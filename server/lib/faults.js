import { pointAtDistance, pathLength, formatDistance, formatCoord } from './geo.js';
import { emitEvent } from './events.js';
import { randomToken } from './secret.js';

export function uid(prefix = 'id') {
  return `${prefix}_${randomToken(9).replace(/[-_]/g, '').slice(0, 14)}`;
}

export function pushActivity(db, { userId, userName, projectId, action, detail }) {
  db.activity.unshift({
    id: uid('act'),
    userId: userId || null,
    userName: userName || 'Sistem',
    projectId: projectId || null,
    action,
    detail,
    at: new Date().toISOString(),
  });
  db.activity = db.activity.slice(0, 500);
}

export function createAlarm(db, data) {
  const now = new Date().toISOString();
  if (data.dedupeKey) {
    const existing = db.alarms.find(
      (a) => a.dedupeKey === data.dedupeKey && !a.resolved
    );
    if (existing) {
      existing.lastSeenAt = now;
      existing.count = (existing.count || 1) + 1;
      return { alarm: existing, created: false };
    }
  }
  const alarm = {
    id: uid('alm'),
    projectId: data.projectId || null,
    severity: data.severity || 'warning',
    category: data.category || 'system',
    title: data.title || 'Peringatan jaringan',
    message: data.message || '',
    nodeId: data.nodeId || null,
    cableId: data.cableId || null,
    faultId: data.faultId || null,
    source: data.source || 'system',
    dedupeKey: data.dedupeKey || null,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolved: false,
    createdAt: now,
    lastSeenAt: now,
    count: 1,
  };
  db.alarms.unshift(alarm);
  db.alarms = db.alarms.slice(0, 1000);
  return { alarm, created: true };
}

export function resolveAlarmByKey(db, dedupeKey) {
  const now = new Date().toISOString();
  const changed = [];
  for (const alarm of db.alarms) {
    if (alarm.dedupeKey === dedupeKey && !alarm.resolved) {
      alarm.resolved = true;
      alarm.resolvedAt = now;
      changed.push(alarm);
    }
  }
  return changed;
}

export function resolveAlarmsByFault(db, faultId) {
  const now = new Date().toISOString();
  for (const alarm of db.alarms) {
    if (alarm.faultId === faultId && !alarm.resolved) {
      alarm.resolved = true;
      alarm.resolvedAt = now;
    }
  }
}

/**
 * BFS downstream from a node using cable direction (from -> to).
 * Used to list affected ONTs when a cable is cut.
 */
export function downstreamNodes(db, projectId, startNodeId) {
  if (!startNodeId) return [];
  const nodes = db.nodes.filter((n) => n.projectId === projectId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map();
  for (const cable of db.cables.filter((c) => c.projectId === projectId)) {
    if (!cable.fromNodeId || !cable.toNodeId) continue;
    if (!adjacency.has(cable.fromNodeId)) adjacency.set(cable.fromNodeId, []);
    adjacency.get(cable.fromNodeId).push(cable);
  }
  const seen = new Set([startNodeId]);
  const queue = [startNodeId];
  const result = [];
  while (queue.length && result.length < 2000) {
    const current = queue.shift();
    for (const cable of adjacency.get(current) || []) {
      const next = cable.toNodeId;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      if (byId.has(next)) {
        result.push(byId.get(next));
        queue.push(next);
      }
    }
  }
  return result;
}

export function nearestNode(nodes, point, types = null) {
  let best = null;
  for (const node of nodes) {
    if (types && !types.includes(node.type)) continue;
    const d = Math.hypot(node.lat - point[0], node.lng - point[1]);
    if (!best || d < best.distance) best = { node, distance: d };
  }
  return best?.node || null;
}

/**
 * Create a fiber cut fault: interpolate the fault point, list downstream
 * customers, flag the cable, raise a critical alarm and broadcast realtime
 * events (map animation + siren are triggered client-side).
 */
export function createFault(db, {
  cable,
  distanceM,
  ratio,
  source = 'manual',
  severity = 'critical',
  title,
  description,
  node = null,
  dedupeKey = null,
  user = null,
  silent = false,
}) {
  const now = new Date().toISOString();
  let point = null;
  let totalM = cable ? cable.lengthM || pathLength(cable.path) : 0;
  let along = 0;
  if (cable) {
    if (Array.isArray(cable.path) && cable.path.length) {
      const target = Number.isFinite(Number(distanceM))
        ? Number(distanceM)
        : Math.max(0, Math.min(1, Number(ratio) || 0.5)) * totalM;
      const at = pointAtDistance(cable.path, target);
      if (at) {
        point = at.point;
        along = at.distanceM;
        totalM = at.totalM || totalM;
      }
    } else {
      const from = db.nodes.find((n) => n.id === cable.fromNodeId);
      const to = db.nodes.find((n) => n.id === cable.toNodeId);
      if (from && to) point = [(from.lat + to.lat) / 2, (from.lng + to.lng) / 2];
    }
  } else if (node) {
    point = [node.lat, node.lng];
  }
  if (!point) throw new Error('Tidak dapat menentukan titik gangguan.');

  const affected = cable
    ? downstreamNodes(db, cable.projectId, cable.toNodeId).filter((n) => n.type === 'ont' || n.type === 'odp')
    : [];
  const affectedIds = affected.map((n) => n.id);
  const projectId = cable?.projectId || node?.projectId || null;

  const fault = {
    id: uid('flt'),
    projectId,
    cableId: cable?.id || null,
    nodeId: node?.id || null,
    type: cable ? 'cut' : 'device',
    source,
    severity,
    status: 'active',
    distanceM: Math.round(along),
    totalM: Math.round(totalM),
    ratio: totalM ? along / totalM : 0,
    point,
    title:
      title ||
      (cable
        ? `Kabel ${cable.name} terdeteksi putus`
        : `Gangguan perangkat ${node?.name || ''}`),
    description:
      description ||
      (cable
        ? `Terdeteksi gangguan pada ${formatDistance(along)} dari sisi A (${formatCoord(point)}).`
        : `Perangkat ${node?.name || ''} tidak merespons.`),
    affectedNodeIds: affectedIds,
    dedupeKey,
    detectedAt: now,
    resolvedAt: null,
  };

  db.faults.unshift(fault);
  if (cable) {
    cable.status = 'fault';
    cable.faultId = fault.id;
    cable.updatedAt = now;
  }
  if (node) {
    node.status = node.type === 'ont' ? 'offline' : 'critical';
    node.updatedAt = now;
  }

  const { alarm, created } = createAlarm(db, {
    projectId,
    severity,
    category: cable ? 'fault' : 'device',
    title: fault.title,
    message: `${fault.description}${affected.length ? ` • ${affected.length} node terdampak.` : ''}`,
    nodeId: node?.id || null,
    cableId: cable?.id || null,
    faultId: fault.id,
    source,
    dedupeKey: dedupeKey ? `fault:${dedupeKey}` : null,
  });

  pushActivity(db, {
    userId: user?.id,
    userName: user?.name,
    projectId,
    action: cable ? 'fault.cut' : 'fault.device',
    detail: fault.title,
  });

  if (!silent) {
    emitEvent('fault', { fault, cable, alarm, affected, actorId: user?.id || null });
    if (created) emitEvent('alarm', { alarm });
    emitEvent('nodes', { affectedNodeIds: [node?.id, ...affectedIds].filter(Boolean) });
  }
  return { fault, alarm, affected };
}

/** Repair a fault and restore attached cable/node status. */
export function repairFault(db, fault, { user = null, silent = false } = {}) {
  if (!fault || fault.status === 'resolved') return fault;
  const now = new Date().toISOString();
  fault.status = 'resolved';
  fault.resolvedAt = now;
  const cable = fault.cableId ? db.cables.find((c) => c.id === fault.cableId) : null;
  if (cable && cable.faultId === fault.id) {
    cable.status = 'active';
    cable.faultId = null;
    cable.updatedAt = now;
  }
  const node = fault.nodeId ? db.nodes.find((n) => n.id === fault.nodeId) : null;
  if (node && node.status !== 'online' && node.status !== 'maintenance') {
    node.status = 'online';
    node.updatedAt = now;
  }
  for (const id of fault.affectedNodeIds || []) {
    const n = db.nodes.find((x) => x.id === id);
    if (n && n.status === 'offline') {
      n.status = 'online';
      n.updatedAt = now;
    }
  }
  resolveAlarmsByFault(db, fault.id);
  pushActivity(db, {
    userId: user?.id,
    userName: user?.name,
    projectId: fault.projectId,
    action: 'fault.repair',
    detail: `Gangguan dipulihkan: ${fault.title}`,
  });
  if (!silent) {
    emitEvent('fault:resolved', { fault, cable, actorId: user?.id || null });
    emitEvent('nodes', { affectedNodeIds: fault.affectedNodeIds || [] });
  }
  return fault;
}

export default { createFault, repairFault, createAlarm, downstreamNodes };
