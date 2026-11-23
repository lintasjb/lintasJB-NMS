import { HttpClient } from '../lib/http.js';

// GenieACS NBI adapter (default NBI port 7557).
// Docs: https://docs.genieacs.com/en/latest/nbi.html

function client(config = {}) {
  if (!config.url) throw new Error('URL GenieACS belum dikonfigurasi.');
  return new HttpClient({
    baseUrl: config.url.replace(/\/+$/, ''),
    username: config.username || '',
    password: config.password || '',
    timeout: config.timeout || 12000,
    insecure: config.insecure !== false,
  });
}

function friendlyError(err, config) {
  const msg = String(err?.message || err);
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|Timeout/.test(msg)) {
    return new Error(
      `GenieACS tidak dapat dihubungi di ${config?.url || '-'}. Pastikan service NBI berjalan dan port 7557 terbuka. (${msg})`
    );
  }
  return new Error(msg);
}

async function request(config, path, opts) {
  try {
    const c = client(config);
    const res = await c.request(path, opts);
    if (!res.ok) {
      let detail = res.text?.slice(0, 300);
      if (res.data) detail = JSON.stringify(res.data).slice(0, 300);
      const err = new Error(`GenieACS HTTP ${res.status}: ${detail || 'tanpa respons'}`);
      err.status = res.status;
      throw err;
    }
    return res.data ?? res.text;
  } catch (err) {
    throw friendlyError(err, config);
  }
}

function unwrap(value) {
  if (value && typeof value === 'object' && '_value' in value) return value._value;
  return value;
}

function flatten(node, prefix = '', out = {}, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return out;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('_') && key !== '_value') continue;
    if (value && typeof value === 'object') {
      if ('_value' in value) out[`${prefix}${key}`] = unwrap(value);
      flatten(value, `${prefix}${key}.`, out, depth + 1);
    }
  }
  return out;
}

function pick(params, patterns) {
  for (const pattern of patterns) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    const keys = Object.keys(params).filter((k) => re.test(k));
    if (keys.length) {
      const sorted = keys.sort((a, b) => b.length - a.length);
      return params[sorted[0]];
    }
  }
  return null;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9+.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function normalizeDevice(device = {}, offlineAfterSec = 600) {
  const params = flatten(device);
  const devId = device._deviceId || {};
  const serial =
    devId._SerialNumber || devId.serialNumber || device._serialNumber || String(device._id || '').split('-').pop();
  const lastInform = device._lastInform ? new Date(device._lastInform) : null;
  const ageSec = lastInform ? (Date.now() - lastInform.getTime()) / 1000 : Infinity;
  const rxRaw = toNumber(
    pick(params, [/(?:RX|Rx|Optical).*Power/i, /OpticalSignalLevel/i, /RXPower$/])
  );
  let rxPower = rxRaw;
  if (rxRaw !== null && rxRaw > 100) rxPower = rxRaw / 1000; // some CPEs report µdBm
  return {
    id: device._id,
    serial,
    oui: devId._OUI || '',
    manufacturer: devId._Manufacturer || device._deviceId?._Manufacturer || '',
    model: devId._ProductClass || device._deviceId?._ProductClass || '',
    hardwareVersion: pick(params, [/HardwareVersion$/i]) || '',
    softwareVersion: pick(params, [/SoftwareVersion$/i, /FirmwareVersion$/i]) || '',
    lastInform: lastInform && !Number.isNaN(lastInform.getTime()) ? lastInform.toISOString() : null,
    online: ageSec <= offlineAfterSec,
    ageSec: Number.isFinite(ageSec) ? Math.round(ageSec) : null,
    ip:
      pick(params, [
        /WANPPPConnection.*ExternalIPAddress$/i,
        /WANIPConnection.*ExternalIPAddress$/i,
        /ExternalIPAddress$/i,
        /WANIPAddress$/i,
      ]) || '',
    pppoeUser: pick(params, [/WANPPPConnection.*Username$/i, /PPP.*Username$/i]) || '',
    ssid: pick(params, [/SSID$/i]) || '',
    uptime: toNumber(pick(params, [/UpTime$/i, /Uptime$/i])),
    rxPower: rxPower !== null ? Number(rxPower.toFixed(2)) : null,
    txPower: toNumber(pick(params, [/TXPower$/i])),
    temperature: toNumber(pick(params, [/Temperature$/i])),
    tags: Array.isArray(device._tags) ? device._tags : [],
    connectionRequestUrl: pick(params, [/ConnectionRequestURL$/i]) || '',
    softwareVersionFull: device._softwareVersion || '',
  };
}

export async function testConnection(config) {
  const started = Date.now();
  const data = await request(config, '/devices/?query=%7B%7D&limit=1');
  return {
    ok: true,
    latencyMs: Date.now() - started,
    deviceCount: Array.isArray(data) ? data.length : 0,
    message: 'Koneksi GenieACS NBI berhasil.',
  };
}

export async function listDevices(config, { limit = 300, query = {} } = {}) {
  const q = encodeURIComponent(JSON.stringify(query));
  const data = await request(config, `/devices/?query=${q}&limit=${Number(limit) || 300}`);
  if (!Array.isArray(data)) return [];
  return data.map((d) => normalizeDevice(d, config.offlineAfterSec || 600));
}

export async function getDeviceRaw(config, id) {
  const q = encodeURIComponent(JSON.stringify({ _id: id }));
  const data = await request(config, `/devices/?query=${q}&limit=1`);
  return Array.isArray(data) ? data[0] || null : null;
}

export async function listFaults(config, { limit = 100 } = {}) {
  const data = await request(config, `/faults/?query=%7B%7D&limit=${Number(limit) || 100}`);
  if (!Array.isArray(data)) return [];
  return data.map((f) => ({
    id: f._id,
    deviceId: typeof f.device === 'string' ? f.device : f.device?._id || '',
    channel: f.channel || '',
    code: f.code || '',
    message: f.message || '',
    timestamp: f._timestamp || f.timestamp || null,
    retries: f.retries || 0,
  }));
}

export async function createTask(config, deviceId, task) {
  return request(config, `/devices/${encodeURIComponent(deviceId)}/tasks?timeout=5000`, {
    method: 'POST',
    json: task,
  });
}

export function refreshDevice(config, deviceId, objectName = '') {
  return createTask(config, deviceId, { name: 'refreshObject', objectName });
}

export function rebootDevice(config, deviceId) {
  return createTask(config, deviceId, { name: 'reboot' });
}

export function setParameterValues(config, deviceId, values) {
  return createTask(config, deviceId, {
    name: 'setParameterValues',
    parameterValues: values,
  });
}

export async function countDevices(config) {
  const devices = await listDevices(config, { limit: 1000 });
  return {
    total: devices.length,
    online: devices.filter((d) => d.online).length,
    offline: devices.filter((d) => !d.online).length,
    devices,
  };
}

export default {
  testConnection,
  listDevices,
  listFaults,
  refreshDevice,
  rebootDevice,
  setParameterValues,
  countDevices,
  normalizeDevice,
};
