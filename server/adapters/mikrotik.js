import { HttpClient } from '../lib/http.js';
import { getApiOverview, probeApi } from './routeros-api.js';

// MikroTik RouterOS adapter.
// Mendukung dua jalur koneksi nyata:
//   1. REST API  -> service `www` / `www-ssl` (RouterOS v7), path /rest
//   2. API native -> service `api` (8728) / `api-ssl` (8729), protokol biner
// Deteksi protokol dilakukan otomatis dari port yang diberikan, sehingga
// port NAT apa pun (mis. 8782 -> 8728) tetap bisa dipakai.

const TRANSPORT_TTL = 10 * 60 * 1000;
const transportCache = new Map();

function cleanHost(host) {
  return String(host || '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/.*$/, '');
}

function origin(router) {
  const scheme = router.tls === false ? 'http' : 'https';
  const port = Number(router.port) || (scheme === 'https' ? 443 : 80);
  return `${scheme}://${cleanHost(router.host)}:${port}`;
}

function client(router) {
  if (!router.host) throw new Error('Host router MikroTik belum diisi.');
  return new HttpClient({
    baseUrl: origin(router),
    username: router.username || '',
    password: router.password || '',
    insecure: true,
    timeout: router.timeout || 12000,
  });
}

function friendly(err, transport = '') {
  const msg = String(err?.message || err);
  if (/Invalid URL|ERR_INVALID_URL/i.test(msg)) {
    return new Error('Host/port router tidak valid. Gunakan format IP atau domain tanpa http://.');
  }
  if (/invalid user name or password|Autentikasi RouterOS|not logged in/i.test(msg)) {
    return new Error('Autentikasi RouterOS gagal. Periksa username dan password API.');
  }
  if (/wrong version number|EPROTO|ssl3_get_record|Client network socket disconnected|socket hang up/i.test(msg)) {
    return new Error(
      'Port ini tidak memakai HTTPS. Untuk service API biner pilih Mode koneksi "API Biner"; untuk REST aktifkan www-ssl di router.'
    );
  }
  if (/Timeout|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|ECONNRESET/i.test(msg)) {
    const hint = transport === 'api'
      ? 'Pastikan service API/API-SSL aktif di router dan port NAT mengarah ke 8728/8729.'
      : 'Pastikan REST API (www/www-ssl) aktif atau gunakan Mode koneksi API Biner.';
    return new Error(`RouterOS tidak dapat dihubungi. ${hint} (${msg})`);
  }
  if (/HTTP 401/.test(msg)) return new Error('Autentikasi RouterOS gagal. Periksa username/password.');
  if (/HTTP 404/.test(msg)) {
    return new Error('Endpoint /rest tidak ditemukan. Aktifkan www-ssl (RouterOS 7) atau gunakan Mode koneksi API Biner.');
  }
  return new Error(msg);
}

async function get(router, path) {
  try {
    const res = await client(router).get(path);
    if (!res.ok) {
      const err = new Error(`RouterOS HTTP ${res.status}: ${res.text.slice(0, 220)}`);
      err.status = res.status;
      throw err;
    }
    return res.data;
  } catch (err) {
    throw friendly(err, 'rest');
  }
}

export async function resolveTransport(router) {
  const host = cleanHost(router.host);
  const port = Number(router.port) || (router.tls === false ? 80 : 443);
  const wantTls = router.tls !== false;

  if (router.transport === 'api') {
    // Port standar API: 8728 plain, 8729 api-ssl. Port NAT lain dideteksi.
    if (port === 8728) return { transport: 'api', useTls: false };
    if (port === 8729) return { transport: 'api', useTls: true };
    if (await probeApi({ host, port, useTls: false, timeout: 2500 })) {
      return { transport: 'api', useTls: false };
    }
    if (wantTls && (await probeApi({ host, port, useTls: true, timeout: 2500 }))) {
      return { transport: 'api', useTls: true };
    }
    return { transport: 'api', useTls: false };
  }
  if (router.transport === 'rest') return { transport: 'rest', useTls: wantTls };

  // Port standar langsung dipetakan tanpa probe agar tidak menambah delay.
  if (port === 8728) return { transport: 'api', useTls: false };
  if (port === 8729) return { transport: 'api', useTls: true };
  if (port === 443) return { transport: 'rest', useTls: true };
  if (port === 80) return { transport: 'rest', useTls: false };

  const key = `${host}:${port}:${wantTls ? 1 : 0}`;
  const cached = transportCache.get(key);
  if (cached && Date.now() - cached.at < TRANSPORT_TTL) return cached.value;

  let value = null;
  if (await probeApi({ host, port, useTls: false, timeout: 2500 })) {
    value = { transport: 'api', useTls: false };
  } else if (wantTls && (await probeApi({ host, port, useTls: true, timeout: 2500 }))) {
    value = { transport: 'api', useTls: true };
  }
  if (!value) value = { transport: 'rest', useTls: wantTls };

  transportCache.set(key, { at: Date.now(), value });
  return value;
}

function normalize(raw, router) {
  const resource = raw.resource || {};
  const interfaces = Array.isArray(raw.interfaces)
    ? raw.interfaces
    : raw.interfaces
      ? [raw.interfaces]
      : [];
  const monitored = Array.isArray(router.monitoredInterfaces)
    ? router.monitoredInterfaces.filter(Boolean)
    : [];
  const normalizedInterfaces = interfaces.map((i) => ({
    name: i.name,
    type: i.type || '',
    running: i.running === true || i.running === 'true',
    disabled: i.disabled === true || i.disabled === 'true',
    rxByte: Number(i['rx-byte'] || 0),
    txByte: Number(i['tx-byte'] || 0),
    speed: i['link-speed'] || i.speed || '',
    comment: i.comment || '',
    monitored: monitored.includes(i.name),
  }));
  const down = normalizedInterfaces.filter((i) => i.monitored && (!i.running || i.disabled));
  return {
    ok: true,
    resource: {
      cpuLoad: Number(resource['cpu-load'] || 0),
      uptime: resource.uptime || '',
      version: resource.version || '',
      board: resource['board-name'] || '',
      architecture: resource['architecture-name'] || '',
      totalMemory: Number(resource['total-memory'] || 0),
      freeMemory: Number(resource['free-memory'] || 0),
      identity: raw.identity || '',
    },
    interfaces: normalizedInterfaces,
    pppActive: Array.isArray(raw.pppActive) ? raw.pppActive : [],
    health: Array.isArray(raw.health) ? raw.health : [],
    monitored,
    downInterfaces: down.map((i) => i.name),
    summary: {
      interfaceTotal: normalizedInterfaces.length,
      interfaceUp: normalizedInterfaces.filter((i) => i.running && !i.disabled).length,
      monitoredTotal: monitored.length,
      monitoredDown: down.length,
      pppActive: Array.isArray(raw.pppActive) ? raw.pppActive.length : 0,
    },
  };
}

async function restOverview(router) {
  const [resource, interfaces, pppActive, health] = await Promise.all([
    get(router, '/rest/system/resource'),
    get(router, '/rest/interface'),
    get(router, '/rest/ppp/active').catch(() => []),
    get(router, '/rest/system/health').catch(() => []),
  ]);
  return {
    resource,
    interfaces: Array.isArray(interfaces) ? interfaces : [interfaces].filter(Boolean),
    pppActive: Array.isArray(pppActive) ? pppActive : [],
    health: Array.isArray(health) ? health : [],
  };
}

async function loadOverview(router) {
  const resolved = await resolveTransport(router);
  const raw = resolved.transport === 'api'
    ? await getApiOverview({ ...router, useTls: resolved.useTls })
    : await restOverview(router);
  return { raw, resolved };
}

export async function testConnection(router) {
  const started = Date.now();
  try {
    const { raw, resolved } = await loadOverview(router);
    const data = normalize(raw, router);
    return {
      ...data,
      latencyMs: Date.now() - started,
      message:
        resolved.transport === 'api'
          ? 'Koneksi RouterOS API native berhasil.'
          : 'Koneksi RouterOS REST API berhasil.',
      transport: resolved.transport,
      useTls: resolved.useTls,
    };
  } catch (err) {
    throw friendly(err);
  }
}

export async function getOverview(router) {
  try {
    const { raw, resolved } = await loadOverview(router);
    return { ...normalize(raw, router), transport: resolved.transport, useTls: resolved.useTls };
  } catch (err) {
    throw friendly(err);
  }
}

export default { testConnection, getOverview, resolveTransport };
