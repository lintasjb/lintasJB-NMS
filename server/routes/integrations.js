import express from 'express';
import { getDb, save } from '../lib/store.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { seal, unseal, hasSecret } from '../lib/secret.js';
import { licenseStatus, assertNodeQuota } from '../lib/license.js';
import { createAlarm, nearestNode, pushActivity, resolveAlarmByKey, uid } from '../lib/faults.js';
import { emitEvent } from '../lib/events.js';
import { runMonitor, monitorStatus } from '../monitors.js';
import * as genieacs from '../adapters/genieacs.js';
import * as hioso from '../adapters/hioso.js';
import { sshExec } from '../adapters/olt-ssh.js';
import * as mikrotik from '../adapters/mikrotik.js';
import { routerConfig } from '../lib/router-config.js';
import { oltConfig } from '../lib/olt-config.js';
import {
  asyncHandler,
  blockDemo,
  clampNumber,
  cleanText,
  httpError,
  isDemoUser,
  requireEntityProjectAccess,
  requireFields,
  resolveProject,
  visibleProjects,
} from './helpers.js';

const router = express.Router();

const VENDORS = ['hioso', 'mikrotik', 'huawei', 'zte', 'fiberhome', 'nokia', 'vsol', 'raisecom', 'cdata', 'generic'];
const OLT_MODELS = {
  hioso: ['HA7304', 'HA7304S', 'HA7308', 'FHA7104', 'FHA7108', 'EPON 1U', 'EPON 2U', 'GPON 4P'],
  mikrotik: ['CRS328-4C-20S-4S+RM', 'CRS305-1G-4S+IN'],
  huawei: ['MA5800-X7', 'MA5800-X15', 'EA5800-X7'],
  zte: ['C320', 'C300', 'C620'],
  fiberhome: ['AN5516-01', 'AN5516-06'],
  nokia: ['7360 ISAM FX-4', '7360 ISAM FX-8'],
  vsol: ['V1600D', 'V1600G2'],
  raisecom: ['ISCOM5508'],
  cdata: ['FD1304'],
  generic: ['Generic OLT'],
};

function publicOlt(olt) {
  const { passwordEnc, sshKeyEnc, sshPassEnc, ...rest } = olt;
  return { ...rest, hasPassword: hasSecret(passwordEnc), hasSshKey: hasSecret(sshKeyEnc) };
}
function publicRouter(r) {
  const { passwordEnc, ...rest } = r;
  return { ...rest, hasPassword: hasSecret(passwordEnc) };
}

function genieConfig(settings, body = {}) {
  const g = settings.integrations.genieacs;
  return {
    ...g,
    ...(body.url ? { url: cleanText(body.url, 300) } : {}),
    ...(body.username !== undefined ? { username: cleanText(body.username, 100) } : {}),
    password: body.password || unseal(g.passwordEnc),
    offlineAfterSec: Number(g.offlineAfterSec || settings.monitor.offlineAfterSec || 600),
  };
}

function positionNear(base, radiusDeg = 0.012) {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * radiusDeg;
  return [base[0] + Math.sin(angle) * r, base[1] + Math.cos(angle) * r];
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
router.get(
  '/integrations/overview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req);
    const projectId = project?.id || null;
    const demo = isDemoUser(req.user);
    const allowedIds = new Set(visibleProjects(db, req.user).map((p) => p.id));
    const olts = db.olts
      .filter((o) => allowedIds.has(o.projectId))
      .filter((o) => !demo || o.simulated === true)
      .filter((o) => !projectId || o.projectId === projectId);
    const routers = demo
      ? []
      : db.routers.filter((r) => allowedIds.has(r.projectId)).filter((r) => !projectId || r.projectId === projectId);
    const g = db.settings.integrations.genieacs;
    res.json({
      genieacs: demo
        ? { enabled: false, url: '', username: '', hasPassword: false, pollSeconds: 0, cache: { devices: [], faults: [] } }
        : {
            enabled: g.enabled,
            url: g.url,
            username: g.username,
            hasPassword: hasSecret(g.passwordEnc),
            pollSeconds: g.pollSeconds,
            offlineAfterSec: g.offlineAfterSec,
            cache: db.cache.genieacs,
          },
      olts: olts.map(publicOlt),
      routers: routers.map(publicRouter),
      cacheOlts: Object.fromEntries(
        Object.entries(db.cache.olts || {}).filter(([id]) => olts.some((o) => o.id === id))
      ),
      cacheRouters: Object.fromEntries(
        Object.entries(db.cache.routers || {}).filter(([id]) => routers.some((r) => r.id === id))
      ),
      monitor: demo
        ? { enabled: false, intervalSec: null, lastMonitorAt: null, error: null }
        : monitorStatus(),
      vendors: VENDORS,
      models: OLT_MODELS,
      license: licenseStatus(db.license, db.nodes.length),
    });
  })
);

// ---------------------------------------------------------------------------
// GenieACS
// ---------------------------------------------------------------------------
router.post(
  '/integrations/genieacs/test',
  requireAuth,
  blockDemo,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const cfg = genieConfig(db.settings, req.body || {});
    if (!cfg.url) throw httpError(400, 'URL GenieACS belum diisi.');
    try {
      const result = await genieacs.testConnection(cfg);
      res.json(result);
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  })
);

router.get(
  '/integrations/genieacs/devices',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (isDemoUser(req.user)) {
      return res.json({ devices: [], faults: [], online: 0, offline: 0, total: 0 });
    }
    const db = getDb();
    const cfg = genieConfig(db.settings);
    if (!cfg.url) throw httpError(400, 'URL GenieACS belum dikonfigurasi di Pengaturan.');
    try {
      const [devices, faults] = await Promise.all([
        genieacs.listDevices(cfg, { limit: 500 }),
        genieacs.listFaults(cfg, { limit: 100 }).catch(() => []),
      ]);
      db.cache.genieacs = {
        devices,
        faults,
        lastRunAt: new Date().toISOString(),
        error: null,
        online: devices.filter((d) => d.online).length,
        offline: devices.filter((d) => !d.online).length,
      };
      save();
      res.json({
        devices,
        faults,
        online: db.cache.genieacs.online,
        offline: db.cache.genieacs.offline,
        total: devices.length,
      });
    } catch (err) {
      db.cache.genieacs = { ...(db.cache.genieacs || {}), error: err.message, lastRunAt: new Date().toISOString() };
      save();
      res.status(502).json({ error: err.message, devices: [], faults: [] });
    }
  })
);

router.post(
  '/integrations/genieacs/refresh/:id',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const cfg = genieConfig(db.settings);
    await genieacs.refreshDevice(cfg, req.params.id, req.body.objectName || '');
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'genieacs.refresh',
      detail: `Mengirim refreshObject ke device ${req.params.id}.`,
    });
    save();
    res.json({ ok: true, message: 'Task refresh dikirim ke GenieACS.' });
  })
);

router.post(
  '/integrations/genieacs/reboot/:id',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const cfg = genieConfig(db.settings);
    await genieacs.rebootDevice(cfg, req.params.id);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'genieacs.reboot',
      detail: `Mengirim task reboot ke device ${req.params.id}.`,
    });
    save();
    res.json({ ok: true, message: 'Task reboot dikirim ke perangkat.' });
  })
);

router.post(
  '/integrations/genieacs/sync',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    const cfg = genieConfig(db.settings);
    const devices = await genieacs.listDevices(cfg, { limit: 500 });
    let linked = 0;
    let updated = 0;
    let created = 0;
    let skipped = 0;
    const license = licenseStatus(db.license, db.nodes.length);
    const capacity = Math.max(0, (license.maxNodes || 0) - db.nodes.length);
    const oltNode = db.nodes.find((n) => n.projectId === project.id && n.type === 'olt');
    const anchor = oltNode ? [oltNode.lat, oltNode.lng] : project.center;
    const nearest = nearestNode(
      db.nodes.filter((n) => n.projectId === project.id),
      anchor,
      ['odp', 'closure', 'odc']
    );
    for (const device of devices) {
      const node = db.nodes.find(
        (n) =>
          n.projectId === project.id &&
          n.genieacsSerial &&
          String(n.genieacsSerial).toUpperCase() === String(device.serial).toUpperCase()
      );
      if (node) {
        const next = device.online ? 'online' : 'offline';
        if (node.status !== next) {
          node.status = next;
          node.updatedAt = new Date().toISOString();
          updated += 1;
        }
        node.lastSeenAt = device.lastInform;
        linked += 1;
        continue;
      }
      if (!req.body.createMissing) {
        skipped += 1;
        continue;
      }
      if (created >= capacity) {
        skipped += 1;
        continue;
      }
      const pos = positionNear(anchor);
      const newNode = {
        id: uid('nd'),
        projectId: project.id,
        type: 'ont',
        name: `ONT ${device.serial}`,
        code: `ONT-${String(device.serial).slice(-6)}`,
        lat: pos[0],
        lng: pos[1],
        status: device.online ? 'online' : 'offline',
        parentId: nearest?.id || oltNode?.id || null,
        vendor: device.manufacturer || '',
        model: device.model || '',
        serial: device.serial,
        genieacsSerial: device.serial,
        capacity: 1,
        usedPorts: 1,
        address: '',
        notes: 'Dibuat otomatis dari sinkronisasi GenieACS.',
        properties: { ip: device.ip, ssid: device.ssid, rxPower: device.rxPower },
        oltId: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.nodes.push(newNode);
      created += 1;
    }
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'genieacs.sync',
      detail: `Sinkronisasi GenieACS: ${linked} linked, ${updated} update, ${created} ONT baru, ${skipped} dilewati.`,
    });
    save();
    emitEvent('nodes', { source: 'genieacs-sync' });
    res.json({
      ok: true,
      linked,
      updated,
      created,
      skipped,
      capacity,
      total: devices.length,
      message: `${linked} ONT tertaut, ${created} ONT baru dibuat${skipped ? `, ${skipped} dilewati (kuota/opsi)` : ''}.`,
    });
  })
);

router.post(
  '/integrations/genieacs/link',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const node = db.nodes.find((n) => n.id === req.body.nodeId);
    if (!node) throw httpError(404, 'Node tidak ditemukan.');
    if (!req.body.serial) throw httpError(400, 'Serial GenieACS wajib diisi.');
    node.genieacsSerial = cleanText(req.body.serial, 80);
    node.updatedAt = new Date().toISOString();
    save();
    emitEvent('node:changed', { node, action: 'update' });
    res.json({ node, message: 'Serial GenieACS ditautkan ke node.' });
  })
);

// GenieACS / external webhook (no JWT; optional shared token).
router.post(
  '/webhooks/genieacs',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const expected = db.settings.integrations.webhookToken;
    const provided = req.headers['x-webhook-token'] || req.query.token;
    const strict = process.env.WEBHOOK_STRICT === '1';
    if (strict && expected && provided !== expected) {
      throw httpError(401, 'Webhook token tidak valid.');
    }
    const body = req.body || {};
    const event = cleanText(body.event || body.type || 'event', 80);
    const device = body.device || {};
    const serial = cleanText(
      device.serial || device._serialNumber || body.serial || body.deviceId,
      80
    );
    const online = /online|inform|connection/.test(event) && !/offline|disconnect|lost/.test(event);
    if (serial) {
      const node = db.nodes.find(
        (n) => n.genieacsSerial && String(n.genieacsSerial).toUpperCase() === serial.toUpperCase()
      );
      if (node) {
        node.status = online ? 'online' : 'offline';
        node.updatedAt = new Date().toISOString();
      }
    }
    let alarm = null;
    if (!online && serial) {
      const resAlarm = createAlarm(db, {
        projectId: db.projects[0]?.id,
        severity: 'major',
        category: 'device',
        source: 'genieacs',
        dedupeKey: `genieacs:offline:${serial}`,
        title: `Webhook GenieACS: ${event}`,
        message: cleanText(body.message, 400) || `Perangkat ${serial} melaporkan event ${event}.`,
      });
      alarm = resAlarm.alarm;
      if (resAlarm.created) emitEvent('alarm', { alarm });
    } else if (serial) {
      resolveAlarmByKey(db, `genieacs:offline:${serial}`);
    }
    save();
    emitEvent('nodes', { source: 'webhook' });
    res.json({ ok: true, event, serial, alarm });
  })
);

// ---------------------------------------------------------------------------
// OLTs (HiOSO & multi-vendor)
// ---------------------------------------------------------------------------
router.get(
  '/olts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const allowedIds = new Set(visibleProjects(db, req.user).map((p) => p.id));
    let olts = db.olts.filter((o) => allowedIds.has(o.projectId));
    if (isDemoUser(req.user)) olts = olts.filter((o) => o.simulated === true);
    if (req.query.projectId) olts = olts.filter((o) => o.projectId === req.query.projectId);
    res.json({
      olts: olts.map(publicOlt),
      vendors: VENDORS,
      models: OLT_MODELS,
      cache: Object.fromEntries(
        Object.entries(db.cache.olts || {}).filter(([id]) => olts.some((o) => o.id === id))
      ),
    });
  })
);

function oltFromBody(db, body, project, existing = null) {
  const vendor = String(body.vendor || existing?.vendor || 'hioso');
  if (!VENDORS.includes(vendor)) throw httpError(400, 'Vendor OLT tidak didukung.');
  const name = cleanText(body.name ?? existing?.name, 120);
  const host = cleanText(body.host ?? existing?.host, 120);
  if (!name) throw httpError(400, 'Nama OLT wajib diisi.');
  if (!host) throw httpError(400, 'Host/IP OLT wajib diisi.');
  const protocol = String(body.protocol || existing?.protocol || 'http');
  if (!['http', 'snmp', 'rest', 'ssh', 'cli'].includes(protocol)) throw httpError(400, 'Protokol OLT tidak valid.');
  const defaultPort = protocol === 'snmp' ? 161 : protocol === 'ssh' || protocol === 'cli' ? 22 : protocol === 'http' ? 80 : 443;
  const snmp = body.snmp && typeof body.snmp === 'object' ? body.snmp : existing?.snmp || {};
  const pathDefaults =
    vendor === 'hioso'
      ? { loginPath: '', onuPath: '/onuAllPonOnuList.asp' }
      : { loginPath: '/login.cgi', onuPath: '/cgi-bin/onu_list.cgi' };
  const olt = {
    ...(existing || {}),
    projectId: project.id,
    siteNodeId: body.siteNodeId === undefined ? existing?.siteNodeId || null : body.siteNodeId || null,
    name,
    vendor,
    model: cleanText(body.model ?? existing?.model, 80),
    host,
    port: clampNumber(body.port ?? existing?.port, 1, 65535, defaultPort),
    protocol,
    tls: Boolean(body.tls ?? existing?.tls),
    username: cleanText(body.username ?? existing?.username, 100),
    simulated: body.simulated === undefined ? Boolean(existing?.simulated) : Boolean(body.simulated),
    enabled: body.enabled === undefined ? existing?.enabled !== false : Boolean(body.enabled),
    loginPath: cleanText(body.loginPath ?? existing?.loginPath, 200) || pathDefaults.loginPath,
    onuPath: cleanText(body.onuPath ?? existing?.onuPath, 200) || pathDefaults.onuPath,
    loginUserField: cleanText(body.loginUserField ?? existing?.loginUserField, 60) || 'username',
    loginPassField: cleanText(body.loginPassField ?? existing?.loginPassField, 60) || 'password',
    sshOnuCommand: cleanText(body.sshOnuCommand ?? existing?.sshOnuCommand, 200),
    sshTestCommand: cleanText(body.sshTestCommand ?? existing?.sshTestCommand, 200),
    snmp: {
      community: cleanText(snmp.community, 80) || 'public',
      port: clampNumber(snmp.port, 1, 65535, 161),
      onuStatusOid: cleanText(snmp.onuStatusOid, 200),
      onuNameOid: cleanText(snmp.onuNameOid, 200),
      onuMacOid: cleanText(snmp.onuMacOid, 200),
      onuRxOid: cleanText(snmp.onuRxOid, 200),
    },
  };
  if (body.password) olt.passwordEnc = seal(body.password);
  if (body.clearPassword) olt.passwordEnc = '';
  if (body.sshPrivateKey) olt.sshKeyEnc = seal(body.sshPrivateKey);
  if (body.sshKeyPassphrase) olt.sshPassEnc = seal(body.sshKeyPassphrase);
  if (body.clearSshKey) {
    olt.sshKeyEnc = '';
    olt.sshPassEnc = '';
  }
  return olt;
}

router.post(
  '/olts',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    const olt = oltFromBody(db, req.body, project);
    olt.id = uid('olt');
    olt.createdAt = new Date().toISOString();
    olt.lastPollAt = null;
    olt.lastResult = null;
    db.olts.push(olt);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'olt.create',
      detail: `Menambahkan OLT ${olt.vendor.toUpperCase()} ${olt.name}.`,
    });
    save();
    res.status(201).json({ olt: publicOlt(olt) });
  })
);

router.put(
  '/olts/:id',
  requireAuth,
  requireEntityProjectAccess('olt'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const olt = db.olts.find((o) => o.id === req.params.id);
    if (!olt) throw httpError(404, 'OLT tidak ditemukan.');
    const project = db.projects.find((p) => p.id === olt.projectId) || resolveProject(req, { required: true });
    Object.assign(olt, oltFromBody(db, req.body, project, olt));
    save();
    res.json({ olt: publicOlt(olt) });
  })
);

router.delete(
  '/olts/:id',
  requireAuth,
  requireEntityProjectAccess('olt'),
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    if (!db.olts.some((o) => o.id === req.params.id)) throw httpError(404, 'OLT tidak ditemukan.');
    db.olts = db.olts.filter((o) => o.id !== req.params.id);
    delete db.cache.olts[req.params.id];
    save();
    res.json({ ok: true });
  })
);

router.post(
  '/olts/test-connection',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const body = req.body || {};
    const existing = body.id ? db.olts.find((o) => o.id === body.id) : null;
    const host = cleanText(body.host ?? existing?.host, 120);
    if (!host) throw httpError(400, 'Host/IP OLT wajib diisi.');
    const protocol = String(body.protocol || existing?.protocol || 'http');
    if (!['http', 'snmp', 'rest', 'ssh', 'cli'].includes(protocol)) {
      throw httpError(400, 'Protokol OLT tidak valid.');
    }
    const defaultPort = protocol === 'snmp' ? 161 : protocol === 'ssh' || protocol === 'cli' ? 22 : protocol === 'http' ? 80 : 443;
    const config = oltConfig(existing || {}, {
      ...body,
      host,
      protocol,
      port: clampNumber(body.port ?? existing?.port, 1, 65535, defaultPort),
      simulated: body.simulated === undefined ? Boolean(existing?.simulated) : Boolean(body.simulated),
      vendor: body.vendor || existing?.vendor || 'generic',
      name: body.name || existing?.name || host,
    });
    const result = await hioso.testConnection(config);
    res.status(result.ok ? 200 : 502).json(result);
  })
);

router.post(
  '/olts/:id/exec',
  requireAuth,
  requireEntityProjectAccess('olt'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const olt = db.olts.find((o) => o.id === req.params.id);
    if (!olt) throw httpError(404, 'OLT tidak ditemukan.');
    if (!['ssh', 'cli'].includes(String(olt.protocol))) {
      throw httpError(400, 'Remote SSH hanya tersedia untuk OLT dengan protokol SSH.');
    }
    const command = cleanText(req.body?.command, 300);
    if (!command) throw httpError(400, 'Perintah SSH wajib diisi.');
    try {
      const result = await sshExec(oltConfig(olt), command);
      pushActivity(db, {
        userId: req.user.id,
        userName: req.user.name,
        projectId: olt.projectId,
        action: 'olt.exec',
        detail: `Remote SSH ${olt.name}: ${command}`,
      });
      save();
      res.json(result);
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  })
);

router.post(
  '/olts/:id/test',
  requireAuth,
  blockDemo,
  requireEntityProjectAccess('olt'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const olt = db.olts.find((o) => o.id === req.params.id);
    if (!olt) throw httpError(404, 'OLT tidak ditemukan.');
    const config = oltConfig(olt, req.body || {});
    const result = await hioso.testConnection(config);
    olt.lastPollAt = new Date().toISOString();
    olt.lastResult = result;
    save();
    res.status(result.ok ? 200 : 502).json(result);
  })
);

router.get(
  '/olts/:id/onus',
  requireAuth,
  requireEntityProjectAccess('olt'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const olt = db.olts.find((o) => o.id === req.params.id);
    if (!olt) throw httpError(404, 'OLT tidak ditemukan.');
    try {
      const result = await hioso.getOnus(oltConfig(olt));
      db.cache.olts[olt.id] = {
        ...result,
        onus: result.onus.slice(0, 500),
        at: new Date().toISOString(),
        error: null,
      };
      olt.lastPollAt = new Date().toISOString();
      olt.lastResult = { ok: true, message: result.message, ...result.summary };
      save();
      res.json({
        ...result,
        onus: result.onus.map((onu) => {
          const node = db.nodes.find(
            (n) =>
              n.type === 'ont' &&
              n.projectId === olt.projectId &&
              [n.serial, n.genieacsSerial]
                .filter(Boolean)
                .some(
                  (serial) =>
                    String(serial).replace(/[^a-z0-9]/gi, '').toUpperCase() ===
                    String(onu.serial || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
                )
          );
          return { ...onu, linkedNodeId: node?.id || null };
        }),
      });
    } catch (err) {
      olt.lastResult = { ok: false, message: err.message };
      olt.lastPollAt = new Date().toISOString();
      db.cache.olts[olt.id] = { ...(db.cache.olts[olt.id] || {}), error: err.message, at: new Date().toISOString() };
      save();
      res.status(502).json({ ok: false, message: err.message, onus: [] });
    }
  })
);

router.post(
  '/olts/:id/sync',
  requireAuth,
  requireEntityProjectAccess('olt'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const olt = db.olts.find((o) => o.id === req.params.id);
    if (!olt) throw httpError(404, 'OLT tidak ditemukan.');
    const result = await hioso.getOnus(oltConfig(olt));
    const project = db.projects.find((p) => p.id === olt.projectId);
    const site = olt.siteNodeId ? db.nodes.find((n) => n.id === olt.siteNodeId) : null;
    const anchor = site ? [site.lat, site.lng] : project?.center || [-8.1689, 113.702];
    const parent = nearestNode(
      db.nodes.filter((n) => n.projectId === olt.projectId),
      anchor,
      ['odp', 'closure', 'odc']
    );
    let created = 0;
    let linked = 0;
    const license = licenseStatus(db.license, db.nodes.length);
    const capacity = Math.max(0, (license.maxNodes || 0) - db.nodes.length);
    for (const onu of result.onus) {
      const existing = db.nodes.find(
        (n) =>
          n.type === 'ont' &&
          n.projectId === olt.projectId &&
          [n.serial, n.genieacsSerial]
            .filter(Boolean)
            .some(
              (serial) =>
                String(serial).replace(/[^a-z0-9]/gi, '').toUpperCase() ===
                String(onu.serial || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
            )
      );
      if (existing) {
        existing.status = onu.status === 'offline' ? 'offline' : onu.status === 'warning' ? 'warning' : 'online';
        existing.rxPower = onu.rxPower;
        existing.oltId = olt.id;
        existing.updatedAt = new Date().toISOString();
        linked += 1;
        continue;
      }
      if (!req.body.createMissing || created >= capacity) continue;
      const pos = positionNear(anchor, 0.01);
      db.nodes.push({
        id: uid('nd'),
        projectId: olt.projectId,
        type: 'ont',
        name: onu.customer || onu.name || `ONU ${onu.onuId}`,
        code: `ONU-${onu.onuId}`,
        lat: pos[0],
        lng: pos[1],
        status: onu.status === 'offline' ? 'offline' : onu.status === 'warning' ? 'warning' : 'online',
        parentId: parent?.id || olt.siteNodeId || null,
        vendor: olt.vendor,
        model: '',
        serial: onu.serial,
        genieacsSerial: onu.serial,
        capacity: 1,
        usedPorts: 1,
        address: '',
        notes: `Sinkronisasi dari OLT ${olt.name}.`,
        properties: { onuId: onu.onuId, rxPower: onu.rxPower, distanceM: onu.distanceM },
        oltId: olt.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      created += 1;
    }
    db.cache.olts[olt.id] = {
      ...result,
      onus: result.onus.slice(0, 500),
      at: new Date().toISOString(),
      error: null,
    };
    olt.lastResult = { ok: true, message: result.message, ...result.summary };
    olt.lastPollAt = new Date().toISOString();
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: olt.projectId,
      action: 'olt.sync',
      detail: `Sync OLT ${olt.name}: ${linked} ONU tertaut, ${created} ONT baru.`,
    });
    save();
    emitEvent('nodes', { source: 'olt-sync' });
    res.json({
      ok: true,
      linked,
      created,
      total: result.onus.length,
      message: `${linked} ONU tertaut, ${created} ONT baru dibuat.`,
      summary: result.summary,
    });
  })
);

// ---------------------------------------------------------------------------
// MikroTik routers
// ---------------------------------------------------------------------------
function splitHost(raw) {
  let value = String(raw || '').trim();
  let port = null;
  if (!value) return { host: '', port: null };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      value = parsed.hostname;
      if (parsed.port) port = Number(parsed.port);
    } catch {
      value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    }
  }
  value = value.replace(/\/.*$/, '');
  const match = value.match(/^(.+):(\d+)$/);
  if (match && !value.startsWith('[')) {
    value = match[1];
    port = Number(match[2]);
  }
  return { host: value.trim(), port };
}

function routerFromBody(db, body, project, existing = null) {
  const name = cleanText(body.name ?? existing?.name, 120);
  const parsedHost = splitHost(body.host ?? existing?.host);
  const host = cleanText(parsedHost.host, 120);
  if (!name) throw httpError(400, 'Nama router wajib diisi.');
  if (!host) throw httpError(400, 'Host/IP router wajib diisi.');
  const useTls = body.tls === undefined ? existing?.tls !== false : Boolean(body.tls);
  const requestedPort = body.port ?? parsedHost.port ?? existing?.port;
  const router = {
    ...(existing || {}),
    projectId: project.id,
    siteNodeId: body.siteNodeId === undefined ? existing?.siteNodeId || null : body.siteNodeId || null,
    name,
    host,
    port: clampNumber(requestedPort, 1, 65535, useTls ? 443 : 80),
    tls: useTls,
    transport: ['auto', 'rest', 'api'].includes(body.transport)
      ? body.transport
      : ['auto', 'rest', 'api'].includes(existing?.transport)
        ? existing.transport
        : 'auto',
    username: cleanText(body.username ?? existing?.username, 100),
    passwordEnv: cleanText(body.passwordEnv ?? existing?.passwordEnv, 100),
    description: cleanText(body.description ?? existing?.description, 200),
    // Mode simulasi sudah dihapus: semua router memakai koneksi nyata.
    simulated: false,
    enabled: body.enabled === undefined ? existing?.enabled !== false : Boolean(body.enabled),
    monitoredInterfaces: Array.isArray(body.monitoredInterfaces)
      ? body.monitoredInterfaces.map((v) => cleanText(v, 60)).filter(Boolean).slice(0, 30)
      : existing?.monitoredInterfaces || [],
  };
  if (body.password) router.passwordEnc = seal(body.password);
  if (body.clearPassword) router.passwordEnc = '';
  return router;
}

router.get(
  '/routers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const allowedIds = new Set(visibleProjects(db, req.user).map((p) => p.id));
    let routers = isDemoUser(req.user)
      ? []
      : db.routers.filter((r) => allowedIds.has(r.projectId));
    if (req.query.projectId) routers = routers.filter((r) => r.projectId === req.query.projectId);
    res.json({
      routers: routers.map(publicRouter),
      cache: Object.fromEntries(
        Object.entries(db.cache.routers || {}).filter(([id]) => routers.some((r) => r.id === id))
      ),
    });
  })
);

router.post(
  '/routers',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const project = resolveProject(req, { required: true });
    const router = routerFromBody(db, req.body, project);
    router.id = uid('rtr');
    router.createdAt = new Date().toISOString();
    router.lastPollAt = null;
    router.lastResult = null;
    db.routers.push(router);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: project.id,
      action: 'router.create',
      detail: `Menambahkan router MikroTik ${router.name}.`,
    });
    save();
    res.status(201).json({ router: publicRouter(router) });
  })
);

router.put(
  '/routers/:id',
  requireAuth,
  requireEntityProjectAccess('router'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const router = db.routers.find((r) => r.id === req.params.id);
    if (!router) throw httpError(404, 'Router tidak ditemukan.');
    const project = db.projects.find((p) => p.id === router.projectId) || resolveProject(req, { required: true });
    Object.assign(router, routerFromBody(db, req.body, project, router));
    save();
    res.json({ router: publicRouter(router) });
  })
);

router.delete(
  '/routers/:id',
  requireAuth,
  requireEntityProjectAccess('router'),
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    if (!db.routers.some((r) => r.id === req.params.id)) throw httpError(404, 'Router tidak ditemukan.');
    db.routers = db.routers.filter((r) => r.id !== req.params.id);
    delete db.cache.routers[req.params.id];
    save();
    res.json({ ok: true });
  })
);

router.post(
  '/routers/test-connection',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const body = req.body || {};
    const existing = body.id ? db.routers.find((r) => r.id === body.id) : null;
    const parsedHost = splitHost(body.host ?? existing?.host);
    const host = cleanText(parsedHost.host, 120);
    if (!host) throw httpError(400, 'Host/IP router wajib diisi.');
    const tls = body.tls === undefined ? existing?.tls !== false : Boolean(body.tls);
    const config = routerConfig(existing || {}, {
      ...body,
      host,
      port: clampNumber(body.port ?? parsedHost.port ?? existing?.port, 1, 65535, tls ? 443 : 80),
      tls,
      transport: ['auto', 'rest', 'api'].includes(body.transport)
        ? body.transport
        : existing?.transport || 'auto',
      timeout: 15000,
    });
    try {
      const result = await mikrotik.testConnection(config);
      res.json(result);
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  })
);

router.post(
  '/routers/:id/test',
  requireAuth,
  blockDemo,
  requireEntityProjectAccess('router'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const router = db.routers.find((r) => r.id === req.params.id);
    if (!router) throw httpError(404, 'Router tidak ditemukan.');
    const config = routerConfig(router, req.body || {});
    try {
      const result = await mikrotik.testConnection(config);
      router.lastPollAt = new Date().toISOString();
      router.lastResult = {
        ok: true,
        message: result.message,
        ...result.summary,
        cpu: result.resource.cpuLoad,
        uptime: result.resource.uptime,
        transport: result.transport,
        latencyMs: result.latencyMs,
      };
      db.cache.routers[router.id] = { ...result, at: new Date().toISOString(), error: null };
      save();
      res.json(result);
    } catch (err) {
      router.lastPollAt = new Date().toISOString();
      router.lastResult = { ok: false, message: err.message, transport: config.transport || 'auto' };
      db.cache.routers[router.id] = {
        ...(db.cache.routers[router.id] || {}),
        at: new Date().toISOString(),
        error: err.message,
      };
      save();
      res.status(502).json({ ok: false, message: err.message });
    }
  })
);

router.get(
  '/routers/:id/interfaces',
  requireAuth,
  requireEntityProjectAccess('router'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const router = db.routers.find((r) => r.id === req.params.id);
    if (!router) throw httpError(404, 'Router tidak ditemukan.');
    try {
      const result = await mikrotik.getOverview(routerConfig(router));
      db.cache.routers[router.id] = { ...result, at: new Date().toISOString(), error: null };
      router.lastPollAt = new Date().toISOString();
      router.lastResult = {
        ok: true,
        message: `CPU ${result.resource.cpuLoad}% • ${result.summary.interfaceUp}/${result.summary.interfaceTotal} interface up`,
        ...result.summary,
        cpu: result.resource.cpuLoad,
        uptime: result.resource.uptime,
        transport: result.transport,
      };
      save();
      res.json(result);
    } catch (err) {
      db.cache.routers[router.id] = { ...(db.cache.routers[router.id] || {}), error: err.message, at: new Date().toISOString() };
      router.lastResult = { ok: false, message: err.message };
      save();
      res.status(502).json({ ok: false, message: err.message, interfaces: [] });
    }
  })
);

router.post(
  '/routers/:id/sync',
  requireAuth,
  requireEntityProjectAccess('router'),
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const router = db.routers.find((r) => r.id === req.params.id);
    if (!router) throw httpError(404, 'Router tidak ditemukan.');
    const result = await mikrotik.getOverview(routerConfig(router));
    db.cache.routers[router.id] = { ...result, at: new Date().toISOString(), error: null };
    router.lastPollAt = new Date().toISOString();
    router.lastResult = {
      ok: true,
      message: `Sync OK • ${result.summary.interfaceUp}/${result.summary.interfaceTotal} interface up`,
      ...result.summary,
      cpu: result.resource.cpuLoad,
      uptime: result.resource.uptime,
      transport: result.transport,
    };
    const node = router.siteNodeId ? db.nodes.find((n) => n.id === router.siteNodeId) : null;
    if (node && node.status !== 'fault') {
      node.status = result.downInterfaces.length ? 'warning' : 'online';
      node.properties = {
        ...node.properties,
        cpu: result.resource.cpuLoad,
        uptime: result.resource.uptime,
        routerOs: result.resource.version,
        pppActive: result.summary.pppActive,
      };
      node.updatedAt = new Date().toISOString();
    }
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: router.projectId,
      action: 'router.sync',
      detail: `Sinkronisasi RouterOS ${router.name} via ${result.transport === 'api' ? 'API native' : 'REST API'}.`,
    });
    save();
    emitEvent('router:changed', { router, result });
    res.json({ ok: true, ...result, message: 'Data router berhasil disinkronkan.' });
  })
);

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------
router.get(
  '/monitor/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (isDemoUser(req.user)) {
      return res.json({ enabled: false, intervalSec: null, lastMonitorAt: null, error: null });
    }
    res.json(monitorStatus());
  })
);

router.post(
  '/monitor/run',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const result = await runMonitor('manual', { force: true });
    res.json(result);
  })
);

export { VENDORS, OLT_MODELS };
export default router;
