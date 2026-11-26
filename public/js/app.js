/* lintasJB NMS — application shell, auth, routing, realtime */
import * as api from './api.js';
import {
  state, applyBootstrap, activeAlarms, activeFaults, setSoundEnabled,
} from './state.js';
import {
  esc, icon, fmt, toast, errorToast, modal, drawer, empty, severityBox, ROLE_LABEL,
  NODE_TYPES, CABLE_TYPES, closeAllOverlays,
} from './ui.js';
import { ROUTES, parseHash, currentView, navigate, setFocus } from './router.js';
import { runCleanup } from './lifecycle.js';
import { parseCoordinate } from './geosearch.js';
import * as sound from './sound.js';

const PAGE_LOADERS = {
  dashboard: () => import('./pages/dashboard.js'),
  map: () => import('./pages/map.js'),
  assets: () => import('./pages/assets.js'),
  cables: () => import('./pages/cables.js'),
  faults: () => import('./pages/faults.js'),
  devices: () => import('./pages/devices.js'),
  transfer: () => import('./pages/transfer.js'),
  settings: () => import('./pages/settings.js'),
  admin: () => import('./pages/admin.js'),
  about: () => import('./pages/about.js'),
};

const AUTH_TITLES = {
  login: ['Selamat datang kembali', 'Masuk ke workspace NOC Anda.'],
  register: ['Buat workspace baru', 'Daftarkan perusahaan dan mulai petakan jaringan fiber Anda.'],
};

const appEl = document.getElementById('app');
const authScreen = document.getElementById('auth-screen');
const bootScreen = document.getElementById('boot-screen');
const viewEl = document.getElementById('view');
let liveView = viewEl;
const alertStrip = document.getElementById('alert-strip');
const faultOverlay = document.getElementById('fault-overlay');

let shellWired = false;
let refreshing = false;
let refreshQueued = false;
let refreshTimer = null;
let renderSeq = 0;
let currentPage = '';
let lastSirenAt = 0;
let overlayTimer = null;
let palette = null;
let sseConnected = false;

/* ------------------------------------------------------------------ brand */

function branding() {
  return state.settings.branding || {};
}

function applyBranding() {
  const b = branding();
  // Instalasi lama masih menyimpan logo bawaan lama; petakan ke mark perusahaan.
  const logo = !b.logo || b.logo === '/assets/logo.svg' ? '/assets/lintasjb-mark.png' : b.logo;
  for (const img of document.querySelectorAll('[data-logo]')) {
    if (img.getAttribute('src') !== logo) img.src = logo;
  }
  for (const el of document.querySelectorAll('[data-app-name]')) el.textContent = b.appName || 'lintasJB NMS';
  for (const el of document.querySelectorAll('[data-company]')) el.textContent = b.companyName || 'lintasJB';
  for (const el of document.querySelectorAll('[data-brand-tagline]')) el.textContent = b.tagline || 'Fiber Network Intelligence';
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(b.accent || '')) ? b.accent : '#22d3ee';
  const accent2 = /^#[0-9a-fA-F]{6}$/.test(String(b.accent2 || '')) ? b.accent2 : '#a3e635';
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-2', accent2);
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = logo;
  document.title = `${b.appName || 'lintasJB NMS'} — ${b.tagline || 'Fiber Network Intelligence'}`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = '#060b14';
}

/* ------------------------------------------------------------------ boot */

function showBoot(show) {
  bootScreen?.classList.toggle('hidden', !show);
}

function showAuth(message = '') {
  api.closeEvents();
  sseConnected = false;
  closeAllOverlays();
  appEl?.classList.add('hidden');
  authScreen?.classList.remove('hidden');
  showBoot(false);
  if (message) {
    const activeForm = authScreen?.querySelector('.auth-form:not(.hidden)');
    showAuthError(activeForm, message);
  }
}

function showAuthError(form, message) {
  if (!form) return;
  const box = form.querySelector('[data-auth-error]');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('hidden', !message);
}

function setAuthTab(tab) {
  if (!authScreen) return;
  authScreen.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.authTab === tab);
  });
  authScreen.querySelector('#login-form')?.classList.toggle('hidden', tab !== 'login');
  authScreen.querySelector('#register-form')?.classList.toggle('hidden', tab !== 'register');
  authScreen.querySelector('#auth-title').textContent = AUTH_TITLES[tab][0];
  authScreen.querySelector('#auth-subtitle').textContent = AUTH_TITLES[tab][1];
  const forms = authScreen.querySelectorAll('.auth-form');
  forms.forEach((form) => showAuthError(form, ''));
  authScreen.querySelector(tab === 'login' ? '#login-form [name="email"]' : '#register-form [name="name"]')?.focus();
}

async function enterApp({ projectId = '' } = {}) {
  showBoot(true);
  authScreen?.classList.add('hidden');
  appEl?.classList.add('hidden');
  try {
    if (projectId) api.setProjectId(projectId);
    await loadBootstrap();
    appEl?.classList.remove('hidden');
    showBoot(false);
    wireShell();
    updateShell();
    applyBranding();
    connectEvents();
    if (!location.hash) history.replaceState(null, '', '#/dashboard');
    await renderRoute();
  } catch (err) {
    showBoot(false);
    if (err?.status === 401) {
      showAuth('Sesi berakhir. Silakan login kembali.');
    } else {
      showAuth('Gagal memuat data dari server. Pastikan lintasJB NMS berjalan.');
      toast.error('Tidak dapat membuka workspace', err?.message || 'Periksa koneksi ke server.');
    }
  }
}

async function loadBootstrap() {
  let data;
  try {
    data = await api.bootstrap(api.getProjectId());
  } catch (err) {
    // Project tersimpan dari akun sebelumnya tidak boleh mengunci akun baru.
    if (err?.status !== 403 || !api.getProjectId()) throw err;
    api.setProjectId('');
    data = await api.bootstrap('');
  }
  applyBootstrap(data);
  if (data.project?.id) api.setProjectId(data.project.id);
  applyBranding();
  updateShell();
  return data;
}

function scheduleRefresh(delay = 420) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshAll();
  }, delay);
}

async function refreshAll({ render = true } = {}) {
  if (refreshing) {
    refreshQueued = true;
    return;
  }
  refreshing = true;
  try {
    do {
      refreshQueued = false;
      try {
        await loadBootstrap();
        updateShell();
        if (render && !appEl.classList.contains('hidden')) await renderRoute();
      } catch (err) {
        if (err?.status === 401) return;
        console.warn('[refresh]', err);
        toast.error('Gagal menyegarkan data', err?.message || 'Server tidak merespons.');
      }
    } while (refreshQueued);
  } finally {
    refreshing = false;
    if (refreshQueued) scheduleRefresh(80);
  }
}

/* ------------------------------------------------------------------ shell */

function updateShell() {
  const projectSelect = document.getElementById('project-select');
  if (projectSelect) {
    projectSelect.innerHTML = (state.projects || [])
      .map((p) => `<option value="${esc(p.id)}" ${p.id === state.projectId ? 'selected' : ''}>${esc(p.name)}${p.code ? ` · ${esc(p.code)}` : ''}</option>`)
      .join('') || '<option value="">Belum ada project</option>';
  }

  const nodes = state.nodes.length;
  const cables = state.cables.length;
  const faults = activeFaults().length;
  const alarms = activeAlarms();
  const km = Number(state.stats?.cableKm) || (state.cables.reduce((sum, c) => sum + (Number(c.lengthM) || 0), 0) / 1000);

  setText('[data-count-nodes]', fmt.num(nodes));
  setText('[data-count-cables]', fmt.num(cables));
  const faultCount = document.querySelector('[data-count-faults]');
  if (faultCount) {
    faultCount.textContent = String(faults);
    faultCount.classList.toggle('hidden', faults === 0);
  }
  setText('[data-project-name]', state.project?.name || 'Belum ada project');
  setText('[data-project-nodes]', `${fmt.num(nodes)} node`);
  setText('[data-project-km]', `${fmt.num(km, 2)} km`);

  const user = state.user || {};
  for (const el of document.querySelectorAll('[data-user-name]')) el.textContent = user.name || 'Pengguna';
  const roleText = `${ROLE_LABEL[user.role] || user.role || 'Operator'}${user.demo ? ' · Demo (hanya baca)' : ''}`;
  for (const el of document.querySelectorAll('[data-user-role]')) el.textContent = roleText;
  for (const el of document.querySelectorAll('[data-user-initials]')) el.textContent = fmt.initials(user.name || 'NA');

  const canAdmin = ['superadmin', 'admin'].includes(user.role);
  for (const el of document.querySelectorAll('[data-admin-only]')) el.classList.toggle('hidden', !canAdmin);
  if (!canAdmin && currentView() === 'admin') navigate('dashboard');

  const license = state.license || {};
  setText('[data-license-plan]', String(license.planLabel || license.plan || 'TRIAL').toUpperCase());
  setText('[data-license-days]', license.daysLeft === undefined ? '— hari tersisa' : `${license.daysLeft} hari tersisa`);
  const bar = document.querySelector('[data-license-bar]');
  if (bar) bar.style.width = `${Math.min(100, Number(license.usagePercent) || 0)}%`;
  const mini = document.getElementById('license-mini');
  if (mini) mini.classList.toggle('hidden', false);

  const badge = document.querySelector('[data-alarm-badge]');
  if (badge) {
    badge.textContent = String(alarms.length);
    badge.classList.toggle('hidden', alarms.length === 0);
  }

  updateAlertStrip();
  updateSoundButton();
}

function setText(selector, value) {
  for (const el of document.querySelectorAll(selector)) el.textContent = value;
}

function updateAlertStrip() {
  if (!alertStrip) return;
  const faults = activeFaults();
  const critical = activeAlarms().filter((a) => !a.acknowledged && (a.severity === 'critical' || a.severity === 'major'));
  if (faults.length) {
    alertStrip.classList.remove('hidden');
    alertStrip.innerHTML = `${icon('alert-triangle')}
      <div><b>${fmt.num(faults.length)} gangguan kabel aktif.</b> ${esc(faults[0].title)}${faults.length > 1 ? ` dan ${faults.length - 1} lainnya` : ''}.</div>
      <button class="link-btn" data-nav="faults">Buka fault locator ${icon('chevron-right')}</button>`;
    return;
  }
  if (critical.length) {
    alertStrip.classList.remove('hidden');
    alertStrip.innerHTML = `${icon('alert-circle')}
      <div><b>${fmt.num(critical.length)} alarm kritis belum di-ACK.</b> ${esc(critical[0].title)}.</div>
      <button class="link-btn" data-nav="faults">Lihat alarm ${icon('chevron-right')}</button>`;
    return;
  }
  alertStrip.classList.add('hidden');
  alertStrip.innerHTML = '';
}

/* ------------------------------------------------------------------ routing */

async function renderRoute() {
  if (appEl.classList.contains('hidden')) return;
  const seq = ++renderSeq;
  const { view, params } = parseHash();
  const meta = ROUTES[view] || ROUTES.dashboard;
  const loader = PAGE_LOADERS[view] || PAGE_LOADERS.dashboard;

  if (view === currentPage) runCleanup();
  else {
    runCleanup();
    currentPage = view;
  }
  closeAllOverlays();

  // Replace the route container so page-level event listeners from the
  // previous render cannot accumulate (which caused duplicate requests).
  const previousView = liveView;
  const nextView = document.createElement('main');
  nextView.id = 'view';
  nextView.className = previousView.className;
  previousView.replaceWith(nextView);
  liveView = nextView;

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.nav === view);
  });
  setText('#page-title', meta.title);
  setText('#page-subtitle', meta.subtitle);
  document.title = `${meta.title} · ${branding().appName || 'lintasJB NMS'}`;
  liveView.className = view === 'map' ? 'view view--map' : 'view';
  liveView.innerHTML = `<div class="page"><div class="empty"><div class="boot-spinner"></div><span>Memuat ${esc(meta.title)}…</span></div></div>`;
  appEl.classList.remove('sidebar-open');

  try {
    const mod = await loader();
    if (seq !== renderSeq) return;
    liveView.innerHTML = '';
    await mod.render(liveView, params);
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error('[route]', view, err);
    liveView.innerHTML = `<div class="page"><div class="panel"><div class="panel-body">${empty('alert-triangle', 'Halaman gagal dimuat', err?.message || 'Terjadi kesalahan pada modul halaman.')}</div></div></div>`;
    toast.error('Gagal membuka halaman', err?.message || String(err));
  }
}

/* ------------------------------------------------------------------ realtime */

function connectEvents() {
  if (sseConnected) api.closeEvents();
  const source = api.connectEvents({
    onStatus(status) {
      sseConnected = status === 'online';
      if (status === 'offline' && !document.body.dataset.sseWarned) {
        document.body.dataset.sseWarned = '1';
        setTimeout(() => { delete document.body.dataset.sseWarned; }, 30000);
      }
    },
    onEvent(type, data) {
      if (type === 'hello') return;
      if (type === 'fault') {
        handleFaultEvent(data);
        scheduleRefresh();
        return;
      }
      if (type === 'fault:resolved') {
        hideFaultOverlay();
        if (data?.actorId !== state.user?.id) {
          toast.success('Gangguan dipulihkan', data?.fault?.title || 'Kabel kembali normal.');
        }
        scheduleRefresh();
        return;
      }
      if (type === 'alarm') {
        handleAlarmEvent(data);
        scheduleRefresh();
        return;
      }
      if (type === 'alarm:changed') {
        scheduleRefresh(250);
        return;
      }
      if (type === 'alarms:ack-all') {
        toast.info('Alarm di-ACK', 'Seluruh alarm pada project ditandai sudah ditangani.');
        scheduleRefresh(200);
        return;
      }
      if (type === 'node:changed' || type === 'cable:changed' || type === 'nodes') {
        scheduleRefresh(220);
        return;
      }
      if (type === 'projects') {
        scheduleRefresh(120);
        return;
      }
      if (type === 'settings' || type === 'license') {
        scheduleRefresh(180);
        return;
      }
      if (type === 'import') {
        if (data?.actorId !== state.user?.id) {
          toast.info('Import selesai', `${data?.nodes || 0} node dan ${data?.cables || 0} kabel ditambahkan.`);
        }
        scheduleRefresh(120);
        return;
      }
      if (type === 'billing') {
        if (data?.actorId !== state.user?.id) {
          const order = data?.order || {};
          toast.info('Tagihan diperbarui', `${order.invoiceNo || 'Tagihan'} · ${String(order.status || '').toUpperCase()}`);
          scheduleRefresh(200);
        }
        return;
      }
      if (type === 'router:changed') {
        scheduleRefresh(300);
      }
    },
  });
  sseConnected = Boolean(source);
}

function handleFaultEvent(data) {
  const fault = data?.fault;
  if (!fault) return;
  triggerAlarmSound('fault');
  flashFaultOverlay();
  if (data?.actorId !== state.user?.id) {
    const affected = Array.isArray(data.affected) ? data.affected.length : 0;
    toast.fault(fault.title || 'Kabel putus terdeteksi', `${fault.description || 'Fault locator menemukan titik gangguan.'}${affected ? ` · ${affected} node terdampak.` : ''}`);
  }
}

function handleAlarmEvent(data) {
  const alarm = data?.alarm;
  if (!alarm) return;
  if (alarm.faultId) return;
  triggerAlarmSound(alarm.severity === 'critical' ? 'device' : 'warning');
  toast.warn(alarm.title || 'Alarm baru', alarm.message || 'Perangkat membutuhkan perhatian.');
}

function triggerAlarmSound(kind) {
  const cfg = state.settings.alarm || {};
  if (!state.soundEnabled || cfg.enabled === false) return;
  if (kind === 'fault' && cfg.onFault === false) return;
  if (kind === 'device' && cfg.onDevice === false) return;
  if (kind === 'warning' && cfg.onDevice === false) return;
  if (Date.now() - lastSirenAt < 3500) return;
  lastSirenAt = Date.now();
  sound.unlock();
  sound.play(cfg.pattern || 'siren', Number(cfg.volume) || 0.55, Number(cfg.repeat) || 3);
}

function flashFaultOverlay() {
  if (!faultOverlay) return;
  if (overlayTimer) clearTimeout(overlayTimer);
  faultOverlay.classList.remove('hidden');
  overlayTimer = setTimeout(() => {
    faultOverlay.classList.add('hidden');
    overlayTimer = null;
  }, 6500);
}

function hideFaultOverlay() {
  if (overlayTimer) clearTimeout(overlayTimer);
  overlayTimer = null;
  faultOverlay?.classList.add('hidden');
}

/* ------------------------------------------------------------------ sound */

function updateSoundButton() {
  const btn = document.getElementById('btn-sound');
  if (!btn) return;
  btn.innerHTML = icon(state.soundEnabled ? 'volume' : 'volume-x');
  btn.title = state.soundEnabled ? 'Suara alarm aktif — klik untuk bisukan' : 'Suara alarm nonaktif — klik untuk aktifkan';
  btn.classList.toggle('text-accent', state.soundEnabled);
}

function toggleSound() {
  const next = !state.soundEnabled;
  setSoundEnabled(next);
  if (next) {
    sound.unlock();
    const cfg = state.settings.alarm || {};
    sound.play(cfg.pattern || 'beep', Math.min(0.5, Number(cfg.volume) || 0.5), 1);
    toast.success('Suara alarm aktif', 'Sirene akan berbunyi saat gangguan terdeteksi.');
  } else {
    sound.stopSound();
    toast.info('Suara alarm dibisukan', 'Alarm visual tetap berjalan.');
  }
  updateSoundButton();
}

/* ------------------------------------------------------------------ alarm drawer */

function openAlarms() {
  const alarms = activeAlarms()
    .slice()
    .sort((a, b) => {
      const rank = { critical: 0, major: 1, warning: 2, info: 3 };
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    });
  const unacked = alarms.filter((a) => !a.acknowledged).length;
  const d = drawer({
    title: 'Pusat alarm',
    subtitle: `${alarms.length} alarm aktif · ${unacked} belum di-ACK`,
    body: alarms.length
      ? `<div class="row row--between mb-2">
          <span class="muted" style="font-size:10px">Diurutkan berdasarkan tingkat keparahan</span>
          <button class="link-btn" data-drawer-ack-all>ACK semua</button>
        </div>
        <div class="alarm-list">${alarms.map((alarm) => `<div class="drawer-alarm">
          ${severityBox(alarm.severity || 'info')}
          <div class="drawer-alarm__body">
            <b>${esc(alarm.title)}</b>
            <p>${esc(alarm.message || '')}</p>
            <span>${esc(alarm.source || 'system')} · ${esc(fmt.ago(alarm.lastSeenAt || alarm.createdAt))}${alarm.count > 1 ? ` · ${alarm.count}×` : ''}${alarm.acknowledged ? ' · ACK' : ''}</span>
            <div class="row mt-1">
              ${!alarm.acknowledged ? `<button class="btn btn-xs btn-soft" data-drawer-ack="${esc(alarm.id)}">${icon('check')} ACK</button>` : ''}
              <button class="btn btn-xs btn-ghost" data-drawer-resolve="${esc(alarm.id)}">${icon('check-circle')} Selesai</button>
              ${alarm.faultId ? `<button class="btn btn-xs btn-ghost" data-drawer-fault="${esc(alarm.faultId)}">${icon('crosshair')} Lokasi</button>` : ''}
            </div>
          </div>
        </div>`).join('')}</div>`
      : empty('check-circle', 'Tidak ada alarm aktif', 'Seluruh perangkat dan kabel dalam kondisi normal.'),
    footer: '<button class="btn btn-soft" data-drawer-close>Tutup</button>',
  });

  d.root?.addEventListener('click', async (event) => {
    const ack = event.target.closest('[data-drawer-ack]');
    const resolve = event.target.closest('[data-drawer-resolve]');
    const fault = event.target.closest('[data-drawer-fault]');
    if (fault) {
      d.close();
      navigate('faults', { faultId: fault.dataset.drawerFault });
      return;
    }
    if (ack) {
      try {
        await api.post(`/alarms/${ack.dataset.drawerAck}/ack`, {});
        toast.success('Alarm di-ACK', 'Alarm ditandai sudah ditangani.');
        d.close();
        scheduleRefresh(150);
      } catch (err) { errorToast(err); }
      return;
    }
    if (resolve) {
      try {
        await api.post(`/alarms/${resolve.dataset.drawerResolve}/resolve`, {});
        toast.success('Alarm diselesaikan', 'Alarm dipindahkan ke riwayat.');
        d.close();
        scheduleRefresh(150);
      } catch (err) { errorToast(err); }
      return;
    }
    if (event.target.closest('[data-drawer-ack-all]')) {
      try {
        const result = await api.post('/alarms/ack-all', { projectId: state.projectId });
        toast.success('Semua alarm di-ACK', `${result.count || 0} alarm ditandai sudah ditangani.`);
        d.close();
        scheduleRefresh(150);
      } catch (err) { errorToast(err); }
    }
  });
}

/* ------------------------------------------------------------------ search palette */

function searchItems() {
  const pages = Object.entries(ROUTES).map(([id, meta]) => ({
    kind: 'page',
    id,
    group: 'Halaman',
    label: meta.title,
    sub: meta.subtitle,
    icon: id === 'map' ? 'map' : id === 'settings' ? 'settings' : id === 'faults' ? 'alert-triangle' : id === 'transfer' ? 'swap' : id === 'devices' ? 'router' : id === 'cables' ? 'cable' : id === 'assets' ? 'network' : 'grid',
    color: '#8ba0bd',
  }));
  const nodes = state.nodes.map((n) => {
    const meta = NODE_TYPES[n.type] || { short: 'NODE', color: '#8ba0bd' };
    return { kind: 'node', id: n.id, group: 'Node', label: n.name, sub: `${meta.short}${n.code ? ` · ${n.code}` : ''} · ${n.status || ''}`, icon: meta.icon || 'pin', color: meta.color };
  });
  const cables = state.cables.map((c) => {
    const meta = CABLE_TYPES[c.type] || { label: 'Kabel', color: '#22d3ee' };
    return { kind: 'cable', id: c.id, group: 'Kabel', label: c.name, sub: `${meta.label} · ${fmt.km(c.lengthM)} · ${c.status || ''}`, icon: meta.icon || 'cable', color: meta.color };
  });
  const faults = activeFaults().map((f) => ({
    kind: 'fault', id: f.id, group: 'Gangguan', label: f.title, sub: `${f.source || 'manual'} · ${fmt.ago(f.detectedAt)}`, icon: 'alert-triangle', color: '#ff4d6d',
  }));
  return [...pages, ...nodes, ...cables, ...faults];
}

function openPalette() {
  if (palette) return;
  const root = document.getElementById('modal-root');
  if (!root) return;
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.style.alignItems = 'flex-start';
  back.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Pencarian global">
    <div class="palette-input">${icon('search')}<input id="palette-query" placeholder="Cari node, kabel, koordinat, atau halaman…" autocomplete="off" /></div>
    <div class="palette-results" id="palette-results"></div>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigasi</span><span><kbd>Enter</kbd> buka</span><span><kbd>Esc</kbd> tutup</span><span class="grow"></span><span>Ctrl K</span></div>
  </div>`;
  root.appendChild(back);
  const input = back.querySelector('#palette-query');
  const results = back.querySelector('#palette-results');
  const all = searchItems();
  let visible = [];
  let index = 0;

  const close = () => {
    back.remove();
    palette = null;
  };

  const render = () => {
    const q = input.value.trim().toLowerCase();
    const coord = q ? parseCoordinate(q) : null;
    const coordItem = coord ? {
      kind: 'coordinate',
      id: `${coord.lat},${coord.lng}`,
      group: 'Koordinat',
      label: `Buka koordinat ${fmt.coord(coord.lat, coord.lng, 6)}`,
      sub: 'WGS84 · buka di Live Map',
      icon: 'crosshair',
      color: '#f5a524',
      point: [coord.lat, coord.lng],
    } : null;
    visible = [
      ...(coordItem ? [coordItem] : []),
      ...all.filter((item) => !q || `${item.label} ${item.sub} ${item.group}`.toLowerCase().includes(q)),
    ].slice(0, 24);
    if (!visible.length) {
      results.innerHTML = empty('search', 'Tidak ada hasil', 'Coba kata kunci lain.');
      return;
    }
    index = Math.min(index, visible.length - 1);
    const groups = new Map();
    visible.forEach((item, i) => {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push({ item, i });
    });
    results.innerHTML = [...groups.entries()].map(([group, list]) => `
      <div class="palette-group">${esc(group)}</div>
      ${list.map(({ item, i }) => `<div class="palette-item ${i === index ? 'active' : ''}" data-palette-index="${i}">
        <span class="cell-icon" style="color:${item.color}">${icon(item.icon)}</span>
        <div class="grow"><b>${esc(item.label)}</b><span>${esc(item.sub || '')}</span></div>
        <span class="pi-meta">${esc(item.kind)}</span>
      </div>`).join('')}
    `).join('');
    results.querySelector(`[data-palette-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (i = index) => {
    const item = visible[i];
    if (!item) return;
    close();
    if (item.kind === 'page') navigate(item.id);
    else if (item.kind === 'node') { setFocus('node', item.id); navigate('map'); }
    else if (item.kind === 'cable') { setFocus('cable', item.id); navigate('map'); }
    else if (item.kind === 'coordinate') { setFocus('point', item.id, { point: item.point }); navigate('map'); }
    else if (item.kind === 'fault') navigate('faults', { faultId: item.id });
  };

  input.addEventListener('input', () => { index = 0; render(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); index = Math.min(visible.length - 1, index + 1); render(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); index = Math.max(0, index - 1); render(); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
  });

  back.addEventListener('click', (event) => {
    if (event.target === back) { close(); return; }
    const item = event.target.closest('[data-palette-index]');
    if (item) choose(Number(item.dataset.paletteIndex));
  });

  palette = { close, input };
  render();
  setTimeout(() => input.focus(), 30);
}

/* ------------------------------------------------------------------ user menu */

function openUserMenu() {
  const user = state.user || {};
  modal({
    title: user.name || 'Pengguna',
    subtitle: `${ROLE_LABEL[user.role] || user.role || 'Operator'}${user.company ? ` · ${user.company}` : ''}`,
    iconName: 'user',
    size: 'sm',
    body: `<div class="license-panel">
      <div class="license-panel__top">
        <div><div class="license-plan" style="font-size:17px">${esc(user.name || 'Pengguna')}</div><div class="license-customer">${esc(user.email || '')}</div></div>
        <div class="avatar">${esc(fmt.initials(user.name))}</div>
      </div>
      <div class="license-grid" style="grid-template-columns:1fr 1fr">
        <div><span>Role</span><b>${esc(ROLE_LABEL[user.role] || user.role || '—')}</b></div>
        <div><span>Status</span><b>${esc(user.status === 'disabled' ? 'Nonaktif' : 'Aktif')}</b></div>
      </div>
    </div>
    <div class="hint mt-2">${icon('shield')} Sesi aman dengan token JWT. Data tersimpan di server Anda sendiri.</div>`,
    footer: `<button class="btn btn-ghost" data-open-account>${icon('user')} Akun</button>
      <button class="btn btn-soft" data-open-settings>${icon('settings')} Pengaturan</button>
      <button class="btn btn-danger" data-logout>${icon('logout')} Keluar</button>`,
    onMount(ui, root) {
      root.querySelector('[data-open-account]')?.addEventListener('click', () => { ui.close(); navigate('settings', { tab: 'account' }); });
      root.querySelector('[data-open-settings]')?.addEventListener('click', () => { ui.close(); navigate('settings'); });
      root.querySelector('[data-logout]')?.addEventListener('click', () => { ui.close(); logout(); });
    },
  });
}

function logout() {
  api.closeEvents();
  sound.stopSound();
  api.clearSession();
  closeAllOverlays();
  window.location.hash = '#/dashboard';
  window.location.reload();
}

/* ------------------------------------------------------------------ auth wiring */

function wireAuth() {
  if (!authScreen) return;

  authScreen.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setAuthTab(btn.dataset.authTab));
  });

  authScreen.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement?.querySelector('input');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.innerHTML = icon(input.type === 'password' ? 'eye' : 'lock');
    });
  });

  authScreen.querySelector('[data-demo-fill]')?.addEventListener('click', () => {
    const form = authScreen.querySelector('#login-form');
    if (!form) return;
    form.querySelector('[name="email"]').value = 'demo@lintasjb.id';
    form.querySelector('[name="password"]').value = 'Demo123!';
    showAuthError(form, '');
    toast.info('Akun demo diisi', 'Demo hanya menampilkan project simulasi bersifat hanya-baca.');
  });

  authScreen.querySelector('[data-demo-login]')?.addEventListener('click', () => {
    const form = authScreen.querySelector('#login-form');
    if (!form) return;
    form.querySelector('[name="email"]').value = 'demo@lintasjb.id';
    form.querySelector('[name="password"]').value = 'Demo123!';
    form.requestSubmit();
  });

  const loginForm = authScreen.querySelector('#login-form');
  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = loginForm.querySelector('button[type="submit"]');
    const email = loginForm.querySelector('[name="email"]').value.trim();
    const password = loginForm.querySelector('[name="password"]').value;
    const remember = loginForm.querySelector('[name="remember"]').checked;
    showAuthError(loginForm, '');
    submit.disabled = true;
    const original = submit.innerHTML;
    submit.innerHTML = '<span class="boot-spinner" style="width:15px;height:15px;border-width:1.5px"></span><span>Menghubungkan…</span>';
    try {
      const res = await api.auth.login(email, password);
      api.setSession({ token: res.token, user: res.user, remember });
      await enterApp();
    } catch (err) {
      showAuthError(loginForm, err.message || 'Login gagal. Periksa email dan password.');
      submit.disabled = false;
      submit.innerHTML = original;
    }
  });

  const registerForm = authScreen.querySelector('#register-form');
  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = registerForm.querySelector('button[type="submit"]');
    const payload = {
      name: registerForm.querySelector('[name="name"]').value.trim(),
      company: registerForm.querySelector('[name="company"]').value.trim(),
      email: registerForm.querySelector('[name="email"]').value.trim(),
      password: registerForm.querySelector('[name="password"]').value,
      demo: registerForm.querySelector('[name="demo"]').checked,
    };
    showAuthError(registerForm, '');
    submit.disabled = true;
    const original = submit.innerHTML;
    submit.innerHTML = '<span class="boot-spinner" style="width:15px;height:15px;border-width:1.5px"></span><span>Membuat akun…</span>';
    try {
      const res = await api.auth.register(payload);
      api.setSession({ token: res.token, user: res.user, remember: true, projectId: res.projectId });
      toast.success('Akun dibuat', `Selamat datang, ${res.user.name}.`);
      await enterApp({ projectId: res.projectId || '' });
    } catch (err) {
      showAuthError(registerForm, err.message || 'Pendaftaran gagal. Coba lagi.');
      submit.disabled = false;
      submit.innerHTML = original;
    }
  });

  setAuthTab('login');
}

/* ------------------------------------------------------------------ shell wiring */

function wireShell() {
  if (shellWired) return;
  shellWired = true;

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      const view = nav.dataset.nav;
      const params = {};
      if (nav.dataset.settingsTab) params.tab = nav.dataset.settingsTab;
      navigate(view, params);
      return;
    }
    if (event.target.closest('[data-user-menu]')) {
      event.preventDefault();
      openUserMenu();
    }
  });

  document.getElementById('project-select')?.addEventListener('change', (event) => {
    api.setProjectId(event.target.value);
    toast.info('Mengganti project', 'Memuat data project terpilih…');
    refreshAll({ render: true });
  });

  document.getElementById('sidebar-collapse')?.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('lintasjb.sidebar', collapsed ? 'collapsed' : 'open');
  });

  document.getElementById('mobile-menu')?.addEventListener('click', (event) => {
    event.stopPropagation();
    appEl?.classList.toggle('sidebar-open');
  });

  document.addEventListener('click', (event) => {
    if (!appEl?.classList.contains('sidebar-open')) return;
    if (event.target.closest('.sidebar') || event.target.closest('#mobile-menu')) return;
    appEl.classList.remove('sidebar-open');
  });

  document.getElementById('btn-search')?.addEventListener('click', openPalette);
  document.getElementById('btn-alarms')?.addEventListener('click', openAlarms);
  document.getElementById('btn-sound')?.addEventListener('click', toggleSound);

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
      return;
    }
    if (event.key === 'Escape' && palette) {
      palette.close();
    }
  });

  document.addEventListener('nms:refresh', () => scheduleRefresh(220));
  window.addEventListener('nms:unauthorized', () => {
    showAuth('Sesi berakhir. Silakan login kembali.');
  });
  window.addEventListener('hashchange', () => {
    if (!appEl.classList.contains('hidden')) renderRoute();
  });
  window.addEventListener('beforeunload', () => api.closeEvents());

  document.addEventListener('pointerdown', () => sound.unlock(), { once: true });

  if (localStorage.getItem('lintasjb.sidebar') === 'collapsed') {
    document.body.classList.add('sidebar-collapsed');
  }
}

/* ------------------------------------------------------------------ start */

async function start() {
  applyBranding();
  wireAuth();
  updateSoundButton();
  if (api.getToken()) {
    await enterApp();
  } else {
    showAuth();
  }
}

start();

export default { refreshAll, renderRoute };
