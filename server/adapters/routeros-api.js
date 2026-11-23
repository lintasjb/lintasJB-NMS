import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

/*
 * MikroTik RouterOS native API client (protocol v1).
 * Dipakai saat port yang diberikan mengarah ke service `api` (8728) atau
 * `api-ssl` (8729), bukan REST API `www-ssl`.
 *
 * Protokol: setiap kata diawali panjang (1-4 byte), satu kalimat diakhiri
 * kata kosong (0x00). Login memakai challenge MD5; bila router menolak
 * challenge (mis. password non-ASCII), otomatis fallback ke login plaintext.
 */

const DEFAULT_TIMEOUT = 10000;

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(len | 0x8000);
    return b;
  }
  if (len < 0x200000) {
    const b = Buffer.alloc(3);
    b[0] = (len >> 16) | 0xc0;
    b[1] = (len >> 8) & 0xff;
    b[2] = len & 0xff;
    return b;
  }
  const b = Buffer.alloc(4);
  b.writeUInt32BE(len | 0xe0000000);
  return b;
}

function encodeWord(word) {
  const body = Buffer.from(String(word), 'utf8');
  return Buffer.concat([encodeLength(body.length), body]);
}

function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}

/** Ambil semua kalimat lengkap dari buffer; sisanya dikembalikan apa adanya. */
function takeSentences(buffer) {
  const sentences = [];
  let words = [];
  let i = 0;
  let sentenceStart = 0;

  while (i < buffer.length) {
    const prefixStart = i;
    let len = buffer[i];
    let prefix = 1;

    if (len & 0x80) {
      if (len & 0x40) {
        if (len & 0x20) {
          if (i + 3 >= buffer.length) return { sentences, rest: buffer.subarray(sentenceStart) };
          len = ((len & 0x1f) << 24) | (buffer[i + 1] << 16) | (buffer[i + 2] << 8) | buffer[i + 3];
          prefix = 4;
        } else {
          if (i + 2 >= buffer.length) return { sentences, rest: buffer.subarray(sentenceStart) };
          len = ((len & 0x3f) << 16) | (buffer[i + 1] << 8) | buffer[i + 2];
          prefix = 3;
        }
      } else {
        if (i + 1 >= buffer.length) return { sentences, rest: buffer.subarray(sentenceStart) };
        len = ((len & 0x7f) << 8) | buffer[i + 1];
        prefix = 2;
      }
    }

    i += prefix;
    if (len === 0) {
      sentences.push(words);
      words = [];
      sentenceStart = i;
      continue;
    }
    if (i + len > buffer.length) {
      i = prefixStart;
      break;
    }
    words.push(buffer.subarray(i, i + len).toString('utf8'));
    i += len;
  }

  return { sentences, rest: buffer.subarray(sentenceStart) };
}

function attrsOf(sentence) {
  const out = {};
  for (const word of sentence) {
    if (!word || word[0] !== '=' || word.startsWith('=ret=')) continue;
    const idx = word.indexOf('=', 1);
    if (idx < 1) continue;
    out[word.slice(1, idx)] = word.slice(idx + 1);
  }
  return out;
}

function messageOf(sentence) {
  const attr = sentence.find((w) => w.startsWith('=message='));
  return attr ? attr.slice(9) : '';
}

function trapError(sentence, fallback) {
  const message = messageOf(sentence) || fallback;
  const err = new Error(message);
  err.routerOs = true;
  return err;
}

class RouterOsApi {
  constructor({ host, port, username = '', password = '', useTls = false, timeout = DEFAULT_TIMEOUT } = {}) {
    this.host = host;
    this.port = Number(port) || (useTls ? 8729 : 8728);
    this.username = username || '';
    this.password = password || '';
    this.useTls = Boolean(useTls);
    this.timeout = timeout;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
    this.closed = true;
    this.socketError = null;
  }

  async open() {
    if (this.socket && !this.closed) return;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
    this.socketError = null;
    const socket = await new Promise((resolve, reject) => {
      let sock;
      const onConnect = () => {
        try {
          sock.setNoDelay(true);
        } catch {
          /* ignore */
        }
        resolve(sock);
      };
      if (this.useTls) {
        sock = tls.connect(
          { host: this.host, port: this.port, rejectUnauthorized: false, timeout: this.timeout },
          onConnect
        );
      } else {
        sock = net.connect({ host: this.host, port: this.port });
        sock.once('connect', onConnect);
      }
      sock.once('error', reject);
      sock.setTimeout(this.timeout, () =>
        sock.destroy(new Error(`Timeout ${this.timeout} ms saat menghubungi ${this.host}:${this.port}`))
      );
    });

    this.socket = socket;
    this.closed = false;
    socket.setTimeout(0);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('Koneksi RouterOS API ditutup.')));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { sentences, rest } = takeSentences(this.buffer);
    this.buffer = rest;
    for (const sentence of sentences) {
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(sentence);
      else this.queue.push(sentence);
    }
  }

  fail(err) {
    if (this.closed && !this.waiters.length) return;
    this.closed = true;
    this.socketError = err;
    for (const waiter of this.waiters.splice(0)) waiter.reject(err);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  read(timeout = this.timeout) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.reject(this.socketError || new Error('Koneksi RouterOS API ditutup.'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`Timeout ${timeout} ms menunggu balasan RouterOS.`));
      }, timeout);
      waiter.resolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      waiter.reject = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      this.waiters.push(waiter);
    });
  }

  send(words) {
    if (!this.socket || this.closed) throw new Error('Koneksi RouterOS API belum terbuka.');
    this.socket.write(encodeSentence(words));
  }

  async login() {
    await this.open();

    // RouterOS >= 6.43 menerima login plaintext langsung (satu round-trip).
    // Ini juga menghindari percobaan challenge yang gagal di log router.
    this.send(['/login', `=name=${this.username}`, `=password=${this.password}`]);
    let answer = await this.read();
    if (answer.includes('!fatal')) throw new Error(messageOf(answer) || 'RouterOS menutup koneksi.');
    if (answer.includes('!done') && !answer.some((w) => w.startsWith('!trap'))) return;

    // Fallback: challenge MD5 untuk RouterOS lama.
    this.close();
    await this.open();
    this.send(['/login']);
    const first = await this.read();
    const ret = first.find((w) => w.startsWith('=ret='));
    if (!ret || ret.length <= 5) {
      throw new Error('Autentikasi RouterOS gagal. Periksa username dan password API.');
    }
    const challenge = Buffer.from(ret.slice(5), 'hex');
    const digest = crypto
      .createHash('md5')
      .update(Buffer.concat([Buffer.from([0]), Buffer.from(this.password, 'utf8'), challenge]))
      .digest('hex');
    this.send(['/login', `=name=${this.username}`, `=response=00${digest}`]);
    answer = await this.read();
    if (answer.includes('!fatal')) throw new Error(messageOf(answer) || 'RouterOS menutup koneksi.');
    if (answer.some((w) => w.startsWith('!trap')) || !answer.includes('!done')) {
      throw new Error('Autentikasi RouterOS gagal. Periksa username dan password API.');
    }
  }

  async command(words) {
    this.send(words);
    const rows = [];
    for (;;) {
      const sentence = await this.read();
      if (sentence.includes('!fatal')) throw new Error(messageOf(sentence) || 'RouterOS fatal error.');
      if (sentence.some((w) => w.startsWith('!trap'))) {
        throw trapError(sentence, `Perintah RouterOS ditolak: ${words[0]}`);
      }
      if (sentence.includes('!re')) rows.push(attrsOf(sentence));
      else if (sentence.includes('!done') || sentence.includes('!empty')) return rows;
    }
  }

  close() {
    this.closed = true;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error('Koneksi RouterOS API ditutup.'));
  }
}

function healthRows(rows) {
  const out = [];
  for (const row of rows) {
    if (row.name && row.value !== undefined) {
      out.push({ name: row.name, value: row.value, type: row.type || '' });
      continue;
    }
    for (const [name, value] of Object.entries(row)) {
      if (name === '.id' || value === '' || value === undefined) continue;
      out.push({ name, value: String(value), type: row.type || '' });
    }
  }
  return out;
}

async function withConnection(router, fn) {
  const api = new RouterOsApi({
    host: router.host,
    port: router.port,
    username: router.username,
    password: router.password,
    useTls: router.useTls === true,
    timeout: Number(router.timeout) || DEFAULT_TIMEOUT,
  });
  try {
    await api.login();
    return await fn(api);
  } finally {
    api.close();
  }
}

async function safeCommand(api, words) {
  try {
    return await api.command(words);
  } catch (err) {
    if (/no such command|unknown command|not found/i.test(err.message)) return [];
    throw err;
  }
}

export async function getApiOverview(router) {
  return withConnection(router, async (api) => {
    // RouterOS API tidak multiplex perintah, jadi jalankan berurutan.
    const resourceRows = await api.command(['/system/resource/print']);
    const interfaces = await safeCommand(api, ['/interface/print']);
    const pppActive = await safeCommand(api, ['/ppp/active/print']);
    const health = await safeCommand(api, ['/system/health/print']);
    const identity = await safeCommand(api, ['/system/identity/print']);
    return {
      resource: resourceRows[0] || {},
      interfaces,
      pppActive,
      health: healthRows(health),
      identity: identity[0]?.name || '',
    };
  });
}

/** Probe cepat: apakah host:port berbicara protokol API RouterOS? */
export function probeApi({ host, port, useTls, timeout = 2500 }) {
  return new Promise((resolve) => {
    if (!host || !port) return resolve(false);
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeout);
    let sock;
    if (useTls) {
      sock = tls.connect({ host, port, rejectUnauthorized: false, timeout }, () => {
        try {
          sock.write(encodeSentence(['/login']));
        } catch {
          finish(false);
        }
      });
    } else {
      sock = net.connect({ host, port });
      sock.once('connect', () => {
        try {
          sock.write(encodeSentence(['/login']));
        } catch {
          finish(false);
        }
      });
    }
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const text = buf.toString('latin1');
      if (/!(done|trap|fatal|re)/.test(text)) {
        finish(true);
      } else if (buf.length > 96) {
        finish(false);
      }
    });
    sock.once('error', () => finish(false));
    sock.once('close', () => finish(false));
  });
}

export default { getApiOverview, probeApi };
