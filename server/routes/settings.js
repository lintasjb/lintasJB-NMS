import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, save } from '../lib/store.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { seal, DATA_DIR } from '../lib/secret.js';
import { generateLicense, licenseStatus, PLANS, verifyLicense, FEATURES } from '../lib/license.js';
import { pushActivity } from '../lib/faults.js';
import { emitEvent } from '../lib/events.js';
import { scheduleMonitor } from '../monitors.js';
import { BASEMAPS } from '../basemaps.js';
import {
  asyncHandler,
  clampNumber,
  cleanText,
  httpError,
  requireFields,
  sanitizeSettings,
} from './helpers.js';

const router = express.Router();
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error('Logo harus berupa PNG, JPG, atau WEBP (maks. 3 MB).'));
      return;
    }
    cb(null, true);
  },
});

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

router.get(
  '/settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    res.json({
      settings: sanitizeSettings(db.settings, req.user),
      basemaps: BASEMAPS,
      license: licenseStatus(db.license, db.nodes.length),
    });
  })
);

router.put(
  '/settings',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const body = req.body || {};
    const s = db.settings;

    if (body.branding && typeof body.branding === 'object') {
      const b = body.branding;
      if (b.companyName !== undefined) s.branding.companyName = cleanText(b.companyName, 60) || 'lintasJB';
      if (b.appName !== undefined) s.branding.appName = cleanText(b.appName, 60) || 'lintasJB NMS';
      if (b.tagline !== undefined) s.branding.tagline = cleanText(b.tagline, 100);
      if (b.footer !== undefined) s.branding.footer = cleanText(b.footer, 140);
      if (b.logo === '/assets/lintasjb-mark.png' || b.logo === '/assets/logo.svg') s.branding.logo = b.logo;
      for (const key of ['accent', 'accent2']) {
        if (b[key] !== undefined) {
          if (!/^#[0-9a-fA-F]{6}$/.test(String(b[key]))) throw httpError(400, `${key} harus warna HEX.`);
          s.branding[key] = String(b[key]);
        }
      }
    }

    if (body.map && typeof body.map === 'object') {
      const m = body.map;
      const validBasemaps = new Set([...BASEMAPS.map((b) => b.id), ...(s.customBasemaps || []).map((b) => b.id)]);
      if (m.basemap !== undefined) {
        if (!validBasemaps.has(m.basemap)) throw httpError(400, 'Basemap tidak dikenal.');
        s.map.basemap = m.basemap;
      }
      if (Array.isArray(m.center) && m.center.length === 2) {
        const lat = Number(m.center[0]);
        const lng = Number(m.center[1]);
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw httpError(400, 'Koordinat pusat peta tidak valid.');
        s.map.center = [lat, lng];
      }
      if (m.zoom !== undefined) s.map.zoom = clampNumber(m.zoom, 2, 22, s.map.zoom);
      for (const key of ['showLabels', 'animate', 'showFaults', 'showGrid']) {
        if (m[key] !== undefined) s.map[key] = Boolean(m[key]);
      }
    }

    if (body.alarm && typeof body.alarm === 'object') {
      const a = body.alarm;
      if (a.enabled !== undefined) s.alarm.enabled = Boolean(a.enabled);
      if (a.volume !== undefined) s.alarm.volume = clampNumber(a.volume, 0, 1, s.alarm.volume);
      if (a.pattern !== undefined) {
        if (!['siren', 'beep', 'pulse', 'alarm'].includes(a.pattern)) throw httpError(400, 'Pola alarm tidak valid.');
        s.alarm.pattern = a.pattern;
      }
      if (a.repeat !== undefined) s.alarm.repeat = clampNumber(a.repeat, 1, 20, s.alarm.repeat);
      for (const key of ['onFault', 'onDevice', 'onCable']) {
        if (a[key] !== undefined) s.alarm[key] = Boolean(a[key]);
      }
    }

    if (body.monitor && typeof body.monitor === 'object') {
      const m = body.monitor;
      if (m.enabled !== undefined) s.monitor.enabled = Boolean(m.enabled);
      if (m.intervalSec !== undefined) s.monitor.intervalSec = clampNumber(m.intervalSec, 30, 3600, s.monitor.intervalSec);
      if (m.offlineAfterSec !== undefined) s.monitor.offlineAfterSec = clampNumber(m.offlineAfterSec, 60, 86400, s.monitor.offlineAfterSec);
      if (m.autoCableFault !== undefined) s.monitor.autoCableFault = Boolean(m.autoCableFault);
      if (m.autoCreateOnt !== undefined) s.monitor.autoCreateOnt = Boolean(m.autoCreateOnt);
    }

    if (body.integrations?.genieacs && typeof body.integrations.genieacs === 'object') {
      const g = body.integrations.genieacs;
      const target = s.integrations.genieacs;
      if (g.enabled !== undefined) target.enabled = Boolean(g.enabled);
      if (g.url !== undefined) {
        const url = cleanText(g.url, 300).replace(/\/+$/, '');
        if (url && !/^https?:\/\//i.test(url)) throw httpError(400, 'URL GenieACS harus diawali http:// atau https://.');
        target.url = url;
      }
      if (g.username !== undefined) target.username = cleanText(g.username, 100);
      if (g.pollSeconds !== undefined) target.pollSeconds = clampNumber(g.pollSeconds, 30, 3600, target.pollSeconds);
      if (g.offlineAfterSec !== undefined) target.offlineAfterSec = clampNumber(g.offlineAfterSec, 60, 86400, target.offlineAfterSec);
      if (g.clearPassword) target.passwordEnc = '';
      else if (typeof g.password === 'string' && g.password.length > 0 && !/^[•]+$/.test(g.password)) {
        target.passwordEnc = seal(g.password);
      }
    }

    if (Array.isArray(body.customBasemaps)) {
      s.customBasemaps = body.customBasemaps.slice(0, 10).map((b, i) => {
        const url = cleanText(b.url, 500);
        if (url && !/^https?:\/\//i.test(url)) throw httpError(400, 'URL basemap kustom harus http(s).');
        return {
          id: cleanText(b.id, 40) || `custom-${Date.now()}-${i}`,
          name: cleanText(b.name, 60) || `Basemap ${i + 1}`,
          url,
          attribution: cleanText(b.attribution, 120),
          enabled: Boolean(b.enabled),
        };
      });
    }

    s.updatedAt = new Date().toISOString();
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'settings.update',
      detail: 'Memperbarui pengaturan aplikasi/branding.',
    });
    save();
    scheduleMonitor();
    emitEvent('settings', { settings: sanitizeSettings(s, req.user) });
    res.json({ settings: sanitizeSettings(s, req.user), message: 'Pengaturan disimpan.' });
  })
);

router.post(
  '/settings/logo',
  requireAuth,
  requireRole('superadmin', 'admin'),
  upload.single('logo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, 'File logo tidak ditemukan.');
    const db = getDb();
    const filename = `logo-${Date.now()}${EXT[req.file.mimetype] || '.png'}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer);
    const old = db.settings.branding.logo;
    db.settings.branding.logo = `/uploads/${filename}`;
    db.settings.updatedAt = new Date().toISOString();
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'branding.logo',
      detail: `Mengganti logo perusahaan (${req.file.originalname || filename}).`,
    });
    save();
    emitEvent('settings', { settings: sanitizeSettings(db.settings, req.user) });
    if (old?.startsWith('/uploads/')) {
      const oldPath = path.join(UPLOAD_DIR, path.basename(old));
      if (oldPath.startsWith(UPLOAD_DIR)) fs.rm(oldPath, { force: true }, () => {});
    }
    res.json({
      logo: db.settings.branding.logo,
      settings: sanitizeSettings(db.settings, req.user),
      message: 'Logo perusahaan berhasil diperbarui.',
    });
  })
);

router.post(
  '/settings/logo/reset',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    db.settings.branding.logo = '/assets/lintasjb-mark.png';
    save();
    emitEvent('settings', { settings: sanitizeSettings(db.settings, req.user) });
    res.json({ logo: db.settings.branding.logo, settings: sanitizeSettings(db.settings, req.user) });
  })
);

router.get(
  '/basemaps',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    res.json({
      basemaps: BASEMAPS,
      custom: (db.settings.customBasemaps || []).filter((b) => b.enabled !== false && b.url),
    });
  })
);

// ---------------------------------------------------------------------------
// License
// ---------------------------------------------------------------------------
router.get(
  '/license',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    res.json({
      license: licenseStatus(db.license, db.nodes.length),
      key: ['superadmin', 'admin'].includes(req.user.role) ? db.license?.key || null : null,
      plans: PLANS,
      features: FEATURES,
    });
  })
);

router.post(
  '/license/activate',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const key = cleanText(req.body.key, 4000);
    if (!key) throw httpError(400, 'Kunci lisensi wajib diisi.');
    const result = verifyLicense(key);
    if (!result.valid) throw httpError(400, result.reason || 'Lisensi tidak valid.');
    db.license = { ...result.license, key };
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'license.activate',
      detail: `Aktivasi lisensi ${result.license.plan} untuk ${result.license.customer}.`,
    });
    save();
    emitEvent('license', { license: licenseStatus(db.license, db.nodes.length) });
    res.json({
      license: licenseStatus(db.license, db.nodes.length),
      message: 'Lisensi berhasil diaktivasi.',
    });
  })
);

router.post(
  '/license/generate',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    requireFields(req.body, ['customer']);
    const generated = generateLicense({
      customer: cleanText(req.body.customer, 120),
      plan: req.body.plan,
      months: req.body.months,
      maxNodes: req.body.maxNodes,
      features: Array.isArray(req.body.features) ? req.body.features.filter((f) => FEATURES.includes(f)) : undefined,
    });
    if (req.body.activate) {
      db.license = { ...generated.license, key: generated.key };
      emitEvent('license', { license: licenseStatus(db.license, db.nodes.length) });
    }
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'license.generate',
      detail: `Generate lisensi ${generated.license.plan} untuk ${generated.license.customer}.`,
    });
    save();
    res.json({
      key: generated.key,
      license: generated.license,
      active: licenseStatus(db.license, db.nodes.length),
      message: 'Kunci lisensi berhasil dibuat.',
    });
  })
);

export default router;
