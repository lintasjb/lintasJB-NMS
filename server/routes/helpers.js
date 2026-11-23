import { getDb } from '../lib/store.js';
import { hasSecret } from '../lib/secret.js';

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function requireFields(body, fields) {
  const missing = fields.filter((f) => {
    const v = body?.[f];
    return v === undefined || v === null || (typeof v === 'string' && !v.trim());
  });
  if (missing.length) throw httpError(400, `Field wajib belum diisi: ${missing.join(', ')}.`);
}

export function projectIdOf(req) {
  return String(req.query.projectId || req.body?.projectId || '').trim();
}

export function resolveProject(req, { required = false } = {}) {
  const db = getDb();
  const id = projectIdOf(req) || db.projects[0]?.id;
  const project = db.projects.find((p) => p.id === id);
  if (!project && required) throw httpError(404, 'Project tidak ditemukan.');
  return project || null;
}

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function cleanText(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

export function sanitizeSettings(settings, user) {
  const copy = structuredClone(settings);
  const g = copy.integrations?.genieacs;
  if (g) {
    g.hasPassword = hasSecret(g.passwordEnc);
    delete g.passwordEnc;
    delete g.password;
  }
  if (user?.role !== 'superadmin' && user?.role !== 'admin') {
    if (copy.integrations) delete copy.integrations.webhookToken;
  }
  copy.customBasemaps = (copy.customBasemaps || []).filter((b) => b && b.id);
  return copy;
}

export function parseJSONBody(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function paginate(array, req, defaults = { limit: 100, max: 500 }) {
  const limit = Math.min(defaults.max, Math.max(1, Number(req.query.limit) || defaults.limit));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { items: array.slice(offset, offset + limit), total: array.length, limit, offset };
}
