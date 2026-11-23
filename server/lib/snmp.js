import dgram from 'node:dgram';

// Minimal SNMP v2c client (GET / GETNEXT / WALK) implemented on top of UDP.
// Used as a vendor-neutral fallback for HiOSO EPON/GPON OLTs. OIDs are
// configurable from the OLT form because firmware revisions expose different
// private MIBs.

let requestId = Math.floor(Math.random() * 0x7fffffff);

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, value) {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}

function encodeInt(value) {
  const bytes = [];
  let n = Number(value);
  if (n === 0) bytes.push(0);
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}

function encodeOid(oid) {
  const parts = String(oid).split('.').map((n) => Number(n));
  const first = 40 * parts[0] + parts[1];
  const bytes = [first];
  for (const part of parts.slice(2)) {
    if (part < 0x80) {
      bytes.push(part);
    } else {
      const stack = [part & 0x7f];
      let n = Math.floor(part / 128);
      while (n > 0) {
        stack.unshift((n & 0x7f) | 0x80);
        n = Math.floor(n / 128);
      }
      bytes.push(...stack);
    }
  }
  return tlv(0x06, Buffer.from(bytes));
}

function buildRequest(community, pduTag, oid) {
  requestId = (requestId + 1) & 0x7fffffff;
  const varbind = tlv(0x30, Buffer.concat([encodeOid(oid), tlv(0x05, Buffer.alloc(0))]));
  const varbinds = tlv(0x30, varbind);
  const pdu = tlv(
    pduTag,
    Buffer.concat([encodeInt(requestId), encodeInt(0), encodeInt(0), varbinds])
  );
  return tlv(
    0x30,
    Buffer.concat([
      encodeInt(1),
      tlv(0x04, Buffer.from(community || 'public')),
      pdu,
    ])
  );
}

function readTlv(buf, offset) {
  if (offset >= buf.length) return null;
  const tag = buf[offset];
  let len = buf[offset + 1];
  let header = 2;
  if (len === undefined) return null;
  if (len & 0x80) {
    const count = len & 0x7f;
    len = 0;
    for (let i = 0; i < count; i += 1) len = len * 256 + buf[offset + 2 + i];
    header = 2 + count;
  }
  const start = offset + header;
  if (start + len > buf.length) return null;
  return { tag, length: len, value: buf.subarray(start, start + len), start, end: start + len };
}

function decodeInt(value) {
  if (!value.length) return 0;
  let n = value[0] & 0x80 ? -1 : 0;
  for (const byte of value) n = n * 256 + byte;
  return n;
}

function decodeOid(value) {
  if (!value.length) return '';
  const parts = [Math.floor(value[0] / 40), value[0] % 40];
  let n = 0;
  for (let i = 1; i < value.length; i += 1) {
    n = n * 128 + (value[i] & 0x7f);
    if (!(value[i] & 0x80)) {
      parts.push(n);
      n = 0;
    }
  }
  return parts.join('.');
}

function decodeValue(tag, value) {
  switch (tag) {
    case 0x02:
      return decodeInt(value);
    case 0x04:
      return value.toString('utf8');
    case 0x05:
      return null;
    case 0x06:
      return decodeOid(value);
    case 0x40:
      return [...value].join('.');
    case 0x41:
    case 0x42:
    case 0x43:
      return decodeInt(value);
    case 0x46: {
      let n = 0;
      for (const b of value) n = n * 256 + b;
      return n;
    }
    case 0x80:
      return { error: 'noSuchObject' };
    case 0x81:
      return { error: 'noSuchInstance' };
    case 0x82:
      return { error: 'endOfMibView' };
    default:
      return value.toString('hex');
  }
}

function parseResponse(buf) {
  const top = readTlv(buf, 0);
  if (!top) throw new Error('Respons SNMP tidak valid.');
  let offset = top.start;
  const version = readTlv(buf, offset);
  if (!version) throw new Error('Respons SNMP tidak lengkap.');
  offset = version.end;
  const community = readTlv(buf, offset);
  offset = community.end;
  const pdu = readTlv(buf, offset);
  if (!pdu) throw new Error('PDU SNMP tidak ditemukan.');
  let p = pdu.start;
  const reqId = readTlv(buf, p);
  p = reqId.end;
  const errStatus = readTlv(buf, p);
  p = errStatus.end;
  const errIndex = readTlv(buf, p);
  p = errIndex.end;
  const list = readTlv(buf, p);
  if (!list) throw new Error('Varbind SNMP kosong.');
  const vars = [];
  let v = list.start;
  while (v < list.end) {
    const vb = readTlv(buf, v);
    if (!vb) break;
    let q = vb.start;
    const oid = readTlv(buf, q);
    q = oid.end;
    const val = readTlv(buf, q);
    vars.push({
      oid: decodeOid(oid.value),
      value: val ? decodeValue(val.tag, val.value) : null,
      tag: val?.tag,
    });
    v = vb.end;
  }
  return {
    requestId: decodeInt(reqId.value),
    errorStatus: decodeInt(errStatus.value),
    errorIndex: decodeInt(errIndex.value),
    vars,
  };
}

function send(host, port, packet, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timeout SNMP dari ${host}:${port} (${timeoutMs} ms).`));
    }, timeoutMs);
    socket.once('message', (msg) => {
      clearTimeout(timer);
      socket.close();
      try {
        resolve(parseResponse(msg));
      } catch (err) {
        reject(err);
      }
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
    socket.send(packet, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
}

export async function snmpGet(host, community, oids, opts = {}) {
  const port = Number(opts.port) || 161;
  const targets = Array.isArray(oids) ? oids : [oids];
  const out = {};
  for (const oid of targets) {
    const res = await send(host, port, buildRequest(community, 0xa0, oid), opts.timeout);
    if (res.errorStatus) throw new Error(`SNMP error-status ${res.errorStatus} untuk ${oid}`);
    out[oid] = res.vars[0]?.value;
  }
  return out;
}

export async function snmpWalk(host, community, baseOid, opts = {}) {
  const port = Number(opts.port) || 161;
  const maxRows = Math.min(Number(opts.maxRows) || 256, 2048);
  const rows = [];
  let current = baseOid;
  for (let i = 0; i < maxRows; i += 1) {
    const res = await send(host, port, buildRequest(community, 0xa1, current), opts.timeout);
    if (res.errorStatus) throw new Error(`SNMP walk error-status ${res.errorStatus}`);
    const vb = res.vars[0];
    if (!vb || vb.value?.error === 'endOfMibView') break;
    if (!vb.oid.startsWith(baseOid)) break;
    if (vb.oid === current) break;
    rows.push({ oid: vb.oid, value: vb.value });
    current = vb.oid;
  }
  return rows;
}

export default { snmpGet, snmpWalk };
