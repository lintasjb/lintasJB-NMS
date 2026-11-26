/* lintasJB NMS — Settings, branding, license, users, project */
import * as api from '../api.js';
import { state, availableBasemaps } from '../state.js';
import {
  esc, icon, fmt, toast, errorToast, empty, field, switchRow, confirmDialog, modal,
  copyText, formValues, ROLE_LABEL, statusPill, NODE_TYPES,
} from '../ui.js';
import { requestRefresh } from '../forms.js';
import * as sound from '../sound.js';
import { navigate } from '../router.js';

const TABS = [
  { id: 'branding', label: 'Branding & Logo', icon: 'palette' },
  { id: 'map', label: 'Peta & Basemap', icon: 'map' },
  { id: 'alarm', label: 'Alarm & Suara', icon: 'bell' },
  { id: 'monitor', label: 'Monitoring', icon: 'activity' },
  { id: 'integrations', label: 'Integrasi', icon: 'link' },
  { id: 'license', label: 'Lisensi', icon: 'key' },
  { id: 'users', label: 'Pengguna', icon: 'user', admin: true },
  { id: 'project', label: 'Project', icon: 'git-branch' },
  { id: 'account', label: 'Akun Saya', icon: 'shield' },
];

const PLANS = [
  { value: 'starter', label: 'Starter — 300 node / 12 bulan' },
  { value: 'professional', label: 'Professional — 2.500 node / 12 bulan' },
  { value: 'enterprise', label: 'Enterprise — 100.000 node / 36 bulan' },
  { value: 'trial', label: 'Trial — 200 node / 1 bulan' },
];

const isAdmin = () => ['superadmin', 'admin'].includes(state.user?.role);
const isSuperadmin = () => state.user?.role === 'superadmin';

function sectionHead(title, desc, iconName) {
  return `<div class="settings-section__head"><h3>${icon(iconName)} ${esc(title)}</h3><p>${esc(desc)}</p></div>`;
}

async function saveSettings(patch, message = 'Pengaturan disimpan.') {
  try {
    const res = await api.put('/settings', patch);
    if (res?.settings) state.settings = res.settings;
    toast.success('Tersimpan', res?.message || message);
    requestRefresh();
    return res;
  } catch (err) {
    errorToast(err);
    return null;
  }
}

function colorField(label, name, value) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : '#22d3ee';
  return `<label class="field"><span>${esc(label)}</span>
    <div class="color-input">
      <input type="color" name="${esc(name)}" value="${esc(safe)}" data-color-input />
      <span data-color-label="${esc(name)}" class="mono">${esc(safe)}</span>
    </div>
  </label>`;
}

/* ------------------------------------------------------------------ tabs */

function brandingTab() {
  const b = state.settings.branding || {};
  return `<form id="form-branding" autocomplete="off">
    <section class="settings-section">
      ${sectionHead('Identitas & logo perusahaan', 'Nama, tagline, logo, dan warna aksen yang tampil di seluruh aplikasi.', 'palette')}
      <div class="settings-section__body">
        <div class="logo-upload mb-3">
          <div class="logo-preview"><img src="${esc(b.logo || '/assets/lintasjb-mark.png')}" alt="Logo" id="logo-preview-img" /></div>
          <div class="grow">
            <b style="font-size:12px">Logo perusahaan</b>
            <p class="muted" style="font-size:10.5px;margin-top:2px">PNG, JPG, atau WEBP. Maksimal 3 MB. Disarankan latar transparan dan rasio 1:1.</p>
            <div class="row mt-1">
              <button type="button" class="btn btn-xs btn-soft" data-logo-pick>${icon('upload')} Unggah logo</button>
              <button type="button" class="btn btn-xs btn-ghost" data-logo-reset>${icon('refresh')} Logo bawaan</button>
            </div>
            <input type="file" id="logo-input" class="hidden" accept="image/png,image/jpeg,image/webp" />
          </div>
        </div>
        <div class="form-grid">
          ${field('Nama perusahaan', `<input name="companyName" value="${esc(b.companyName || '')}" placeholder="PT lintasJB Network" required />`)}
          ${field('Nama aplikasi', `<input name="appName" value="${esc(b.appName || '')}" placeholder="lintasJB NMS" required />`)}
          ${field('Tagline', `<input name="tagline" value="${esc(b.tagline || '')}" placeholder="Fiber Network Intelligence" />`)}
          ${field('Footer / catatan', `<input name="footer" value="${esc(b.footer || '')}" placeholder="© 2026 lintasJB" />`)}
          ${colorField('Warna aksen utama', 'accent', b.accent || '#22d3ee')}
          ${colorField('Warna aksen kedua', 'accent2', b.accent2 || '#a3e635')}
        </div>
        <div class="hint mt-2">${icon('info')} Logo akan muncul pada sidebar, halaman login, ikon browser, dan halaman cetak. Warna aksen langsung dipratinjau saat Anda memilih warna.</div>
      </div>
      <div class="settings-section__foot">
        <span class="muted grow" style="font-size:10px">Disimpan di server Anda sendiri.</span>
        <button type="submit" class="btn btn-primary btn-sm">${icon('save')} Simpan branding</button>
      </div>
    </section>
  </form>`;
}

function mapTab() {
  const m = state.settings.map || {};
  const basemaps = availableBasemaps();
  const custom = state.settings.customBasemaps || [];
  return `<form id="form-map" autocomplete="off">
    <section class="settings-section">
      ${sectionHead('Peta & basemap', 'Pilih tampilan dasar peta, posisi awal, dan layer yang aktif.', 'map')}
      <div class="settings-section__body">
        <div class="form-grid">
          <label class="field span-2"><span>Basemap default</span>
            <select name="basemap">${basemaps.map((b) => `<option value="${esc(b.id)}" ${b.id === m.basemap ? 'selected' : ''}>${esc(b.name)}${b.group ? ` · ${esc(b.group)}` : ''}</option>`).join('')}</select>
          </label>
          ${field('Latitude pusat peta', `<input name="centerLat" type="number" step="0.000001" min="-90" max="90" value="${esc(m.center?.[0] ?? -8.2)}" />`)}
          ${field('Longitude pusat peta', `<input name="centerLng" type="number" step="0.000001" min="-180" max="180" value="${esc(m.center?.[1] ?? 114.02)}" />`)}
          <label class="field"><span>Zoom awal</span>
            <div class="range-row"><input type="range" name="zoom" min="2" max="19" step="1" value="${esc(m.zoom ?? 10)}" id="map-zoom-range" /><span class="range-val" id="map-zoom-label">${esc(m.zoom ?? 10)}</span></div>
          </label>
          <div class="field"><span>Lokasi saya</span>
            <button type="button" class="btn btn-soft btn-block" data-map-geo>${icon('navigation')} Gunakan lokasi perangkat</button>
          </div>
        </div>
        <div class="divider"></div>
        <div class="form-grid">
          <div>
            ${switchRow('showLabels', 'Label node', 'Tampilkan nama node di atas marker peta.', m.showLabels !== false)}
            ${switchRow('animate', 'Animasi kabel', 'Aliran data animasi pada seluruh rute fiber.', m.animate !== false)}
          </div>
          <div>
            ${switchRow('showFaults', 'Marker gangguan', 'Tampilkan titik putus dan status kabel bermasalah.', m.showFaults !== false)}
            ${switchRow('showGrid', 'Grid peta', 'Tampilkan grid koordinat pada peta.', Boolean(m.showGrid))}
          </div>
        </div>
      </div>
      <div class="settings-section__foot">
        <span class="muted grow" style="font-size:10px">${basemaps.length} basemap tersedia termasuk ${custom.length} kustom.</span>
        <button type="submit" class="btn btn-primary btn-sm">${icon('save')} Simpan peta</button>
      </div>
    </section>
  </form>
  <section class="settings-section">
    ${sectionHead('Basemap kustom', 'Tambahkan tile server XYZ milik Anda sendiri (mis. MapTiler, Stadia, atau server internal).', 'layers')}
    <div class="settings-section__body">
      ${custom.length ? `<div class="user-list mb-2">${custom.map((b) => `<div class="user-row">
        <span class="cell-icon">${icon('layers')}</span>
        <div class="user-row__info"><b>${esc(b.name)}</b><span class="truncate">${esc(b.url || 'URL belum diisi')}</span></div>
        <span class="pill ${b.enabled !== false ? 'pill--ok' : ''}">${b.enabled !== false ? 'AKTIF' : 'OFF'}</span>
        <button class="icon-btn" data-custom-del="${esc(b.id)}" title="Hapus">${icon('trash')}</button>
      </div>`).join('')}</div>` : empty('layers', 'Belum ada basemap kustom', 'Tambahkan URL tile XYZ di bawah untuk memperbanyak pilihan basemap.')}
      <div class="form-grid">
        ${field('Nama basemap', '<input name="customName" placeholder="Citra Satelit Internal" />')}
        ${field('Atribusi', '<input name="customAttribution" placeholder="© Perusahaan Anda" />')}
        <label class="field span-2"><span>URL tile XYZ</span><input name="customUrl" placeholder="https://tile.example.com/{z}/{x}/{y}.png" /></label>
      </div>
      <div class="row mt-2">
        <button type="button" class="btn btn-soft btn-sm" data-custom-add>${icon('plus')} Tambahkan basemap</button>
        <span class="muted" style="font-size:10px">Maksimal 10 basemap kustom. Gunakan placeholder {z}, {x}, {y}.</span>
      </div>
    </div>
  </section>`;
}

function alarmTab() {
  const a = state.settings.alarm || {};
  return `<form id="form-alarm" autocomplete="off">
    <section class="settings-section">
      ${sectionHead('Alarm & suara', 'Atur pola sirene, volume, dan pemicu suara saat gangguan terdeteksi.', 'bell')}
      <div class="settings-section__body">
        <div class="form-grid">
          <label class="field"><span>Pola suara</span>
            <select name="pattern">
              ${[['siren', 'Sirene (naik-turun)'], ['beep', 'Beep digital'], ['pulse', 'Pulse cepat'], ['alarm', 'Alarm klasik']].map(([v, l]) => `<option value="${v}" ${a.pattern === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Pengulangan</span><input name="repeat" type="number" min="1" max="20" value="${esc(a.repeat ?? 3)}" /></label>
          <label class="field span-2"><span>Volume</span>
            <div class="range-row"><input type="range" name="volume" min="0" max="1" step="0.05" value="${esc(a.volume ?? 0.55)}" id="alarm-volume" /><span class="range-val" id="alarm-volume-label">${Math.round((Number(a.volume) || 0.55) * 100)}%</span></div>
          </label>
        </div>
        <div class="divider"></div>
        <div class="form-grid">
          <div>
            ${switchRow('enabled', 'Aktifkan alarm suara', 'Sirene berbunyi otomatis saat event realtime masuk.', a.enabled !== false)}
            ${switchRow('onFault', 'Kabel putus', 'Bunyikan alarm saat fault locator mendeteksi kabel putus.', a.onFault !== false)}
          </div>
          <div>
            ${switchRow('onDevice', 'Perangkat offline', 'Bunyikan alarm saat OLT, router, atau perangkat bermasalah.', a.onDevice !== false)}
            ${switchRow('onCable', 'Perubahan kabel', 'Sertakan event perubahan status kabel pada alarm.', a.onCable !== false)}
          </div>
        </div>
        <div class="hint mt-2">${icon('volume')} Browser mensyaratkan interaksi pengguna sebelum audio dapat diputar. Klik tombol tes di bawah sekali untuk membuka izin audio.</div>
      </div>
      <div class="settings-section__foot">
        <button type="button" class="btn btn-soft btn-sm" data-test-sound>${icon('play')} Tes suara</button>
        <button type="submit" class="btn btn-primary btn-sm">${icon('save')} Simpan alarm</button>
      </div>
    </section>
  </form>`;
}

function monitorTab() {
  const m = state.settings.monitor || {};
  const last = state.integrations?.lastMonitorAt;
  const error = state.integrations?.monitorError;
  return `<form id="form-monitor" autocomplete="off">
    <section class="settings-section">
      ${sectionHead('Monitoring otomatis', 'Polling GenieACS, OLT, dan router untuk mendeteksi perangkat offline.', 'activity')}
      <div class="settings-section__body">
        <div class="form-grid">
          <label class="field"><span>Interval polling (detik)</span><input name="intervalSec" type="number" min="30" max="3600" value="${esc(m.intervalSec ?? 180)}" /></label>
          <label class="field"><span>Offline setelah (detik)</span><input name="offlineAfterSec" type="number" min="60" max="86400" value="${esc(m.offlineAfterSec ?? 600)}" /></label>
        </div>
        <div class="divider"></div>
        <div class="form-grid">
          <div>
            ${switchRow('enabled', 'Monitoring aktif', 'Jalankan polling otomatis sesuai interval.', m.enabled !== false)}
            ${switchRow('autoCableFault', 'Fault kabel otomatis', 'Buat gangguan kabel saat perangkat hilang dari jaringan.', m.autoCableFault !== false)}
          </div>
          <div>
            ${switchRow('autoCreateOnt', 'Buat ONT otomatis', 'Tambahkan node ONT baru dari perangkat GenieACS yang belum terdaftar.', Boolean(m.autoCreateOnt))}
            <div class="status-line mt-2" style="font-size:10.5px"><span class="dot ${error ? 'dot--err' : 'dot--ok'}"></span> ${error ? `Error: ${esc(error)}` : `Poll terakhir: ${last ? fmt.datetime(last) : 'belum pernah'}`}</div>
          </div>
        </div>
        <div class="hint mt-2">${icon('info')} Monitoring berjalan di server. Perubahan interval berlaku setelah disimpan. Untuk data ONU/OLT terbaru, gunakan tombol sinkronisasi di halaman Perangkat.</div>
      </div>
      <div class="settings-section__foot">
        <button type="button" class="btn btn-soft btn-sm" data-run-monitor>${icon('refresh')} Jalankan sekarang</button>
        <button type="submit" class="btn btn-primary btn-sm">${icon('save')} Simpan monitoring</button>
      </div>
    </section>
  </form>`;
}

function integrationsTab() {
  const g = state.settings.integrations?.genieacs || {};
  const olts = state.integrations?.olts || [];
  const routers = state.integrations?.routers || [];
  return `<form id="form-genieacs" autocomplete="off">
    <section class="settings-section">
      ${sectionHead('GenieACS NBI', 'Hubungkan TR-069 ACS melalui REST NBI untuk membaca dan mengelola ONT/CPE.', 'globe')}
      <div class="settings-section__body">
        <div class="form-grid">
          ${field('URL GenieACS NBI', `<input name="url" value="${esc(g.url || '')}" placeholder="http://10.10.10.5:7557" />`)}
          ${field('Username', `<input name="username" value="${esc(g.username || '')}" placeholder="admin" autocomplete="off" />`)}
          ${field('Password', `<input name="password" type="password" placeholder="${g.hasPassword ? '•••••••• (tersimpan)' : 'Belum diatur'}" autocomplete="new-password" />`)}
          <label class="check" style="align-self:end;margin-bottom:9px"><input type="checkbox" name="clearPassword" /><span>Hapus password tersimpan</span></label>
          ${field('Polling (detik)', `<input name="pollSeconds" type="number" min="30" max="3600" value="${esc(g.pollSeconds ?? 180)}" />`)}
          ${field('Offline setelah (detik)', `<input name="offlineAfterSec" type="number" min="60" max="86400" value="${esc(g.offlineAfterSec ?? 600)}" />`)}
        </div>
        ${switchRow('enabled', 'Aktifkan integrasi GenieACS', 'Cache perangkat dan fault GenieACS akan diperbarui otomatis.', Boolean(g.enabled))}
        <div class="hint mt-2">${icon('shield')} Password disimpan terenkripsi di server. Gunakan tombol tes untuk memverifikasi koneksi NBI sebelum menyimpan.</div>
      </div>
      <div class="settings-section__foot">
        <button type="button" class="btn btn-soft btn-sm" data-test-genie>${icon('link')} Tes koneksi</button>
        <button type="submit" class="btn btn-primary btn-sm">${icon('save')} Simpan integrasi</button>
      </div>
    </section>
  </form>
  <section class="settings-section">
    ${sectionHead('OLT & router', 'Kelola kredensial perangkat multi-vendor di halaman Perangkat.', 'router')}
    <div class="settings-section__body">
      <div class="integration-list">
        <div class="integration-row">
          <div class="int-ico">${icon('radio')}</div>
          <div class="int-info"><b>OLT multi-vendor</b><span>${olts.length ? olts.map((o) => `${o.name} (${o.vendor || 'generic'})`).join(' · ') : 'Belum ada OLT terdaftar'}</span></div>
          <div class="int-meta"><b>${olts.length} OLT</b><span>${olts.filter((o) => o.lastResult?.ok).length} OK</span></div>
        </div>
        <div class="integration-row">
          <div class="int-ico">${icon('router')}</div>
          <div class="int-info"><b>MikroTik RouterOS</b><span>${routers.length ? routers.map((r) => r.name).join(' · ') : 'Belum ada router terdaftar'}</span></div>
          <div class="int-meta"><b>${routers.length} router</b><span>${routers.filter((r) => r.lastResult?.ok).length} OK</span></div>
        </div>
      </div>
      <div class="row mt-2">
        <button type="button" class="btn btn-soft btn-sm" data-go-devices>${icon('router')} Buka halaman Perangkat</button>
        <span class="muted" style="font-size:10px">Mendukung HiOSO EPON/GPON, Huawei, ZTE, FiberHome, Nokia, VSOL, dan RouterOS v7 REST.</span>
      </div>
    </div>
  </section>`;
}

function licenseTab() {
  const l = state.license || {};
  const features = Array.isArray(l.features) ? l.features : [];
  const key = state.licenseKey || '';
  const usage = Number(l.usagePercent) || 0;
  return `<div class="settings-content" style="gap:14px">
    <section class="settings-section">
      ${sectionHead('Lisensi aktif', 'Lisensi kustom ditandatangani HMAC dan mengikat kuota node serta fitur.', 'key')}
      <div class="settings-section__body">
        <div class="license-panel">
          <div class="license-panel__top">
            <div>
              <div class="license-plan">${esc(l.planLabel || l.plan || 'Trial')}</div>
              <div class="license-customer">${esc(l.customer || 'lintasJB Demo')} · ID ${esc(l.id || '—')}</div>
            </div>
            <span class="pill ${l.active ? 'pill--ok' : 'pill--danger'}">${l.active ? 'AKTIF' : 'TIDAK AKTIF'}</span>
          </div>
          <div class="license-grid">
            <div><span>Node terpakai</span><b>${fmt.num(l.nodeCount || 0)} / ${fmt.num(l.maxNodes || 0)}</b></div>
            <div><span>Berlaku sampai</span><b>${l.expiresAt ? fmt.date(l.expiresAt) : '—'}</b></div>
            <div><span>Sisa hari</span><b class="${Number(l.daysLeft) <= 7 ? 'text-warn' : ''}">${l.daysLeft ?? '—'} hari</b></div>
          </div>
          <div class="usage-bar"><i style="width:${Math.min(100, usage)}%"></i></div>
          <div class="row row--between mt-1" style="font-size:9.5px;color:var(--dim)"><span>Utilisasi kuota node</span><span>${usage}%</span></div>
          ${features.length ? `<div class="feature-chips">${features.map((f) => `<span class="feature-chip">${esc(f)}</span>`).join('')}</div>` : ''}
        </div>
        ${key ? `<div class="mt-2"><div class="row row--between mb-1"><b style="font-size:11px">Kunci lisensi</b><button class="link-btn" data-copy-license>${icon('copy')} Salin</button></div><div class="license-key" id="license-key">${esc(key)}</div></div>` : ''}
        ${l.reason ? `<div class="hint hint--warn mt-2">${icon('alert-triangle')} ${esc(l.reason)}</div>` : ''}
      </div>
    </section>

    <section class="settings-section">
      ${sectionHead('Aktivasi lisensi', 'Tempel kunci lisensi yang Anda terima untuk memperbarui paket.', 'shield')}
      <div class="settings-section__body">
        <form id="form-license" autocomplete="off">
          <label class="field"><span>Pelanggan tujuan</span><select name="customerId" id="license-activate-customer" data-placeholder="Lisensi utama / akun saya"><option value="">Lisensi utama / akun saya</option></select></label>
          <label class="field mt-2"><span>Kunci lisensi</span><textarea name="key" rows="3" placeholder="LJB1.eyJ...tanda-tangan" spellcheck="false"></textarea></label>
          <div class="row mt-2"><button type="submit" class="btn btn-primary btn-sm">${icon('check')} Aktivasi lisensi</button><span class="muted" style="font-size:10px">Kunci diverifikasi secara lokal di server.</span></div>
        </form>
      </div>
    </section>

    ${isAdmin() ? `<section class="settings-section">
      ${sectionHead('Generate lisensi', 'Buat kunci lisensi baru untuk pelanggan. Hanya tersedia untuk administrator.', 'database')}
      <div class="settings-section__body">
        <form id="form-license-generate" autocomplete="off">
          <div class="form-grid">
            ${field('Pelanggan', '<select name="customerId" id="license-customer" data-placeholder="— Pilih pelanggan terdaftar —"><option value="">— Pilih pelanggan terdaftar —</option></select>', 'Pilih akun yang akan diperpanjang; lisensi aktif akan melekat pada akun tersebut.')}
            ${field('Nama pelanggan (opsional)', '<input name="customer" placeholder="Diisi bila bukan akun terdaftar" />')}
            <label class="field"><span>Paket</span><select name="plan">${PLANS.map((p) => `<option value="${p.value}">${esc(p.label)}</option>`).join('')}</select></label>
            ${field('Masa berlaku (bulan)', '<input name="months" type="number" min="1" max="120" value="12" />')}
            ${field('Kuota node', '<input name="maxNodes" type="number" min="1" max="100000" value="2500" />')}
          </div>
          <label class="check mt-2"><input type="checkbox" name="activate" checked /><span>Aktifkan lisensi ini sekarang</span></label>
          <div class="row mt-2"><button type="submit" class="btn btn-soft btn-sm">${icon('key')} Generate kunci</button></div>
        </form>
        <div id="license-generate-result"></div>
      </div>
    </section>` : ''}

    <section class="settings-section">
      ${sectionHead('Beli / perpanjang lisensi', 'Tentukan harga sendiri, pilih paket dan metode pembayaran. Tagihan dibuat di server; lisensi aktif setelah pembayaran diverifikasi.', 'credit-card')}
      <div class="settings-section__body" id="billing-slot">${empty('clock', 'Memuat metode pembayaran…')}</div>
    </section>
  </div>`;
}

function usersTab() {
  if (!isAdmin()) {
    return `<section class="settings-section">${sectionHead('Pengguna', 'Manajemen pengguna hanya tersedia untuk administrator.', 'user')}
      <div class="settings-section__body">${empty('lock', 'Akses terbatas', 'Hubungi administrator untuk mengelola pengguna.')}</div>
    </section>`;
  }
  return `<section class="settings-section">
    ${sectionHead('Pengguna aplikasi', 'Atur role dan status akun. Pendaftaran akun baru tersedia dari halaman login.', 'user')}
    <div class="settings-section__body" id="users-slot">${empty('clock', 'Memuat pengguna…')}</div>
  </section>`;
}

function projectTab() {
  const p = state.project || {};
  const projects = state.projects || [];
  const center = p.center || state.settings.map?.center || [-8.2, 114.02];
  return `<form id="form-project" autocomplete="off">
    <section class="settings-section">
      ${sectionHead('Project aktif', 'Ubah identitas dan posisi awal peta untuk project yang sedang dibuka.', 'git-branch')}
      <div class="settings-section__body">
        <div class="form-grid">
          ${field('Nama project', `<input name="name" value="${esc(p.name || '')}" required />`)}
          ${field('Kode project', `<input name="code" value="${esc(p.code || '')}" placeholder="JBR-BWI" />`)}
          <label class="field span-2"><span>Deskripsi</span><textarea name="description" rows="2" placeholder="Cakupan jaringan FTTH project ini.">${esc(p.description || '')}</textarea></label>
          ${field('Latitude pusat', `<input name="centerLat" type="number" step="0.000001" value="${esc(center[0])}" />`)}
          ${field('Longitude pusat', `<input name="centerLng" type="number" step="0.000001" value="${esc(center[1])}" />`)}
          ${field('Zoom', `<input name="zoom" type="number" min="2" max="22" value="${esc(p.zoom || 10)}" />`)}
          <label class="field"><span>Status</span><select name="status">
            ${['active', 'planned', 'archived'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></label>
        </div>
        <div class="hint mt-2">${icon('info')} ${fmt.num(p.nodeCount ?? state.nodes.length)} node · ${fmt.num(p.cableCount ?? state.cables.length)} kabel · dibuat ${esc(fmt.date(p.createdAt))}</div>
      </div>
      <div class="settings-section__foot">
        ${isAdmin() && projects.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm text-danger" data-project-delete="${esc(p.id)}">${icon('trash')} Hapus project</button>` : ''}
        <span class="grow"></span>
        <button type="submit" class="btn btn-primary btn-sm">${icon('save')} Simpan project</button>
      </div>
    </section>
  </form>

  <section class="settings-section">
    ${sectionHead('Daftar project', 'Buka, duplikasi, atau buat project baru untuk area jaringan lain.', 'layers')}
    <div class="settings-section__body">
      <div class="user-list">
        ${projects.map((item) => `<div class="user-row">
          <span class="cell-icon">${icon('git-branch')}</span>
          <div class="user-row__info"><b>${esc(item.name)}</b><span>${esc(item.code || item.id)} · ${fmt.num(item.nodeCount || 0)} node · ${fmt.num(item.cableCount || 0)} kabel</span></div>
          ${item.id === state.projectId ? '<span class="pill pill--accent">DIBUKA</span>' : ''}
          <button class="btn btn-xs btn-soft" data-project-open="${esc(item.id)}">Buka</button>
          <button class="icon-btn" data-project-dup="${esc(item.id)}" title="Duplikasi">${icon('copy')}</button>
        </div>`).join('')}
      </div>
      <div class="divider"></div>
      <b style="font-size:11.5px">Project baru</b>
      <div class="form-grid mt-2" id="project-create-grid">
        ${field('Nama project', '<input name="newName" placeholder="Jaringan FTTH Surabaya" />')}
        ${field('Kode', '<input name="newCode" placeholder="SBY-01" />')}
      </div>
      <div class="row mt-2">
        <button type="button" class="btn btn-soft btn-sm" data-project-create>${icon('plus')} Buat project</button>
        <span class="muted" style="font-size:10px">Project baru dimulai kosong. Gunakan duplikasi untuk menyalin topologi.</span>
      </div>
    </div>
  </section>`;
}

function accountTab() {
  const u = state.user || {};
  return `<div class="settings-content" style="gap:14px">
    <section class="settings-section">
      ${sectionHead('Profil akun', 'Informasi akun yang tampil pada aktivitas dan audit log.', 'user')}
      <div class="settings-section__body">
        <form id="form-profile" autocomplete="off">
          <div class="form-grid">
            ${field('Nama lengkap', `<input name="name" value="${esc(u.name || '')}" required />`)}
            ${field('Perusahaan', `<input name="company" value="${esc(u.company || '')}" />`)}
            ${field('Nomor telepon', `<input name="phone" value="${esc(u.phone || '')}" placeholder="08xxxxxxxxxx" />`)}
            <label class="field"><span>Email</span><input value="${esc(u.email || '')}" disabled /></label>
            <label class="field"><span>Role</span><input value="${esc(ROLE_LABEL[u.role] || u.role || '')}" disabled /></label>
            <label class="field"><span>Status akun</span><input value="${esc(u.status === 'disabled' ? 'Nonaktif' : 'Aktif')}" disabled /></label>
          </div>
          <div class="row mt-2"><button type="submit" class="btn btn-primary btn-sm">${icon('save')} Simpan profil</button></div>
        </form>
      </div>
    </section>
    <section class="settings-section">
      ${sectionHead('Keamanan', 'Ganti password secara berkala. Minimal 8 karakter dengan huruf dan angka.', 'lock')}
      <div class="settings-section__body">
        <form id="form-password" autocomplete="off">
          <div class="form-grid">
            ${field('Password saat ini', '<input name="currentPassword" type="password" required autocomplete="current-password" />')}
            ${field('Password baru', '<input name="newPassword" type="password" required autocomplete="new-password" />')}
            ${field('Ulangi password baru', '<input name="confirmPassword" type="password" required autocomplete="new-password" />', 'Minimal 8 karakter, kombinasi huruf dan angka.')}
          </div>
          <div class="row mt-2"><button type="submit" class="btn btn-soft btn-sm">${icon('shield')} Ubah password</button></div>
        </form>
      </div>
    </section>
  </div>`;
}

function sectionFor(tab) {
  switch (tab) {
    case 'branding': return brandingTab();
    case 'map': return mapTab();
    case 'alarm': return alarmTab();
    case 'monitor': return monitorTab();
    case 'integrations': return integrationsTab();
    case 'license': return licenseTab();
    case 'users': return usersTab();
    case 'project': return projectTab();
    case 'account': return accountTab();
    default: return brandingTab();
  }
}

/* ------------------------------------------------------------------ bindings */

function bindBranding(content, view) {
  const form = content.querySelector('#form-branding');
  if (!form) return;
  const logoInput = content.querySelector('#logo-input');
  const previewImg = content.querySelector('#logo-preview-img');

  content.querySelector('[data-logo-pick]')?.addEventListener('click', () => logoInput?.click());
  logoInput?.addEventListener('change', async () => {
    const file = logoInput.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Format logo salah', 'Gunakan PNG, JPG, atau WEBP.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Logo terlalu besar', 'Maksimal 3 MB.');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    if (previewImg) previewImg.src = localUrl;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const res = await api.upload('/settings/logo', fd);
      toast.success('Logo diperbarui', 'Logo perusahaan berhasil diunggah.');
      if (previewImg) previewImg.src = res.logo || localUrl;
      requestRefresh();
    } catch (err) {
      errorToast(err);
      if (previewImg) previewImg.src = state.settings.branding?.logo || '/assets/lintasjb-mark.png';
    } finally {
      setTimeout(() => URL.revokeObjectURL(localUrl), 5000);
      logoInput.value = '';
    }
  });

  content.querySelector('[data-logo-reset]')?.addEventListener('click', async () => {
    try {
      const res = await api.post('/settings/logo/reset', {});
      toast.success('Logo direset', 'Logo bawaan lintasJB digunakan kembali.');
      if (previewImg) previewImg.src = res.logo || '/assets/lintasjb-mark.png';
      requestRefresh();
    } catch (err) {
      errorToast(err);
    }
  });

  content.querySelectorAll('[data-color-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const label = content.querySelector(`[data-color-label="${input.name}"]`);
      if (label) label.textContent = input.value;
      document.documentElement.style.setProperty(input.name === 'accent' ? '--accent' : '--accent-2', input.value);
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(form);
    await saveSettings({
      branding: {
        companyName: values.companyName,
        appName: values.appName,
        tagline: values.tagline,
        footer: values.footer,
        accent: values.accent,
        accent2: values.accent2,
      },
    }, 'Branding perusahaan disimpan.');
  });
}

function bindMap(content, view) {
  const form = content.querySelector('#form-map');
  if (!form) return;
  const zoom = form.querySelector('#map-zoom-range');
  const zoomLabel = form.querySelector('#map-zoom-label');
  zoom?.addEventListener('input', () => {
    if (zoomLabel) zoomLabel.textContent = zoom.value;
  });

  form.querySelector('[data-map-geo]')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation tidak tersedia', 'Browser Anda tidak mendukung pembacaan lokasi.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.querySelector('[name="centerLat"]').value = pos.coords.latitude.toFixed(6);
        form.querySelector('[name="centerLng"]').value = pos.coords.longitude.toFixed(6);
        toast.success('Lokasi diterapkan', 'Koordinat pusat peta diisi dari lokasi perangkat.');
      },
      (err) => toast.error('Gagal membaca lokasi', err.message),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(form);
    await saveSettings({
      map: {
        basemap: values.basemap,
        center: [Number(values.centerLat), Number(values.centerLng)],
        zoom: Number(values.zoom),
        showLabels: values.showLabels,
        animate: values.animate,
        showFaults: values.showFaults,
        showGrid: values.showGrid,
      },
    }, 'Pengaturan peta disimpan.');
  });

  const customName = content.querySelector('[name="customName"]');
  const customUrl = content.querySelector('[name="customUrl"]');
  const customAttr = content.querySelector('[name="customAttribution"]');

  content.querySelector('[data-custom-add]')?.addEventListener('click', async () => {
    const name = customName?.value.trim();
    const url = customUrl?.value.trim();
    if (!name) {
      toast.warn('Nama basemap wajib', 'Isi nama basemap terlebih dahulu.');
      return;
    }
    if (!/^https?:\/\//i.test(url || '')) {
      toast.warn('URL tidak valid', 'URL tile harus diawali http:// atau https://.');
      return;
    }
    const list = [...(state.settings.customBasemaps || []), {
      id: `custom-${Date.now()}`,
      name,
      url,
      attribution: customAttr?.value.trim() || 'Custom',
      enabled: true,
    }];
    const res = await saveSettings({ customBasemaps: list }, 'Basemap kustom ditambahkan.');
    if (res) {
      if (customName) customName.value = '';
      if (customUrl) customUrl.value = '';
      if (customAttr) customAttr.value = '';
    }
  });

  content.querySelectorAll('[data-custom-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const list = (state.settings.customBasemaps || []).filter((b) => b.id !== btn.dataset.customDel);
      await saveSettings({ customBasemaps: list }, 'Basemap kustom dihapus.');
    });
  });
}

function bindAlarm(content) {
  const form = content.querySelector('#form-alarm');
  if (!form) return;
  const volume = form.querySelector('#alarm-volume');
  const label = form.querySelector('#alarm-volume-label');
  volume?.addEventListener('input', () => {
    if (label) label.textContent = `${Math.round(Number(volume.value) * 100)}%`;
  });

  form.querySelector('[data-test-sound]')?.addEventListener('click', () => {
    const values = formValues(form);
    sound.unlock();
    sound.play(values.pattern, Number(values.volume) || 0.55, Number(values.repeat) || 3);
    toast.info('Tes suara', `Memutar pola ${values.pattern} selama beberapa detik.`);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(form);
    await saveSettings({
      alarm: {
        enabled: values.enabled,
        pattern: values.pattern,
        repeat: Number(values.repeat),
        volume: Number(values.volume),
        onFault: values.onFault,
        onDevice: values.onDevice,
        onCable: values.onCable,
      },
    }, 'Pengaturan alarm disimpan.');
  });
}

function bindMonitor(content) {
  const form = content.querySelector('#form-monitor');
  if (!form) return;
  form.querySelector('[data-run-monitor]')?.addEventListener('click', async () => {
    try {
      toast.info('Monitor berjalan', 'Polling perangkat sedang dijalankan di server.');
      const result = await api.integration.runMonitor();
      toast.success('Monitor selesai', result.message || 'Status perangkat diperbarui.');
      requestRefresh();
    } catch (err) {
      errorToast(err);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(form);
    await saveSettings({
      monitor: {
        enabled: values.enabled,
        intervalSec: Number(values.intervalSec),
        offlineAfterSec: Number(values.offlineAfterSec),
        autoCableFault: values.autoCableFault,
        autoCreateOnt: values.autoCreateOnt,
      },
    }, 'Pengaturan monitoring disimpan.');
  });
}

function bindIntegrations(content) {
  const form = content.querySelector('#form-genieacs');
  if (!form) return;

  const payload = () => {
    const values = formValues(form);
    const genieacs = {
      enabled: values.enabled,
      url: values.url,
      username: values.username,
      pollSeconds: Number(values.pollSeconds),
      offlineAfterSec: Number(values.offlineAfterSec),
      clearPassword: Boolean(values.clearPassword),
    };
    if (values.password) genieacs.password = values.password;
    return genieacs;
  };

  form.querySelector('[data-test-genie]')?.addEventListener('click', async () => {
    const values = formValues(form);
    if (!values.url) {
      toast.warn('URL belum diisi', 'Masukkan URL GenieACS NBI terlebih dahulu.');
      return;
    }
    try {
      toast.info('Menguji GenieACS', 'Menghubungi endpoint NBI…');
      const result = await api.integration.genieacsTest({
        url: values.url,
        username: values.username,
        password: values.password || undefined,
      });
      toast.success('GenieACS terhubung', result.message || 'Koneksi NBI berhasil.');
    } catch (err) {
      errorToast(err);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveSettings({ integrations: { genieacs: payload() } }, 'Integrasi GenieACS disimpan.');
  });

  content.querySelector('[data-go-devices]')?.addEventListener('click', () => navigate('devices'));
}

/* ------------------------------------------------- billing / checkout ---- */

// Menjaga invoice yang sedang dibuka agar tidak hilang saat halaman di-refresh
// oleh event SSE / requestRefresh setelah pembayaran diverifikasi.
let billingCache = { orderId: null, methodId: null };

const ORDER_STATUS = {
  pending: { label: 'MENUNGGU BAYAR', cls: 'pill--warn' },
  paid: { label: 'LUNAS', cls: 'pill--ok' },
  cancelled: { label: 'DIBATALKAN', cls: 'pill--danger' },
  expired: { label: 'KEDALUWARSA', cls: 'pill--muted' },
};

const orderStatus = (status) => ORDER_STATUS[status] || ORDER_STATUS.pending;

function rupiah(value) {
  return `Rp ${Math.max(0, Math.round(Number(value) || 0)).toLocaleString('id-ID')}`;
}

function feeFor(method, subtotal) {
  if (!method) return 0;
  return method.feeType === 'percent'
    ? Math.round((subtotal * Number(method.feeValue || 0)) / 100)
    : Math.round(Number(method.feeValue) || 0);
}

function groupMethods(methods) {
  const groups = [];
  for (const m of methods) {
    let group = groups.find((g) => g.name === m.group);
    if (!group) {
      group = { name: m.group || 'Lainnya', items: [] };
      groups.push(group);
    }
    group.items.push(m);
  }
  return groups;
}

function billingMarkup(data, selectedId) {
  const methods = (data.methods || []).filter((m) => m.enabled !== false);
  const plans = data.plans || [];
  const suggestions = data.priceSuggestions || {};
  const config = data.config || {};
  const groups = groupMethods(methods);
  const selected = methods.find((m) => m.id === selectedId) || methods[0];
  const planDef = plans.find((p) => p.id === 'professional') || plans[0] || { id: 'professional', months: 12, maxNodes: 2500 };
  const amount = Number(planDef.yearly || suggestions[planDef.id]) || 12000000;
  const customer = state.user?.company || state.settings?.branding?.companyName || state.user?.name || '';
  const email = state.user?.email || '';
  const phone = state.user?.phone || '';

  return `<div class="billing-form">
    <form id="form-order" autocomplete="off" novalidate>
      <div class="form-grid">
        ${field('Nama pelanggan / perusahaan', `<input name="customer" value="${esc(customer)}" placeholder="PT Pelanggan Fiber" required />`)}
        ${field('Email tagihan', `<input name="email" type="email" value="${esc(email)}" placeholder="billing@perusahaan.id" required />`)}
        ${field('No. WhatsApp', `<input name="phone" value="${esc(phone)}" placeholder="0812xxxxxxx" />`)}
        ${field('Paket lisensi', `<select name="plan">${plans.map((p) => {
          const price = Number(p.yearly || p.monthly || suggestions[p.id]) || 0;
          return `<option value="${esc(p.id)}" ${p.id === planDef.id ? 'selected' : ''}>${esc(p.label)} — ${fmt.num(p.maxNodes)} node / ${p.months} bln${price ? ` · ${rupiah(price)}` : ''}</option>`;
        }).join('')}</select>`)}
        ${field('Harga kustom (Rp)', `<input name="amount" type="number" inputmode="numeric" min="10000" max="1000000000" step="1000" value="${amount}" required data-amount />`, 'Bebas menentukan harga, minimal Rp 10.000.')}
        ${field('Masa berlaku (bulan)', `<input name="months" type="number" min="1" max="120" value="${planDef.months}" />`)}
        ${field('Kuota node', `<input name="maxNodes" type="number" min="1" max="100000" value="${planDef.maxNodes}" />`)}
      </div>

      <div class="price-chips">
        <span class="price-chips__label">${icon('sparkles')} Harga cepat</span>
        ${plans.flatMap((p) => {
          const monthly = Number(p.monthly) || 0;
          const yearly = Number(p.yearly || suggestions[p.id]) || 0;
          const chips = [];
          if (monthly) chips.push({ value: monthly, months: 1, label: `${p.label} · ${rupiah(monthly)}/bln` });
          if (yearly) chips.push({ value: yearly, months: p.months || 12, label: `${p.label} · ${rupiah(yearly)}/thn` });
          return chips.map((c) => `<button type="button" class="chip" data-price="${c.value}" data-price-plan="${esc(p.id)}" data-price-months="${c.months}">${esc(c.label)}</button>`);
        }).join('')}
      </div>

      <div class="pay-groups">
        ${groups.map((group) => `<div class="pay-group">
          <div class="pay-group__title">${esc(group.name)}</div>
          <div class="pay-grid">${group.items.map((m) => `<button type="button" class="pay-method${m.id === selected.id ? ' active' : ''}" data-method="${esc(m.id)}">
            <span class="pay-method__icon">${icon(m.icon || 'credit-card')}</span>
            <span class="pay-method__label">${esc(m.label)}</span>
            <span class="pay-method__fee">${m.feeType === 'percent' ? `${m.feeValue}%` : (Number(m.feeValue) ? rupiah(m.feeValue) : 'Gratis')}</span>
          </button>`).join('')}</div>
        </div>`).join('')}
      </div>

      <input type="hidden" name="method" value="${esc(selected.id)}" data-method-input />

      <div class="order-summary" data-summary>
        <div class="order-summary__row"><span>Subtotal lisensi</span><b data-sum-subtotal>—</b></div>
        <div class="order-summary__row"><span>Biaya layanan <span data-sum-method></span></span><b data-sum-fee>—</b></div>
        <div class="order-summary__row order-summary__row--total"><span>Total bayar</span><b data-sum-total>—</b></div>
      </div>

      <div class="row row--between mt-2 billing-actions">
        <span class="muted billing-note">${icon('shield')} Tagihan berlaku 24 jam. Lisensi aktif setelah pembayaran diverifikasi.</span>
        <button type="submit" class="btn btn-primary">${icon('receipt')} Buat tagihan</button>
      </div>
    </form>

    <div id="order-invoice"></div>
    <div id="order-history"></div>

    ${isAdmin() ? `<details class="billing-config">
      <summary>${icon('settings')} Pengaturan merchant, rekening &amp; e-wallet</summary>
      <div class="billing-config__body">
        <form id="form-billing-config" autocomplete="off">
          <div class="form-grid">
            ${field('Nama merchant', `<input name="merchantName" value="${esc(config.merchantName || '')}" />`)}
            ${field('Kota merchant', `<input name="merchantCity" value="${esc(config.merchantCity || '')}" />`)}
            ${field('Email support', `<input name="supportEmail" type="email" value="${esc(config.supportEmail || '')}" />`)}
            ${field('Telepon support', `<input name="supportPhone" value="${esc(config.supportPhone || '')}" />`)}
            ${field('Nomor e-wallet', `<input name="ewalletNumber" value="${esc(config.ewalletNumber || '')}" />`)}
            ${field('Nomor QRIS / merchant ID', `<input name="merchantId" value="${esc(config.merchantId || '')}" />`)}
          </div>
          <div class="form-grid mt-2">
            ${['bca', 'bni', 'bri', 'mandiri'].map((bank) => `<label class="field"><span>Rekening ${bank.toUpperCase()}</span><input name="acc_${bank}_number" value="${esc(config.accounts?.[bank]?.number || '')}" placeholder="Nomor rekening" /></label>
            <label class="field"><span>Atas nama ${bank.toUpperCase()}</span><input name="acc_${bank}_holder" value="${esc(config.accounts?.[bank]?.holder || '')}" placeholder="Nama pemilik rekening" /></label>`).join('')}
          </div>
          <label class="field mt-2"><span>Catatan pembayaran</span><textarea name="note" rows="2">${esc(config.note || '')}</textarea></label>
          <div class="method-settings mt-2">
            <b>Metode pembayaran yang aktif</b>
            <p class="muted" style="font-size:10px">Centang metode yang boleh dipakai pelanggan. Metode yang tidak dicentang akan disembunyikan dari form tagihan.</p>
            ${groupMethods(data.methods || []).map((group) => `<div class="method-settings__group">
              <span>${esc(group.name)}</span>
              <div class="method-settings__grid">${group.items.map((m) => `<label class="method-toggle">
                <input type="checkbox" data-method-toggle value="${esc(m.id)}" ${m.enabled !== false ? 'checked' : ''} />
                <span>${esc(m.label)}</span>
              </label>`).join('')}</div>
            </div>`).join('')}
          </div>
          <div class="row mt-2"><button type="submit" class="btn btn-soft btn-sm">${icon('save')} Simpan data pembayaran</button></div>
        </form>
      </div>
    </details>` : ''}
  </div>`;
}

function invoiceMarkup(order) {
  const status = orderStatus(order.status);
  const token = encodeURIComponent(api.getToken());
  const qr = order.payment?.qr && order.status === 'pending'
    ? `<div class="qris-box"><img src="/api/billing/orders/${encodeURIComponent(order.id)}/qr.png?token=${token}" alt="QRIS ${esc(order.invoiceNo)}" /><span class="qris-note">Scan dengan aplikasi apa pun yang mendukung QRIS</span></div>`
    : '';
  const code = order.payment?.code
    ? `<div class="invoice-code"><span>${order.method === 'qris' ? 'Referensi' : 'Kode bayar'}</span><b class="mono">${esc(order.payment.code)}</b><button type="button" class="btn btn-xs btn-soft" data-copy="${esc(order.payment.code)}">${icon('copy')} Salin</button></div>`
    : '';
  return `<div class="invoice-card" data-order-id="${esc(order.id)}">
    <div class="invoice-card__head">
      <div><div class="invoice-no">${esc(order.invoiceNo)}</div><div class="invoice-sub">${esc(order.methodLabel)} · ${esc(order.totalLabel)}</div></div>
      <span class="pill ${status.cls}">${status.label}</span>
    </div>
    <div class="invoice-grid">
      <div><span>Paket</span><b>${esc(order.planLabel || order.plan)}</b></div>
      <div><span>Masa berlaku</span><b>${fmt.num(order.months)} bulan</b></div>
      <div><span>Kuota node</span><b>${fmt.num(order.maxNodes)} node</b></div>
      <div><span>Subtotal</span><b>${esc(order.subtotalLabel)}</b></div>
      <div><span>Biaya layanan</span><b>${esc(order.feeLabel)}</b></div>
      <div><span>Total</span><b class="invoice-total">${esc(order.totalLabel)}</b></div>
    </div>
    ${qr}${code}
    <ol class="invoice-steps">${(order.instructions || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${order.licenseKey ? `<div><div class="row row--between mb-1"><b style="font-size:11px">Kunci lisensi</b><span class="muted" style="font-size:10px">Lisensi aktif</span></div><div class="license-key">${esc(order.licenseKey)}</div></div>` : ''}
    <div class="row mt-1 invoice-actions">
      <button type="button" class="btn btn-xs btn-soft" data-copy="${esc(order.invoiceNo)}">${icon('copy')} No. invoice</button>
      ${order.licenseKey ? `<button type="button" class="btn btn-xs btn-soft" data-copy="${esc(order.licenseKey)}">${icon('key')} Kunci lisensi</button>` : ''}
      ${isAdmin() && order.status === 'pending' ? `<button type="button" class="btn btn-xs btn-primary" data-pay="${esc(order.id)}">${icon('check')} Verifikasi &amp; aktifkan</button>` : ''}
      ${order.status === 'pending' ? `<button type="button" class="btn btn-xs btn-danger" data-cancel="${esc(order.id)}">${icon('x')} Batalkan</button>` : ''}
    </div>
  </div>`;
}

function historyMarkup(orders) {
  if (!orders?.length) return '';
  return `<div class="order-history">
    <div class="order-history__title">Riwayat tagihan</div>
    ${orders.map((o) => `<button type="button" class="order-row" data-open-order="${esc(o.id)}">
      <span class="order-row__no">${esc(o.invoiceNo)}</span>
      <span class="order-row__meta">${esc(o.methodLabel)} · ${esc(o.totalLabel)} · ${esc(fmt.date(o.createdAt))}</span>
      <span class="pill ${orderStatus(o.status).cls}">${orderStatus(o.status).label}</span>
    </button>`).join('')}
  </div>`;
}

async function bindBilling(content) {
  const slot = content.querySelector('#billing-slot');
  if (!slot) return;

  let data;
  try {
    data = await api.get('/billing/config');
  } catch (err) {
    slot.innerHTML = empty('alert-triangle', 'Gagal memuat pembayaran', err.message);
    return;
  }
  if (!Array.isArray(data.methods) || !data.methods.length) {
    slot.innerHTML = empty('credit-card', 'Belum ada metode pembayaran', 'Hubungi administrator untuk melengkapi data billing.');
    return;
  }

  let selectedId = data.methods.some((m) => m.id === billingCache.methodId)
    ? billingCache.methodId
    : data.methods[0].id;
  let orders = Array.isArray(data.orders)
    ? [...data.orders].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    : [];

  const renderHistory = () => {
    const host = slot.querySelector('#order-history');
    if (host) host.innerHTML = historyMarkup(orders);
  };

  const renderInvoice = (order, { scroll = true } = {}) => {
    const host = slot.querySelector('#order-invoice');
    if (!host) return;
    billingCache.orderId = order.id;
    host.innerHTML = invoiceMarkup(order);
    const idx = orders.findIndex((o) => o.id === order.id);
    if (idx >= 0) orders[idx] = order;
    else orders.unshift(order);
    renderHistory();
    if (scroll) host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const updateSummary = () => {
    const form = slot.querySelector('#form-order');
    if (!form) return;
    const amount = Number(form.querySelector('[data-amount]')?.value) || 0;
    const methodId = form.querySelector('[data-method-input]')?.value;
    const method = data.methods.find((m) => m.id === methodId) || data.methods[0];
    const fee = feeFor(method, amount);
    const setText = (sel, value) => {
      const el = form.querySelector(sel);
      if (el) el.textContent = value;
    };
    setText('[data-sum-subtotal]', rupiah(amount));
    setText('[data-sum-fee]', rupiah(fee));
    setText('[data-sum-total]', rupiah(amount + fee));
    setText('[data-sum-method]', method ? `· ${method.label}` : '');
  };

  const wireForm = () => {
    const form = slot.querySelector('#form-order');
    if (!form) return;
    updateSummary();

    form.querySelector('[data-amount]')?.addEventListener('input', updateSummary);

    form.addEventListener('change', (event) => {
      if (event.target.name !== 'plan') return;
      const plan = data.plans?.find((p) => p.id === event.target.value);
      if (plan) {
        form.querySelector('[name="months"]').value = plan.months;
        form.querySelector('[name="maxNodes"]').value = plan.maxNodes;
        const suggested = Number(plan.yearly || plan.monthly || data.priceSuggestions?.[plan.id]) || 0;
        if (suggested) form.querySelector('[data-amount]').value = suggested;
      }
      updateSummary();
    });

    form.querySelectorAll('[data-method]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedId = btn.dataset.method;
        billingCache.methodId = selectedId;
        form.querySelectorAll('[data-method]').forEach((b) => b.classList.toggle('active', b === btn));
        form.querySelector('[data-method-input]').value = selectedId;
        updateSummary();
      });
    });

    form.querySelectorAll('[data-price]').forEach((btn) => {
      btn.addEventListener('click', () => {
        form.querySelector('[data-amount]').value = btn.dataset.price;
        const planId = btn.dataset.pricePlan;
        const plan = data.plans?.find((p) => p.id === planId);
        if (plan) {
          form.querySelector('[name="plan"]').value = plan.id;
          form.querySelector('[name="months"]').value = Number(btn.dataset.priceMonths) || plan.months;
          form.querySelector('[name="maxNodes"]').value = plan.maxNodes;
        }
        updateSummary();
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = formValues(form);
      const amount = Number(values.amount) || 0;
      if (amount < 10000) {
        toast.warn('Harga terlalu kecil', 'Harga minimal Rp 10.000.');
        return;
      }
      if (!String(values.customer || '').trim()) {
        toast.warn('Nama kosong', 'Isi nama pelanggan atau perusahaan.');
        return;
      }
      if (!String(values.email || '').trim()) {
        toast.warn('Email kosong', 'Isi email untuk menerima tagihan.');
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const res = await api.post('/billing/orders', {
          customer: values.customer,
          email: values.email,
          phone: values.phone,
          plan: values.plan,
          months: Number(values.months),
          maxNodes: Number(values.maxNodes),
          amount,
          method: values.method,
          projectId: state.project?.id,
        });
        toast.success('Tagihan dibuat', res.message || 'Silakan selesaikan pembayaran.');
        renderInvoice(res.order);
      } catch (err) {
        errorToast(err);
      } finally {
        submit.disabled = false;
      }
    });
  };

  const wireConfig = () => {
    const form = slot.querySelector('#form-billing-config');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = formValues(form);
      const accounts = {};
      for (const bank of ['bca', 'bni', 'bri', 'mandiri']) {
        accounts[bank] = {
          number: values[`acc_${bank}_number`],
          holder: values[`acc_${bank}_holder`],
        };
      }
      try {
        const enabled = [...form.querySelectorAll('[data-method-toggle]')]
          .filter((input) => input.checked).map((input) => input.value);
        const disabledMethods = (data.methods || [])
          .map((m) => m.id).filter((id) => !enabled.includes(id));
        const res = await api.put('/billing/config', {
          merchantName: values.merchantName,
          merchantCity: values.merchantCity,
          supportEmail: values.supportEmail,
          supportPhone: values.supportPhone,
          ewalletNumber: values.ewalletNumber,
          merchantId: values.merchantId,
          note: values.note,
          accounts,
          disabledMethods,
        });
        const disabled = new Set(res.config?.disabledMethods || []);
        data.methods = (data.methods || []).map((m) => ({ ...m, enabled: !disabled.has(m.id) }));
        data.config = res.config || data.config;
        toast.success('Tersimpan', res.message || 'Data pembayaran diperbarui.');
        renderAll();
      } catch (err) {
        errorToast(err);
      }
    });
  };

  const renderAll = () => {
    slot.innerHTML = billingMarkup(data, selectedId);
    wireForm();
    wireConfig();
    renderHistory();
    const cached = billingCache.orderId ? orders.find((o) => o.id === billingCache.orderId) : null;
    if (cached) renderInvoice(cached, { scroll: false });
  };

  slot.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      copyText(copy.dataset.copy);
      return;
    }

    const pay = event.target.closest('[data-pay]');
    if (pay) {
      const ok = await confirmDialog({
        title: 'Verifikasi pembayaran?',
        message: 'Pastikan dana sudah masuk. Kunci lisensi akan dibuat dan langsung diaktifkan di server ini.',
        confirmText: 'Verifikasi & aktifkan',
      });
      if (!ok) return;
      pay.disabled = true;
      try {
        const res = await api.post(`/billing/orders/${pay.dataset.pay}/pay`, { activate: true });
        toast.success('Pembayaran terverifikasi', res.message || 'Lisensi diaktifkan.');
        if (res.active) {
          state.license = res.active;
          if (res.key) state.licenseKey = res.key;
        }
        renderInvoice(res.order);
        requestRefresh();
      } catch (err) {
        errorToast(err);
        pay.disabled = false;
      }
      return;
    }

    const cancel = event.target.closest('[data-cancel]');
    if (cancel) {
      const ok = await confirmDialog({
        title: 'Batalkan tagihan?',
        message: 'Tagihan yang dibatalkan tidak dapat dibayar lagi. Anda dapat membuat tagihan baru kapan saja.',
        confirmText: 'Batalkan tagihan',
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.post(`/billing/orders/${cancel.dataset.cancel}/cancel`, {});
        toast.success('Tagihan dibatalkan', res.message || 'Tagihan dibatalkan.');
        renderInvoice(res.order);
      } catch (err) {
        errorToast(err);
      }
      return;
    }

    const open = event.target.closest('[data-open-order]');
    if (open) {
      try {
        const res = await api.get(`/billing/orders/${open.dataset.openOrder}`);
        renderInvoice(res.order);
      } catch (err) {
        errorToast(err);
      }
    }
  });

  renderAll();
}

async function bindLicense(content) {
  content.querySelector('[data-copy-license]')?.addEventListener('click', () => {
    if (state.licenseKey) copyText(state.licenseKey);
  });

  try {
    const data = await api.auth.users();
    const customers = (data.users || []).filter((u) =>
      !['superadmin', 'admin'].includes(u.role) && !u.demo && u.status !== 'disabled'
    );
    for (const sel of [
      content.querySelector('#license-customer'),
      content.querySelector('#license-activate-customer'),
    ]) {
      if (!sel) continue;
      const placeholder = sel.dataset.placeholder || '— Pilih —';
      sel.innerHTML = `<option value="">${esc(placeholder)}</option>` + customers.map((u) =>
        `<option value="${esc(u.id)}">${esc(u.company || u.name)} — ${esc(u.email)}</option>`
      ).join('');
    }
  } catch { /* daftar tetap kosong bila gagal dimuat */ }

  const activateForm = content.querySelector('#form-license');
  activateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    document.activeElement?.blur?.();
    const key = activateForm.querySelector('[name="key"]').value.trim();
    if (!key) {
      toast.warn('Kunci kosong', 'Tempel kunci lisensi terlebih dahulu.');
      return;
    }
    const customerId = activateForm.querySelector('[name="customerId"]')?.value || '';
    try {
      const res = await api.post('/license/activate', { key, customerId });
      toast.success('Lisensi diaktivasi', res.message || 'Lisensi berhasil diaktivasi.');
      if (!customerId) {
        state.license = res.license;
        state.licenseKey = key;
        requestRefresh();
      }
    } catch (err) {
      errorToast(err);
    }
  });

  const generateForm = content.querySelector('#form-license-generate');
  generateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    document.activeElement?.blur?.();
    const values = formValues(generateForm);
    try {
      const res = await api.post('/license/generate', {
        customerId: values.customerId || '',
        customer: values.customer,
        plan: values.plan,
        months: Number(values.months),
        maxNodes: Number(values.maxNodes),
        activate: Boolean(values.activate),
      });
      const resultEl = content.querySelector('#license-generate-result');
      if (resultEl) {
        resultEl.innerHTML = `<div class="locator-result">
          <div class="locator-result__head">${icon('key')} Kunci lisensi baru <span class="pill pill--ok" style="margin-left:auto">SIAP</span></div>
          <div class="license-key" style="margin-top:8px">${esc(res.key)}</div>
          <p class="muted" style="font-size:10px;margin-top:6px">Untuk pelanggan: <b>${esc(res.license?.customer || '-')}</b></p>
          <div class="row mt-2">
            <button class="btn btn-xs btn-soft" data-copy-generated>${icon('copy')} Salin kunci</button>
            ${res.active ? `<span class="muted" style="font-size:10px">Lisensi langsung diaktifkan untuk pelanggan ini.</span>` : ''}
          </div>
        </div>`;
        resultEl.querySelector('[data-copy-generated]')?.addEventListener('click', () => copyText(res.key));
      }
      toast.success('Lisensi dibuat', res.message || 'Kunci lisensi berhasil dibuat.');
      if (res.active && !values.customerId) {
        state.license = res.active;
        state.licenseKey = res.key;
      }
    } catch (err) {
      errorToast(err);
    }
  });

  bindBilling(content);
}

async function loadUsers(content) {
  const slot = content.querySelector('#users-slot');
  if (!slot) return;
  try {
    const data = await api.auth.users();
    const users = data.users || [];
    if (!users.length) {
      slot.innerHTML = empty('user', 'Belum ada pengguna');
      return;
    }
    slot.innerHTML = `<div class="user-list">${users.map((u) => `<div class="user-row" data-user-id="${esc(u.id)}">
      <div class="avatar">${esc(fmt.initials(u.name))}</div>
      <div class="user-row__info"><b>${esc(u.name)}${u.id === state.user?.id ? ' (Anda)' : ''}</b><span>${esc(u.email)} · ${esc(u.company || '—')} · login ${u.lastLoginAt ? esc(fmt.ago(u.lastLoginAt)) : 'belum pernah'}</span></div>
      <label class="field" style="min-width:130px"><span>Role</span><select data-user-role="${esc(u.id)}">
        ${Object.entries(ROLE_LABEL).map(([value, label]) => `<option value="${value}" ${u.role === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}
      </select></label>
      <label class="field" style="min-width:110px"><span>Status</span><select data-user-status="${esc(u.id)}">
        <option value="active" ${u.status !== 'disabled' ? 'selected' : ''}>Aktif</option>
        <option value="disabled" ${u.status === 'disabled' ? 'selected' : ''}>Nonaktif</option>
      </select></label>
      <button class="icon-btn" data-user-delete="${esc(u.id)}" title="Hapus pengguna" ${u.id === state.user?.id ? 'disabled' : ''}>${icon('trash')}</button>
    </div>`).join('')}</div>`;
  } catch (err) {
    slot.innerHTML = empty('alert-triangle', 'Gagal memuat pengguna', err.message);
  }
}

function bindUsers(content) {
  if (!isAdmin()) return;
  loadUsers(content);
  content.addEventListener('change', async (event) => {
    const roleSelect = event.target.closest('[data-user-role]');
    const statusSelect = event.target.closest('[data-user-status]');
    if (!roleSelect && !statusSelect) return;
    const id = roleSelect?.dataset.userRole || statusSelect?.dataset.userStatus;
    const payload = roleSelect ? { role: roleSelect.value } : { status: statusSelect.value };
    try {
      await api.auth.updateUser(id, payload);
      toast.success('Pengguna diperbarui', 'Perubahan role/status disimpan.');
      requestRefresh();
    } catch (err) {
      errorToast(err);
      loadUsers(content);
    }
  });

  content.addEventListener('click', async (event) => {
    const del = event.target.closest('[data-user-delete]');
    if (!del) return;
    const ok = await confirmDialog({
      title: 'Hapus pengguna?',
      message: 'Akun ini akan dihapus permanen. Riwayat aktivitas tetap tersimpan.',
      confirmText: 'Hapus pengguna',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.auth.deleteUser(del.dataset.userDelete);
      toast.success('Pengguna dihapus', 'Akun berhasil dihapus.');
      loadUsers(content);
    } catch (err) {
      errorToast(err);
    }
  });
}

function bindProject(content) {
  const form = content.querySelector('#form-project');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(form);
    try {
      await api.put(`/projects/${state.project.id}`, {
        name: values.name,
        code: values.code,
        description: values.description,
        center: [Number(values.centerLat), Number(values.centerLng)],
        zoom: Number(values.zoom),
        status: values.status,
      });
      toast.success('Project disimpan', 'Identitas dan pusat peta diperbarui.');
      requestRefresh();
    } catch (err) {
      errorToast(err);
    }
  });

  content.querySelectorAll('[data-project-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      api.setProjectId(btn.dataset.projectOpen);
      toast.info('Membuka project', 'Memuat data project terpilih…');
      requestRefresh();
    });
  });

  content.querySelectorAll('[data-project-dup]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const source = state.projects.find((p) => p.id === btn.dataset.projectDup);
      if (!source) return;
      try {
        const name = prompt('Nama project duplikat:', `${source.name} (copy)`);
        if (name === null) return;
        const res = await api.post(`/projects/${source.id}/duplicate`, { name: name || undefined });
        api.setProjectId(res.project.id);
        toast.success('Project diduplikasi', `${res.project.name} dibuat dengan salinan topologi.`);
        requestRefresh();
      } catch (err) {
        errorToast(err);
      }
    });
  });

  content.querySelector('[data-project-create]')?.addEventListener('click', async () => {
    const name = content.querySelector('[name="newName"]')?.value.trim();
    const code = content.querySelector('[name="newCode"]')?.value.trim();
    if (!name) {
      toast.warn('Nama project wajib', 'Isi nama project baru terlebih dahulu.');
      return;
    }
    try {
      const res = await api.post('/projects', {
        name,
        code,
        description: 'Project baru lintasJB NMS.',
        center: state.settings.map?.center || [-8.2, 114.02],
        zoom: state.settings.map?.zoom || 10,
      });
      api.setProjectId(res.project.id);
      toast.success('Project dibuat', res.project.name);
      requestRefresh();
    } catch (err) {
      errorToast(err);
    }
  });

  content.querySelector('[data-project-delete]')?.addEventListener('click', async () => {
    const project = state.project;
    if (!project) return;
    const ok = await confirmDialog({
      title: 'Hapus project?',
      message: `Project ${project.name} beserta seluruh node, kabel, gangguan, dan alarm di dalamnya akan dihapus permanen.`,
      confirmText: 'Hapus project',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/projects/${project.id}`);
      const next = state.projects.find((p) => p.id !== project.id);
      if (next) api.setProjectId(next.id);
      toast.success('Project dihapus', project.name);
      requestRefresh();
    } catch (err) {
      errorToast(err);
    }
  });
}

function bindAccount(content) {
  const profile = content.querySelector('#form-profile');
  profile?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(profile);
    try {
      const res = await api.auth.updateProfile({
        name: values.name,
        company: values.company,
        phone: values.phone,
      });
      state.user = res.user;
      api.setSession({ user: res.user });
      toast.success('Profil disimpan', 'Informasi akun berhasil diperbarui.');
      requestRefresh();
    } catch (err) {
      errorToast(err);
    }
  });

  const password = content.querySelector('#form-password');
  password?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formValues(password);
    if (values.newPassword !== values.confirmPassword) {
      toast.error('Password tidak sama', 'Konfirmasi password baru tidak cocok.');
      return;
    }
    if (String(values.newPassword).length < 8) {
      toast.error('Password terlalu pendek', 'Minimal 8 karakter dengan huruf dan angka.');
      return;
    }
    try {
      await api.auth.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success('Password diperbarui', 'Gunakan password baru pada login berikutnya.');
      password.reset();
    } catch (err) {
      errorToast(err);
    }
  });
}

/* ------------------------------------------------------------------ render */

export async function render(view, params = {}) {
  const allowed = TABS.filter((t) => !t.admin || isAdmin());
  let activeTab = allowed.some((t) => t.id === params.tab)
    ? params.tab
    : (sessionStorage.getItem('lintasjb.settingsTab') || 'branding');
  if (!allowed.some((t) => t.id === activeTab)) activeTab = 'branding';

  view.innerHTML = `<div class="page">
    <div class="page-toolbar">
      <div><h2>Pengaturan platform</h2><p>Branding, peta, alarm, monitoring, integrasi, lisensi, pengguna, dan project.</p></div>
      <div class="page-toolbar__right">
        <span class="pill pill--accent">${icon('shield')} ${esc(ROLE_LABEL[state.user?.role] || state.user?.role || '')}</span>
      </div>
    </div>
    <div class="settings-layout">
      <aside class="settings-nav" id="settings-nav">
        ${allowed.map((tab) => `<button data-tab="${tab.id}">${icon(tab.icon)} <span>${esc(tab.label)}</span></button>`).join('')}
      </aside>
      <div class="settings-content" id="settings-content"></div>
    </div>
  </div>`;

  const content = view.querySelector('#settings-content');
  const nav = view.querySelector('#settings-nav');

  function paint() {
    nav.querySelectorAll('[data-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === activeTab));
    content.innerHTML = sectionFor(activeTab);
    switch (activeTab) {
      case 'branding': bindBranding(content, view); break;
      case 'map': bindMap(content, view); break;
      case 'alarm': bindAlarm(content); break;
      case 'monitor': bindMonitor(content); break;
      case 'integrations': bindIntegrations(content); break;
      case 'license': bindLicense(content); break;
      case 'users': bindUsers(content); break;
      case 'project': bindProject(content); break;
      case 'account': bindAccount(content); break;
      default: break;
    }
  }

  nav.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tab]');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    sessionStorage.setItem('lintasjb.settingsTab', activeTab);
    history.replaceState(null, '', `#/settings?tab=${activeTab}`);
    paint();
  });

  sessionStorage.setItem('lintasjb.settingsTab', activeTab);
  paint();
}

export default { render };
