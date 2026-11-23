import ssh2 from 'ssh2';

const { Client } = ssh2;

/**
 * Adapter SSH untuk OLT.
 *
 * OLT jaringan (Huawei, ZTE, HiOSO, FiberHome, ...) umumnya tidak menerima
 * "exec" SSH seperti server Linux. Karena itu adapter ini membuka shell
 * interaktif, menuliskan perintah CLI, menangani prompt "More", lalu
 * mengumpulkan output sampai idle. Password maupun private key tidak pernah
 * dikirim ke browser.
 */

const PRESETS = {
  huawei: { test: 'display version', onus: 'display ont info 0 all' },
  zte: { test: 'show version', onus: 'show gpon onu state' },
  hioso: { test: 'show version', onus: 'show onu all' },
  fiberhome: { test: 'show version', onus: 'show onu all' },
  nokia: { test: 'show version', onus: 'show ont all' },
  vsol: { test: 'show version', onus: 'show onu all' },
  raisecom: { test: 'show version', onus: 'show onu info' },
  cdata: { test: 'show version', onus: 'show onu all' },
  mikrotik: { test: '/system resource print', onus: '/interface print' },
  generic: { test: 'show version', onus: 'show onu all' },
};

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;
const PAGER_RE = /(-{2,}\s*more\s*-{2,}|<---\s*more\s*--->|--more--)/i;

export function oltSshPreset(olt) {
  return PRESETS[String(olt?.vendor || 'generic').toLowerCase()] || PRESETS.generic;
}

export function cleanTerminal(text) {
  return String(text || '')
    .replace(ANSI_RE, '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectionConfig(olt, timeout) {
  const config = {
    host: olt.host,
    port: Number(olt.port) || 22,
    username: olt.username || '',
    readyTimeout: Math.min(Number(timeout) || 15000, 60000),
    keepaliveInterval: 5000,
    keepaliveCountMax: 2,
    hostVerifier: () => true,
    tryKeyboard: true,
  };
  if (olt.sshPrivateKey) {
    config.privateKey = olt.sshPrivateKey;
    if (olt.sshKeyPassphrase) config.passphrase = olt.sshKeyPassphrase;
  } else {
    config.password = olt.password || '';
  }
  return config;
}

function connect(olt, timeout) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch { /* ignore */ }
      reject(new Error(`Timeout ${Math.round((Number(timeout) || 15000) / 1000)} detik saat membuka SSH ${olt.host}:${olt.port || 22}.`));
    }, (Number(timeout) || 15000) + 2000);

    conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => olt.password || ''));
    });
    conn.on('ready', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(conn);
    });
    conn.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    try {
      conn.connect(connectionConfig(olt, timeout));
    } catch (err) {
      settled = true;
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Jalankan satu atau beberapa perintah CLI di shell SSH dan kembalikan output.
 */
export function sshShell(olt, commands, options = {}) {
  const timeout = Number(options.timeout) || 20000;
  const idleMs = Number(options.idleMs) || 900;
  const bannerMs = Number(options.bannerMs) || 700;
  const list = (Array.isArray(commands) ? commands : [commands])
    .map((c) => String(c || '').trim())
    .filter(Boolean);

  return new Promise((resolve, reject) => {
    const started = Date.now();
    let output = '';
    let finished = false;
    let conn = null;
    let idleTimer = null;
    let hardTimer = null;

    const cleanup = () => {
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      try { conn?.end(); } catch { /* ignore */ }
    };
    const done = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (err) reject(err);
      else resolve({ output: cleanTerminal(output), latencyMs: Date.now() - started });
    };
    const armIdle = (stream) => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        try { stream.write('exit\n'); } catch { /* ignore */ }
        done();
      }, idleMs);
    };

    hardTimer = setTimeout(() => done(new Error(`Timeout ${Math.round(timeout / 1000)} detik menunggu output SSH.`)), timeout);

    connect(olt, Math.min(timeout, 15000)).then((client) => {
      conn = client;
      const openShell = (cb) => {
        client.shell({ term: 'vt100', cols: 240, rows: 64 }, (err, stream) => {
          // Sebagian perangkat menolak PTY; fallback ke shell tanpa PTY.
          if (err && /pseudo-terminal/i.test(String(err.message))) {
            client.shell(false, cb);
            return;
          }
          cb(err, stream);
        });
      };
      openShell((err, stream) => {
        if (err) return done(err);
        stream.on('data', (chunk) => {
          output += chunk.toString('utf8');
          if (PAGER_RE.test(output.slice(-120))) {
            try { stream.write(' '); } catch { /* ignore */ }
          }
          armIdle(stream);
        });
        stream.stderr?.on('data', (chunk) => {
          output += chunk.toString('utf8');
          armIdle(stream);
        });
        stream.on('close', () => done());

        (async () => {
          await delay(bannerMs);
          for (const command of list) {
            stream.write(command.endsWith('\n') ? command : `${command}\n`);
            await delay(400);
          }
          armIdle(stream);
        })().catch((e) => done(e));
      });
    }).catch((err) => done(err));
  });
}

function identityFromOutput(output, olt) {
  const lines = String(output || '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .map((line) => line.replace(/^(?:<[^>]+>|\[[^\]]+\]|[A-Za-z0-9_.-]{2,40}[>#])\s*/, ''))
    .filter(Boolean)
    .filter((line) => !/^(login|password|user(name)?|warning|last login|trying|press any key|% ?unknown|% ?invalid)\b/i.test(line));
  const preferred = lines.find((line) => /version|model|system name|hostname|serial|board|uptime/i.test(line));
  return (preferred || lines[0] || olt.name || olt.host || 'OLT').slice(0, 160);
}

export async function sshTest(olt) {
  const preset = oltSshPreset(olt);
  const command = String(olt.sshTestCommand || '').trim() || preset.test;
  const started = Date.now();
  const result = await sshShell(olt, [command], { timeout: 20000 });
  const output = result.output.trim();
  if (!output) {
    throw new Error('SSH terhubung tetapi tidak ada output dari perintah tes. Periksa prompt/enable OLT.');
  }
  const identity = identityFromOutput(output, olt);
  return {
    ok: true,
    protocol: 'ssh',
    latencyMs: result.latencyMs || Date.now() - started,
    message: `SSH OK • ${identity}`,
    resource: {
      identity,
      host: olt.host,
      port: Number(olt.port) || 22,
      command,
    },
    output: output.slice(0, 2000),
  };
}

const SERIAL_RE = /\b(?:[A-Z]{4}[0-9A-F]{8,12}|(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}|[0-9A-F]{12,16})\b/i;

function pickNumber(line, re) {
  const match = line.match(re);
  if (!match) return null;
  const value = Number(String(match[1]).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse output CLI ONU yang umum dipakai vendor OLT.
 * Baris yang tidak memuat serial/MAC dilewati, sehingga header dan prompt aman.
 */
export function parseOnuText(raw, olt = {}) {
  const text = cleanTerminal(raw);
  const rows = [];
  const seen = new Set();
  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length > 600) continue;
    const serialMatch = line.match(SERIAL_RE);
    if (!serialMatch) continue;
    const serial = serialMatch[0].toUpperCase();
    if (seen.has(serial)) continue;

    const lower = line.toLowerCase();
    if (!/(online|offline|up|down|active|inactive|working|los|dying|fail|normal)/i.test(lower)) {
      continue;
    }
    if (/serial\s*(number|no)|mac\s*address\s*(table)?\s*$/i.test(lower) && !/\d\s*dBm/i.test(line)) {
      continue;
    }

    let status = 'online';
    if (/(offline|inactive|\bdown\b|\blos\b|fail|deactive)/i.test(lower)) status = 'offline';
    else if (/(dying|degrad|warn)/i.test(lower)) status = 'warning';

    const rx = pickNumber(line, /(-?\d{1,2}(?:[.,]\d{1,2})?)\s*dBm/i);
    const distance = pickNumber(line, /(\d{1,5})\s*m\b/i);
    let onuId = pickNumber(line, /\b(\d{1,3})\s*\/\s*\d{1,3}\s*\/\s*\d{1,3}\b/);
    if (onuId === null) onuId = pickNumber(line, /\bonu[-\s:]*(\d{1,5})\b/i);
    if (onuId === null) onuId = pickNumber(line, /^\s*(\d{1,4})\s+[A-Za-z]/);
    if (onuId === null) onuId = rows.length + 1;

    let name = '';
    const quoted = line.match(/"([^"]{2,60})"/);
    if (quoted) name = quoted[1];
    if (!name) {
      const tokens = line
        .split(/\s{2,}|\t+/)
        .map((t) => t.trim())
        .filter((t) => t && !SERIAL_RE.test(t) && !/^-+$/.test(t));
      name = tokens.find((t) => /[A-Za-z]{2,}/.test(t) && !/online|offline|active|inactive|working|dying|los|gpon|epon/i.test(t)) || '';
    }

    seen.add(serial);
    rows.push({
      onuId,
      name: name || `ONU-${onuId}`,
      serial,
      mac: serial.includes(':') || serial.includes('-') ? serial : '',
      status,
      rxPower: rx,
      txPower: null,
      distanceM: distance,
      customer: name || '',
      profile: '',
      interface: '',
      lastSeen: new Date().toISOString(),
    });
  }

  return rows;
}

export async function sshOnus(olt) {
  const preset = oltSshPreset(olt);
  const command = String(olt.sshOnuCommand || '').trim() || preset.onus;
  const result = await sshShell(olt, [command], { timeout: 35000, idleMs: 1200 });
  const onus = parseOnuText(result.output, olt);
  if (!onus.length) {
    const snippet = result.output.split('\n').filter(Boolean).slice(-8).join(' | ').slice(0, 300);
    throw new Error(
      `SSH berhasil tetapi daftar ONU tidak dapat diparse. Sesuaikan "Perintah ONU" (${command}). Output terakhir: ${snippet || 'kosong'}`
    );
  }
  return {
    ok: true,
    source: 'ssh',
    latencyMs: result.latencyMs,
    onus,
    message: `SSH CLI: ${onus.length} ONU terbaca (${command}).`,
    output: result.output.slice(0, 4000),
  };
}

export async function sshExec(olt, command) {
  const cmd = String(command || '').trim();
  if (!cmd) throw new Error('Perintah SSH wajib diisi.');
  if (cmd.length > 300) throw new Error('Perintah SSH terlalu panjang (maksimal 300 karakter).');
  const result = await sshShell(olt, [cmd], { timeout: 30000, idleMs: 1000 });
  return {
    ok: true,
    command: cmd,
    latencyMs: result.latencyMs,
    output: result.output.slice(-20000),
  };
}

export default { sshTest, sshOnus, sshExec, sshShell, parseOnuText, oltSshPreset };
