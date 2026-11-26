import express from 'express';
import {
  checkPassword,
  hashPassword,
  loginThrottle,
  publicUser,
  requireAuth,
  requireRole,
  signToken,
} from '../lib/auth.js';
import { getDb, save } from '../lib/store.js';
import { pushActivity } from '../lib/faults.js';
import { seal, unseal } from '../lib/secret.js';
import { createProject, cloneProject } from '../lib/projects.js';
import { asyncHandler, cleanText, httpError, requireFields } from './helpers.js';
import { ROLES } from '../lib/auth.js';

const router = express.Router();

function validatePassword(password) {
  if (String(password).length < 8) throw httpError(400, 'Password minimal 8 karakter.');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw httpError(400, 'Password harus memuat huruf dan angka.');
  }
}

/** Simpan hash untuk login dan salinan terenkripsi untuk superadmin. */
function setUserPassword(user, plain) {
  user.passwordHash = hashPassword(plain);
  user.passwordEnc = seal(plain);
}

function uniqueUsername(db, base) {
  const cleaned =
    String(base || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 24) || 'user';
  let candidate = cleaned;
  let n = 1;
  while (db.users.some((u) => u.username.toLowerCase() === candidate)) {
    candidate = `${cleaned}${n}`;
    n += 1;
  }
  return candidate;
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const name = cleanText(req.body.name, 80);
    const email = cleanText(req.body.email, 120).toLowerCase();
    const company = cleanText(req.body.company, 120) || 'Personal';
    const password = String(req.body.password || '');
    requireFields({ name, email, password }, ['name', 'email', 'password']);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Format email tidak valid.');
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      throw httpError(409, 'Email sudah terdaftar. Silakan login.');
    }
    validatePassword(password);
    const user = {
      id: `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      username: uniqueUsername(db, req.body.username || email.split('@')[0]),
      email,
      passwordHash: hashPassword(password),
      passwordEnc: seal(password),
      role: 'operator',
      company,
      phone: cleanText(req.body.phone, 30),
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    db.users.push(user);

    let project = null;
    if (db.projects.length && req.body.demo !== false) {
      try {
        const template = db.projects.find((p) => p.demo) || db.projects[0];
        project = cloneProject(db, template.id, {
          name: `Jaringan ${company}`,
          code: `NET-${new Date().getFullYear()}-${String(db.projects.length + 1).padStart(2, '0')}`,
          userId: user.id,
          userName: user.name,
        });
      } catch {
        project = null;
      }
    }
    if (!project) {
      project = createProject(db, {
        name: `Jaringan ${company}`,
        code: `NET-${new Date().getFullYear()}-${String(db.projects.length + 1).padStart(2, '0')}`,
        description: 'Project pertama Anda. Tambahkan POP, OLT, ODC, ODP, dan ONT.',
        center: db.settings.map.center,
        zoom: db.settings.map.zoom,
        userId: user.id,
        userName: user.name,
      });
      db.nodes.push({
        id: `nd_${Date.now().toString(36)}`,
        projectId: project.id,
        type: 'pop',
        name: 'POP Utama',
        code: 'POP-01',
        lat: project.center[0],
        lng: project.center[1],
        status: 'planned',
        parentId: null,
        address: '',
        notes: 'Node awal otomatis. Edit sesuai lokasi POP Anda.',
        vendor: '',
        model: '',
        serial: '',
        capacity: 1,
        usedPorts: 0,
        genieacsSerial: '',
        oltId: '',
        properties: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    pushActivity(db, {
      userId: user.id,
      userName: user.name,
      projectId: project?.id,
      action: 'auth.register',
      detail: `${user.name} (${company}) mendaftar dan membuat project ${project?.name || '-'}.`,
    });
    save();
    res.status(201).json({
      token: signToken(user),
      user: publicUser(user),
      projectId: project?.id || null,
    });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const identifier = cleanText(req.body.email || req.body.username, 120).toLowerCase();
    const password = String(req.body.password || '');
    if (!identifier || !password) throw httpError(400, 'Email/username dan password wajib diisi.');
    const throttle = loginThrottle(`${req.ip}:${identifier}`);
    if (throttle.blocked) {
      throw httpError(429, `Terlalu banyak percobaan. Coba lagi dalam ${throttle.retryAfter} detik.`);
    }
    const user = db.users.find(
      (u) => u.email.toLowerCase() === identifier || u.username.toLowerCase() === identifier
    );
    if (!user || !checkPassword(password, user.passwordHash)) {
      throw httpError(401, 'Email/username atau password salah.');
    }
    if (user.status !== 'active') throw httpError(403, 'Akun dinonaktifkan. Hubungi administrator.');
    user.lastLoginAt = new Date().toISOString();
    // Akun lama belum punya salinan terenkripsi; isi otomatis saat login.
    if (!user.passwordEnc) user.passwordEnc = seal(password);
    pushActivity(db, {
      userId: user.id,
      userName: user.name,
      projectId: db.projects.find((p) => p.createdBy === user.id)?.id || null,
      action: 'auth.login',
      detail: `${user.name} login ke lintasJB NMS.`,
    });
    save();
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  })
);

router.put(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) throw httpError(404, 'Akun tidak ditemukan.');
    user.name = cleanText(req.body.name, 80) || user.name;
    user.company = cleanText(req.body.company, 120) || user.company;
    user.phone = cleanText(req.body.phone, 30);
    pushActivity(db, {
      userId: user.id,
      userName: user.name,
      action: 'user.profile',
      detail: 'Memperbarui profil akun.',
    });
    save();
    res.json({ user: publicUser(user) });
  })
);

router.put(
  '/me/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = db.users.find((u) => u.id === req.user.id);
    if (!checkPassword(req.body.currentPassword, user.passwordHash)) {
      throw httpError(400, 'Password lama tidak sesuai.');
    }
    validatePassword(req.body.newPassword);
    setUserPassword(user, req.body.newPassword);
    save();
    res.json({ ok: true, message: 'Password berhasil diperbarui.' });
  })
);

router.get(
  '/users',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    res.json({
      users: db.users.map((u) => ({
        ...publicUser(u),
        lastLoginAt: u.lastLoginAt,
      })),
    });
  })
);

router.post(
  '/users',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const name = cleanText(req.body.name, 80);
    const email = cleanText(req.body.email, 120).toLowerCase();
    const password = String(req.body.password || '');
    const role = ROLES.includes(req.body.role) ? req.body.role : 'operator';
    const demo = req.user.role === 'superadmin' ? Boolean(req.body.demo) : false;
    requireFields({ name, email, password }, ['name', 'email', 'password']);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Format email tidak valid.');
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      throw httpError(409, 'Email sudah terdaftar.');
    }
    if (role === 'superadmin' && req.user.role !== 'superadmin') {
      throw httpError(403, 'Hanya superadmin yang dapat membuat akun superadmin.');
    }
    validatePassword(password);
    const user = {
      id: `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      username: uniqueUsername(db, req.body.username || email.split('@')[0]),
      email,
      passwordHash: hashPassword(password),
      passwordEnc: seal(password),
      role,
      company: cleanText(req.body.company, 120) || 'Personal',
      phone: cleanText(req.body.phone, 30),
      status: 'active',
      demo,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    db.users.push(user);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'user.create',
      detail: `Menambahkan pengguna ${user.name} (${user.email}) dengan role ${user.role}${demo ? ' (akun demo)' : ''}.`,
    });
    save();
    res.status(201).json({ user: publicUser(user) });
  })
);

router.get(
  '/users/:id/password',
  requireAuth,
  requireRole('superadmin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) throw httpError(404, 'User tidak ditemukan.');
    const password = unseal(user.passwordEnc || '');
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'user.password_view',
      detail: `Melihat password akun ${user.name} (${user.email}).`,
    });
    save();
    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      password: password || null,
      available: Boolean(password),
    });
  })
);

router.post(
  '/users/:id/password',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) throw httpError(404, 'User tidak ditemukan.');
    if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
      throw httpError(403, 'Hanya superadmin yang dapat mengubah password superadmin.');
    }
    const newPassword = String(req.body.newPassword || '');
    validatePassword(newPassword);
    setUserPassword(user, newPassword);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'user.password',
      detail: `Mereset password akun ${user.name} (${user.email}).`,
    });
    save();
    res.json({ ok: true, message: `Password ${user.name} berhasil direset.` });
  })
);

router.put(
  '/users/:id',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) throw httpError(404, 'User tidak ditemukan.');
    if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
      throw httpError(403, 'Hanya superadmin yang dapat mengubah akun superadmin.');
    }
    if (req.body.name !== undefined) user.name = cleanText(req.body.name, 80) || user.name;
    if (req.body.company !== undefined) user.company = cleanText(req.body.company, 120);
    if (req.body.phone !== undefined) user.phone = cleanText(req.body.phone, 30);
    if (req.body.role !== undefined) {
      if (!ROLES.includes(req.body.role)) throw httpError(400, 'Role tidak valid.');
      if (user.id === req.user.id && req.body.role !== 'superadmin') {
        throw httpError(400, 'Tidak dapat menurunkan role akun sendiri.');
      }
      user.role = req.body.role;
    }
    if (req.body.demo !== undefined && req.user.role === 'superadmin') {
      user.demo = Boolean(req.body.demo);
    }
    if (req.body.status !== undefined) {
      if (!['active', 'disabled'].includes(req.body.status)) throw httpError(400, 'Status tidak valid.');
      if (user.id === req.user.id && req.body.status === 'disabled') {
        throw httpError(400, 'Tidak dapat menonaktifkan akun sendiri.');
      }
      user.status = req.body.status;
    }
    save();
    res.json({ user: publicUser(user) });
  })
);

router.delete(
  '/users/:id',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    if (req.params.id === req.user.id) throw httpError(400, 'Tidak dapat menghapus akun sendiri.');
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) throw httpError(404, 'User tidak ditemukan.');
    if (user.role === 'superadmin' && req.user.role !== 'superadmin') {
      throw httpError(403, 'Hanya superadmin yang dapat menghapus akun superadmin.');
    }
    if (user.role === 'superadmin' && db.users.filter((u) => u.role === 'superadmin').length <= 1) {
      throw httpError(400, 'Minimal satu superadmin harus tersedia.');
    }
    db.users = db.users.filter((u) => u.id !== req.params.id);
    save();
    res.json({ ok: true });
  })
);

export default router;
