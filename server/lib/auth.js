import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './secret.js';
import { getDb } from './store.js';

export const ROLES = ['superadmin', 'admin', 'operator', 'viewer'];

export function hashPassword(password) {
  return bcrypt.hashSync(String(password), 10);
}

export function checkPassword(password, hash) {
  try {
    return bcrypt.compareSync(String(password), String(hash));
  } catch {
    return false;
  }
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email },
    getJwtSecret(),
    { expiresIn: '7d', issuer: 'lintasjb-nms' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret(), { issuer: 'lintasjb-nms' });
  } catch {
    return null;
  }
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    company: user.company,
    phone: user.phone,
    status: user.status,
    demo: Boolean(user.demo),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function authFromRequest(req) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token && req.query?.token) token = String(req.query.token);
  if (!token) return { error: 'Token autentikasi tidak ditemukan.', status: 401 };
  const payload = verifyToken(token);
  if (!payload) return { error: 'Sesi kedaluwarsa. Silakan login kembali.', status: 401 };
  const db = getDb();
  const user = db.users.find((u) => u.id === payload.sub);
  if (!user) return { error: 'Akun tidak ditemukan.', status: 401 };
  if (user.status !== 'active') return { error: 'Akun dinonaktifkan.', status: 403 };
  return { user, token };
}

export function requireAuth(req, res, next) {
  const result = authFromRequest(req);
  if (result.error) return res.status(result.status).json({ error: result.error });
  req.user = result.user;
  req.token = result.token;
  return next();
}

export function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Belum login.' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Hak akses tidak mencukupi untuk aksi ini.' });
    }
    return next();
  };
}

/** Very small in-memory login throttle. */
const attempts = new Map();
export function loginThrottle(key, { max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, resetAt: now + windowMs };
  if (entry.resetAt < now) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  attempts.set(key, entry);
  if (attempts.size > 5000) attempts.clear();
  return { blocked: entry.count > max, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
}
