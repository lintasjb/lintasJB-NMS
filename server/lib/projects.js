import { uid } from './faults.js';

export function createProject(db, { name, code, description, center, zoom, userId, userName }) {
  const project = {
    id: uid('prj'),
    name: String(name || 'Project Baru').slice(0, 120),
    code: String(code || '').slice(0, 40) || `PRJ-${Date.now().toString(36).toUpperCase()}`,
    description: String(description || '').slice(0, 500),
    center: Array.isArray(center) && center.length === 2 ? [Number(center[0]), Number(center[1])] : [-8.1689, 113.702],
    zoom: Number(zoom) || 12,
    status: 'active',
    demo: false,
    createdBy: userId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.projects.push(project);
  return project;
}

/** Deep-copy a project's map data with fresh IDs and remapped relationships. */
export function cloneProject(db, sourceId, { name, code, userId, userName, copyAlarms = false } = {}) {
  const source = db.projects.find((p) => p.id === sourceId);
  if (!source) throw new Error('Project sumber tidak ditemukan.');
  const project = createProject(db, {
    name: name || `${source.name} (copy)`,
    code: code || `${source.code}-COPY`,
    description: source.description,
    center: source.center,
    zoom: source.zoom,
    userId,
    userName,
  });
  project.demo = false;
  const idMap = new Map();
  for (const node of db.nodes.filter((n) => n.projectId === sourceId)) {
    const id = uid('nd');
    idMap.set(node.id, id);
    db.nodes.push({
      ...structuredClone(node),
      id,
      projectId: project.id,
      parentId: node.parentId ? null : null,
      serial: node.serial,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  for (const node of db.nodes.filter((n) => n.projectId === project.id)) {
    const sourceNode = db.nodes.find(
      (n) => n.projectId === sourceId && idMap.get(n.id) === node.id
    );
    node.parentId = sourceNode?.parentId ? idMap.get(sourceNode.parentId) || null : null;
  }
  const cableIdMap = new Map();
  for (const cable of db.cables.filter((c) => c.projectId === sourceId)) {
    const id = uid('cb');
    cableIdMap.set(cable.id, id);
    db.cables.push({
      ...structuredClone(cable),
      id,
      projectId: project.id,
      fromNodeId: idMap.get(cable.fromNodeId) || null,
      toNodeId: idMap.get(cable.toNodeId) || null,
      faultId: null,
      status: cable.status === 'fault' ? 'active' : cable.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  if (copyAlarms) {
    for (const alarm of db.alarms.filter((a) => a.projectId === sourceId).slice(0, 20)) {
      db.alarms.push({
        ...structuredClone(alarm),
        id: uid('alm'),
        projectId: project.id,
        nodeId: idMap.get(alarm.nodeId) || null,
        cableId: cableIdMap.get(alarm.cableId) || null,
        faultId: null,
        resolved: true,
        resolvedAt: alarm.resolvedAt || new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    }
  }
  return project;
}

export default { createProject, cloneProject };
