import { getDb, save } from './lib/store.js';
import { unseal } from './lib/secret.js';
import { routerConfig } from './lib/router-config.js';
import { oltConfig } from './lib/olt-config.js';
import { emitEvent } from './lib/events.js';
import { createAlarm, resolveAlarmByKey, createFault, repairFault } from './lib/faults.js';
import * as genieacs from './adapters/genieacs.js';
import * as hioso from './adapters/hioso.js';
import * as mikrotik from './adapters/mikrotik.js';

let timer = null;
let startupTimer = null;
let running = false;
let lastRun = null;

function nowIso() {
  return new Date().toISOString();
}

function genieConfig(settings) {
  const g = settings.integrations?.genieacs || {};
  return {
    ...g,
    url: g.url,
    username: g.username || '',
    password: unseal(g.passwordEnc),
    offlineAfterSec: Number(g.offlineAfterSec || settings.monitor?.offlineAfterSec || 600),
  };
}

function raise(db, data, created) {
  const res = createAlarm(db, data);
  if (res.created) created.push(res.alarm);
  return res.alarm;
}

/** Group offline ONT nodes by direct parent (ODP/closure) and create an auto cable fault. */
function correlateCableFaults(db, projectIds, createdFaults, settings) {
  if (!settings.monitor?.autoCableFault) return;
  for (const projectId of projectIds) {
    const projectNodes = db.nodes.filter((n) => n.projectId === projectId);
    const offlineOnts = projectNodes.filter((n) => n.type === 'ont' && n.status === 'offline');
    const groups = new Map();
    for (const ont of offlineOnts) {
      if (!ont.parentId) continue;
      if (!groups.has(ont.parentId)) groups.set(ont.parentId, []);
      groups.get(ont.parentId).push(ont);
    }
    for (const [parentId, onts] of groups) {
      if (onts.length < 2) continue;
      const dedupeKey = `auto:${parentId}`;
      const existingFault = db.faults.find(
        (f) => f.dedupeKey === dedupeKey && f.status === 'active'
      );
      if (existingFault) continue;
      const parent = projectNodes.find((n) => n.id === parentId);
      const cable = db.cables.find(
        (c) => c.projectId === projectId && c.toNodeId === parentId && c.status !== 'fault'
      );
      if (!cable) continue;
      const result = createFault(db, {
        cable,
        ratio: 0.55,
        source: 'genieacs',
        severity: 'critical',
        dedupeKey,
        title: `Dugaan kabel putus menuju ${parent?.name || cable.name}`,
        description: `${onts.length} ONT di ${parent?.name || 'ODP'} offline bersamaan. Sistem mengkorelasikan gangguan pada ${cable.name}.`,
      });
      createdFaults.push(result.fault);
      emitEvent('fault', {
        fault: result.fault,
        cable: result.cable,
        alarm: result.alarm,
        affected: result.affected,
      });
      emitEvent('alarm', { alarm: result.alarm });
    }
  }
}

/** Resolve auto faults whose parent no longer has >=2 offline ONTs. */
function resolveRecoveredFaults(db, settings) {
  if (!settings.monitor?.autoCableFault) return;
  const now = nowIso();
  for (const fault of db.faults) {
    if (fault.status !== 'active' || !fault.dedupeKey?.startsWith('auto:')) continue;
    const parentId = fault.dedupeKey.slice(5);
    const offline = db.nodes.filter(
      (n) => n.parentId === parentId && n.type === 'ont' && n.status === 'offline'
    );
    if (offline.length < 2) {
      fault.autoResolvedAt = now;
      repairFault(db, fault, { silent: false });
    }
  }
}

async function pollGenieacs(db, settings, result, created) {
  const cfg = genieConfig(settings);
  if (!cfg.enabled) {
    result.genieacs = { skipped: true, reason: 'disabled' };
    return;
  }
  try {
    const devices = await genieacs.listDevices(cfg, { limit: 300 });
    const faults = await genieacs.listFaults(cfg, { limit: 50 }).catch(() => []);
    const at = nowIso();
    db.cache.genieacs = {
      devices,
      faults,
      lastRunAt: at,
      error: null,
      online: devices.filter((d) => d.online).length,
      offline: devices.filter((d) => !d.online).length,
    };
    const projectIds = new Set();
    let changed = 0;
    for (const node of db.nodes) {
      if (node.type !== 'ont' || !node.genieacsSerial) continue;
      const dev = devices.find(
        (d) => String(d.serial).toUpperCase() === String(node.genieacsSerial).toUpperCase()
      );
      if (!dev) continue;
      projectIds.add(node.projectId);
      const next = dev.online ? 'online' : 'offline';
      if (node.status !== next) {
        node.status = next;
        node.updatedAt = at;
        changed += 1;
      }
      node.lastSeenAt = dev.lastInform || node.lastSeenAt;
      node.rxPower = dev.rxPower ?? node.rxPower;
      const key = `genieacs:offline:${dev.serial}`;
      if (!dev.online) {
        raise(
          db,
          {
            projectId: node.projectId,
            severity: 'major',
            category: 'device',
            nodeId: node.id,
            source: 'genieacs',
            dedupeKey: key,
            title: `ONT offline: ${node.name}`,
            message: `GenieACS tidak menerima inform dari ${dev.serial} sejak ${dev.lastInform || 'tidak diketahui'}.`,
          },
          created
        );
      } else {
        resolveAlarmByKey(db, key);
      }
    }
    correlateCableFaults(db, projectIds, result.createdFaults, settings);
    resolveRecoveredFaults(db, settings);
    resolveAlarmByKey(db, 'genieacs:down');
    result.genieacs = {
      total: devices.length,
      online: db.cache.genieacs.online,
      offline: db.cache.genieacs.offline,
      changed,
      faults: faults.length,
    };
    if (changed) emitEvent('nodes', { source: 'genieacs' });
  } catch (err) {
    db.cache.genieacs = { ...(db.cache.genieacs || {}), lastRunAt: nowIso(), error: err.message };
    raise(
      db,
      {
        projectId: null,
        severity: 'major',
        category: 'system',
        source: 'genieacs',
        dedupeKey: 'genieacs:down',
        title: 'GenieACS tidak dapat dihubungi',
        message: err.message,
      },
      created
    );
    result.genieacs = { error: err.message };
    result.errors.push(`GenieACS: ${err.message}`);
  }
}

function findOntNode(db, olt, onu) {
  const serial = String(onu.serial || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return db.nodes.find((n) => {
    if (n.type !== 'ont') return false;
    if (n.oltId && n.oltId !== olt.id) return false;
    const values = [n.serial, n.genieacsSerial, n.code]
      .filter(Boolean)
      .map((v) => String(v).replace(/[^a-z0-9]/gi, '').toUpperCase());
    if (!serial) return false;
    if (values.includes(serial)) return true;
    return values.some((v) => v && (v.endsWith(serial) || serial.endsWith(v)));
  });
}

async function pollOlts(db, settings, result, created) {
  const olts = db.olts.filter((o) => o.enabled);
  for (const olt of olts) {
    const config = oltConfig(olt);
    try {
      const poll = await hioso.getOnus(config);
      const at = nowIso();
      db.cache.olts[olt.id] = {
        ...poll,
        at,
        onus: poll.onus.slice(0, 500),
        error: null,
      };
      olt.lastPollAt = at;
      olt.lastResult = {
        ok: true,
        message: poll.message,
        ...poll.summary,
        simulated: Boolean(poll.simulated),
        source: poll.source,
      };
      let changed = 0;
      for (const onu of poll.onus) {
        const node = findOntNode(db, olt, onu);
        if (!node) continue;
        const next = onu.status === 'offline' ? 'offline' : onu.status === 'warning' ? 'warning' : 'online';
        if (node.status !== next) {
          node.status = next;
          node.updatedAt = at;
          changed += 1;
        }
        node.lastSeenAt = onu.lastSeen;
        if (onu.rxPower !== null && onu.rxPower !== undefined) node.rxPower = onu.rxPower;
      }
      const site = olt.siteNodeId ? db.nodes.find((n) => n.id === olt.siteNodeId) : null;
      if (site && site.status !== 'fault') site.status = 'online';
      resolveAlarmByKey(db, `olt:down:${olt.id}`);
      const key = `olt:onuoffline:${olt.id}`;
      if (poll.summary.offline > 0) {
        raise(
          db,
          {
            projectId: olt.projectId,
            severity: 'warning',
            category: 'device',
            nodeId: olt.siteNodeId,
            source: olt.vendor,
            dedupeKey: key,
            title: `${poll.summary.offline} ONU offline di ${olt.name}`,
            message: `Terdeteksi ${poll.summary.offline} ONU offline dari ${poll.summary.total} ONU.`,
          },
          created
        );
      } else {
        resolveAlarmByKey(db, key);
      }
      if (changed) emitEvent('nodes', { source: olt.vendor });
      result.olts.push({ id: olt.id, ok: true, ...poll.summary });
    } catch (err) {
      db.cache.olts[olt.id] = {
        ...(db.cache.olts[olt.id] || {}),
        at: nowIso(),
        error: err.message,
      };
      olt.lastPollAt = nowIso();
      olt.lastResult = { ok: false, message: err.message };
      raise(
        db,
        {
          projectId: olt.projectId,
          severity: 'major',
          category: 'device',
          nodeId: olt.siteNodeId,
          source: olt.vendor,
          dedupeKey: `olt:down:${olt.id}`,
          title: `OLT tidak merespons: ${olt.name}`,
          message: err.message,
        },
        created
      );
      const site = olt.siteNodeId ? db.nodes.find((n) => n.id === olt.siteNodeId) : null;
      if (site && olt.enabled) {
        site.status = 'offline';
        site.updatedAt = nowIso();
      }
      result.olts.push({ id: olt.id, ok: false, error: err.message });
      result.errors.push(`OLT ${olt.name}: ${err.message}`);
    }
  }
}

async function pollRouters(db, settings, result, created) {
  for (const router of db.routers.filter((r) => r.enabled)) {
    try {
      const poll = await mikrotik.getOverview(routerConfig(router));
      const at = nowIso();
      db.cache.routers[router.id] = { ...poll, at, error: null };
      router.lastPollAt = at;
      router.lastResult = {
        ok: true,
        message: `${poll.transport === 'api' ? 'API native' : 'REST API'} OK • CPU ${poll.resource.cpuLoad}% • ${poll.summary.interfaceUp}/${poll.summary.interfaceTotal} interface up`,
        ...poll.summary,
        cpu: poll.resource.cpuLoad,
        uptime: poll.resource.uptime,
        transport: poll.transport,
      };
      resolveAlarmByKey(db, `router:down:${router.id}`);
      const downKey = `router:ifdown:${router.id}`;
      const site = router.siteNodeId ? db.nodes.find((n) => n.id === router.siteNodeId) : null;
      if (poll.downInterfaces.length) {
        raise(
          db,
          {
            projectId: router.projectId,
            severity: 'warning',
            category: 'device',
            nodeId: router.siteNodeId,
            source: 'mikrotik',
            dedupeKey: downKey,
            title: `Interface down di ${router.name}`,
            message: `Interface bermasalah: ${poll.downInterfaces.join(', ')}.`,
          },
          created
        );
        if (site && site.status !== 'fault') site.status = 'warning';
      } else {
        resolveAlarmByKey(db, downKey);
        if (site && site.status !== 'fault') site.status = 'online';
      }
      result.routers.push({ id: router.id, ok: true, down: poll.downInterfaces.length });
    } catch (err) {
      db.cache.routers[router.id] = {
        ...(db.cache.routers[router.id] || {}),
        at: nowIso(),
        error: err.message,
      };
      router.lastPollAt = nowIso();
      router.lastResult = { ok: false, message: err.message };
      raise(
        db,
        {
          projectId: router.projectId,
          severity: 'critical',
          category: 'device',
          nodeId: router.siteNodeId,
          source: 'mikrotik',
          dedupeKey: `router:down:${router.id}`,
          title: `Router tidak dapat dihubungi: ${router.name}`,
          message: err.message,
        },
        created
      );
      const site = router.siteNodeId ? db.nodes.find((n) => n.id === router.siteNodeId) : null;
      if (site) {
        site.status = 'offline';
        site.updatedAt = nowIso();
      }
      result.routers.push({ id: router.id, ok: false, error: err.message });
      result.errors.push(`Router ${router.name}: ${err.message}`);
    }
  }
}

export async function runMonitor(reason = 'manual', { force = false } = {}) {
  const db = getDb();
  const settings = db.settings;
  if (!force && !settings.monitor?.enabled) {
    return { skipped: true, reason: 'Monitoring dinonaktifkan.', at: nowIso() };
  }
  if (running) return { skipped: true, reason: 'Monitoring sedang berjalan.', at: nowIso() };
  running = true;
  const started = Date.now();
  const result = {
    at: nowIso(),
    reason,
    genieacs: null,
    olts: [],
    routers: [],
    createdFaults: [],
    errors: [],
  };
  const created = [];
  try {
    await pollGenieacs(db, settings, result, created);
    await pollOlts(db, settings, result, created);
    await pollRouters(db, settings, result, created);
    db.cache.lastMonitorAt = result.at;
    db.cache.monitorError = result.errors.length ? result.errors.join(' | ') : null;
    result.durationMs = Date.now() - started;
    result.alarmsCreated = created.length;
    result.summary = {
      genieacs: result.genieacs,
      olts: result.olts.length,
      routers: result.routers.length,
      errors: result.errors.length,
    };
    lastRun = result;
    save();
    for (const alarm of created) emitEvent('alarm', { alarm });
    emitEvent('monitor', result);
    return result;
  } catch (err) {
    db.cache.monitorError = err.message;
    result.errors.push(err.message);
    result.durationMs = Date.now() - started;
    lastRun = result;
    save();
    return result;
  } finally {
    running = false;
  }
}

export function monitorStatus() {
  const db = getDb();
  return {
    running,
    lastRun,
    lastMonitorAt: db.cache.lastMonitorAt || null,
    error: db.cache.monitorError || null,
    intervalSec: db.settings.monitor?.intervalSec || 180,
    enabled: Boolean(db.settings.monitor?.enabled),
  };
}

export function scheduleMonitor() {
  if (timer) clearInterval(timer);
  if (startupTimer) clearTimeout(startupTimer);
  timer = null;
  const db = getDb();
  if (!db.settings.monitor?.enabled) return;
  const sec = Math.max(30, Number(db.settings.monitor.intervalSec) || 180);
  timer = setInterval(() => {
    runMonitor('interval').catch((err) => console.error('[monitor]', err.message));
  }, sec * 1000);
  timer.unref?.();
  startupTimer = setTimeout(() => {
    runMonitor('startup').catch((err) => console.error('[monitor]', err.message));
  }, 12000);
  startupTimer.unref?.();
}

export function stopMonitor() {
  if (timer) clearInterval(timer);
  if (startupTimer) clearTimeout(startupTimer);
  timer = null;
  startupTimer = null;
}
