import express from 'express';
import { getDb, save, DATA_DIR } from '../lib/store.js';
import { requireAuth, requireRole, publicUser } from '../lib/auth.js';
import { hasSecret } from '../lib/secret.js';
import {
  assertNodeQuotaFor,
  keyForUser,
  licenseStatusFor,
} from '../lib/license.js';
import {
  createAlarm,
  createFault,
  downstreamNodes,
  nearestNode,
  pushActivity,
  repairFault,
  resolveAlarmByKey,
  uid,
} from '../lib/faults.js';
import { pathLength, pointAtDistance, formatDistance } from '../lib/geo.js';
import { emitEvent } from '../lib/events.js';
import { cloneProject, createProject } from '../lib/projects.js';
import { BASEMAPS } from '../basemaps.js';
import { CABLE_ANIMATION_TYPES } from '../../public/js/cable-animations.js';
import {
  asyncHandler,
  assertProjectAccess,
  blockDemo,
  canAccessProject,
  clampNumber,
  cleanText,
  httpError,
  isDemoUser,
  projectIdOf,
  requireEntityProjectAccess,
  requireFields,
  resolveProject,
  sanitizeSettings,
  visibleProjects,
} from './helpers.js';

const router = express.Router();

export const NODE_TYPES = ['pop', 'router', 'server', 'olt', 'odc', 'odp', 'ont', 'closure'];
export const CABLE_TYPES = ['backbone', 'feeder', 'distribution', 'drop'];
const NODE_STATUS = ['online', 'offline', 'warning', 'critical', 'maintenance', 'planned'];
const CABLE_STATUS = ['active', 'fault', 'maintenance', 'planned', 'decommissioned'];
const ANIMATIONS = CABLE_ANIMATION_TYPES;
const FAULT_SOURCES = ['manual', 'otdr', 'posgis', 'genieacs', 'hioso', 'mikrotik', 'auto'];

function publicOlt(olt) {
  const { passwordEnc, ...rest } = olt;
  return { ...rest, hasPassword: hasSecret(passwordEnc) };
}

function publicRouter(r) {
  const { passwordEnc, ...rest } = r;
  return { ...rest, hasPassword: hasSecret(passwordEnc) };
}

function nodeStats(db, projectId) {
  const nodes = db.nodes.filter((n) => n.projectId === projectId);
  const cables = db.cables.filter((c) => c.projectId === projectId);
  const faults = db.faults.filter((f) => f.projectId === projectId);
  const alarms = db.alarms.filter((a) => a.projectId === projectId);
  const byType = {};
  for (const type of NODE_TYPES) byType[type] = 0;
  for (const node of nodes) byType[node.type] = (byType[node.type] || 0) + 1;
  const byStatus = {};
  for (const node of nodes) byStatus[node.status] = (byStatus[node.status] || 0) + 1;
  const cableKm = {};
  for (const type of CABLE_TYPES) cableKm[type] = 0;
  let totalLength = 0;
  for (const cable of cables) {
    const len = Number(cable.lengthM) || pathLength(cable.path);
    totalLength += len;
    cableKm[cable.type] = (cableKm[cable.type] || 0) + len / 1000;
  }
  for (const key of Object.keys(cableKm)) cableKm[key] = Number(cableKm[key].toFixed(2));
  const ont = nodes.filter((n) => n.type === 'ont');
  return {
    nodes: nodes.length,
    cables: cables.length,
    cableKm: Number((totalLength / 1000).toFixed(2)),
    cableKmByType: cableKm,
    nodesByType: byType,
    nodesByStatus: byStatus,
    ontTotal: ont.length,
    ontOnline: ont.filter((n) => n.status === 'online').length,
    ontOffline: ont.filter((n) => n.status === 'offline').length,
    ontWarning: ont.filter((n) => n.status === 'warning').length,
    faultsActive: faults.filter((f) => f.status === 'active').length,
    faultsTotal: faults.length,
    alarmsActive: alarms.filter((a) => !a.resolved).length,
    alarmsCritical: alarms.filter((a) => !a.resolved && a.severity === 'critical').length,
    alarmsUnacked: alarms.filter((a) => !a.resolved && !a.acknowledged).length,
    fiberUtilization: (() => {
      const cablesWithFiber = cables.filter((c) => Number(c.fiberCount) > 0);
      const total = cablesWithFiber.reduce((a, c) => a + Number(c.fiberCount), 0);
      const used = cablesWithFiber.reduce((a, c) => a + Number(c.usedFibers || 0), 0);
      return total ? Math.round((used / total) * 100) : 0;
    })(),
  };
}

function normalizePath(input, from, to) {
  let path = [];
  if (Array.isArray(input)) {
    path = input
      .map((p) => {
        if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
        if (p && typeof p === 'object') return [Number(p.lat), Number(p.lng)];
        return null;
      })
      .filter(
        (p) =>
          p &&
          Number.isFinite(p[0]) &&
          Number.isFinite(p[1]) &&
          p[0] >= -90 &&
          p[0] <= 90 &&
          p[1] >= -180 &&
          p[1] <= 180
      );
  }
  if (path.length < 2 && from && to) path = [[from.lat, from.lng], [to.lat, to.lng]];
  if (from && path.length) path[0] = [from.lat, from.lng];
  if (to && path.length) path[path.length - 1] = [to.lat, to.lng];
  if (path.length > 2000) path = path.slice(0, 2000);
  return path.map(([lat, lng]) => [Number(lat.toFixed(7)), Number(lng.toFixed(7))]);
}

function nodeFromBody(body, project, existing = null) {
  const type = String(body.type || existing?.type || 'odp');
  if (!NODE_TYPES.includes(type)) throw httpError(400, `Tipe node tidak valid: ${type}.`);
  const name = cleanText(body.name ?? existing?.name, 120);
  if (!name) throw httpError(400, 'Nama node wajib diisi.');
  const lat = Number(body.lat ?? existing?.lat);
  const lng = Number(body.lng ?? existing?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw httpError(400, 'Latitude tidak valid.');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw httpError(400, 'Longitude tidak valid.');
  const status = String(body.status ?? existing?.status ?? 'online');
  if (!NODE_STATUS.includes(status)) throw httpError(400, 'Status node tidak valid.');
  return {
    ...(existing || {}),
    projectId: project.id,
    type,
    name,
    code: cleanText(body.code ?? existing?.code, 48) || name.slice(0, 12).toUpperCase(),
    lat,
    lng,
    status,
    parentId: body.parentId === undefined ? existing?.parentId || null : body.parentId || null,
    address: cleanText(body.address ?? existing?.address, 200),
    notes: cleanText(body.notes ?? existing?.notes, 1000),
    vendor: cleanText(body.vendor ?? existing?.vendor, 80),
    model: cleanText(body.model ?? existing?.model, 80),
    serial: cleanText(body.serial ?? existing?.serial, 80),
    capacity: clampNumber(body.capacity ?? existing?.capacity, 0, 100000, 0),
    usedPorts: clampNumber(body.usedPorts ?? existing?.usedPorts, 0, 100000, 0),
    genieacsSerial: cleanText(body.genieacsSerial ?? existing?.genieacsSerial, 80),
    oltId: cleanText(body.oltId ?? existing?.oltId, 80),
    properties:
      body.properties && typeof body.properties === 'object'
        ? { ...existing?.properties, ...body.properties }
        : existing?.properties || {},
  };
}

function assertParent(db, parentId, projectId, selfId = null) {
  if (!parentId) return;
  if (selfId && parentId === selfId) throw httpError(400, 'Node tidak boleh menjadi parent dirinya sendiri.');
  const parent = db.nodes.find((n) => n.id === parentId);
  if (!parent) throw httpError(400, 'Parent node tidak ditemukan.');
  if (parent.projectId !== projectId) throw httpError(400, 'Parent node berada di project lain.');
}

function cableFromBody(db, body, project, existing = null) {
  const type = String(body.type || existing?.type || 'distribution');
  if (!CABLE_TYPES.includes(type)) throw httpError(400, 'Tipe kabel tidak valid.');
  const name = cleanText(body.name ?? existing?.name, 120);
  if (!name) throw httpError(400, 'Nama kabel wajib diisi.');
  const fromNodeId = body.fromNodeId === undefined ? existing?.fromNodeId || null : body.fromNodeId || null;
  const toNodeId = body.toNodeId === undefined ? existing?.toNodeId || null : body.toNodeId || null;
  const from = fromNodeId ? db.nodes.find((n) => n.id === fromNodeId) : null;
  const to = toNodeId ? db.nodes.find((n) => n.id === toNodeId) : null;
  if (fromNodeId && !from) throw httpError(400, 'Node awal tidak ditemukan.');
  if (toNodeId && !to) throw httpError(400, 'Node akhir tidak ditemukan.');
  if (from && from.projectId !== project.id) throw httpError(400, 'Node awal berada di project lain.');
  if (to && to.projectId !== project.id) throw httpError(400, 'Node akhir berada di project lain.');
  if (fromNodeId && fromNodeId === toNodeId) throw httpError(400, 'Node awal dan akhir tidak boleh sama.');
  const path = normalizePath(body.path ?? existing?.path, from, to);
  if (path.length < 2) {
    throw httpError(400, 'Rute kabel minimal terdiri dari 2 titik. Gambar rute di peta atau pilih node awal/akhir.');
  }
  const status = String(body.status ?? existing?.status ?? 'active');
  if (!CABLE_STATUS.includes(status)) throw httpError(400, 'Status kabel tidak valid.');
  const animationInput = body.animation || existing?.animation || {};
  const animation = {
    type: ANIMATIONS.includes(animationInput.type) ? animationInput.type : 'flow',
    speed: clampNumber(animationInput.speed, 0.2, 5, 1),
    reverse: Boolean(animationInput.reverse),
  };
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || existing?.color || ''))
    ? String(body.color || existing?.color)
    : '#22d3ee';
  return {
    ...(existing || {}),
    projectId: project.id,
    name,
    code: cleanText(body.code ?? existing?.code, 48) || name.slice(0, 12).toUpperCase(),
    type,
    fromNodeId,
    toNodeId,
    path,
    color,
    animation,
    status,
    fiberCount: clampNumber(body.fiberCount ?? existing?.fiberCount, 0, 6912, type === 'drop' ? 1 : 12),
    usedFibers: clampNumber(body.usedFibers ?? existing?.usedFibers, 0, 6912, 0),
    lengthM: Math.round(pathLength(path)),
    notes: cleanText(body.notes ?? existing?.notes, 1000),
  };
}

// ---------------------------------------------------------------------------
// About / informasi aplikasi
// ---------------------------------------------------------------------------
router.get(
  '/about',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const license = licenseStatusFor(db, req.user);
    res.json({
      app: {
        name: 'lintasJB NMS',
        company: 'PT Lintas Jaringan Bersama',
        version: '1.0.0',
        tagline: 'Fiber Network Intelligence',
        description:
          'Platform pemetaan, monitoring, dan fault locator jaringan FTTH self-hosted. Menggabungkan peta interaktif, manajemen aset, POSGIS, GenieACS, OLT multi-vendor, dan MikroTik RouterOS dalam satu NOC.',
        website: 'https://lintasjb.id',
        email: 'support@lintasjb.id',
        phone: '0812-3456-7890',
        location: 'Cirahayu, Jawa Barat, Indonesia',
        licenseModel: 'Lisensi kustom self-hosted (HMAC)',
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        uptimeSec: Math.round(process.uptime()),
        serverTime: new Date().toISOString(),
        dataDir: DATA_DIR,
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      stats: (() => {
        const allowedIds = new Set(visibleProjects(db, req.user).map((p) => p.id));
        const scopedNodes = db.nodes.filter((n) => allowedIds.has(n.projectId));
        const scopedCables = db.cables.filter((c) => allowedIds.has(c.projectId));
        const isAdmin = ['superadmin', 'admin'].includes(req.user.role);
        return {
          projects: allowedIds.size,
          nodes: scopedNodes.length,
          cables: scopedCables.length,
          users: isAdmin ? db.users.length : null,
          orders: isAdmin
            ? (db.orders || []).length
            : (db.orders || []).filter((o) => o.userId === req.user.id).length,
          activeFaults: db.faults.filter((f) => allowedIds.has(f.projectId) && f.status === 'active').length,
          activeAlarms: db.alarms.filter((a) => allowedIds.has(a.projectId) && !a.resolved).length,
        };
      })(),
      license,
      stack: [
        { name: 'Node.js', detail: 'Runtime server (ESM)' },
        { name: 'Express', detail: 'REST API & static' },
        { name: 'Leaflet', detail: 'Peta interaktif & animasi SVG' },
        { name: 'Vanilla JS', detail: 'SPA tanpa build step' },
        { name: 'Server-Sent Events', detail: 'Realtime alarm & fault' },
        { name: 'JSON Store', detail: 'Database lokal atomik' },
        { name: 'GenieACS NBI', detail: 'TR-069 / CWMP' },
        { name: 'HiOSO OLT', detail: 'Simulasi / HTTP / SNMP' },
        { name: 'MikroTik RouterOS', detail: 'REST API v7' },
      ],
      modules: [
        { icon: 'map', title: 'Live Map', text: '10 basemap, layer aset, animasi aliran data, lokasi saya, dan koordinat.' },
        { icon: 'alert-triangle', title: 'POSGIS Fault Locator', text: 'Konversi jarak OTDR menjadi titik putus, node terdampak, dan alarm otomatis.' },
        { icon: 'network', title: 'Manajemen Aset', text: 'POP, router, server, OLT, ODC, ODP, ONT, dan joint closure dengan CRUD penuh.' },
        { icon: 'cable', title: 'Kabel & Rute', text: 'Backbone, feeder, distribusi, drop: panjang geodesic, core, dan utilisasi.' },
        { icon: 'router', title: 'Integrasi Perangkat', text: 'GenieACS, OLT HiOSO multi-vendor, dan MikroTik RouterOS v7 REST.' },
        { icon: 'swap', title: 'Import / Export', text: 'KML, KMZ, GeoJSON, dan CSV dengan pratinjau dry-run.' },
        { icon: 'key', title: 'Lisensi & Pembayaran', text: 'Harga kustom, QRIS, transfer bank, virtual account, e-wallet, dan retail.' },
        { icon: 'shield', title: 'Keamanan & Peran', text: 'JWT, role superadmin/admin/operator/viewer, audit log aktivitas.' },
      ],
      credits: [
        'Leaflet — BSD-2-Clause',
        'OpenStreetMap & penyedia tile — atribusi masing-masing',
        'Express, Multer, JSZip, fast-xml-parser, jsonwebtoken — MIT',
        'qrcode — MIT',
      ],
      shortcuts: [
        ['Ctrl + K', 'Pencarian global node / kabel / halaman'],
        ['Esc', 'Tutup modal, drawer, atau palette'],
        ['Double click peta', 'Zoom in cepat'],
      ],
    });
  })
);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
router.get(
  '/bootstrap',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const requested = String(req.query.projectId || '');
    const accessible = visibleProjects(db, req.user);
    if (requested && db.projects.some((p) => p.id === requested) && !accessible.some((p) => p.id === requested)) {
      throw httpError(403, 'Anda tidak memiliki akses ke project ini.');
    }
    // Tanpa projectId eksplisit, prioritaskan project milik user yang login
    // (mis. hasil registrasi) sebelum jatuh ke project pertama yang diizinkan.
    const project =
      (requested && accessible.find((p) => p.id === requested)) ||
      accessible.find((p) => p.createdBy && p.createdBy === req.user.id) ||
      accessible[0] ||
      null;
    const projectId = project?.id || null;
    const allowedIds = new Set(accessible.map((p) => p.id));
    const demo = isDemoUser(req.user);
    const nodes = projectId ? db.nodes.filter((n) => n.projectId === projectId) : [];
    const cables = projectId ? db.cables.filter((c) => c.projectId === projectId) : [];
    const faults = projectId
      ? db.faults.filter((f) => f.projectId === projectId).slice(0, 100)
      : [];
    const alarms = projectId
      ? db.alarms.filter((a) => a.projectId === projectId).slice(0, 150)
      : [];
    const activity = db.activity
      .filter((a) => {
        if (req.user.role === 'superadmin') return !projectId || !a.projectId || a.projectId === projectId;
        if (a.userId === req.user.id) return true;
        return Boolean(a.projectId) && allowedIds.has(a.projectId);
      })
      .slice(0, 60);
    const license = licenseStatusFor(db, req.user);
    const ownerName = (p) => {
      if (!p.createdBy) return null;
      return db.users.find((u) => u.id === p.createdBy)?.name || null;
    };
    const olts = db.olts
      .filter((o) => allowedIds.has(o.projectId))
      .filter((o) => !demo || o.simulated === true)
      .filter((o) => !projectId || o.projectId === projectId);
    const routers = demo
      ? []
      : db.routers
          .filter((r) => allowedIds.has(r.projectId))
          .filter((r) => !projectId || r.projectId === projectId);
    res.json({
      user: publicUser(req.user),
      settings: sanitizeSettings(db.settings, req.user),
      license,
      licenseKey: keyForUser(db, req.user),
      basemaps: BASEMAPS,
      projects: accessible.map((p) => ({
        ...p,
        ownerName: ownerName(p),
        nodeCount: db.nodes.filter((n) => n.projectId === p.id).length,
        cableCount: db.cables.filter((c) => c.projectId === p.id).length,
      })),
      project,
      nodes,
      cables,
      faults,
      alarms,
      splices: (db.splices || []).filter((s) => !projectId || s.projectId === projectId),
      stats: projectId ? nodeStats(db, projectId) : {},
      activity,
      integrations: {
        genieacs: {
          ...db.cache.genieacs,
          devices: demo ? [] : (db.cache.genieacs.devices || []).slice(0, 300),
          faults: demo ? [] : (db.cache.genieacs.faults || []).slice(0, 50),
        },
        olts: olts.map(publicOlt),
        routers: routers.map(publicRouter),
        cacheOlts: Object.fromEntries(
          Object.entries(db.cache.olts || {}).filter(([id]) => olts.some((o) => o.id === id))
        ),
        cacheRouters: Object.fromEntries(
          Object.entries(db.cache.routers || {}).filter(([id]) => routers.some((r) => r.id === id))
        ),
        lastMonitorAt: db.cache.lastMonitorAt,
        monitorError: demo ? null : db.cache.monitorError,
      },
      serverTime: new Date().toISOString(),
    });
  })
);

router.get(
  '/stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    res.json({ stats: nodeStats(db, project.id) });
  })
);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
router.get(
  '/projects',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ownerName = (p) => {
      if (!p.createdBy) return null;
      return db.users.find((u) => u.id === p.createdBy)?.name || null;
    };
    res.json({
      projects: visibleProjects(db, req.user).map((p) => ({
        ...p,
        ownerName: ownerName(p),
        nodeCount: db.nodes.filter((n) => n.projectId === p.id).length,
        cableCount: db.cables.filter((c) => c.projectId === p.id).length,
      })),
    });
  })
);

router.post(
  '/projects',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    if (isDemoUser(req.user)) throw httpError(403, 'Akun demo tidak dapat membuat project baru.');
    requireFields(req.body, ['name']);
    const project = createProject(db, {
      ...req.body,
      userId: req.user.id,
      userName: req.user.name,
    });
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'project.create',
      detail: `Membuat project ${project.name}.`,
    });
    save();
    emitEvent('projects', { project });
    res.status(201).json({ project });
  })
);

router.put(
  '/projects/:id',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = db.projects.find((p) => p.id === req.params.id);
    if (!project) throw httpError(404, 'Project tidak ditemukan.');
    assertProjectAccess(req.user, project);
    if (req.body.name !== undefined) project.name = cleanText(req.body.name, 120) || project.name;
    if (req.body.code !== undefined) project.code = cleanText(req.body.code, 40);
    if (req.body.description !== undefined) project.description = cleanText(req.body.description, 500);
    if (Array.isArray(req.body.center) && req.body.center.length === 2) {
      project.center = [Number(req.body.center[0]), Number(req.body.center[1])];
    }
    if (req.body.zoom !== undefined) project.zoom = clampNumber(req.body.zoom, 2, 22, project.zoom);
    if (req.body.status !== undefined) project.status = cleanText(req.body.status, 20);
    project.updatedAt = new Date().toISOString();
    save();
    emitEvent('projects', { project });
    res.json({ project });
  })
);

router.post(
  '/projects/:id/duplicate',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    if (isDemoUser(req.user)) throw httpError(403, 'Akun demo tidak dapat menduplikasi project.');
    const source = db.projects.find((p) => p.id === req.params.id);
    if (!source) throw httpError(404, 'Project tidak ditemukan.');
    assertProjectAccess(req.user, source);
    const project = cloneProject(db, req.params.id, {
      name: cleanText(req.body.name, 120) || undefined,
      code: cleanText(req.body.code, 40) || undefined,
      userId: req.user.id,
      userName: req.user.name,
    });
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'project.duplicate',
      detail: `Menduplikasi project menjadi ${project.name}.`,
    });
    save();
    emitEvent('projects', { project });
    res.status(201).json({ project });
  })
);

router.delete(
  '/projects/:id',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    if (db.projects.length <= 1) throw httpError(400, 'Minimal satu project harus tersedia.');
    const project = db.projects.find((p) => p.id === req.params.id);
    if (!project) throw httpError(404, 'Project tidak ditemukan.');
    assertProjectAccess(req.user, project);
    db.projects = db.projects.filter((p) => p.id !== req.params.id);
    db.nodes = db.nodes.filter((n) => n.projectId !== project.id);
    db.cables = db.cables.filter((c) => c.projectId !== project.id);
    db.faults = db.faults.filter((f) => f.projectId !== project.id);
    db.alarms = db.alarms.filter((a) => a.projectId !== project.id);
    db.olts = db.olts.filter((o) => o.projectId !== project.id);
    db.routers = db.routers.filter((r) => r.projectId !== project.id);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'project.delete',
      detail: `Menghapus project ${project.name}.`,
    });
    save();
    emitEvent('projects', { deleted: project.id });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------
router.get(
  '/nodes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    let nodes = db.nodes.filter((n) => n.projectId === project.id);
    if (req.query.type) nodes = nodes.filter((n) => n.type === req.query.type);
    if (req.query.status) nodes = nodes.filter((n) => n.status === req.query.status);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      nodes = nodes.filter((n) =>
        [n.name, n.code, n.serial, n.address].some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    res.json({ nodes });
  })
);

router.post(
  '/nodes',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    assertNodeQuotaFor(db, req.user);
    const node = nodeFromBody(req.body, project);
    assertParent(db, node.parentId, project.id);
    if (db.nodes.some((n) => n.projectId === project.id && n.code && n.code === node.code)) {
      node.code = `${node.code}-${Math.floor(Math.random() * 90 + 10)}`;
    }
    node.id = uid('nd');
    node.createdAt = new Date().toISOString();
    node.updatedAt = new Date().toISOString();
    db.nodes.push(node);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'node.create',
      detail: `Menambahkan ${node.type.toUpperCase()} ${node.name}.`,
    });
    save();
    emitEvent('node:changed', { node, action: 'create' });
    res.status(201).json({ node });
  })
);

router.put(
  '/nodes/:id',
  requireAuth,
  requireEntityProjectAccess('node'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const node = db.nodes.find((n) => n.id === req.params.id);
    if (!node) throw httpError(404, 'Node tidak ditemukan.');
    const project = db.projects.find((p) => p.id === node.projectId);
    if (!project) throw httpError(404, 'Project node tidak ditemukan.');
    const next = nodeFromBody(req.body, project, node);
    assertParent(db, next.parentId, project.id, node.id);
    Object.assign(node, next, { updatedAt: new Date().toISOString() });
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: node.projectId,
      action: 'node.update',
      detail: `Memperbarui ${node.type.toUpperCase()} ${node.name}.`,
    });
    save();
    emitEvent('node:changed', { node, action: 'update' });
    res.json({ node });
  })
);

/** Hapus beberapa node sekaligus beserta kabel/fault/alarm terkait. */
function removeNodes(db, nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  const connected = db.cables.filter((c) => ids.has(c.fromNodeId) || ids.has(c.toNodeId));
  const now = new Date().toISOString();
  for (const cable of connected) {
    const fault = db.faults.find((f) => f.cableId === cable.id && f.status === 'active');
    if (fault) {
      fault.status = 'resolved';
      fault.resolvedAt = now;
      fault.notes = 'Kabel dihapus bersama node.';
    }
  }
  db.cables = db.cables.filter((c) => !ids.has(c.fromNodeId) && !ids.has(c.toNodeId));
  for (const child of db.nodes) if (ids.has(child.parentId)) child.parentId = null;
  for (const alarm of db.alarms) if (ids.has(alarm.nodeId)) alarm.nodeId = null;
  db.nodes = db.nodes.filter((n) => !ids.has(n.id));
  return connected;
}

router.post(
  '/nodes/bulk-delete',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(raw.map(String))];
    if (!ids.length) throw httpError(400, 'Pilih minimal satu node.');
    if (ids.length > 200) throw httpError(400, 'Maksimal 200 node sekali hapus.');
    const nodes = db.nodes.filter((n) => ids.includes(n.id));
    if (!nodes.length) throw httpError(404, 'Node tidak ditemukan.');
    for (const node of nodes) {
      const project = db.projects.find((p) => p.id === node.projectId);
      if (!canAccessProject(req.user, project)) {
        throw httpError(403, 'Anda tidak memiliki akses ke sebagian node yang dipilih.');
      }
    }
    const connected = removeNodes(db, nodes);
    const names = nodes.slice(0, 5).map((n) => n.name).join(', ');
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: nodes[0].projectId,
      action: 'node.delete.bulk',
      detail: `Menghapus ${nodes.length} node (${names}${nodes.length > 5 ? ' …' : ''}) dan ${connected.length} kabel terkait.`,
    });
    save();
    emitEvent('node:changed', { deleted: nodes.map((n) => n.id), action: 'delete' });
    res.json({ ok: true, deleted: nodes.length, deletedCables: connected.length });
  })
);

router.delete(
  '/nodes/:id',
  requireAuth,
  requireEntityProjectAccess('node'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const node = db.nodes.find((n) => n.id === req.params.id);
    if (!node) throw httpError(404, 'Node tidak ditemukan.');
    const connected = removeNodes(db, [node]);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: node.projectId,
      action: 'node.delete',
      detail: `Menghapus node ${node.name} dan ${connected.length} kabel terkait.`,
    });
    save();
    emitEvent('node:changed', { node, action: 'delete' });
    res.json({ ok: true, deletedCables: connected.map((c) => c.id) });
  })
);

// ---------------------------------------------------------------------------
// Cables
// ---------------------------------------------------------------------------
router.get(
  '/cables',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    let cables = db.cables.filter((c) => c.projectId === project.id);
    if (req.query.type) cables = cables.filter((c) => c.type === req.query.type);
    if (req.query.status) cables = cables.filter((c) => c.status === req.query.status);
    res.json({ cables });
  })
);

router.post(
  '/cables',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    const cable = cableFromBody(db, req.body, project);
    cable.id = uid('cb');
    cable.createdAt = new Date().toISOString();
    cable.updatedAt = new Date().toISOString();
    db.cables.push(cable);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'cable.create',
      detail: `Menambahkan kabel ${cable.name} (${cable.type}, ${formatDistance(cable.lengthM)}).`,
    });
    save();
    emitEvent('cable:changed', { cable, action: 'create' });
    res.status(201).json({ cable });
  })
);

router.put(
  '/cables/:id',
  requireAuth,
  requireEntityProjectAccess('cable'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const cable = db.cables.find((c) => c.id === req.params.id);
    if (!cable) throw httpError(404, 'Kabel tidak ditemukan.');
    const project = db.projects.find((p) => p.id === cable.projectId);
    const next = cableFromBody(db, req.body, project, cable);
    Object.assign(cable, next, { updatedAt: new Date().toISOString() });
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: cable.projectId,
      action: 'cable.update',
      detail: `Memperbarui kabel ${cable.name}.`,
    });
    save();
    emitEvent('cable:changed', { cable, action: 'update' });
    res.json({ cable });
  })
);

router.delete(
  '/cables/:id',
  requireAuth,
  requireEntityProjectAccess('cable'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const cable = db.cables.find((c) => c.id === req.params.id);
    if (!cable) throw httpError(404, 'Kabel tidak ditemukan.');
    const activeFault = db.faults.find((f) => f.cableId === cable.id && f.status === 'active');
    if (activeFault) {
      activeFault.status = 'resolved';
      activeFault.resolvedAt = new Date().toISOString();
      activeFault.notes = 'Kabel dihapus.';
    }
    db.cables = db.cables.filter((c) => c.id !== cable.id);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: cable.projectId,
      action: 'cable.delete',
      detail: `Menghapus kabel ${cable.name}.`,
    });
    save();
    emitEvent('cable:changed', { cable, action: 'delete' });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Fault locator (POSGIS)
// ---------------------------------------------------------------------------
router.post(
  '/faults/locate',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const cable = db.cables.find((c) => c.id === req.body.cableId);
    if (!cable) throw httpError(404, 'Kabel tidak ditemukan. Pilih kabel yang akan dianalisis.');
    const active = db.faults.find((f) => f.cableId === cable.id && f.status === 'active');
    if (active) {
      throw httpError(409, `Kabel ini sudah memiliki gangguan aktif (${active.id}). Lakukan repair terlebih dahulu.`);
    }
    const total = Number(cable.lengthM) || pathLength(cable.path);
    let distanceM = null;
    if (req.body.distanceKm !== undefined) distanceM = Number(req.body.distanceKm) * 1000;
    else if (req.body.distanceM !== undefined) distanceM = Number(req.body.distanceM);
    else if (req.body.distance !== undefined) distanceM = Number(req.body.distance);
    let ratio = null;
    if (distanceM === null && req.body.ratio !== undefined) ratio = Number(req.body.ratio);
    distanceM = Math.max(0, Math.min(total, distanceM ?? (ratio ?? 0.5) * total));
    const source = FAULT_SOURCES.includes(req.body.source) ? req.body.source : 'posgis';
    const result = createFault(db, {
      cable,
      distanceM,
      source,
      severity: 'critical',
      title: cleanText(req.body.title, 160) || undefined,
      description:
        cleanText(req.body.description, 500) ||
        `Fault locator menemukan titik putus pada ${formatDistance(distanceM)} dari sisi A (${(distanceM / 1000).toFixed(3)} km).`,
      user: req.user,
    });
    const projectNodes = db.nodes.filter((n) => n.projectId === cable.projectId);
    const nearestOdp = nearestNode(projectNodes, result.fault.point, ['odp', 'closure', 'odc']);
    const nearestAny = nearestNode(projectNodes, result.fault.point);
    save();
    res.status(201).json({
      ...result,
      cable,
      totalM: total,
      distanceM,
      nearest: nearestOdp || nearestAny,
      downstream: downstreamNodes(db, cable.projectId, cable.toNodeId),
      locator: 'POSGIS local geodesic engine',
    });
  })
);

router.post(
  '/faults/device',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const node = db.nodes.find((n) => n.id === req.body.nodeId);
    if (!node) throw httpError(404, 'Node perangkat tidak ditemukan.');
    const active = db.faults.find((f) => f.nodeId === node.id && f.status === 'active');
    if (active) throw httpError(409, 'Perangkat ini sudah memiliki gangguan aktif.');
    const result = createFault(db, {
      node,
      source: FAULT_SOURCES.includes(req.body.source) ? req.body.source : 'manual',
      severity: req.body.severity === 'warning' ? 'warning' : 'critical',
      title: cleanText(req.body.title, 160) || `Perangkat offline: ${node.name}`,
      description: cleanText(req.body.description, 500) || 'Simulasi gangguan perangkat untuk validasi alarm dan animasi.',
      user: req.user,
    });
    save();
    res.status(201).json(result);
  })
);

router.get(
  '/faults',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    let faults = db.faults.filter((f) => f.projectId === project.id);
    if (req.query.status) faults = faults.filter((f) => f.status === req.query.status);
    res.json({ faults: faults.slice(0, 300) });
  })
);

router.get(
  '/faults/:id',
  requireAuth,
  requireEntityProjectAccess('fault'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const fault = db.faults.find((f) => f.id === req.params.id);
    if (!fault) throw httpError(404, 'Gangguan tidak ditemukan.');
    res.json({
      fault,
      cable: db.cables.find((c) => c.id === fault.cableId) || null,
      node: db.nodes.find((n) => n.id === fault.nodeId) || null,
      alarms: db.alarms.filter((a) => a.faultId === fault.id),
    });
  })
);

router.post(
  '/faults/:id/repair',
  requireAuth,
  requireEntityProjectAccess('fault'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const fault = db.faults.find((f) => f.id === req.params.id);
    if (!fault) throw httpError(404, 'Gangguan tidak ditemukan.');
    repairFault(db, fault, { user: req.user });
    save();
    res.json({ fault, message: 'Gangguan dipulihkan. Kabel kembali normal.' });
  })
);

router.delete(
  '/faults/:id',
  requireAuth,
  requireEntityProjectAccess('fault'),
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const fault = db.faults.find((f) => f.id === req.params.id);
    if (!fault) throw httpError(404, 'Gangguan tidak ditemukan.');
    if (fault.status === 'active') repairFault(db, fault, { user: req.user });
    db.faults = db.faults.filter((f) => f.id !== req.params.id);
    db.alarms = db.alarms.filter((a) => a.faultId !== fault.id);
    save();
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------
router.get(
  '/alarms',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    let alarms = db.alarms.filter((a) => a.projectId === project.id);
    if (req.query.status === 'active') alarms = alarms.filter((a) => !a.resolved);
    if (req.query.status === 'resolved') alarms = alarms.filter((a) => a.resolved);
    if (req.query.severity) alarms = alarms.filter((a) => a.severity === req.query.severity);
    const limit = Math.min(500, Number(req.query.limit) || 150);
    res.json({
      alarms: alarms.slice(0, limit),
      stats: {
        active: alarms.filter((a) => !a.resolved).length,
        unacked: alarms.filter((a) => !a.resolved && !a.acknowledged).length,
        critical: alarms.filter((a) => !a.resolved && a.severity === 'critical').length,
      },
    });
  })
);

router.post(
  '/alarms/:id/ack',
  requireAuth,
  blockDemo,
  requireEntityProjectAccess('alarm'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const alarm = db.alarms.find((a) => a.id === req.params.id);
    if (!alarm) throw httpError(404, 'Alarm tidak ditemukan.');
    alarm.acknowledged = true;
    alarm.acknowledgedBy = req.user.id;
    alarm.acknowledgedAt = new Date().toISOString();
    save();
    emitEvent('alarm:changed', { alarm });
    res.json({ alarm });
  })
);

router.post(
  '/alarms/:id/resolve',
  requireAuth,
  requireEntityProjectAccess('alarm'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const alarm = db.alarms.find((a) => a.id === req.params.id);
    if (!alarm) throw httpError(404, 'Alarm tidak ditemukan.');
    alarm.resolved = true;
    alarm.resolvedAt = new Date().toISOString();
    if (alarm.dedupeKey) resolveAlarmByKey(db, alarm.dedupeKey);
    save();
    emitEvent('alarm:changed', { alarm });
    res.json({ alarm });
  })
);

router.post(
  '/alarms/ack-all',
  requireAuth,
  blockDemo,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    const projectId = project.id;
    let count = 0;
    for (const alarm of db.alarms) {
      if (alarm.projectId !== projectId || alarm.resolved || alarm.acknowledged) continue;
      alarm.acknowledged = true;
      alarm.acknowledgedBy = req.user.id;
      alarm.acknowledgedAt = new Date().toISOString();
      count += 1;
    }
    save();
    emitEvent('alarms:ack-all', { projectId });
    res.json({ ok: true, count });
  })
);

router.get(
  '/activity',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const requested = projectIdOf(req);
    const allowedIds = new Set(visibleProjects(db, req.user).map((p) => p.id));
    const items = db.activity
      .filter((a) => {
        if (a.userId === req.user.id) return true;
        if (!a.projectId) return req.user.role === 'superadmin';
        if (!allowedIds.has(a.projectId)) return false;
        return requested ? a.projectId === requested : true;
      })
      .slice(0, Math.min(300, Number(req.query.limit) || 80));
    res.json({ activity: items });
  })
);

router._nodeStats = nodeStats;
export default router;
