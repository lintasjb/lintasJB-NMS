/* =============================================================================
 * lintasJB NMS — Admin Panel
 * Ringkasan sistem, pengguna & role, project, log aktivitas, integrasi,
 * harga paket (Rupiah), dan backup data. Khusus superadmin/admin.
 * ========================================================================== */
import * as api from '../api.js';
import { state } from '../state.js';
import {
  esc, icon, fmt, toast, errorToast, empty, field, formValues,
  confirmDialog, modal, copyText, ROLE_LABEL,
} from '../ui.js';
import { requestRefresh } from '../forms.js';
import { navigate } from '../router.js';

const isAdmin = () => ['superadmin', 'admin'].includes(state.user?.role);
const isSuper = () => state.user?.role === 'superadmin';

const TABS = [
  { id: 'overview', label: 'Ringkasan', icon: 'activity' },
  { id: 'users', label: 'Pengguna & Role', icon: 'user' },
  { id: 'projects', label: 'Project', icon: 'git-branch' },
  { id: 'activity', label: 'Log Aktivitas', icon: 'clock' },
  { id: 'integrations', label: 'Integrasi & Lisensi', icon: 'link' },
  { id: 'pricing', label: 'Harga & Paket', icon: 'credit-card' },
  { id: 'backup', label: 'Backup Data', icon: 'database' },
];

const ACTION_LABEL = {
  'auth.login': 'Login',
  'auth.register': 'Registrasi',
  'user.profile': 'Profil',
  'user.create': 'Tambah pengguna',
  'user.password': 'Reset password',
  'user.delete': 'Hapus pengguna',
  'pricing.update': 'Ubah harga',
  'backup.download': 'Unduh backup',
  'project.create': 'Buat project',
  'project.duplicate': 'Duplikasi project',
  'project.delete': 'Hapus project',
  'settings.update': 'Ubah pengaturan',
  'license.activate': 'Aktivasi lisensi',
  'billing.order': 'Tagihan lisensi',
  'billing.paid': 'Pembayaran lisensi',
  'node.create': 'Tambah node',
  'node.update': 'Ubah node',
  'node.delete': 'Hapus node',
  'cable.create': 'Tambah kabel',
  'cable.update': 'Ubah kabel',
  'cable.delete': 'Hapus kabel',
  'import.run': 'Import data',
  'fault.resolve': 'Selesaikan gangguan',
  'monitor.run': 'Jalankan monitor',
};

/* ------------------------------------------------------------------ helpers */

function rupiah(value) {
  return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

function bytes(value) {
  let n = Number(value) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 || n >= 10 ? 0 : 1)} ${units[i]}`;
}

function duration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} hari ${h} jam`;
  if (h) return `${h} jam ${m} menit`;
  if (m) return `${m} menit`;
  return `${s} detik`;
}

function kv(label, value) {
  return `<div class="admin-kv"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function statCard(label, value, sub, iconName, tone = '') {
  return `<div class="admin-stat ${tone}">
    <span class="admin-stat__ico">${icon(iconName)}</span>
    <div class="admin-stat__text">
      <span class="admin-stat__label">${esc(label)}</span>
      <b class="admin-stat__value">${esc(value)}</b>
      <span class="admin-stat__sub">${esc(sub)}</span>
    </div>
  </div>`;
}

function actionLabel(action) {
  return ACTION_LABEL[action] || action || 'Aktivitas';
}

function statusPill(value) {
  const map = {
    active: ['Aktif', 'pill--ok'],
    disabled: ['Nonaktif', 'pill--muted'],
    online: ['Online', 'pill--ok'],
    offline: ['Offline', 'pill--danger'],
    error: ['Error', 'pill--danger'],
    pending: ['Menunggu', 'pill--warn'],
  };
  const [text, cls] = map[value] || [value || 'Tidak diketahui', 'pill--muted'];
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}

function rolePill(role) {
  const cls = role === 'superadmin' ? 'pill--purple' : role === 'admin' ? 'pill--accent' : role === 'operator' ? 'pill--info' : 'pill--muted';
  return `<span class="pill ${cls}">${esc(ROLE_LABEL[role] || role)}</span>`;
}

function userRow(u, { onReset, onDelete } = {}) {
  const self = u.id === state.user?.id;
  const roleOptions = Object.entries(ROLE_LABEL)
    .filter(([value]) => value !== 'superadmin' || isSuper())
    .map(([value, label]) => `<option value="${value}" ${u.role === value ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');
  return `<div class="admin-user" data-user-id="${esc(u.id)}">
    <div class="avatar">${esc(fmt.initials(u.name))}</div>
    <div class="admin-user__info">
      <b>${esc(u.name)}${self ? ' <span class="muted">(Anda)</span>' : ''}</b>
      <span>${esc(u.email)}${u.username ? ` · @${esc(u.username)}` : ''}${u.company ? ` · ${esc(u.company)}` : ''}</span>
      <span class="admin-user__meta">${rolePill(u.role)} ${statusPill(u.status === 'disabled' ? 'disabled' : 'active')} <span class="muted">Login: ${u.lastLoginAt ? esc(fmt.ago(u.lastLoginAt)) : 'belum pernah'}</span></span>
    </div>
    <div class="admin-user__actions">
      <label class="field field--inline"><span>Role</span><select data-user-role="${esc(u.id)}">${roleOptions}</select></label>
      <label class="field field--inline"><span>Status</span><select data-user-status="${esc(u.id)}">
        <option value="active" ${u.status !== 'disabled' ? 'selected' : ''}>Aktif</option>
        <option value="disabled" ${u.status === 'disabled' ? 'selected' : ''}>Nonaktif</option>
      </select></label>
      ${isSuper() ? `<button class="icon-btn" data-user-view="${esc(u.id)}" title="Lihat password (superadmin)">${icon('eye')}</button>` : ''}
      <button class="icon-btn" data-user-reset="${esc(u.id)}" title="Reset password">${icon('key')}</button>
      <button class="icon-btn" data-user-delete="${esc(u.id)}" title="Hapus pengguna" ${self ? 'disabled' : ''}>${icon('trash')}</button>
    </div>
  </div>`;
}

function activityRow(item) {
  const at = item.at || '';
  return `<div class="admin-act">
    <span class="admin-act__dot"></span>
    <div class="admin-act__body">
      <div class="admin-act__head"><b>${esc(item.userName || 'Sistem')}</b> <span class="pill pill--muted">${esc(actionLabel(item.action))}</span></div>
      <p>${esc(item.detail || '')}</p>
    </div>
    <time>${esc(fmt.date(at))}<br><span>${esc(fmt.time(at))}</span></time>
  </div>`;
}

/* ------------------------------------------------------------------ render */

export async function render(view, params = {}) {
  if (!isAdmin()) {
    view.innerHTML = `<div class="page"><div class="panel"><div class="panel-body">${empty('lock', 'Akses terbatas', 'Admin Panel hanya tersedia untuk administrator. Hubungi superadmin bila Anda memerlukan akses.')}</div></div></div>`;
    return;
  }

  const tabs = TABS;
  const active = tabs.some((t) => t.id === params.tab) ? params.tab : 'overview';

  view.innerHTML = `<div class="page admin-page">
    <div class="admin-head">
      <div class="admin-head__text">
        <span class="admin-kicker">${icon('shield')} ADMIN PANEL</span>
        <h2>Pusat kendali lintasJB NMS</h2>
        <p>Kelola pengguna, project, harga paket, dan pantau kesehatan sistem dari satu tempat.</p>
      </div>
      <div class="admin-head__actions">
        <button type="button" class="btn btn-soft btn-sm" data-admin-refresh>${icon('refresh')} Muat ulang</button>
      </div>
    </div>
    <div class="settings-layout">
      <aside class="settings-nav" id="admin-nav">
        ${tabs.map((t) => `<button type="button" data-admin-tab="${t.id}" class="${t.id === active ? 'active' : ''}">${icon(t.icon)}<span>${esc(t.label)}</span></button>`).join('')}
      </aside>
      <div class="settings-content" id="admin-content"></div>
    </div>
  </div>`;

  const content = view.querySelector('#admin-content');
  const nav = view.querySelector('#admin-nav');

  const open = (tab) => {
    nav.querySelectorAll('[data-admin-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.adminTab === tab));
    try { history.replaceState(null, '', `#/admin?tab=${tab}`); } catch { /* abaikan */ }
    content.innerHTML = `<div class="panel"><div class="panel-body">${empty('clock', 'Memuat data…')}</div></div>`;
    (LOADERS[tab] || LOADERS.overview)(content);
  };

  nav.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-admin-tab]');
    if (btn) open(btn.dataset.adminTab);
  });
  view.querySelector('[data-admin-refresh]')?.addEventListener('click', () => {
    open(nav.querySelector('[data-admin-tab].active')?.dataset.adminTab || active);
  });

  open(active);
}

const LOADERS = {
  overview: loadOverview,
  users: loadUsers,
  projects: loadProjects,
  activity: loadActivity,
  integrations: loadIntegrations,
  pricing: loadPricing,
  backup: loadBackup,
};

/* ------------------------------------------------------------------ ringkasan */

async function loadOverview(el) {
  try {
    const d = await api.admin.overview();
    const c = d.counts;
    const m = d.monitor || {};
    const lic = d.license || {};
    const g = d.integrations.genieacs;
    const usage = lic.maxNodes ? Math.min(100, Math.round((Number(lic.nodeCount) || 0) / lic.maxNodes * 100)) : 0;

    el.innerHTML = `
      <div class="admin-stats">
        ${statCard('Uptime server', duration(d.app.uptimeSec), `${d.app.nodeVersion} · ${d.app.platform}`, 'activity')}
        ${statCard('Pengguna', fmt.num(c.users), `${fmt.num(c.activeUsers)} akun aktif`, 'user')}
        ${statCard('Project', fmt.num(c.projects), `${fmt.num(c.nodes)} node · ${fmt.num(c.cables)} kabel`, 'git-branch')}
        ${statCard('Database', bytes(d.storage.dbBytes), `${bytes(d.storage.uploadsBytes)} upload`, 'database')}
      </div>

      <section class="settings-section">
        <div class="settings-section__head"><h3>${icon('server')} Status sistem</h3><p>Informasi proses aplikasi dan pemantauan otomatis.</p></div>
        <div class="settings-section__body">
          <div class="admin-grid">
            ${kv('Versi aplikasi', `v${d.app.version}`)}
            ${kv('Node.js', d.app.nodeVersion)}
            ${kv('Memori proses', `${d.app.memoryMB} MB`)}
            ${kv('PID', String(d.app.pid))}
            ${kv('Monitor otomatis', m.enabled ? 'Aktif' : 'Nonaktif')}
            ${kv('Interval monitor', m.intervalSec ? `${m.intervalSec} detik` : '-')}
            ${kv('Pemantauan terakhir', m.lastMonitorAt ? `${fmt.date(m.lastMonitorAt)} ${fmt.time(m.lastMonitorAt)}` : 'belum pernah')}
            ${kv('Gangguan aktif', `${fmt.num(c.faults)} gangguan · ${fmt.num(c.alarms)} alarm`)}
          </div>
          ${m.error ? `<div class="admin-alert">${icon('alert-triangle')} <span>${esc(m.error)}</span></div>` : ''}
          <div class="row mt-2">
            <button type="button" class="btn btn-soft btn-sm" data-run-monitor>${icon('refresh')} Jalankan monitor sekarang</button>
            <button type="button" class="btn btn-soft btn-sm" data-go-devices>${icon('link')} Kelola integrasi</button>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__head"><h3>${icon('link')} Integrasi perangkat</h3><p>Status GenieACS, OLT, dan MikroTik yang terhubung.</p></div>
        <div class="settings-section__body">
          <div class="admin-device">
            <div class="admin-device__main"><b>GenieACS</b><span>${esc(g.url || 'Belum dikonfigurasi')}${g.lastRunAt ? ` · terakhir ${fmt.ago(g.lastRunAt)}` : ''}</span></div>
            ${statusPill(g.enabled ? 'online' : 'disabled')}
          </div>
          ${g.error ? `<div class="admin-alert">${icon('alert-triangle')} <span>${esc(g.error)}</span></div>` : ''}
          ${(d.integrations.olts || []).map((o) => `<div class="admin-device">
            <div class="admin-device__main"><b>${esc(o.name)}</b><span>${esc(o.vendor)} · ${esc(o.host)}${o.port ? `:${o.port}` : ''}${o.simulated ? ' · simulasi' : ''}</span></div>
            ${statusPill(o.status || 'pending')}
          </div>`).join('') || `<div class="muted" style="font-size:11px">Belum ada OLT terdaftar.</div>`}
          ${(d.integrations.routers || []).map((r) => `<div class="admin-device">
            <div class="admin-device__main"><b>${esc(r.name)}</b><span>${esc(r.host)}${r.enabled ? '' : ' · dinonaktifkan'}</span></div>
            ${statusPill(r.enabled ? (r.status || 'pending') : 'disabled')}
          </div>`).join('')}
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__head"><h3>${icon('key')} Lisensi</h3><p>Status paket dan pemakaian kapasitas node.</p></div>
        <div class="settings-section__body">
          <div class="admin-grid">
            ${kv('Paket', lic.planLabel || lic.plan || 'Belum ada')}
            ${kv('Status', lic.active ? 'Aktif' : 'Tidak aktif')}
            ${kv('Sisa hari', lic.daysLeft !== undefined ? `${lic.daysLeft} hari` : '-')}
            ${kv('Kapasitas', lic.maxNodes ? `${fmt.num(lic.nodeCount)} / ${fmt.num(lic.maxNodes)} node` : 'Tidak dibatasi')}
          </div>
          <div class="admin-bar"><i style="width:${usage}%"></i></div>
          <div class="row mt-2">
            <button type="button" class="btn btn-soft btn-sm" data-go-license>${icon('credit-card')} Kelola lisensi</button>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__head"><h3>${icon('clock')} Aktivitas terakhir</h3><p>Delapan aktivitas terbaru di aplikasi.</p></div>
        <div class="settings-section__body">
          <div class="admin-acts">${(d.recent || []).map(activityRow).join('') || `<div class="muted" style="font-size:11px">Belum ada aktivitas.</div>`}</div>
          <div class="row mt-2"><button type="button" class="btn btn-soft btn-sm" data-go-activity>${icon('chevron-right')} Lihat semua aktivitas</button></div>
        </div>
      </section>`;

    el.querySelector('[data-run-monitor]')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        await api.integration.runMonitor();
        toast.success('Monitor dijalankan', 'Pemantauan perangkat selesai dijalankan.');
        loadOverview(el);
      } catch (err) {
        errorToast(err);
        btn.disabled = false;
      }
    });
    el.querySelector('[data-go-devices]')?.addEventListener('click', () => navigate('devices'));
    el.querySelector('[data-go-license]')?.addEventListener('click', () => navigate('settings', { tab: 'license' }));
    el.querySelector('[data-go-activity]')?.addEventListener('click', () => {
      el.closest('.admin-page')?.querySelector('[data-admin-tab="activity"]')?.click();
    });
  } catch (err) {
    el.innerHTML = `<div class="panel"><div class="panel-body">${empty('alert-triangle', 'Gagal memuat ringkasan', err.message)}</div></div>`;
  }
}

/* ------------------------------------------------------------------ pengguna */

async function loadUsers(el) {
  el.innerHTML = `<section class="settings-section">
    <div class="settings-section__head"><h3>${icon('user')} Pengguna aplikasi</h3><p>Tambah akun, atur role/status, reset password, atau hapus pengguna. Tombol mata (lihat password) hanya untuk superadmin.</p></div>
    <div class="settings-section__body">
      <div class="admin-toolbar">
        <label class="admin-search">${icon('search')}<input id="au-q" placeholder="Cari nama, email, atau username…" /></label>
        <select id="au-role">
          <option value="">Semua role</option>
          ${Object.entries(ROLE_LABEL).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
        </select>
        <select id="au-status">
          <option value="">Semua status</option>
          <option value="active">Aktif</option>
          <option value="disabled">Nonaktif</option>
        </select>
        <span class="grow"></span>
        <button type="button" class="btn btn-primary btn-sm" id="au-add">${icon('plus')} Tambah pengguna</button>
      </div>
      <div id="au-list">${empty('clock', 'Memuat pengguna…')}</div>
    </div>
  </section>`;

  const listEl = el.querySelector('#au-list');
  let users = [];

  const draw = () => {
    const q = el.querySelector('#au-q').value.trim().toLowerCase();
    const role = el.querySelector('#au-role').value;
    const status = el.querySelector('#au-status').value;
    const filtered = users.filter((u) => {
      if (role && u.role !== role) return false;
      if (status === 'active' && u.status === 'disabled') return false;
      if (status === 'disabled' && u.status !== 'disabled') return false;
      if (q && !`${u.name} ${u.email} ${u.username || ''} ${u.company || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (!filtered.length) {
      listEl.innerHTML = empty('user', 'Tidak ada pengguna', 'Ubah filter atau tambahkan pengguna baru.');
      return;
    }
    listEl.innerHTML = `<div class="admin-users">${filtered.map((u) => userRow(u)).join('')}</div>`;
  };

  const load = async () => {
    try {
      const data = await api.auth.users();
      users = data.users || [];
      draw();
    } catch (err) {
      listEl.innerHTML = empty('alert-triangle', 'Gagal memuat pengguna', err.message);
    }
  };

  el.querySelector('#au-q').addEventListener('input', draw);
  el.querySelector('#au-role').addEventListener('change', draw);
  el.querySelector('#au-status').addEventListener('change', draw);

  el.querySelector('#au-add').addEventListener('click', () => openCreateUser(load));

  listEl.addEventListener('change', async (event) => {
    const roleSelect = event.target.closest('[data-user-role]');
    const statusSelect = event.target.closest('[data-user-status]');
    if (!roleSelect && !statusSelect) return;
    const id = roleSelect?.dataset.userRole || statusSelect?.dataset.userStatus;
    const payload = roleSelect ? { role: roleSelect.value } : { status: statusSelect.value };
    try {
      await api.auth.updateUser(id, payload);
      toast.success('Pengguna diperbarui', 'Perubahan role/status disimpan.');
      await load();
      requestRefresh();
    } catch (err) {
      errorToast(err);
      await load();
    }
  });

  listEl.addEventListener('click', async (event) => {
    const view = event.target.closest('[data-user-view]');
    if (view) {
      await openViewPassword(users.find((u) => u.id === view.dataset.userView));
      return;
    }
    const reset = event.target.closest('[data-user-reset]');
    if (reset) {
      openResetPassword(users.find((u) => u.id === reset.dataset.userReset), load);
      return;
    }
    const del = event.target.closest('[data-user-delete]');
    if (!del) return;
    const user = users.find((u) => u.id === del.dataset.userDelete);
    const ok = await confirmDialog({
      title: 'Hapus pengguna?',
      message: `Akun ${user?.name || ''} akan dihapus permanen. Riwayat aktivitas tetap tersimpan.`,
      confirmText: 'Hapus pengguna',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.auth.deleteUser(del.dataset.userDelete);
      toast.success('Pengguna dihapus', 'Akun berhasil dihapus.');
      await load();
      requestRefresh();
    } catch (err) {
      errorToast(err);
    }
  });

  await load();
}

function openCreateUser(onDone) {
  modal({
    title: 'Tambah pengguna',
    subtitle: 'Akun baru langsung aktif dan dapat login.',
    iconName: 'user',
    size: 'md',
    body: `<form id="admin-user-form" class="form-grid" autocomplete="off">
      ${field('Nama lengkap', '<input name="name" required maxlength="80" placeholder="Nama pengguna" />')}
      ${field('Email', '<input name="email" type="email" required maxlength="120" placeholder="nama@perusahaan.id" />')}
      ${field('Username (opsional)', '<input name="username" maxlength="24" placeholder="otomatis dari email" />')}
      ${field('Perusahaan', '<input name="company" maxlength="120" placeholder="PT ..." />')}
      ${field('Role', `<select name="role">${Object.entries(ROLE_LABEL)
        .filter(([value]) => value !== 'superadmin' || isSuper())
        .map(([value, label]) => `<option value="${value}" ${value === 'operator' ? 'selected' : ''}>${esc(label)}</option>`)
        .join('')}</select>`)}
      ${field('Password', '<input name="password" type="password" required minlength="8" placeholder="Minimal 8 karakter, huruf + angka" />')}
    </form>`,
    footer: `<button type="button" class="btn btn-soft" data-cancel>Batal</button>
      <button type="button" class="btn btn-primary" data-save>${icon('save')} Simpan pengguna</button>`,
    onMount(apiRef, root) {
      root.querySelector('[data-cancel]').addEventListener('click', apiRef.close);
      root.querySelector('[data-save]').addEventListener('click', async () => {
        const form = root.querySelector('#admin-user-form');
        if (!form.reportValidity()) return;
        const btn = root.querySelector('[data-save]');
        btn.disabled = true;
        try {
          await api.admin.createUser(formValues(form));
          toast.success('Pengguna dibuat', 'Akun baru berhasil ditambahkan.');
          apiRef.close();
          onDone?.();
        } catch (err) {
          errorToast(err);
          btn.disabled = false;
        }
      });
    },
  });
}

async function openViewPassword(user) {
  if (!user || !isSuper()) return;
  try {
    const res = await api.admin.viewPassword(user.id);
    const body = res.password
      ? `<div class="admin-secret">
          <p class="muted">Password akun <b>${esc(user.name)}</b> (${esc(user.email)}). Fitur ini hanya tersedia untuk superadmin.</p>
          <div class="admin-secret__value"><code id="av-password">${esc(res.password)}</code><button type="button" class="btn btn-xs btn-soft" data-copy-password>${icon('copy')} Salin</button></div>
          <p class="muted">Pembukaan password tercatat di log aktivitas.</p>
        </div>`
      : `<div class="admin-note">${icon('info')} <span>Password akun ini belum tersimpan dalam bentuk terenkripsi. Minta pengguna login sekali atau gunakan tombol reset password.</span></div>`;
    modal({
      title: 'Lihat password',
      subtitle: `${user.name} · ${user.email}`,
      iconName: 'eye',
      size: 'sm',
      body,
      footer: `<button type="button" class="btn btn-soft" data-cancel>Tutup</button>`,
      onMount(apiRef, root) {
        root.querySelector('[data-cancel]')?.addEventListener('click', apiRef.close);
        root.querySelector('[data-copy-password]')?.addEventListener('click', async () => {
          try {
            await copyText(res.password);
            toast.success('Password disalin', 'Password berhasil disalin ke clipboard.');
          } catch {
            errorToast(new Error('Gagal menyalin password.'));
          }
        });
      },
    });
  } catch (err) {
    errorToast(err);
  }
}

function openResetPassword(user, onDone) {
  if (!user) return;
  modal({
    title: 'Reset password',
    subtitle: `Atur password baru untuk ${user.name}.`,
    iconName: 'key',
    size: 'sm',
    body: `<form id="admin-reset-form" class="form-grid" autocomplete="off">
      ${field('Password baru', '<input name="newPassword" type="password" required minlength="8" placeholder="Minimal 8 karakter, huruf + angka" />')}
      ${field('Ulangi password', '<input name="confirmPassword" type="password" required minlength="8" />')}
    </form>`,
    footer: `<button type="button" class="btn btn-soft" data-cancel>Batal</button>
      <button type="button" class="btn btn-primary" data-save>${icon('key')} Reset password</button>`,
    onMount(apiRef, root) {
      root.querySelector('[data-cancel]').addEventListener('click', apiRef.close);
      root.querySelector('[data-save]').addEventListener('click', async () => {
        const form = root.querySelector('#admin-reset-form');
        if (!form.reportValidity()) return;
        const values = formValues(form);
        if (values.newPassword !== values.confirmPassword) {
          toast.warn('Password tidak sama', 'Kedua kolom password harus sama.');
          return;
        }
        const btn = root.querySelector('[data-save]');
        btn.disabled = true;
        try {
          await api.admin.resetPassword(user.id, values.newPassword);
          toast.success('Password direset', `Password ${user.name} berhasil diperbarui.`);
          apiRef.close();
          onDone?.();
        } catch (err) {
          errorToast(err);
          btn.disabled = false;
        }
      });
    },
  });
}

/* ------------------------------------------------------------------ project */

async function loadProjects(el) {
  el.innerHTML = `<section class="settings-section">
    <div class="settings-section__head"><h3>${icon('git-branch')} Manajemen project</h3><p>Buka, duplikasi, buat, atau hapus project peta jaringan. Superadmin melihat seluruh project; admin hanya project miliknya sendiri.</p></div>
    <div class="settings-section__body">
      <div id="ap-list">${empty('clock', 'Memuat project…')}</div>
      <div class="divider"></div>
      <b style="font-size:11.5px">Project baru</b>
      <div class="form-grid mt-2">
        ${field('Nama project', '<input id="ap-name" placeholder="Jaringan FTTH Surabaya" maxlength="120" />')}
        ${field('Kode', '<input id="ap-code" placeholder="SBY-01" maxlength="40" />')}
      </div>
      <div class="row mt-2">
        <button type="button" class="btn btn-primary btn-sm" id="ap-create">${icon('plus')} Buat project</button>
        <span class="muted" style="font-size:10px">Project baru dimulai kosong. Gunakan duplikasi untuk menyalin topologi.</span>
      </div>
    </div>
  </section>`;

  const listEl = el.querySelector('#ap-list');
  let projects = [];

  const draw = () => {
    if (!projects.length) {
      listEl.innerHTML = empty('git-branch', 'Belum ada project');
      return;
    }
    listEl.innerHTML = `<div class="user-list">${projects.map((p) => `<div class="user-row">
      <span class="cell-icon">${icon('git-branch')}</span>
      <div class="user-row__info">
        <b>${esc(p.name)} ${p.id === state.projectId ? '<span class="pill pill--accent">DIBUKA</span>' : ''}</b>
        <span>${esc(p.code || p.id)} · ${fmt.num(p.nodeCount || 0)} node · ${fmt.num(p.cableCount || 0)} kabel${p.ownerName ? ` · ${esc(p.ownerName)}` : ''} · ${esc(p.status || 'active')}</span>
      </div>
      <button class="btn btn-xs btn-soft" data-project-open="${esc(p.id)}">Buka</button>
      <button class="icon-btn" data-project-dup="${esc(p.id)}" title="Duplikasi project">${icon('copy')}</button>
      <button class="icon-btn" data-project-del="${esc(p.id)}" title="Hapus project" ${projects.length <= 1 ? 'disabled' : ''}>${icon('trash')}</button>
    </div>`).join('')}</div>`;
  };

  const load = async () => {
    try {
      const data = await api.admin.projects();
      projects = data.projects || [];
      draw();
    } catch (err) {
      listEl.innerHTML = empty('alert-triangle', 'Gagal memuat project', err.message);
    }
  };

  el.querySelector('#ap-create').addEventListener('click', async () => {
    const name = el.querySelector('#ap-name').value.trim();
    const code = el.querySelector('#ap-code').value.trim();
    if (!name) {
      toast.warn('Nama project wajib', 'Isi nama project terlebih dahulu.');
      return;
    }
    try {
      const res = await api.admin.createProject({ name, code });
      toast.success('Project dibuat', `${res.project?.name || name} berhasil dibuat.`);
      el.querySelector('#ap-name').value = '';
      el.querySelector('#ap-code').value = '';
      await load();
      requestRefresh();
    } catch (err) {
      errorToast(err);
    }
  });

  listEl.addEventListener('click', async (event) => {
    const open = event.target.closest('[data-project-open]');
    if (open) {
      api.setProjectId(open.dataset.projectOpen);
      toast.info('Membuka project', 'Memuat data project terpilih.');
      requestRefresh();
      navigate('dashboard');
      return;
    }

    const dup = event.target.closest('[data-project-dup]');
    if (dup) {
      const source = projects.find((p) => p.id === dup.dataset.projectDup);
      if (!source) return;
      modal({
        title: 'Duplikasi project',
        subtitle: 'Seluruh node dan kabel akan disalin ke project baru.',
        iconName: 'copy',
        size: 'sm',
        body: `<label class="field"><span>Nama project baru</span><input id="ap-dup-name" value="${esc(`${source.name} (copy)`)}" maxlength="120" /></label>`,
        footer: `<button type="button" class="btn btn-soft" data-cancel>Batal</button>
          <button type="button" class="btn btn-primary" data-save>${icon('copy')} Duplikasi</button>`,
        onMount(apiRef, root) {
          root.querySelector('[data-cancel]').addEventListener('click', apiRef.close);
          root.querySelector('[data-save]').addEventListener('click', async () => {
            const name = root.querySelector('#ap-dup-name').value.trim();
            try {
              const res = await api.admin.duplicateProject(source.id, name || undefined);
              toast.success('Project diduplikasi', `${res.project?.name || name} dibuat dengan salinan topologi.`);
              apiRef.close();
              await load();
              requestRefresh();
            } catch (err) {
              errorToast(err);
            }
          });
        },
      });
      return;
    }

    const del = event.target.closest('[data-project-del]');
    if (!del) return;
    const project = projects.find((p) => p.id === del.dataset.projectDel);
    const ok = await confirmDialog({
      title: 'Hapus project?',
      message: `Project ${project?.name || ''} beserta seluruh node, kabel, gangguan, dan alarm di dalamnya akan dihapus permanen.`,
      confirmText: 'Hapus project',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteProject(del.dataset.projectDel);
      toast.success('Project dihapus', 'Project berhasil dihapus.');
      await load();
      requestRefresh();
    } catch (err) {
      errorToast(err);
    }
  });

  await load();
}

/* ------------------------------------------------------------------ aktivitas */

async function loadActivity(el) {
  const st = { q: '', action: '', userId: '', limit: 50, offset: 0 };

  let first;
  try {
    first = await api.admin.activity(st);
  } catch (err) {
    el.innerHTML = `<div class="panel"><div class="panel-body">${empty('alert-triangle', 'Gagal memuat aktivitas', err.message)}</div></div>`;
    return;
  }

  el.innerHTML = `<section class="settings-section">
    <div class="settings-section__head"><h3>${icon('clock')} Log aktivitas</h3><p>Audit login, perubahan data, integrasi, lisensi, dan tindakan admin.</p></div>
    <div class="settings-section__body">
      <div class="admin-toolbar">
        <label class="admin-search">${icon('search')}<input id="aa-q" placeholder="Cari detail aktivitas…" /></label>
        <select id="aa-action">
          <option value="">Semua aksi</option>
          ${(first.actions || []).map((a) => `<option value="${esc(a)}">${esc(actionLabel(a))}</option>`).join('')}
        </select>
        <select id="aa-user">
          <option value="">Semua pengguna</option>
          ${(first.users || []).map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
        </select>
        <span class="grow"></span>
        <span class="muted" id="aa-total">${fmt.num(first.total)} aktivitas</span>
      </div>
      <div id="aa-list"></div>
      <div class="admin-pager" id="aa-pager"></div>
    </div>
  </section>`;

  const listEl = el.querySelector('#aa-list');
  const pagerEl = el.querySelector('#aa-pager');
  const totalEl = el.querySelector('#aa-total');

  const draw = (d) => {
    totalEl.textContent = `${fmt.num(d.total)} aktivitas`;
    listEl.innerHTML = d.items.length
      ? `<div class="admin-acts">${d.items.map(activityRow).join('')}</div>`
      : empty('clock', 'Tidak ada aktivitas', 'Coba ubah filter pencarian.');
    const start = d.total ? d.offset + 1 : 0;
    const end = Math.min(d.total, d.offset + d.limit);
    pagerEl.innerHTML = `<button type="button" class="btn btn-xs btn-soft" data-page="prev" ${d.offset <= 0 ? 'disabled' : ''}>‹ Sebelumnya</button>
      <span class="muted">Menampilkan ${fmt.num(start)}–${fmt.num(end)} dari ${fmt.num(d.total)}</span>
      <button type="button" class="btn btn-xs btn-soft" data-page="next" ${end >= d.total ? 'disabled' : ''}>Berikutnya ›</button>`;
  };

  const refresh = async () => {
    try {
      draw(await api.admin.activity(st));
    } catch (err) {
      errorToast(err);
    }
  };

  let timer = null;
  el.querySelector('#aa-q').addEventListener('input', (event) => {
    clearTimeout(timer);
    const value = event.target.value.trim();
    timer = setTimeout(() => {
      st.q = value;
      st.offset = 0;
      refresh();
    }, 300);
  });
  el.querySelector('#aa-action').addEventListener('change', (event) => {
    st.action = event.target.value;
    st.offset = 0;
    refresh();
  });
  el.querySelector('#aa-user').addEventListener('change', (event) => {
    st.userId = event.target.value;
    st.offset = 0;
    refresh();
  });
  pagerEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn) return;
    st.offset = Math.max(0, st.offset + (btn.dataset.page === 'next' ? st.limit : -st.limit));
    refresh();
  });

  draw(first);
}

/* ------------------------------------------------------------------ integrasi */

async function loadIntegrations(el) {
  try {
    const d = await api.admin.overview();
    const g = d.integrations.genieacs;
    const lic = d.license || {};
    const usage = lic.maxNodes ? Math.min(100, Math.round((Number(lic.nodeCount) || 0) / lic.maxNodes * 100)) : 0;

    el.innerHTML = `
      <section class="settings-section">
        <div class="settings-section__head"><h3>${icon('link')} GenieACS (TR-069)</h3><p>Server ACS untuk manajemen ONT/CPE.</p></div>
        <div class="settings-section__body">
          <div class="admin-grid">
            ${kv('Status', g.enabled ? 'Aktif' : 'Nonaktif')}
            ${kv('URL', g.url || '-')}
            ${kv('Interval polling', g.pollSeconds ? `${g.pollSeconds} detik` : '-')}
            ${kv('Perangkat terdeteksi', fmt.num(g.devices))}
            ${kv('Pemantauan terakhir', g.lastRunAt ? fmt.ago(g.lastRunAt) : 'belum pernah')}
          </div>
          ${g.error ? `<div class="admin-alert">${icon('alert-triangle')} <span>${esc(g.error)}</span></div>` : ''}
          <div class="row mt-2"><button type="button" class="btn btn-soft btn-sm" data-go-integrations>${icon('settings')} Buka pengaturan integrasi</button></div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__head"><h3>${icon('server')} OLT</h3><p>${fmt.num((d.integrations.olts || []).length)} OLT terdaftar.</p></div>
        <div class="settings-section__body">
          ${(d.integrations.olts || []).map((o) => `<div class="admin-device">
            <div class="admin-device__main"><b>${esc(o.name)}</b><span>${esc(o.vendor)} · ${esc(o.host)}${o.port ? `:${o.port}` : ''}${o.simulated ? ' · simulasi' : ''}</span></div>
            ${statusPill(o.status || 'pending')}
          </div>`).join('') || empty('server', 'Belum ada OLT', 'Tambahkan OLT di halaman Perangkat.')}
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__head"><h3>${icon('router')} MikroTik RouterOS</h3><p>${fmt.num((d.integrations.routers || []).length)} router terdaftar.</p></div>
        <div class="settings-section__body">
          ${(d.integrations.routers || []).map((r) => `<div class="admin-device">
            <div class="admin-device__main"><b>${esc(r.name)}</b><span>${esc(r.host)}${r.enabled ? '' : ' · dinonaktifkan'}</span></div>
            ${statusPill(r.enabled ? (r.status || 'pending') : 'disabled')}
          </div>`).join('') || empty('router', 'Belum ada router', 'Tambahkan router di halaman Perangkat.')}
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section__head"><h3>${icon('key')} Lisensi</h3><p>Status paket, masa berlaku, dan pemakaian kapasitas.</p></div>
        <div class="settings-section__body">
          <div class="admin-grid">
            ${kv('Paket', lic.planLabel || lic.plan || 'Belum ada')}
            ${kv('Status', lic.active ? 'Aktif' : 'Tidak aktif')}
            ${kv('Sisa hari', lic.daysLeft !== undefined ? `${lic.daysLeft} hari` : '-')}
            ${kv('Kapasitas node', lic.maxNodes ? `${fmt.num(lic.nodeCount)} / ${fmt.num(lic.maxNodes)}` : 'Tidak dibatasi')}
            ${kv('Berlaku sampai', lic.expiresAt ? fmt.date(lic.expiresAt) : '-')}
          </div>
          <div class="admin-bar"><i style="width:${usage}%"></i></div>
          <div class="row mt-2"><button type="button" class="btn btn-soft btn-sm" data-go-license>${icon('credit-card')} Kelola lisensi</button></div>
        </div>
      </section>`;

    el.querySelector('[data-go-integrations]')?.addEventListener('click', () => navigate('settings', { tab: 'integrations' }));
    el.querySelector('[data-go-license]')?.addEventListener('click', () => navigate('settings', { tab: 'license' }));
  } catch (err) {
    el.innerHTML = `<div class="panel"><div class="panel-body">${empty('alert-triangle', 'Gagal memuat integrasi', err.message)}</div></div>`;
  }
}

/* ------------------------------------------------------------------ harga */

function priceCard(plan, editable) {
  if (!editable) {
    return `<div class="admin-price-card admin-price-card--ro">
      <div class="admin-price-card__head">
        <b>${esc(plan.name)}</b>
        <span class="pill pill--accent">${plan.maxNodes ? `${fmt.num(plan.maxNodes)} node` : 'tanpa batas'}</span>
      </div>
      <div class="admin-price-prices">
        <div><span>Per bulan</span><b>${rupiah(plan.monthly)}</b></div>
        <div><span>Per tahun</span><b>${rupiah(plan.yearly)}</b></div>
      </div>
      ${plan.note ? `<p class="muted">${esc(plan.note)}</p>` : ''}
    </div>`;
  }
  return `<div class="admin-price-card" data-plan-id="${esc(plan.id)}">
    <div class="admin-price-card__head">
      <input class="admin-price-name" data-pf="name" value="${esc(plan.name)}" maxlength="40" placeholder="Nama paket" />
      <button type="button" class="icon-btn" data-price-remove title="Hapus paket">${icon('trash')}</button>
    </div>
    <div class="form-grid">
      <label class="field"><span>Harga / bulan (Rp)</span><input type="number" min="0" step="1000" data-pf="monthly" value="${Number(plan.monthly) || 0}" /></label>
      <label class="field"><span>Harga / tahun (Rp)</span><input type="number" min="0" step="1000" data-pf="yearly" value="${Number(plan.yearly) || 0}" /></label>
      <label class="field"><span>Maks. node</span><input type="number" min="0" step="1" data-pf="maxNodes" value="${Number(plan.maxNodes) || 0}" /></label>
      <label class="field span-2"><span>Catatan</span><input data-pf="note" value="${esc(plan.note || '')}" maxlength="140" placeholder="Deskripsi singkat paket" /></label>
    </div>
    <div class="admin-price-preview" data-price-preview>${rupiah(plan.monthly)} / bulan · ${rupiah(plan.yearly)} / tahun</div>
  </div>`;
}

async function loadPricing(el) {
  let pricing;
  try {
    pricing = (await api.admin.pricing()).pricing;
  } catch (err) {
    el.innerHTML = `<div class="panel"><div class="panel-body">${empty('alert-triangle', 'Gagal memuat harga', err.message)}</div></div>`;
    return;
  }
  const editable = isSuper();

  el.innerHTML = `<section class="settings-section">
    <div class="settings-section__head"><h3>${icon('credit-card')} Harga & paket lisensi</h3><p>Atur harga dalam Rupiah untuk periode bulanan dan tahunan.</p></div>
    <div class="settings-section__body">
      <div class="admin-note">${icon('info')} <span>Mata uang: <b>IDR (Rupiah)</b>. Harga dan kuota node di sini dipakai sebagai harga cepat serta paket pada form pembelian lisensi. ${editable ? 'Perubahan hanya tersimpan setelah menekan Simpan.' : 'Hanya superadmin yang dapat mengubah harga.'}</span></div>
      <div id="ap-list" class="admin-price-list">${pricing.plans.map((p) => priceCard(p, editable)).join('')}</div>
      ${editable ? `<button type="button" class="btn btn-soft btn-sm mt-2" id="ap-add">${icon('plus')} Tambah paket</button>` : ''}
    </div>
    ${editable ? `<div class="settings-section__foot">
      <span class="muted" style="margin-right:auto">Terakhir diperbarui: ${pricing.updatedAt ? esc(`${fmt.date(pricing.updatedAt)} ${fmt.time(pricing.updatedAt)}`) : 'belum pernah'}</span>
      <button type="button" class="btn btn-primary" id="ap-save">${icon('save')} Simpan harga</button>
    </div>` : ''}
  </section>`;

  if (!editable) return;

  const listEl = el.querySelector('#ap-list');

  const updatePreview = (card) => {
    const monthly = Number(card.querySelector('[data-pf="monthly"]').value) || 0;
    const yearly = Number(card.querySelector('[data-pf="yearly"]').value) || 0;
    const preview = card.querySelector('[data-price-preview]');
    if (preview) preview.textContent = `${rupiah(monthly)} / bulan · ${rupiah(yearly)} / tahun`;
  };

  listEl.addEventListener('input', (event) => {
    const card = event.target.closest('[data-plan-id]');
    if (card && event.target.matches('[data-pf="monthly"], [data-pf="yearly"]')) updatePreview(card);
  });

  listEl.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-price-remove]');
    if (!btn) return;
    const cards = listEl.querySelectorAll('[data-plan-id]');
    if (cards.length <= 1) {
      toast.warn('Minimal satu paket', 'Harga harus memiliki setidaknya satu paket.');
      return;
    }
    const card = btn.closest('[data-plan-id]');
    const ok = await confirmDialog({
      title: 'Hapus paket?',
      message: `Paket ${card.querySelector('[data-pf="name"]').value || ''} akan dihapus dari daftar harga.`,
      confirmText: 'Hapus paket',
      danger: true,
    });
    if (ok) card.remove();
  });

  el.querySelector('#ap-add').addEventListener('click', () => {
    const id = `paket-${Date.now().toString(36)}`;
    listEl.insertAdjacentHTML('beforeend', priceCard({
      id,
      name: 'Paket baru',
      monthly: 0,
      yearly: 0,
      maxNodes: 0,
      note: '',
    }, true));
    listEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  el.querySelector('#ap-save').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const plans = [...listEl.querySelectorAll('[data-plan-id]')].map((card) => ({
      id: card.dataset.planId,
      name: card.querySelector('[data-pf="name"]').value.trim(),
      monthly: Number(card.querySelector('[data-pf="monthly"]').value) || 0,
      yearly: Number(card.querySelector('[data-pf="yearly"]').value) || 0,
      maxNodes: Number(card.querySelector('[data-pf="maxNodes"]').value) || 0,
      note: card.querySelector('[data-pf="note"]').value.trim(),
    }));
    if (plans.some((p) => !p.name)) {
      toast.warn('Nama paket kosong', 'Setiap paket harus memiliki nama.');
      return;
    }
    btn.disabled = true;
    try {
      const res = await api.admin.savePricing(plans);
      toast.success('Harga disimpan', res.message || 'Daftar harga berhasil diperbarui.');
      requestRefresh();
      loadPricing(el);
    } catch (err) {
      errorToast(err);
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ backup */

async function loadBackup(el) {
  try {
    const d = await api.admin.overview();
    const c = d.counts;
    el.innerHTML = `<section class="settings-section">
      <div class="settings-section__head"><h3>${icon('database')} Backup & unduh data</h3><p>Salinan seluruh data aplikasi dalam satu berkas JSON.</p></div>
      <div class="settings-section__body">
        <div class="admin-stats admin-stats--sm">
          ${statCard('Database', bytes(d.storage.dbBytes), 'data/db.json', 'database')}
          ${statCard('Upload', bytes(d.storage.uploadsBytes), `${fmt.num(d.storage.uploadFiles)} file`, 'layers')}
          ${statCard('Pengguna', fmt.num(c.users), `${fmt.num(c.activeUsers)} aktif`, 'user')}
          ${statCard('Project', fmt.num(c.projects), `${fmt.num(c.nodes)} node`, 'git-branch')}
        </div>
        <div class="admin-note">${icon('info')} <span>Backup berisi pengguna (password ter-hash), project, node, kabel, gangguan, alarm, lisensi, dan log aktivitas. Berkas <b>data/secrets.json</b> disimpan terpisah dan sebaiknya ikut dicadangkan.</span></div>
        <div class="row mt-2">
          <button type="button" class="btn btn-primary" id="ab-download" ${isSuper() ? '' : 'disabled'}>${icon('download')} Unduh db.json</button>
          <span class="muted" style="font-size:10px">${isSuper() ? 'Unduhan akan tercatat di log aktivitas.' : 'Hanya superadmin yang dapat mengunduh backup.'}</span>
        </div>
        <div class="divider"></div>
        <b style="font-size:11.5px">Cara restore</b>
        <ol class="admin-steps">
          <li>Hentikan aplikasi: <code>pm2 stop lintasjb-nms</code></li>
          <li>Cadangkan data lama: <code>cp -a data data.bak</code></li>
          <li>Ganti <code>data/db.json</code> dengan berkas hasil unduhan.</li>
          <li>Pastikan kepemilikan: <code>chown -R nms:nms data</code></li>
          <li>Jalankan lagi: <code>pm2 start lintasjb-nms</code></li>
        </ol>
      </div>
    </section>`;

    el.querySelector('#ab-download')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      toast.info('Menyiapkan backup', 'Berkas akan diunduh sebentar lagi.');
      try {
        await api.admin.backup();
        toast.success('Backup diunduh', 'Simpan berkas di tempat aman.');
      } catch (err) {
        errorToast(err);
      } finally {
        btn.disabled = false;
      }
    });
  } catch (err) {
    el.innerHTML = `<div class="panel"><div class="panel-body">${empty('alert-triangle', 'Gagal memuat backup', err.message)}</div></div>`;
  }
}
