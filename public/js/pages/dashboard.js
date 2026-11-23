/* lintasJB NMS — Dashboard */
import * as api from '../api.js';
import { state, activeAlarms, activeFaults, nodeTypeCounts, availableBasemaps } from '../state.js';
import { esc, icon, fmt, toast, errorToast, empty, severityBox, statusPill, sparkline, NODE_TYPES, NODE_STATUS } from '../ui.js';
import { createMap } from '../map.js';
import { navigate } from '../router.js';
import { registerCleanup } from '../lifecycle.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 19) return 'Selamat sore';
  return 'Selamat malam';
}

function activityIcon(action = '') {
  if (action.startsWith('fault')) return 'alert-triangle';
  if (action.startsWith('node')) return 'network';
  if (action.startsWith('cable')) return 'cable';
  if (action.startsWith('olt') || action.startsWith('router')) return 'router';
  if (action.startsWith('io')) return 'swap';
  if (action.startsWith('license')) return 'key';
  if (action.startsWith('settings') || action.startsWith('branding')) return 'settings';
  if (action.startsWith('auth')) return 'user';
  return 'activity';
}

function alarmItem(alarm) {
  const sev = alarm.severity || 'info';
  return `<div class="alarm-item">
    ${severityBox(sev)}
    <div class="alarm-item__body">
      <div class="alarm-item__top">
        <b>${esc(alarm.title)}</b>
        ${alarm.acknowledged ? '<span class="pill pill--info">ACK</span>' : ''}
        <span class="pill ${sev === 'critical' ? 'pill--danger' : sev === 'warning' ? 'pill--warn' : 'pill--info'}">${esc(sev.toUpperCase())}</span>
      </div>
      <p>${esc(alarm.message || '')}</p>
      <div class="alarm-item__meta"><span>${esc(fmt.ago(alarm.createdAt))}</span><span>·</span><span>${esc(alarm.source || 'system')}</span></div>
    </div>
    <div class="alarm-item__action">
      ${!alarm.acknowledged ? `<button class="icon-btn" data-ack="${esc(alarm.id)}" title="Acknowledge">${icon('check')}</button>` : ''}
      <button class="icon-btn" data-alarm-open="${esc(alarm.id)}" title="Detail">${icon('chevron-right')}</button>
    </div>
  </div>`;
}

export async function render(view) {
  const s = state.stats || {};
  const nodes = Number(s.nodes ?? state.nodes.length);
  const cables = Number(s.cables ?? state.cables.length);
  const km = Number(s.cableKm ?? 0);
  const ontTotal = Number(s.ontTotal ?? state.nodes.filter((n) => n.type === 'ont').length);
  const ontOnline = Number(s.ontOnline ?? state.nodes.filter((n) => n.type === 'ont' && n.status === 'online').length);
  const ontPct = ontTotal ? Math.round((ontOnline / ontTotal) * 100) : 0;
  const faults = activeFaults();
  const alarms = activeAlarms();
  const unacked = alarms.filter((a) => !a.acknowledged);
  const critical = alarms.filter((a) => a.severity === 'critical');
  const healthOk = faults.length === 0 && critical.length === 0;
  const types = nodeTypeCounts();
  const maxType = Math.max(1, ...Object.values(types));
  const project = state.project;
  const user = state.user;
  const integrations = state.integrations || {};
  const monitorLast = integrations.lastMonitorAt;
  const geoCount = state.nodes.filter((n) => Number.isFinite(n.lat)).length;

  view.innerHTML = `<div class="page">
    <section class="dash-hero">
      <div class="dash-hero__main">
        <span class="eyebrow"><span class="pulse-dot"></span> NOC · ${esc(project?.code || 'PROJECT')}</span>
        <h2>${greeting()}, ${esc(user?.name?.split(' ')[0] || 'Operator')}.</h2>
        <p>Kondisi ${esc(project?.name || 'jaringan')} saat ini. ${faults.length ? `<b class="text-danger">${faults.length} gangguan aktif</b> membutuhkan perhatian.` : 'Tidak ada gangguan kabel aktif — seluruh jalur fiber dalam kondisi normal.'}</p>
        <div class="dash-hero__meta">
          <div class="hero-stat"><b>${fmt.num(nodes)}</b><span>Node jaringan</span></div>
          <div class="hero-stat"><b>${fmt.num(km, 2)} km</b><span>Total fiber</span></div>
          <div class="hero-stat"><b>${ontPct}%</b><span>ONT online</span></div>
          <div class="hero-stat"><b>${fmt.num(alarms.length)}</b><span>Alarm aktif</span></div>
        </div>
      </div>
      <div class="dash-hero__side">
        <div>
          <div class="hero-clock" id="dash-clock">${fmt.clock()}</div>
          <div class="hero-date" id="dash-date">${fmt.fullDate()}</div>
        </div>
        <div class="health-ring">
          <span class="badge-dot" style="color:${healthOk ? 'var(--ok)' : 'var(--danger)'}"></span>
          <span>Network health</span>
          <b style="color:${healthOk ? 'var(--ok)' : 'var(--danger)'}">${healthOk ? 'SEHAT' : 'PERLU TINDAKAN'}</b>
        </div>
      </div>
    </section>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-top"><span class="kpi-label">Aset jaringan</span><span class="kpi-ico">${icon('network')}</span></div>
        <div class="kpi-value">${fmt.num(nodes)}<small> node</small></div>
        <div class="kpi-sub"><b>${fmt.num(types.ont || 0)} ONT</b><span>·</span><span>${fmt.num(types.odp || 0)} ODP</span><span>·</span><span>${fmt.num(types.olt || 0)} OLT</span></div>
      </div>
      <div class="kpi">
        <div class="kpi-top"><span class="kpi-label">Panjang kabel</span><span class="kpi-ico">${icon('route')}</span></div>
        <div class="kpi-value">${fmt.num(km, 2)}<small> km</small></div>
        <div class="kpi-sub"><b>${fmt.num(cables)} kabel</b><span>·</span><span>utilisasi ${fmt.pct(s.fiberUtilization || 0)}</span></div>
      </div>
      <div class="kpi ${ontTotal && ontOnline < ontTotal ? 'kpi--warn' : 'kpi--ok'}">
        <div class="kpi-top"><span class="kpi-label">ONT online</span><span class="kpi-ico">${icon('wifi')}</span></div>
        <div class="kpi-value">${fmt.num(ontOnline)}<small> / ${fmt.num(ontTotal)}</small></div>
        <div class="kpi-sub"><b>${ontPct}%</b><span>·</span><span>${fmt.num(ontTotal - ontOnline)} offline/warning</span></div>
      </div>
      <div class="kpi ${faults.length ? 'kpi--danger' : 'kpi--ok'}">
        <div class="kpi-top"><span class="kpi-label">Gangguan aktif</span><span class="kpi-ico">${icon('alert-triangle')}</span></div>
        <div class="kpi-value">${fmt.num(faults.length)}<small> fault</small></div>
        <div class="kpi-sub"><b>${unacked.length} alarm</b><span>belum di-ACK</span></div>
      </div>
    </div>

    <div class="dash-grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>${icon('map')} Peta jaringan</h3>
            <p>${fmt.num(geoCount)} node tergeoreferensi · ${fmt.num(cables)} rute kabel</p>
          </div>
          <div class="panel-head__actions">
            <button class="btn btn-xs btn-soft" data-go-map>${icon('external')} Buka Live Map</button>
          </div>
        </div>
        <div class="mini-map" id="dash-map"></div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div><h3>${icon('bell')} Alarm aktif</h3><p>${fmt.num(alarms.length)} alarm · ${fmt.num(unacked.length)} belum di-ACK</p></div>
          <a class="panel-link" data-go-faults>Lihat semua ${icon('chevron-right')}</a>
        </div>
        <div class="alarm-list">
          ${alarms.length ? alarms.slice(0, 5).map(alarmItem).join('') : empty('check-circle', 'Tidak ada alarm aktif', 'Seluruh perangkat dan kabel dalam kondisi normal.')}
        </div>
        <div class="panel-foot"><span>Update ${esc(fmt.ago(monitorLast || new Date().toISOString()))}</span><span>SSE realtime</span></div>
      </section>
    </div>

    <div class="dash-grid dash-grid--2">
      <section class="panel">
        <div class="panel-head"><div><h3>${icon('layers')} Komposisi aset</h3><p>Distribusi tipe node pada project aktif</p></div><a class="panel-link" data-go-assets>Kelola ${icon('chevron-right')}</a></div>
        <div class="panel-body">
          <div class="composition">
            ${Object.entries(NODE_TYPES).map(([type, meta]) => {
              const count = types[type] || 0;
              const width = Math.max(2, Math.round((count / maxType) * 100));
              return `<div class="comp-row"><span>${esc(meta.label)}</span><div class="comp-bar"><i style="width:${width}%;background:${meta.color}"></i></div><b>${count}</b></div>`;
            }).join('')}
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><div><h3>${icon('activity')} Kesehatan ONT</h3><p>Status pelanggan pada OLT terhubung</p></div></div>
        <div class="panel-body">
          <div class="ont-health">
            <div class="donut" style="--p:${ontPct}"><b>${ontPct}%</b><span>online</span></div>
            <div class="ont-legend grow">
              <div><i style="background:var(--ok)"></i> Online <b>${fmt.num(ontOnline)}</b></div>
              <div><i style="background:var(--danger)"></i> Offline <b>${fmt.num(s.ontOffline ?? 0)}</b></div>
              <div><i style="background:var(--warn)"></i> Warning <b>${fmt.num(s.ontWarning ?? 0)}</b></div>
              <div><i style="background:var(--dim)"></i> Total <b>${fmt.num(ontTotal)}</b></div>
            </div>
          </div>
          <div class="divider"></div>
          <div class="row row--between"><span class="muted" style="font-size:10.5px">Utilisasi fiber</span><b class="mono" style="font-size:11px">${fmt.pct(s.fiberUtilization || 0)}</b></div>
          <div class="usage-bar"><i style="width:${Math.min(100, Number(s.fiberUtilization) || 0)}%"></i></div>
          ${sparkline([12, 18, 16, 24, 22, 30, 26, 34, 31, 38, 36, 44, 41, 48], '#a3e635', 260, 32)}
        </div>
      </section>
    </div>

    <div class="dash-grid">
      <section class="panel">
        <div class="panel-head"><div><h3>${icon('router')} Integrasi & perangkat</h3><p>GenieACS NBI, OLT HiOSO, MikroTik RouterOS</p></div><a class="panel-link" data-go-devices>Kelola ${icon('chevron-right')}</a></div>
        <div class="integration-list">
          <div class="integration-row">
            <div class="int-ico">${icon('globe')}</div>
            <div class="int-info"><b>GenieACS NBI</b><span>${esc(integrations.genieacs?.url || 'Belum dikonfigurasi')}</span></div>
            <div class="int-meta"><b>${integrations.genieacs?.enabled ? 'Aktif' : 'Nonaktif'}</b><span>${integrations.genieacs?.error ? 'error' : `${(integrations.genieacs?.devices || []).length} device`}</span></div>
          </div>
          <div class="integration-row">
            <div class="int-ico">${icon('radio')}</div>
            <div class="int-info"><b>OLT HiOSO & multi-vendor</b><span>${(integrations.olts || []).map((o) => o.name).join(' · ') || 'Belum ada OLT'}</span></div>
            <div class="int-meta"><b>${(integrations.olts || []).length} OLT</b><span>${(integrations.olts || []).filter((o) => o.lastResult?.ok).length} OK</span></div>
          </div>
          <div class="integration-row">
            <div class="int-ico">${icon('router')}</div>
            <div class="int-info"><b>MikroTik RouterOS</b><span>${(integrations.routers || []).map((r) => r.name).join(' · ') || 'Belum ada router'}</span></div>
            <div class="int-meta"><b>${(integrations.routers || []).length} router</b><span>${(integrations.routers || []).filter((r) => r.lastResult?.ok).length} OK</span></div>
          </div>
          <div class="integration-row">
            <div class="int-ico">${icon('clock')}</div>
            <div class="int-info"><b>Monitor otomatis</b><span>Interval ${Math.round((state.settings.monitor?.intervalSec || 180) / 60)} menit · ${state.settings.monitor?.enabled ? 'aktif' : 'nonaktif'}</span></div>
            <div class="int-meta"><b>${monitorLast ? fmt.time(monitorLast) : '—'}</b><span>poll terakhir</span></div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><div><h3>${icon('clock')} Aktivitas terbaru</h3><p>Jejak perubahan dan event jaringan</p></div></div>
        <div class="activity-list">
          ${state.activity.length ? state.activity.slice(0, 6).map((a) => `<div class="activity-item">
            <div class="act-ico">${icon(activityIcon(a.action))}</div>
            <div class="grow"><p>${esc(a.detail)}</p><span>${esc(a.userName || 'Sistem')} · ${esc(fmt.ago(a.at))}</span></div>
          </div>`).join('') : empty('activity', 'Belum ada aktivitas')}
        </div>
      </section>
    </div>
  </div>`;

  let mini = null;
  try {
    mini = createMap(view.querySelector('#dash-map'), { mini: true, interactive: false });
    mini.fit({ padding: [18, 18], animate: false });
    mini.invalidate();
  } catch (err) {
    console.warn('mini map', err);
  }

  const clock = setInterval(() => {
    const c = view.querySelector('#dash-clock');
    const d = view.querySelector('#dash-date');
    if (c) c.textContent = fmt.clock();
    if (d) d.textContent = fmt.fullDate();
  }, 1000);

  registerCleanup(() => {
    clearInterval(clock);
    mini?.destroy();
  });

  view.querySelector('[data-go-map]')?.addEventListener('click', () => navigate('map'));
  view.querySelector('[data-go-faults]')?.addEventListener('click', () => navigate('faults'));
  view.querySelector('[data-go-assets]')?.addEventListener('click', () => navigate('assets'));
  view.querySelector('[data-go-devices]')?.addEventListener('click', () => navigate('devices'));

  view.addEventListener('click', async (event) => {
    const ack = event.target.closest('[data-ack]');
    if (ack) {
      ack.disabled = true;
      try {
        await api.post(`/alarms/${ack.dataset.ack}/ack`, {});
        toast.success('Alarm di-ACK', 'Alarm ditandai sudah ditangani.');
        document.dispatchEvent(new CustomEvent('nms:refresh'));
      } catch (err) { errorToast(err); ack.disabled = false; }
      return;
    }
    const open = event.target.closest('[data-alarm-open]');
    if (open) navigate('faults', { alarmId: open.dataset.alarmOpen });
  });
}

export default { render };
