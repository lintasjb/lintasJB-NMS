/* lintasJB NMS — shared application state */
import { getProjectId } from './api.js';

const FILTER_KEY = 'lintasjb.filters';
const SOUND_KEY = 'lintasjb.sound';

const defaultFilters = {
  nodes: { pop: true, router: true, server: true, olt: true, odc: true, odp: true, ont: true, closure: true },
  cables: { backbone: true, feeder: true, distribution: true, drop: true },
  labels: true,
  animate: true,
  faults: true,
};

function loadFilters() {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
    if (!raw) return structuredClone(defaultFilters);
    return {
      ...defaultFilters,
      ...raw,
      nodes: { ...defaultFilters.nodes, ...(raw.nodes || {}) },
      cables: { ...defaultFilters.cables, ...(raw.cables || {}) },
    };
  } catch {
    return structuredClone(defaultFilters);
  }
}

export const state = {
  ready: false,
  user: null,
  settings: {
    branding: { companyName: 'lintasJB', appName: 'lintasJB NMS', tagline: 'Fiber Network Intelligence', logo: '/assets/lintasjb-mark.png', accent: '#22d3ee', accent2: '#a3e635', footer: '' },
    map: { basemap: 'cartoDark', center: [-8.2, 114.02], zoom: 10, showLabels: true, animate: true, showFaults: true, showGrid: false },
    alarm: { enabled: true, volume: 0.55, pattern: 'siren', repeat: 3, onFault: true, onDevice: true, onCable: true },
    monitor: { enabled: true, intervalSec: 180, offlineAfterSec: 600, autoCableFault: true, autoCreateOnt: false },
    integrations: { genieacs: { enabled: false, url: '', username: '', pollSeconds: 180, offlineAfterSec: 600, hasPassword: false }, webhookToken: '' },
    customBasemaps: [],
  },
  license: null,
  licenseKey: null,
  basemaps: [],
  projects: [],
  project: null,
  projectId: '',
  nodes: [],
  cables: [],
  faults: [],
  alarms: [],
  stats: {},
  activity: [],
  integrations: { genieacs: { devices: [], faults: [] }, olts: [], routers: [], cacheOlts: {}, cacheRouters: {} },
  filters: loadFilters(),
  soundEnabled: localStorage.getItem(SOUND_KEY) !== 'off',
  sseStatus: 'offline',
};

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, detail) {
  for (const fn of listeners.get(event) || []) {
    try { fn(detail); } catch (err) { console.error('[state]', event, err); }
  }
  if (event === 'state') window.dispatchEvent(new CustomEvent('nms:state', { detail }));
}

const byId = (list, id) => list.find((item) => item.id === id) || null;

export function nodeById(id) {
  return byId(state.nodes, id);
}

export function cableById(id) {
  return byId(state.cables, id);
}

export function faultById(id) {
  return byId(state.faults, id);
}

export function activeFaults() {
  return state.faults.filter((f) => f.status === 'active');
}

export function activeAlarms() {
  return state.alarms.filter((a) => !a.resolved);
}

export function faultForCable(cableId) {
  return state.faults.find((f) => f.cableId === cableId && f.status === 'active') || null;
}

export function faultForNode(nodeId) {
  return state.faults.find((f) => f.nodeId === nodeId && f.status === 'active') || null;
}

export function childrenOf(nodeId) {
  return state.nodes.filter((n) => n.parentId === nodeId);
}

export function cablesOfNode(nodeId) {
  return state.cables.filter((c) => c.fromNodeId === nodeId || c.toNodeId === nodeId);
}

export function nodeTypeCounts() {
  const counts = {};
  for (const node of state.nodes) counts[node.type] = (counts[node.type] || 0) + 1;
  return counts;
}

export function availableBasemaps() {
  const custom = (state.settings.customBasemaps || [])
    .filter((b) => b.enabled !== false && b.url && !b.url.includes('YOUR_KEY'))
    .map((b) => ({ id: b.id, name: b.name, group: 'Kustom', url: b.url, attribution: b.attribution || 'Custom', maxZoom: 22, dark: true }));
  return [...(state.basemaps || []), ...custom];
}

export function basemapById(id) {
  return availableBasemaps().find((b) => b.id === id) || availableBasemaps()[0] || null;
}

export function applyBootstrap(data) {
  if (!data) return;
  state.user = data.user || state.user;
  state.settings = data.settings || state.settings;
  state.license = data.license || state.license;
  state.licenseKey = data.licenseKey ?? state.licenseKey;
  state.basemaps = data.basemaps || state.basemaps;
  state.projects = data.projects || state.projects;
  state.project = data.project || null;
  state.projectId = data.project?.id || getProjectId() || '';
  state.nodes = data.nodes || [];
  state.cables = data.cables || [];
  state.faults = data.faults || [];
  state.alarms = data.alarms || [];
  state.stats = data.stats || {};
  state.activity = data.activity || [];
  state.integrations = data.integrations || state.integrations;
  state.ready = true;
  if (data.settings?.map) {
    if (data.settings.map.showLabels !== undefined) state.filters.labels = Boolean(data.settings.map.showLabels);
    if (data.settings.map.animate !== undefined) state.filters.animate = Boolean(data.settings.map.animate);
    if (data.settings.map.showFaults !== undefined) state.filters.faults = Boolean(data.settings.map.showFaults);
  }
  emit('state', state);
}

export function saveFilters() {
  localStorage.setItem(FILTER_KEY, JSON.stringify(state.filters));
}

export function setSoundEnabled(enabled) {
  state.soundEnabled = Boolean(enabled);
  localStorage.setItem(SOUND_KEY, state.soundEnabled ? 'on' : 'off');
  emit('sound', state.soundEnabled);
}

export function projectNodeCount(project) {
  return Number(project?.nodeCount) || state.nodes.filter((n) => n.projectId === project?.id).length;
}

export default state;
