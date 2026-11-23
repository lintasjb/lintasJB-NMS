import fs from 'node:fs';
import path from 'node:path';
import { buildSeed } from '../seed.js';
import { BASEMAP_IDS, LEGACY_BASEMAP_IDS } from '../basemaps.js';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

let data = null;
let timer = null;
let dirty = false;

const ARRAY_KEYS = [
  'users',
  'projects',
  'nodes',
  'cables',
  'faults',
  'alarms',
  'olts',
  'routers',
  'orders',
  'activity',
];

function mergeDefaults(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) {
      target[key] = value;
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      mergeDefaults(target[key], value);
    }
  }
  return target;
}

function normalize(db) {
  for (const key of ARRAY_KEYS) if (!Array.isArray(db[key])) db[key] = [];
  if (!db.meta || typeof db.meta !== 'object') db.meta = { version: 1 };
  if (!db.cache || typeof db.cache !== 'object') db.cache = {};
  if (!db.cache.olts) db.cache.olts = {};
  if (!db.cache.routers) db.cache.routers = {};
  if (!db.cache.genieacs) db.cache.genieacs = { devices: [], faults: [], lastRunAt: null };
  if (!db.license || !db.license.id) {
    // Migrate legacy installations: seed only licensing fields.
    const trial = buildSeed();
    db.license = trial.license;
  }
  if (!db.settings) db.settings = buildSeed().settings;
  const defaults = buildSeed().settings;
  mergeDefaults(db.settings, defaults);
  if (!Array.isArray(db.settings.customBasemaps)) db.settings.customBasemaps = [];
  // Carto basemaps sekarang membutuhkan API key: migrasikan id lama ke layer
  // Esri/OSM yang tetap berfungsi, lalu validasi terhadap katalog + kustom.
  if (!db.settings.map || typeof db.settings.map !== 'object') db.settings.map = {};
  const mapCfg = db.settings.map;
  if (LEGACY_BASEMAP_IDS[mapCfg.basemap]) mapCfg.basemap = LEGACY_BASEMAP_IDS[mapCfg.basemap];
  const customIds = new Set(
    (db.settings.customBasemaps || []).map((b) => String(b?.id || '')).filter(Boolean)
  );
  if (!mapCfg.basemap || (!BASEMAP_IDS.has(mapCfg.basemap) && !customIds.has(mapCfg.basemap))) {
    mapCfg.basemap = 'esriDark';
  }
  // Never keep a raw password in settings (defensive migration).
  const g = db.settings.integrations?.genieacs;
  if (g && g.password && !g.passwordEnc) {
    g.passwordEnc = g.password;
    delete g.password;
  }
  // Router MikroTik selalu memakai koneksi nyata (mode simulasi dihapus).
  for (const r of db.routers) {
    r.simulated = false;
    if (!['auto', 'rest', 'api'].includes(r.transport)) r.transport = 'auto';
    if (r.description === undefined) r.description = '';
    if (r.passwordEnv === undefined) r.passwordEnv = '';
    if (typeof r.tls !== 'boolean') r.tls = true;
  }
  return db;
}

export function getDb() {
  if (data) return data;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      const backup = `${DB_FILE}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(DB_FILE, backup);
      } catch {
        /* ignore */
      }
      console.error(`[db] db.json rusak, backup dibuat: ${backup}`);
      data = buildSeed();
    }
  } else {
    data = buildSeed();
    dirty = true;
  }
  normalize(data);
  if (dirty) saveNow();
  return data;
}

export function save() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    saveNow();
  }, 180);
}

export function saveNow() {
  if (!data) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(TMP_FILE, json, 'utf8');
    try {
      fs.renameSync(TMP_FILE, DB_FILE);
    } catch {
      fs.rmSync(DB_FILE, { force: true });
      fs.renameSync(TMP_FILE, DB_FILE);
    }
  } catch (err) {
    console.error('[db] gagal menyimpan db:', err.message);
  }
  dirty = false;
}

export function mutate(fn) {
  const db = getDb();
  const result = fn(db);
  save();
  return result;
}

export function resetDb({ keepSecrets = true } = {}) {
  const current = getDb();
  const oldUsers = current.users;
  const oldSecrets = {
    license: current.license,
    settings: current.settings,
  };
  data = buildSeed();
  if (keepSecrets) {
    data.users = oldUsers;
    if (oldSecrets.license) data.license = oldSecrets.license;
    if (oldSecrets.settings?.integrations) {
      data.settings.integrations = oldSecrets.settings.integrations;
    }
  }
  saveNow();
  return data;
}

process.on('exit', () => {
  if (dirty) saveNow();
});
process.on('SIGINT', () => {
  if (dirty) saveNow();
  process.exit(0);
});
process.on('SIGTERM', () => {
  if (dirty) saveNow();
  process.exit(0);
});

export { DATA_DIR, DB_FILE };
