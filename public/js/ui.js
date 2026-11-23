/* lintasJB NMS — UI primitives */
import { CABLE_ANIMATIONS } from './cable-animations.js';

export const NODE_TYPES = {
  pop: { label: 'POP Site', short: 'POP', icon: 'building', color: '#a78bfa', hint: 'Point of Presence / site utama' },
  router: { label: 'Router', short: 'Router', icon: 'router', color: '#38bdf8', hint: 'Router / gateway' },
  server: { label: 'Server', short: 'Server', icon: 'server', color: '#94a3b8', hint: 'Server NMS / GenieACS' },
  olt: { label: 'OLT', short: 'OLT', icon: 'radio', color: '#22d3ee', hint: 'Optical Line Terminal' },
  odc: { label: 'ODC', short: 'ODC', icon: 'box', color: '#f59e0b', hint: 'Optical Distribution Cabinet' },
  odp: { label: 'ODP', short: 'ODP', icon: 'git-branch', color: '#a3e635', hint: 'Optical Distribution Point' },
  ont: { label: 'ONT', short: 'ONT', icon: 'home', color: '#f472b6', hint: 'Optical Network Terminal / pelanggan' },
  closure: { label: 'Joint Closure', short: 'JC', icon: 'link', color: '#fbbf24', hint: 'Titik sambung / splice closure' },
};

export const CABLE_TYPES = {
  backbone: { label: 'Backbone', icon: 'route', color: '#22d3ee', hint: 'Jalur utama antar POP' },
  feeder: { label: 'Feeder', icon: 'cable', color: '#a3e635', hint: 'Dari OLT menuju ODC' },
  distribution: { label: 'Distribusi', icon: 'git-branch', color: '#f59e0b', hint: 'Dari ODC menuju ODP' },
  drop: { label: 'Drop', icon: 'link', color: '#f472b6', hint: 'Dari ODP menuju ONT' },
};

export const NODE_STATUS = {
  online: { label: 'Online', tone: 'ok' },
  offline: { label: 'Offline', tone: 'danger' },
  warning: { label: 'Warning', tone: 'warn' },
  critical: { label: 'Kritis', tone: 'danger' },
  maintenance: { label: 'Maintenance', tone: 'info' },
  planned: { label: 'Rencana', tone: 'purple' },
};

export const CABLE_STATUS = {
  active: { label: 'Aktif', tone: 'ok' },
  fault: { label: 'Gangguan', tone: 'danger' },
  maintenance: { label: 'Maintenance', tone: 'info' },
  planned: { label: 'Rencana', tone: 'purple' },
  decommissioned: { label: 'Nonaktif', tone: 'warn' },
};

export const SEVERITY = {
  critical: { label: 'Kritis', tone: 'danger', icon: 'alert-triangle' },
  major: { label: 'Mayor', tone: 'danger', icon: 'alert-circle' },
  warning: { label: 'Peringatan', tone: 'warn', icon: 'warning' },
  info: { label: 'Info', tone: 'info', icon: 'info' },
};

export const ROLE_LABEL = {
  superadmin: 'Superadmin',
  admin: 'Administrator',
  operator: 'Operator',
  viewer: 'Viewer',
};

export const ANIMATIONS = CABLE_ANIMATIONS;

/** Kelas CSS animasi kabel + efek glow untuk dipakai di peta, drawer, dan preview. */
export function cableAnimClasses(type, { reverse = false, fault = false } = {}) {
  const anim = ANIMATIONS[type] ? type : 'flow';
  const classes = ['cable-line'];
  if (anim !== 'none' && anim !== 'static') classes.push(`cable-anim-${anim}`);
  if (['glow', 'glowflow', 'comet', 'laser', 'rainbow', 'breath'].includes(anim)) {
    classes.push('cable-anim-glow');
  }
  if (reverse) classes.push('reverse');
  if (fault) classes.push('cable-fault');
  return [...new Set(classes)].join(' ');
}

export const PALETTE = ['#22d3ee', '#a3e635', '#f59e0b', '#f472b6', '#a78bfa', '#38bdf8', '#34d399', '#fb7185', '#fbbf24', '#e2e8f0'];

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function nodeMeta(type) {
  return NODE_TYPES[type] || { label: type || 'Node', short: String(type || '?').toUpperCase(), icon: 'pin', color: '#8ba0bd', hint: '' };
}

export function cableMeta(type) {
  return CABLE_TYPES[type] || { label: type || 'Kabel', icon: 'cable', color: '#8ba0bd', hint: '' };
}

export const fmt = {
  num(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  km(meters, digits = 2) {
    const n = Number(meters);
    if (!Number.isFinite(n)) return '0 m';
    if (n < 1000) return `${Math.round(n)} m`;
    return `${(n / 1000).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
  },
  pct(value, digits = 0) {
    const n = Number(value);
    return `${Number.isFinite(n) ? n.toFixed(digits) : '0'}%`;
  },
  coord(lat, lng, digits = 6) {
    const a = Number(lat);
    const b = Number(lng);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
    return `${a.toFixed(digits)}, ${b.toFixed(digits)}`;
  },
  date(iso, opts = {}) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', ...opts });
  },
  time(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },
  datetime(iso) {
    if (!iso) return '—';
    return `${fmt.date(iso)} · ${fmt.time(iso)}`;
  },
  clock(date = new Date()) {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },
  fullDate(date = new Date()) {
    return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  },
  ago(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '—';
    const diff = Math.max(0, Date.now() - t);
    const s = Math.floor(diff / 1000);
    if (s < 10) return 'baru saja';
    if (s < 60) return `${s} detik lalu`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} menit lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} jam lalu`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} hari lalu`;
    return fmt.date(iso);
  },
  bytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 ** 2).toFixed(2)} MB`;
  },
  initials(name) {
    return String(name || 'NA')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0] || '')
      .join('')
      .toUpperCase() || 'NA';
  },
};

export function statusPill(status, map = NODE_STATUS) {
  const s = map[status] || { label: status || '—', tone: '' };
  return `<span class="pill ${s.tone ? `pill--${s.tone}` : ''}">${esc(s.label)}</span>`;
}

export function severityBox(severity) {
  const s = SEVERITY[severity] || SEVERITY.info;
  return `<span class="alarm-sev ${esc(severity)}">${icon(s.icon)}</span>`;
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait = 500) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      timer = null;
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function formValues(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'number' || el.type === 'range') data[el.name] = el.value === '' ? null : Number(el.value);
    else if (el.type === 'radio') {
      if (el.checked) data[el.name] = el.value;
    } else if (el.tagName === 'SELECT' && el.multiple) {
      data[el.name] = [...el.selectedOptions].map((o) => o.value);
    } else data[el.name] = el.value;
  }
  return data;
}

export function empty(iconName, title, text = '') {
  return `<div class="empty">${icon(iconName)}<b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div>`;
}

export function spinner(text = 'Memuat…') {
  return `<div class="empty"><div class="boot-spinner"></div><span>${esc(text)}</span></div>`;
}

export function typePicker(name, selected = 'odp', types = Object.keys(NODE_TYPES)) {
  return `<div class="type-picker" data-type-picker="${esc(name)}">
    ${types.map((type) => {
      const m = nodeMeta(type);
      return `<button type="button" class="type-option ${type === selected ? 'active' : ''}" data-type="${type}" title="${esc(m.hint)}">
        ${icon(m.icon)}<span>${esc(m.short)}</span>
      </button>`;
    }).join('')}
  </div>`;
}

export function bindTypePicker(root, name, onChange) {
  const wrap = root.querySelector(`[data-type-picker="${name}"]`);
  if (!wrap) return;
  wrap.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-type]');
    if (!btn) return;
    wrap.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b === btn));
    onChange?.(btn.dataset.type);
  });
}

/* ------------------------------------------------------------------ toasts */
const TOAST_ICON = { info: 'info', success: 'check-circle', warn: 'alert-triangle', error: 'x-circle', fault: 'alert-triangle' };

export function toast(input, message, type = 'info', opts = {}) {
  let data;
  if (typeof input === 'object' && input !== null) data = input;
  else data = { title: input, message, type, ...opts };
  const kind = data.type || 'info';
  const root = document.getElementById('toast-root');
  if (!root) return () => {};
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `
    <div class="toast__ico">${icon(data.icon || TOAST_ICON[kind] || 'info')}</div>
    <div class="toast__body">
      <b>${esc(data.title || '')}</b>
      ${data.message ? `<p>${esc(data.message)}</p>` : ''}
    </div>
    <button class="toast__close" aria-label="Tutup">${icon('x')}</button>`;
  root.appendChild(el);
  let timer = null;
  const close = () => {
    if (timer) clearTimeout(timer);
    if (!el.isConnected) return;
    el.style.opacity = '0';
    el.style.transform = 'translateX(16px)';
    el.style.transition = '.18s';
    setTimeout(() => el.remove(), 190);
  };
  el.querySelector('.toast__close')?.addEventListener('click', close);
  const duration = data.duration === undefined ? (kind === 'fault' ? 9000 : 4800) : data.duration;
  if (duration > 0) timer = setTimeout(close, duration);
  return close;
}
toast.success = (title, message, opts) => toast({ title, message, type: 'success', ...opts });
toast.error = (title, message, opts) => toast({ title, message, type: 'error', ...opts });
toast.warn = (title, message, opts) => toast({ title, message, type: 'warn', ...opts });
toast.info = (title, message, opts) => toast({ title, message, type: 'info', ...opts });
toast.fault = (title, message, opts) => toast({ title, message, type: 'fault', ...opts });

export function errorToast(err) {
  const message = err?.message || 'Terjadi kesalahan.';
  toast.error('Gagal', message);
}

/* ------------------------------------------------------------------ modals */
const openStack = [];

function lockScroll(lock) {
  document.body.style.overflow = lock ? 'hidden' : '';
}

export function modal({
  title = '',
  subtitle = '',
  body = '',
  footer = '',
  size = '',
  iconName = '',
  closable = true,
  onMount,
  onClose,
  className = '',
} = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return { close() {}, root: null };
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal ${size ? `modal--${size}` : ''} ${className}" role="dialog" aria-modal="true">
      <div class="modal-head">
        ${iconName ? `<div class="int-ico">${icon(iconName)}</div>` : ''}
        <div class="modal-head__text">
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        ${closable ? `<button class="icon-btn" data-modal-close aria-label="Tutup">${icon('x')}</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(back);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    const idx = openStack.indexOf(close);
    if (idx >= 0) openStack.splice(idx, 1);
    if (!openStack.length) lockScroll(false);
    onClose?.();
  };
  openStack.push(close);
  lockScroll(true);

  const onKey = (event) => {
    if (event.key === 'Escape' && closable && openStack[openStack.length - 1] === close) close();
  };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (event) => {
    if (event.target === back && closable) close();
    if (event.target.closest('[data-modal-close]')) close();
  });
  const api = { close, root: back, modal: back.querySelector('.modal'), body: back.querySelector('.modal-body'), foot: back.querySelector('.modal-foot') };
  onMount?.(api, back);
  return api;
}

export function confirmDialog({ title = 'Konfirmasi', message = '', confirmText = 'Lanjutkan', cancelText = 'Batal', danger = false, iconName = 'alert-triangle' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({
      title,
      size: 'sm',
      iconName,
      body: `<div class="awg">${esc(message)}</div>`,
      footer: `
        <button class="btn btn-soft" data-cancel>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
      onMount(api, root) {
        root.querySelector('[data-cancel]')?.addEventListener('click', api.close);
        root.querySelector('[data-ok]')?.addEventListener('click', () => {
          answered = true;
          api.close();
          resolve(true);
        });
      },
    });
    if (!m.root) { resolve(false); return; }
  });
}

export function drawer({ title = '', subtitle = '', body = '', footer = '', onMount, onClose, width } = {}) {
  const root = document.getElementById('drawer-root');
  if (!root) return { close() {} };
  const back = document.createElement('div');
  back.className = 'drawer-backdrop';
  back.innerHTML = `
    <aside class="drawer" ${width ? `style="width:${Number(width)}px"` : ''} role="dialog" aria-modal="true">
      <div class="drawer-head">
        <div class="grow">
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p class="muted" style="font-size:10.5px">${esc(subtitle)}</p>` : ''}
        </div>
        <button class="icon-btn" data-drawer-close aria-label="Tutup">${icon('x')}</button>
      </div>
      <div class="drawer-body">${body}</div>
      ${footer ? `<div class="drawer-foot">${footer}</div>` : ''}
    </aside>`;
  root.appendChild(back);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    onClose?.();
  };
  back.addEventListener('click', (event) => {
    if (event.target === back) close();
    if (event.target.closest('[data-drawer-close]')) close();
  });
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const api = { close, root: back, body: back.querySelector('.drawer-body'), foot: back.querySelector('.drawer-foot') };
  onMount?.(api, back);
  return api;
}

export function closeAllOverlays() {
  openStack.slice().forEach((fn) => fn());
  const drawerRoot = document.getElementById('drawer-root');
  if (drawerRoot) drawerRoot.innerHTML = '';
}

/* ------------------------------------------------------------------ misc */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Disalin', 'Teks berhasil disalin ke clipboard.');
    return true;
  } catch {
    toast.error('Gagal menyalin', 'Browser menolak akses clipboard.');
    return false;
  }
}

export function field(label, control, hint = '') {
  return `<label class="field"><span>${esc(label)}</span>${control}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

export function input(name, value = '', attrs = '') {
  return `<input name="${esc(name)}" value="${esc(value)}" ${attrs} />`;
}

export function select(name, options, selected = '', attrs = '') {
  return `<select name="${esc(name)}" ${attrs}>${options.map((o) => {
    const value = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    return `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('')}</select>`;
}

export function switchRow(name, label, desc, checked) {
  return `<div class="switch-row">
    <div><b>${esc(label)}</b><span>${esc(desc)}</span></div>
    <label class="switch"><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''}/><i></i></label>
  </div>`;
}

export function sparkline(points, color = '#22d3ee', width = 160, height = 36) {
  if (!points?.length) return '';
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const spread = max - min || 1;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1 || 1)) * width;
    const y = height - ((p - min) / spread) * (height - 4) - 2;
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const area = `${d} L${width} ${height} L0 ${height} Z`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="${color}" fill-opacity=".09"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round"/>
  </svg>`;
}
