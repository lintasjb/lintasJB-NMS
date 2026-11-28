/* =============================================================================
 * lintasJB NMS — Sambungan serat (splicing) per project
 * ========================================================================== */
import express from 'express';
import { getDb, save } from '../lib/store.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { pushActivity, uid } from '../lib/faults.js';
import { emitEvent } from '../lib/events.js';
import {
  asyncHandler,
  clampNumber,
  cleanText,
  httpError,
  requireEntityProjectAccess,
  requireFields,
  resolveProject,
  visibleProjects,
} from './helpers.js';

const router = express.Router();
const METHODS = ['fusion', 'mechanical'];
const STATUSES = ['planned', 'done', 'issue'];

function payload(db, body, projectId, existing = null) {
  requireFields(body, ['name']);
  const lat = Number(body.lat ?? existing?.lat);
  const lng = Number(body.lng ?? existing?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw httpError(400, 'Latitude tidak valid.');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw httpError(400, 'Longitude tidak valid.');
  const method = METHODS.includes(body.method) ? body.method : (existing?.method || 'fusion');
  const status = STATUSES.includes(body.status) ? body.status : (existing?.status || 'done');
  for (const key of ['cableFromId', 'cableToId']) {
    const id = cleanText(body[key], 80);
    if (id && !(db.cables || []).some((c) => c.id === id)) throw httpError(400, 'Kabel yang dipilih tidak ditemukan.');
  }
  return {
    projectId,
    name: cleanText(body.name, 120),
    lat,
    lng,
    method,
    status,
    lossDb: clampNumber(body.lossDb, 0, 30, existing?.lossDb ?? 0.1),
    coreFrom: cleanText(body.coreFrom, 40),
    coreTo: cleanText(body.coreTo, 40),
    cableFromId: cleanText(body.cableFromId, 80),
    cableToId: cleanText(body.cableToId, 80),
    at: cleanText(body.at, 40),
    notes: cleanText(body.notes, 500),
  };
}

router.get(
  '/splices',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const allowed = new Set(visibleProjects(db, req.user).map((p) => p.id));
    let items = (db.splices || []).filter((s) => allowed.has(s.projectId));
    if (req.query.projectId) items = items.filter((s) => s.projectId === req.query.projectId);
    res.json({ splices: items });
  })
);

router.post(
  '/splices',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    const splice = {
      id: uid('spl'),
      ...payload(db, req.body || {}, project.id),
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!db.splices) db.splices = [];
    db.splices.push(splice);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'splice.create',
      detail: `Menambahkan sambungan ${splice.name} (${splice.coreFrom || '-'} → ${splice.coreTo || '-'}).`,
    });
    save();
    emitEvent('splices', { splice });
    res.status(201).json({ splice });
  })
);

router.put(
  '/splices/:id',
  requireAuth,
  requireEntityProjectAccess('splice'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const splice = (db.splices || []).find((s) => s.id === req.params.id);
    if (!splice) throw httpError(404, 'Sambungan tidak ditemukan.');
    const next = payload(db, req.body || {}, splice.projectId, splice);
    Object.assign(splice, next, { updatedAt: new Date().toISOString() });
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: splice.projectId,
      action: 'splice.update',
      detail: `Memperbarui sambungan ${splice.name}.`,
    });
    save();
    emitEvent('splices', { splice });
    res.json({ splice });
  })
);

router.delete(
  '/splices/:id',
  requireAuth,
  requireEntityProjectAccess('splice'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const splice = (db.splices || []).find((s) => s.id === req.params.id);
    if (!splice) throw httpError(404, 'Sambungan tidak ditemukan.');
    db.splices = (db.splices || []).filter((s) => s.id !== splice.id);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: splice.projectId,
      action: 'splice.delete',
      detail: `Menghapus sambungan ${splice.name}.`,
    });
    save();
    emitEvent('splices', { deleted: splice.id });
    res.json({ ok: true });
  })
);

export default router;
