/* lintasJB NMS — Tentang aplikasi */
import * as api from '../api.js';
import { state } from '../state.js';
import { esc, icon, fmt, toast, copyText } from '../ui.js';
import { navigate } from '../router.js';

function fallbackInfo() {
  return {
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
    runtime: null,
    stats: {
      projects: state.projects?.length || 0,
      nodes: state.nodes?.length || 0,
      cables: state.cables?.length || 0,
      users: null,
      orders: null,
      activeFaults: state.faults?.filter((f) => f.status === 'active').length || 0,
      activeAlarms: state.alarms?.filter((a) => !a.resolved).length || 0,
    },
    license: state.license || null,
    stack: [
      { name: 'Node.js', detail: 'Runtime server (ESM)' },
      { name: 'Express', detail: 'REST API & static' },
      { name: 'Leaflet', detail: 'Peta interaktif & animasi SVG' },
      { name: 'Vanilla JS', detail: 'SPA tanpa build step' },
      { name: 'Server-Sent Events', detail: 'Realtime alarm & fault' },
      { name: 'JSON Store', detail: 'Database lokal atomik' },
    ],
    modules: [
      { icon: 'map', title: 'Live Map', text: 'Basemap, layer aset, animasi aliran data, lokasi saya, dan koordinat.' },
      { icon: 'alert-triangle', title: 'POSGIS Fault Locator', text: 'Konversi jarak OTDR menjadi titik putus dan alarm otomatis.' },
      { icon: 'network', title: 'Manajemen Aset', text: 'POP, router, server, OLT, ODC, ODP, ONT, dan joint closure.' },
      { icon: 'cable', title: 'Kabel & Rute', text: 'Backbone, feeder, distribusi, drop dengan panjang geodesic.' },
      { icon: 'router', title: 'Integrasi Perangkat', text: 'GenieACS, OLT HiOSO multi-vendor, dan MikroTik RouterOS.' },
      { icon: 'swap', title: 'Import / Export', text: 'KML, KMZ, GeoJSON, dan CSV dengan pratinjau dry-run.' },
      { icon: 'key', title: 'Lisensi & Pembayaran', text: 'Harga kustom, QRIS, transfer bank, VA, e-wallet, dan retail.' },
      { icon: 'shield', title: 'Keamanan & Peran', text: 'JWT, role superadmin/admin/operator/viewer, audit log.' },
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
  };
}

function uptimeLabel(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days} hari ${hours} jam`;
  if (hours) return `${hours} jam ${minutes} menit`;
  return `${minutes} menit`;
}

function statCard(label, value, iconName) {
  return `<div class="about-stat">
    <span class="about-stat__icon">${icon(iconName)}</span>
    <div><b>${esc(value)}</b><span>${esc(label)}</span></div>
  </div>`;
}

function heroMarkup(app, license) {
  const active = Boolean(license?.active);
  return `<section class="about-hero">
    <div class="about-hero__brand">
      <span class="about-logo">${icon('logo')}</span>
      <div>
        <span class="about-kicker">${esc(app.company)}</span>
        <h1>${esc(app.name)}</h1>
        <p class="about-tagline">${esc(app.tagline)}</p>
      </div>
    </div>
    <p class="about-desc">${esc(app.description)}</p>
    <div class="about-badges">
      <span class="pill pill--accent">${icon('rocket')} v${esc(app.version)}</span>
      <span class="pill ${active ? 'pill--ok' : 'pill--warn'}">${icon('key')} ${active ? 'Lisensi aktif' : 'Lisensi belum aktif'}</span>
      <span class="pill pill--info">${icon('server')} Self-hosted</span>
      <span class="pill pill--lime">${icon('globe')} ${esc(app.location)}</span>
    </div>
    <div class="about-actions">
      <button type="button" class="btn btn-primary btn-sm" data-about-license>${icon('key')} Kelola lisensi</button>
      <button type="button" class="btn btn-soft btn-sm" data-about-copy>${icon('copy')} Salin info sistem</button>
      <button type="button" class="btn btn-sm" data-about-map>${icon('map')} Buka live map</button>
    </div>
  </section>`;
}

function runtimeMarkup(info) {
  const rt = info.runtime;
  const status = info.license || {};
  const rows = rt
    ? [
        ['Node.js', rt.node || '—'],
        ['Platform', `${rt.platform || '—'} / ${rt.arch || '—'}`],
        ['Uptime server', uptimeLabel(rt.uptimeSec)],
        ['Memori (RSS)', `${fmt.num(rt.memoryMB || 0)} MB`],
        ['Waktu server', fmt.datetime(rt.serverTime)],
        ['Direktori data', rt.dataDir || '—'],
      ]
    : [['Runtime', 'Tidak tersedia (mode offline)']];
  return `<section class="about-card">
    <div class="about-card__head">${icon('server')}<h3>Runtime &amp; server</h3></div>
    <div class="about-meta">
      ${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b class="${k === 'Direktori data' ? 'mono about-path' : ''}">${esc(v)}</b></div>`).join('')}
    </div>
    <div class="about-divider"></div>
    <div class="about-meta about-meta--license">
      <div><span>Paket lisensi</span><b>${esc(status.planLabel || status.plan || 'Trial')}</b></div>
      <div><span>Status</span><b class="${status.active ? 'text-ok' : 'text-warn'}">${status.active ? 'AKTIF' : 'TIDAK AKTIF'}</b></div>
      <div><span>Kuota node</span><b>${fmt.num(status.nodeCount || 0)} / ${fmt.num(status.maxNodes || 0)}</b></div>
      <div><span>Berakhir</span><b>${status.expiresAt ? fmt.date(status.expiresAt) : '—'}</b></div>
    </div>
  </section>`;
}

function statsMarkup(stats) {
  return `<section class="about-stats">
    ${statCard('Project', fmt.num(stats.projects || 0), 'git-branch')}
    ${statCard('Node jaringan', fmt.num(stats.nodes || 0), 'network')}
    ${statCard('Kabel & rute', fmt.num(stats.cables || 0), 'cable')}
    ${statCard('Gangguan aktif', fmt.num(stats.activeFaults || 0), 'alert-triangle')}
    ${statCard('Alarm aktif', fmt.num(stats.activeAlarms || 0), 'bell')}
    ${statCard('Pengguna', stats.users == null ? '—' : fmt.num(stats.users), 'user')}
  </section>`;
}

function modulesMarkup(modules) {
  return `<section class="about-card">
    <div class="about-card__head">${icon('grid')}<h3>Modul &amp; kemampuan</h3></div>
    <div class="about-modules">
      ${modules
        .map(
          (m) => `<div class="about-module">
            <span class="about-module__icon">${icon(m.icon || 'box')}</span>
            <div><b>${esc(m.title)}</b><p>${esc(m.text)}</p></div>
          </div>`
        )
        .join('')}
    </div>
  </section>`;
}

function stackMarkup(stack) {
  return `<section class="about-card">
    <div class="about-card__head">${icon('code')}<h3>Teknologi</h3></div>
    <div class="about-stack">
      ${stack.map((s) => `<div class="about-stack__item"><b>${esc(s.name)}</b><span>${esc(s.detail)}</span></div>`).join('')}
    </div>
  </section>`;
}

function contactMarkup(app) {
  return `<section class="about-card">
    <div class="about-card__head">${icon('mail')}<h3>Kontak &amp; dukungan</h3></div>
    <div class="about-contact">
      <a class="about-contact__row" href="${esc(app.website)}" target="_blank" rel="noopener">
        <span class="about-contact__icon">${icon('globe')}</span>
        <div><span>Website</span><b>${esc(app.website)}</b></div>
        ${icon('external')}
      </a>
      <a class="about-contact__row" href="mailto:${esc(app.email)}">
        <span class="about-contact__icon">${icon('mail')}</span>
        <div><span>Email</span><b>${esc(app.email)}</b></div>
        ${icon('arrow-right')}
      </a>
      <a class="about-contact__row" href="tel:${esc(String(app.phone).replace(/[^+\d]/g, ''))}">
        <span class="about-contact__icon">${icon('phone')}</span>
        <div><span>Telepon / WhatsApp</span><b>${esc(app.phone)}</b></div>
        ${icon('arrow-right')}
      </a>
      <div class="about-contact__row about-contact__row--static">
        <span class="about-contact__icon">${icon('pin')}</span>
        <div><span>Kantor</span><b>${esc(app.location)}</b></div>
      </div>
    </div>
    <div class="about-divider"></div>
    <p class="about-muted">Model lisensi: ${esc(app.licenseModel)}. Kunci ditandatangani HMAC-SHA256 dan diverifikasi lokal, tanpa koneksi ke server lisensi eksternal.</p>
  </section>`;
}

function creditsMarkup(credits, shortcuts) {
  return `<section class="about-card">
    <div class="about-card__head">${icon('book')}<h3>Kredit &amp; lisensi pihak ketiga</h3></div>
    <ul class="about-list">${credits.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <div class="about-divider"></div>
    <div class="about-card__head about-card__head--sub">${icon('sparkles')}<h3>Pintasan keyboard</h3></div>
    <div class="about-shortcuts">
      ${shortcuts.map(([keys, text]) => `<div><kbd>${esc(keys)}</kbd><span>${esc(text)}</span></div>`).join('')}
    </div>
    <p class="about-muted">© ${new Date().getFullYear()} lintasJB. Dibangun untuk tim NOC yang mengelola jaringan fiber dari lapangan sampai dashboard.</p>
  </section>`;
}

function systemInfoText(info) {
  const rt = info.runtime || {};
  const l = info.license || {};
  return [
    `${info.app.name} v${info.app.version} — ${info.app.tagline}`,
    `${info.app.company}`,
    `Runtime: Node ${rt.node || '?'} (${rt.platform || '?'}/${rt.arch || '?'})`,
    `Uptime: ${rt.uptimeSec != null ? uptimeLabel(rt.uptimeSec) : 'n/a'} · Memori ${rt.memoryMB || '?'} MB`,
    `Lisensi: ${l.planLabel || l.plan || 'Trial'} (${l.active ? 'aktif' : 'tidak aktif'})`,
    `Data: ${rt.dataDir || 'n/a'}`,
    `Browser: ${navigator.userAgent}`,
  ].join('\n');
}

export async function render(view) {
  view.innerHTML = `<div class="page">
    <div class="about-loading">${icon('clock')}<span>Memuat informasi aplikasi…</span></div>
  </div>`;

  let info;
  try {
    info = await api.get('/about');
  } catch {
    info = fallbackInfo();
  }
  if (!view.isConnected) return;

  const app = info.app || fallbackInfo().app;
  const stats = { ...fallbackInfo().stats, ...(info.stats || {}) };
  const stack = Array.isArray(info.stack) && info.stack.length ? info.stack : fallbackInfo().stack;
  const modules = Array.isArray(info.modules) && info.modules.length ? info.modules : fallbackInfo().modules;
  const credits = Array.isArray(info.credits) && info.credits.length ? info.credits : fallbackInfo().credits;
  const shortcuts = Array.isArray(info.shortcuts) && info.shortcuts.length ? info.shortcuts : fallbackInfo().shortcuts;

  view.innerHTML = `<div class="page about-page">
    ${heroMarkup(app, info.license)}
    ${statsMarkup(stats)}
    <div class="about-grid">
      ${runtimeMarkup(info)}
      ${modulesMarkup(modules)}
      ${stackMarkup(stack)}
      ${contactMarkup(app)}
      ${creditsMarkup(credits, shortcuts)}
    </div>
    <div class="about-foot">
      <span>${icon('shield')} dibuat &amp; dirawat oleh tim lintasJB</span>
      <span class="mono">${esc(app.name)} v${esc(app.version)}</span>
    </div>
  </div>`;

  view.querySelector('[data-about-license]')?.addEventListener('click', () => navigate('settings', { tab: 'license' }));
  view.querySelector('[data-about-map]')?.addEventListener('click', () => navigate('map'));
  view.querySelector('[data-about-copy]')?.addEventListener('click', async () => {
    await copyText(systemInfoText(info));
    toast.success('Info sistem disalin', 'Ringkasan versi, runtime, dan lisensi tersalin ke clipboard.');
  });
}

export default { render };
