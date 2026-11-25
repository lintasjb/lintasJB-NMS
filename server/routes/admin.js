/* =============================================================================
 * lintasJB NMS — Admin Panel API
 * Ringkasan sistem, log aktivitas, backup database, dan pengaturan harga paket.
 * Semua endpoint di sini hanya untuk role superadmin/admin (harga: superadmin).
 * ========================================================================== */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, save } from '../lib/store.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { licenseStatus } from '../lib/license.js';
import { pushActivity } from '../lib/faults.js';
import { emitEvent } from '../lib/events.js';
import { DATA_DIR } from '../lib/secret.js';
import { monitorStatus } from '../monitors.js';
import { normalizePricing, pricingOf } from '../lib/pricing.js';
import { asyncHandler, cleanText, httpError } from './helpers.js';

const router = express.Router();
const ADMIN_ROLES = ['superadmin', 'admin'];

function dirStats(dir) {
  let bytes = 0;
  let files = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      files += 1;
      try {
        bytes += fs.statSync(path.join(dir, entry.name)).size;
      } catch { /* file bisa terhapus saat dibaca */ }
    }
  } catch { /* folder belum ada */ }
  return { bytes, files };
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

router.get(
  '/admin/overview',
  requireAuth,
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const uploads = dirStats(path.join(DATA_DIR, 'uploads'));
    const memory = process.memoryUsage();
    const genieacs = db.settings.integrations?.genieacs || {};
    const cache = db.cache?.genieacs || {};

    res.json({
      app: {
        name: 'lintasJB NMS',
        version: '1.0.0',
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        memoryMB: Math.round(memory.rss / 1048576),
      },
      counts: {
        users: db.users.length,
        activeUsers: db.users.filter((u) => u.status !== 'disabled').length,
        projects: db.projects.length,
        nodes: db.nodes.length,
        cables: db.cables.length,
        faults: (db.faults || []).filter((f) => f.status !== 'resolved').length,
        alarms: (db.alarms || []).filter((a) => !a.acknowledged).length,
        orders: (db.orders || []).length,
      },
      monitor: monitorStatus(),
      license: licenseStatus(db.license, db.nodes.length),
      storage: {
        dataDir: DATA_DIR,
        dbBytes: fileSize(path.join(DATA_DIR, 'db.json')),
        uploadsBytes: uploads.bytes,
        uploadFiles: uploads.files,
      },
      integrations: {
        genieacs: {
          enabled: Boolean(genieacs.enabled),
          url: genieacs.url || '',
          pollSeconds: genieacs.pollSeconds || null,
          lastRunAt: cache.lastRunAt || null,
          error: cache.error || null,
          devices: (cache.devices || []).length,
        },
        olts: (db.olts || []).map((o) => ({
          id: o.id,
          name: o.name || o.host || o.id,
          vendor: o.vendor || '-',
          host: o.host || '-',
          port: o.port || null,
          simulated: Boolean(o.simulated),
          status: o.status || o.lastStatus || null,
          lastSyncAt: o.lastSyncAt || null,
        })),
        routers: (db.routers || []).map((r) => ({
          id: r.id,
          name: r.name || r.host || r.id,
          host: r.host || '-',
          enabled: r.enabled !== false,
          status: r.status || r.lastStatus || null,
          lastSyncAt: r.lastSyncAt || null,
        })),
      },
      recent: (db.activity || []).slice(0, 8),
    });
  })
);

router.get(
  '/admin/activity',
  requireAuth,
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const all = db.activity || [];
    const q = cleanText(req.query.q, 120).toLowerCase();
    const action = cleanText(req.query.action, 80);
    const userId = cleanText(req.query.userId, 80);

    let items = all;
    if (action) items = items.filter((a) => a.action === action);
    if (userId) items = items.filter((a) => (a.userId || 'system') === userId);
    if (q) {
      items = items.filter((a) =>
        `${a.detail || ''} ${a.userName || ''} ${a.action || ''}`.toLowerCase().includes(q)
      );
    }

    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const users = [...new Map(all.map((a) => [a.userId || 'system', a.userName || 'Sistem'])).entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
      actions: [...new Set(all.map((a) => a.action))].filter(Boolean).sort(),
      users,
    });
  })
);

router.get(
  '/admin/pricing',
  requireAuth,
  requireRole(ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const db = getDb();
    res.json({ pricing: pricingOf(db.settings) });
  })
);

router.put(
  '/admin/pricing',
  requireAuth,
  requireRole('superadmin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const plans = req.body?.plans;
    if (!Array.isArray(plans) || !plans.length) {
      throw httpError(400, 'Daftar paket harga wajib diisi minimal satu.');
    }
    if (plans.length > 12) throw httpError(400, 'Maksimal 12 paket harga.');
    const pricing = normalizePricing({ plans });
    pricing.updatedAt = new Date().toISOString();
    db.settings.pricing = pricing;
    db.settings.updatedAt = pricing.updatedAt;

    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'pricing.update',
      detail: `Memperbarui harga paket (${pricing.plans.length} paket, ${pricing.currency}).`,
    });
    save();
    emitEvent('settings', { pricing });
    res.json({ pricing, message: 'Harga paket disimpan.' });
  })
);

router.get(
  '/admin/backup',
  requireAuth,
  requireRole('superadmin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const file = path.join(DATA_DIR, 'db.json');
    if (!fs.existsSync(file)) throw httpError(404, 'Database belum tersedia.');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'backup.download',
      detail: 'Mengunduh backup database (db.json).',
    });
    save();
    res.download(file, `lintasjb-backup-${stamp}.json`);
  })
);

export default router;
