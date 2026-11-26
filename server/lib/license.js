import crypto from 'node:crypto';
import { getLicenseSecret, randomToken } from './secret.js';

export const FEATURES = [
  'map',
  'nodes',
  'cables',
  'animations',
  'basemaps',
  'genieacs',
  'hioso',
  'mikrotik',
  'fault-locator',
  'kml',
  'branding',
  'alarms',
  'multi-project',
];

export const PLANS = {
  trial: { label: 'Trial', maxNodes: 200, months: 1, features: FEATURES },
  starter: { label: 'Starter', maxNodes: 300, months: 12, features: FEATURES },
  professional: { label: 'Professional', maxNodes: 2500, months: 12, features: FEATURES },
  enterprise: { label: 'Enterprise', maxNodes: 100000, months: 36, features: FEATURES },
};

const PREFIX = 'LJB1';

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

export function signLicense(payload) {
  const body = b64urlJson(payload);
  const sig = crypto
    .createHmac('sha256', getLicenseSecret())
    .update(`${PREFIX}.${body}`)
    .digest('base64url');
  return `${PREFIX}.${body}.${sig}`;
}

export function verifyLicense(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, reason: 'Kunci lisensi kosong.' };
  }
  const parts = key.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { valid: false, reason: 'Format kunci lisensi tidak dikenali.' };
  }
  const [, body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', getLicenseSecret())
    .update(`${PREFIX}.${body}`)
    .digest();
  let provided;
  try {
    provided = Buffer.from(sig, 'base64url');
  } catch {
    return { valid: false, reason: 'Tanda tangan lisensi rusak.' };
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { valid: false, reason: 'Tanda tangan lisensi tidak valid.' };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'Isi lisensi tidak dapat dibaca.' };
  }
  const expires = new Date(payload.expiresAt).getTime();
  if (!Number.isFinite(expires) || expires < Date.now()) {
    return { valid: false, reason: 'Lisensi sudah kedaluwarsa.', license: payload };
  }
  return { valid: true, license: payload };
}

export function createTrialLicense(customer = 'lintasJB Demo', customerId = '') {
  const now = new Date();
  const exp = new Date(now);
  exp.setDate(exp.getDate() + 30);
  const payload = {
    v: 1,
    id: `LIC-${randomToken(6).toUpperCase()}`,
    customer,
    ...(customerId ? { customerId } : {}),
    plan: 'trial',
    issuedAt: now.toISOString(),
    expiresAt: exp.toISOString(),
    maxNodes: PLANS.trial.maxNodes,
    features: PLANS.trial.features,
    note: 'Trial otomatis 30 hari — aktivasi lisensi resmi di menu Pengaturan.',
  };
  return { key: signLicense(payload), license: payload };
}

export function generateLicense({ customer, customerId = '', customerEmail = '', plan = 'professional', months, maxNodes, features } = {}) {
  const planDef = PLANS[plan] || PLANS.professional;
  const now = new Date();
  const exp = new Date(now);
  exp.setMonth(exp.getMonth() + Math.max(1, Number(months) || planDef.months));
  const payload = {
    v: 1,
    id: `LIC-${randomToken(6).toUpperCase()}`,
    customer: String(customer || 'lintasJB Customer').slice(0, 120),
    ...(customerId ? { customerId: String(customerId) } : {}),
    ...(customerEmail ? { customerEmail: String(customerEmail).slice(0, 160) } : {}),
    plan,
    issuedAt: now.toISOString(),
    expiresAt: exp.toISOString(),
    maxNodes: Math.max(1, Number(maxNodes) || planDef.maxNodes),
    features: Array.isArray(features) && features.length ? features : planDef.features,
  };
  return { key: signLicense(payload), license: payload };
}

export function licenseStatus(license, nodeCount = 0) {
  if (!license || !license.id) {
    return {
      active: false,
      valid: false,
      reason: 'Belum ada lisensi aktif.',
      plan: 'none',
      maxNodes: 0,
      features: [],
      nodeCount,
    };
  }
  const expires = new Date(license.expiresAt).getTime();
  const daysLeft = Math.ceil((expires - Date.now()) / 86400000);
  const valid = Number.isFinite(expires) && expires > Date.now();
  const maxNodes = Number(license.maxNodes) || 0;
  return {
    ...license,
    active: valid,
    valid,
    daysLeft,
    planLabel: PLANS[license.plan]?.label || license.plan,
    nodeCount,
    maxNodes,
    usagePercent: maxNodes ? Math.min(100, Math.round((nodeCount / maxNodes) * 100)) : 0,
    expired: !valid,
    reason: valid ? null : 'Lisensi kedaluwarsa.',
  };
}

export function requireFeature(license, feature) {
  if (!license) return false;
  if (!Array.isArray(license.features)) return true;
  return license.features.includes(feature);
}

export function assertNodeQuota(license, currentNodes) {
  const max = Number(license?.maxNodes) || 0;
  if (!license || !license.expiresAt || new Date(license.expiresAt) < new Date()) {
    const err = new Error('Lisensi tidak aktif. Aktivasi lisensi untuk menambah node.');
    err.status = 402;
    throw err;
  }
  if (max && currentNodes >= max) {
    const err = new Error(
      `Kuota node lisensi tercapai (${currentNodes}/${max}). Tingkatkan lisensi Anda.`
    );
    err.status = 402;
    throw err;
  }
}

/* ---------------------------------------------------- lisensi per akun */

/** Pastikan setiap pelanggan memiliki lisensi sendiri (migrasi sekali). */
export function ensureUserLicenses(db) {
  let changed = false;
  if (!db.userLicenses || typeof db.userLicenses !== 'object' || Array.isArray(db.userLicenses)) {
    db.userLicenses = {};
    changed = true;
  }
  for (const user of db.users || []) {
    if (user.role === 'superadmin' || user.demo || db.userLicenses[user.id]) continue;
    const ownsProject = (db.projects || []).some((p) => p.createdBy === user.id);
    if (!ownsProject) continue;
    const source = db.license && db.license.id
      ? structuredClone(db.license)
      : createTrialLicense(user.company || user.name || user.email, user.id).license;
    delete source.key;
    const payload = {
      ...source,
      customerId: user.id,
      customerEmail: user.email,
      customer: user.company || user.name || user.email,
    };
    db.userLicenses[user.id] = { ...payload, key: signLicense(payload) };
    changed = true;
  }
  return changed;
}

/** Lisensi yang berlaku untuk akun (superadmin memakai lisensi utama). */
export function licenseFor(db, user) {
  if (!user || user.role === 'superadmin') return db.license || null;
  return db.userLicenses?.[user.id] || db.license || null;
}

/** Jumlah node milik akun; superadmin menghitung seluruh node. */
export function nodeCountForLicense(db, user) {
  if (!user || user.role === 'superadmin') return (db.nodes || []).length;
  const ids = new Set((db.projects || []).filter((p) => p.createdBy === user.id).map((p) => p.id));
  return (db.nodes || []).filter((n) => ids.has(n.projectId)).length;
}

export function licenseStatusFor(db, user) {
  return licenseStatus(licenseFor(db, user), nodeCountForLicense(db, user));
}

export function keyForUser(db, user) {
  if (!user) return null;
  if (['superadmin', 'admin'].includes(user.role)) return db.license?.key || null;
  return db.userLicenses?.[user.id]?.key || null;
}

export function assertNodeQuotaFor(db, user) {
  return assertNodeQuota(licenseFor(db, user), nodeCountForLicense(db, user));
}

/** Simpan lisensi hasil aktivasi/generate ke akun yang dituju. */
export function activateLicenseFor(db, user, license, key, { global = false } = {}) {
  const stored = { ...license, key };
  if (global || !user || user.role === 'superadmin') {
    db.license = stored;
  } else {
    db.userLicenses = db.userLicenses || {};
    db.userLicenses[user.id] = stored;
  }
  return stored;
}

export function customerOptions(db, requester) {
  if (!['superadmin', 'admin'].includes(requester?.role)) return [];
  return (db.users || [])
    .filter((u) => !['superadmin', 'admin'].includes(u.role) && !u.demo && u.status !== 'disabled')
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      company: u.company || u.name,
      role: u.role,
      plan: db.userLicenses?.[u.id]?.plan || null,
    }));
}
