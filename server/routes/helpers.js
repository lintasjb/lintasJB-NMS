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

/** Akun demo hanya boleh melihat project simulasi. */
export function isDemoUser(user) {
  return Boolean(user?.demo);
}

/** Middleware: akun demo bersifat hanya-baca. */
export function blockDemo(req, res, next) {
  if (isDemoUser(req.user)) {
    return next(httpError(403, 'Akun demo bersifat hanya-baca.'));
  }
  return next();
}

/**
 * Aturan visibilitas project:
 * - superadmin melihat semua project;
 * - akun demo hanya project bertanda `demo` (simulasi);
 * - akun lain hanya project yang ia buat sendiri (`createdBy`).
 */
export function canAccessProject(user, project) {
  if (!project) return false;
  if (user?.role === 'superadmin') return true;
  if (isDemoUser(user)) return project.demo === true;
  return Boolean(project.createdBy) && project.createdBy === user?.id;
}

export function visibleProjects(db, user) {
  return (db.projects || []).filter((p) => canAccessProject(user, p));
}

export function assertProjectAccess(user, project) {
  if (!canAccessProject(user, project)) {
    throw httpError(403, 'Anda tidak memiliki akses ke project ini.');
  }
  return project;
}

/**
 * Middleware untuk route berbasis `:id` (node, kabel, gangguan, alarm, OLT,
 * router). Memastikan entitas yang diakses memang milik project yang boleh
 * dilihat oleh pengguna.
 */
export function requireEntityProjectAccess(type) {
  return (req, res, next) => {
    try {
      const db = getDb();
      const collections = {
        node: db.nodes,
        cable: db.cables,
        fault: db.faults,
        alarm: db.alarms,
        olt: db.olts,
        router: db.routers,
      };
      const entity = (collections[type] || []).find((x) => x.id === req.params.id);
      if (entity) {
        const project = (db.projects || []).find((p) => p.id === entity.projectId);
        if (!canAccessProject(req.user, project)) {
          throw httpError(403, 'Anda tidak memiliki akses ke data project ini.');
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function resolveProject(req, { required = false } = {}) {
  const db = getDb();
  const id = projectIdOf(req);
  const allowed = visibleProjects(db, req.user);
  let project = id ? allowed.find((p) => p.id === id) : allowed[0];
  if (!project && id) {
    const exists = (db.projects || []).some((p) => p.id === id);
    if (exists) throw httpError(403, 'Anda tidak memiliki akses ke project ini.');
    if (required) throw httpError(404, 'Project tidak ditemukan.');
  }
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
  // Akun demo tidak boleh melihat detail integrasi perangkat nyata.
  if (isDemoUser(user) && copy.integrations?.genieacs) {
    copy.integrations.genieacs = {
      ...copy.integrations.genieacs,
      enabled: false,
      url: '',
      username: '',
      hasPassword: false,
      pollSeconds: 0,
      lastError: null,
    };
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
