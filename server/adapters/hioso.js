import { HttpClient } from '../lib/http.js';
import { snmpWalk } from '../lib/snmp.js';
import { sshOnus, sshTest } from './olt-ssh.js';

// HiOSO OLT adapter (multi-vendor).
//
// Supported modes:
//   1. simulated  -> deterministic demo ONUs (default for trial)
//   2. http       -> configurable web UI endpoint (form login + JSON/HTML table)
//   3. snmp       -> configurable private MIB OIDs (GETNEXT walk)
//   4. ssh        -> remote CLI via SSH (Huawei/ZTE/HiOSO/FiberHome/...)
//
// Because firmware revisions differ, loginPath/onuPath, SNMP OIDs, and SSH CLI
// commands are editable per OLT from the UI. The HTML/CLI parsers auto-detect
// common columns (ONU ID, name, MAC, status, RX power, distance).

const SIM_NAMES = {
  jbr: [
    ['ONU-KLV-8812', '8812A1B2C3D4', -19.4, 740, 'Budi Santoso', '50 Mbps'],
    ['ONU-KLV-7710', '7710E5F6A7B8', -21.1, 910, 'Siti Aminah', '30 Mbps'],
    ['ONU-TGB-4412', '4412C3D4E5F6', -20.2, 620, 'Rizal Hakim', '100 Mbps'],
    ['ONU-KWN-9901', '9901A7B8C9D0', -23.8, 1840, 'Dewi Lestari', '20 Mbps'],
    ['ONU-LAB-0001', 'A1B2C3D4E5F6', -18.7, 120, 'Lab lintasJB', '100 Mbps'],
  ],
  bwi: [
    ['ONU-SBO-5521', '5521D4E5F6A7', -27.2, 2100, 'Andi Wijaya', '20 Mbps'],
    ['ONU-SBO-5522', '5522E5F6A7B8', -22.4, 1560, 'Maya Putri', '50 Mbps'],
    ['ONU-SBO-5523', '5523F6A7B8C9', -20.8, 1320, 'Hendra Gunawan', '30 Mbps'],
    ['ONU-BWI-0004', 'B4C5D6E7F8A9', -24.1, 2250, 'Warung Sobo', '20 Mbps'],
  ],
};

function simOnus(olt) {
  const family = String(olt.id || '').includes('bwi') ? 'bwi' : 'jbr';
  const rows = SIM_NAMES[family];
  return rows.map(([name, serial, rx, distance, customer, profile], idx) => ({
    onuId: idx + 1,
    name,
    serial,
    mac: serial.match(/.{1,2}/g)?.join(':').slice(0, 17) || '',
    status: idx === 0 && family === 'bwi' ? 'warning' : 'online',
    rxPower: rx,
    txPower: 2.2,
    distanceM: distance,
    customer,
    profile,
    interface: `epon 0/${Math.floor(idx / 4) + 1}:${(idx % 4) + 1}`,
    lastSeen: new Date(Date.now() - (idx === 0 && family === 'bwi' ? 240000 : 45000)).toISOString(),
  }));
}

function friendly(err, olt) {
  const msg = String(err?.message || err);
  const target = `${olt.host}:${olt.port}`;
  if (/authentication methods failed|authentication failed|permission denied|access denied/i.test(msg)) {
    return new Error(
      `Autentikasi ${olt.protocol === 'ssh' ? 'SSH' : 'OLT'} gagal pada ${target}. Periksa username/password atau private key. (${msg})`
    );
  }
  if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|Timeout|timed out/i.test(msg)) {
    return new Error(
      `OLT ${olt.name || olt.host} tidak dapat dihubungi (${target}). Periksa jaringan/mgmt VLAN dan port ${olt.protocol === 'ssh' ? 'SSH' : 'layanan'}. (${msg})`
    );
  }
  return new Error(msg);
}

function stripHtml(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHtmlTables(html) {
  const tables = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  const matches = String(html).match(tableRe) || [];
  for (const table of matches) {
    const rows = [];
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    for (const row of table.match(rowRe) || []) {
      const cells = [];
      const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let m;
      while ((m = cellRe.exec(row))) cells.push(stripHtml(m[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length > 1) tables.push(rows);
  }
  return tables;
}

function mapOnuRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.toLowerCase());
  const find = (...needles) => headers.findIndex((h) => needles.some((n) => h.includes(n)));
  const idx = {
    id: find('onu id', 'onu-id', 'index', 'no'),
    name: find('name', 'description', 'customer', 'user'),
    mac: find('mac'),
    status: find('status', 'state', 'online'),
    rx: find('rx', 'receive', 'optical'),
    distance: find('distance', 'ranging'),
  };
  const dataRows = rows.slice(1);
  return dataRows
    .filter((r) => r.length > 1)
    .map((r, i) => {
      const statusText = (idx.status >= 0 ? r[idx.status] : 'online').toLowerCase();
      const rxRaw = idx.rx >= 0 ? Number(String(r[idx.rx]).replace(/[^0-9+.-]/g, '')) : null;
      const rx = Number.isFinite(rxRaw) && rxRaw > 0 && rxRaw < 100 ? -rxRaw : rxRaw;
      const name = idx.name >= 0 && r[idx.name] ? r[idx.name] : `ONU-${i + 1}`;
      return {
        onuId: idx.id >= 0 ? Number(r[idx.id]) || i + 1 : i + 1,
        name,
        serial: idx.mac >= 0 ? r[idx.mac] : '',
        mac: idx.mac >= 0 ? r[idx.mac] : '',
        status: /off|down|los|inactive|fail/.test(statusText)
          ? 'offline'
          : /warn|dying|degrad/.test(statusText)
            ? 'warning'
            : 'online',
        rxPower: Number.isFinite(rx) ? rx : null,
        distanceM: idx.distance >= 0 ? Number(String(r[idx.distance]).replace(/[^0-9.]/g, '')) || null : null,
        customer: idx.name >= 0 ? r[idx.name] : '',
        profile: '',
        interface: '',
        lastSeen: new Date().toISOString(),
      };
    });
}

function normalizeJsonOnus(data) {
  let list = data;
  if (!Array.isArray(list)) {
    list = data?.onus || data?.data || data?.list || data?.rows || data?.result || [];
  }
  if (!Array.isArray(list)) return [];
  return list.map((o, i) => {
    const status = String(o.status ?? o.state ?? o.online ?? 'online').toLowerCase();
    return {
      onuId: Number(o.onuId ?? o.id ?? o.index ?? i + 1),
      name: o.name || o.description || o.customer || `ONU-${i + 1}`,
      serial: o.serial || o.sn || o.mac || '',
      mac: o.mac || '',
      status: /off|down|los|inactive|0|false/.test(status) ? 'offline' : /warn|dying/.test(status) ? 'warning' : 'online',
      rxPower: Number(o.rxPower ?? o.rx ?? o.rx_power ?? NaN) || null,
      txPower: Number(o.txPower ?? o.tx ?? NaN) || null,
      distanceM: Number(o.distance ?? o.distanceM ?? NaN) || null,
      customer: o.customer || o.description || '',
      profile: o.profile || o.bandwidth || '',
      interface: o.interface || o.port || '',
      lastSeen: new Date().toISOString(),
    };
  });
}

function normalizeSnmpValue(value, type) {
  if (type === 'status') {
    const s = String(value).toLowerCase();
    if (/^(1|up|online|active|true)$/.test(s)) return 'online';
    if (/^(2|down|offline|inactive|false)$/.test(s)) return 'offline';
    if (/warn|dying|degrad/.test(s)) return 'warning';
    return 'offline';
  }
  if (type === 'rx') {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (n > 0 && n < 1000) return -(n / 10);
    if (n < -60) return n / 10;
    return n;
  }
  return value == null ? '' : String(value);
}

function suffix(oid, base) {
  return oid.startsWith(base) ? oid.slice(base.length + 1) : oid;
}

async function snmpOnus(olt) {
  const snmp = olt.snmp || {};
  const host = olt.host;
  const community = snmp.community || 'public';
  const port = Number(snmp.port) || 161;
  if (!snmp.onuStatusOid) {
    throw new Error('OID status ONU belum diisi pada konfigurasi SNMP OLT.');
  }
  const statusRows = await snmpWalk(host, community, snmp.onuStatusOid, { port, timeout: 2500, maxRows: 256 });
  const nameRows = snmp.onuNameOid
    ? await snmpWalk(host, community, snmp.onuNameOid, { port, timeout: 2500, maxRows: 256 })
    : [];
  const macRows = snmp.onuMacOid
    ? await snmpWalk(host, community, snmp.onuMacOid, { port, timeout: 2500, maxRows: 256 })
    : [];
  const rxRows = snmp.onuRxOid
    ? await snmpWalk(host, community, snmp.onuRxOid, { port, timeout: 2500, maxRows: 256 })
    : [];
  const map = new Map();
  for (const row of statusRows) {
    const key = suffix(row.oid, snmp.onuStatusOid);
    map.set(key, {
      onuId: Number(key.split('.').pop()) || map.size + 1,
      name: `ONU-${key}`,
      status: normalizeSnmpValue(row.value, 'status'),
      serial: '',
      mac: '',
      rxPower: null,
      distanceM: null,
      interface: '',
      lastSeen: new Date().toISOString(),
    });
  }
  for (const row of nameRows) {
    const key = suffix(row.oid, snmp.onuNameOid);
    const item = map.get(key);
    if (item) {
      item.name = String(row.value || item.name);
      item.customer = item.name;
    }
  }
  for (const row of macRows) {
    const item = map.get(suffix(row.oid, snmp.onuMacOid));
    if (item) {
      item.mac = String(row.value || '');
      item.serial = item.mac.replace(/[^a-fA-F0-9]/g, '');
    }
  }
  for (const row of rxRows) {
    const item = map.get(suffix(row.oid, snmp.onuRxOid));
    if (item) item.rxPower = normalizeSnmpValue(row.value, 'rx');
  }
  return [...map.values()];
}

export async function getOnus(olt) {
  const started = Date.now();
  if (olt.simulated) {
    const onus = simOnus(olt);
    return {
      ok: true,
      simulated: true,
      source: 'simulation',
      latencyMs: Date.now() - started,
      onus,
      summary: summarize(onus),
      message: `Mode simulasi: ${onus.length} ONU terbaca dari OLT ${olt.name}.`,
    };
  }
  if (olt.protocol === 'snmp') {
    try {
      const onus = await snmpOnus(olt);
      return {
        ok: true,
        source: 'snmp',
        latencyMs: Date.now() - started,
        onus,
        summary: summarize(onus),
        message: `SNMP walk berhasil: ${onus.length} ONU.`,
      };
    } catch (err) {
      throw friendly(err, olt);
    }
  }

  if (olt.protocol === 'ssh' || olt.protocol === 'cli') {
    try {
      const result = await sshOnus(olt);
      return {
        ok: true,
        source: 'ssh',
        latencyMs: result.latencyMs,
        onus: result.onus,
        summary: summarize(result.onus),
        message: result.message,
      };
    } catch (err) {
      throw friendly(err, olt);
    }
  }

  // HTTP web UI mode
  try {
    const scheme = olt.tls ? 'https' : 'http';
    const port = Number(olt.port) || (olt.tls ? 443 : 80);
    const http = new HttpClient({
      baseUrl: `${scheme}://${olt.host}:${port}`,
      username: undefined,
      insecure: true,
      timeout: 12000,
    });
    if (olt.username) {
      const form = {
        [olt.loginUserField || 'username']: olt.username,
        [olt.loginPassField || 'password']: olt.password || '',
      };
      const login = await http.post(olt.loginPath || '/login.cgi', { form });
      if (login.status === 401 || login.status === 403) {
        throw new Error('Login web HiOSO ditolak. Periksa username/password.');
      }
    }
    const res = await http.get(olt.onuPath || '/cgi-bin/onu_list.cgi');
    if (!res.ok) throw new Error(`HTTP ${res.status} dari halaman ONU HiOSO.`);
    let onus = [];
    if (res.data) onus = normalizeJsonOnus(res.data);
    if (!onus.length) {
      const tables = parseHtmlTables(res.text);
      const candidates = tables
        .map(mapOnuRows)
        .sort((a, b) => b.length - a.length);
      onus = candidates[0] || [];
    }
    if (!onus.length) {
      throw new Error(
        'Halaman HiOSO terbaca tetapi tabel ONU tidak dikenali. Sesuaikan onuPath atau gunakan mode SNMP.'
      );
    }
    return {
      ok: true,
      source: 'http',
      latencyMs: Date.now() - started,
      onus,
      summary: summarize(onus),
      message: `HiOSO web UI: ${onus.length} ONU terbaca.`,
    };
  } catch (err) {
    throw friendly(err, olt);
  }
}

export function summarize(onus = []) {
  return {
    total: onus.length,
    online: onus.filter((o) => o.status === 'online').length,
    offline: onus.filter((o) => o.status === 'offline').length,
    warning: onus.filter((o) => o.status === 'warning').length,
  };
}

export async function testConnection(olt) {
  if (!olt.simulated && (olt.protocol === 'ssh' || olt.protocol === 'cli')) {
    try {
      return await sshTest(olt);
    } catch (err) {
      return { ok: false, message: friendly(err, olt).message };
    }
  }
  try {
    const result = await getOnus(olt);
    return {
      ok: true,
      latencyMs: result.latencyMs,
      message: result.message,
      summary: result.summary,
      source: result.source,
      simulated: Boolean(result.simulated),
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export default { getOnus, testConnection, summarize };
