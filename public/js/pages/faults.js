/* lintasJB NMS — Fault Locator (POSGIS) */
import * as api from '../api.js';
import { state, activeFaults, activeAlarms, cableById, nodeById } from '../state.js';
import {
  esc, icon, fmt, toast, errorToast, empty, severityBox, statusPill,
  confirmDialog, field, switchRow, SEVERITY, NODE_TYPES, CABLE_TYPES,
} from '../ui.js';
import { requestRefresh } from '../forms.js';
import { navigate, setFocus } from '../router.js';

// Keep the last POSGIS result across the full page refresh triggered after a
// fault is created, so the locator panel does not go blank.
let locateCache = null;

const SOURCES = {
  posgis: 'POSGIS (geodesic)',
  otdr: 'OTDR',
  manual: 'Manual / lapangan',
  auto: 'Monitoring otomatis',
  genieacs: 'GenieACS',
  hioso: 'OLT HiOSO',
  mikrotik: 'MikroTik',
};

const CABLE_TYPE_LABEL = { backbone: 'Backbone', feeder: 'Feeder', distribution: 'Distribusi', drop: 'Drop' };

function sortedCables() {
  return [...state.cables].sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
}

function cableOptions(selected = '') {
  return sortedCables()
    .map((c) => {
      const from = nodeById(c.fromNodeId)?.name || 'A';
      const to = nodeById(c.toNodeId)?.name || 'B';
      const label = `${c.name} — ${from} → ${to} (${fmt.km(c.lengthM)})`;
      return `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(label)}</option>`;
    })
    .join('');
}

function deviceNodes() {
  const order = ['olt', 'router', 'server', 'pop', 'odc', 'odp', 'closure', 'ont'];
  return [...state.nodes].sort((a, b) => {
    const ai = order.indexOf(a.type);
    const bi = order.indexOf(b.type);
    if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return String(a.name).localeCompare(String(b.name), 'id');
  });
}

function deviceOptions(selected = '') {
  return deviceNodes()
    .map((n) => {
      const meta = NODE_TYPES[n.type] || { short: n.type };
      return `<option value="${esc(n.id)}" ${n.id === selected ? 'selected' : ''}>${esc(meta.short)} · ${esc(n.name)}${n.code ? ` (${esc(n.code)})` : ''}</option>`;
    })
    .join('');
}

function faultSeverity(fault) {
  return fault.severity === 'warning' ? 'warning' : 'critical';
}

function faultLocation(fault) {
  if (Array.isArray(fault.point)) return fmt.coord(fault.point[0], fault.point[1]);
  const node = nodeById(fault.nodeId);
  if (node) return fmt.coord(node.lat, node.lng);
  return '—';
}

function affectedChips(ids = []) {
  const nodes = ids.map((id) => nodeById(id)).filter(Boolean);
  if (!nodes.length) return '';
  return `<div class="affected-chips">
    ${nodes.slice(0, 14).map((n) => `<span class="affected-chip" title="${esc(NODE_TYPES[n.type]?.label || n.type)}">${esc(n.name)}</span>`).join('')}
    ${nodes.length > 14 ? `<span class="affected-chip">+${nodes.length - 14} lainnya</span>` : ''}
  </div>`;
}

function detailHTML({ fault, cable = null, node = null, totalM = null, distanceM = null, nearest = null, downstream = [], source = '' }) {
  if (!fault) return '';
  const resolved = fault.status === 'resolved';
  const c = cable || cableById(fault.cableId);
  const n = node || nodeById(fault.nodeId);
  const point = fault.point || (n ? [n.lat, n.lng] : null);
  const distance = Number.isFinite(Number(distanceM)) ? Number(distanceM) : Number(fault.distanceM);
  const total = Number.isFinite(Number(totalM)) ? Number(totalM) : Number(fault.totalM);
  const impacted = downstream.length ? downstream : (fault.affectedNodeIds || []).map((id) => nodeById(id)).filter(Boolean);
  return `<div class="locator-result" id="fault-result">
    <div class="locator-result__head">
      ${icon(resolved ? 'check-circle' : 'crosshair')} ${resolved ? 'Gangguan sudah dipulihkan' : 'Hasil fault locator'}
      <span class="pill ${resolved ? 'pill--ok' : 'pill--danger'}" style="margin-left:auto">${resolved ? 'RESOLVED' : 'AKTIF'}</span>
    </div>
    <div class="locator-result__coords">${point ? fmt.coord(point[0], point[1], 7) : '—'}</div>
    <div class="locator-result__meta">
      <span>${esc(c?.name || n?.name || 'Perangkat')}</span>
      ${Number.isFinite(distance) ? `<span>${fmt.km(distance)} dari sisi A</span>` : ''}
      ${Number.isFinite(total) && total > 0 ? `<span>total ${fmt.km(total)}</span>` : ''}
    </div>
    <div class="mt-2"><b style="font-size:12px">${esc(fault.title)}</b>
      <p class="muted" style="font-size:10.5px;line-height:1.55;margin-top:4px">${esc(fault.description || '')}</p>
    </div>
    ${nearest ? `<div class="hint mt-2">${icon('pin')} Titik terdekat: <b>${esc(nearest.name)}</b> · ${fmt.km(Math.hypot((nearest.lat || 0) - (point?.[0] || 0), (nearest.lng || 0) - (point?.[1] || 0)) * 111320)}</div>` : ''}
    ${affectedChips(impacted.map((x) => x.id || x))}
    <div class="row row--between mt-2" style="font-size:9.5px;color:var(--dim)">
      <span>Sumber: ${esc(SOURCES[source || fault.source] || fault.source || 'manual')}</span>
      <span>${esc(fmt.ago(fault.detectedAt))}</span>
    </div>
    <div class="row mt-2">
      <button class="btn btn-xs btn-soft" data-map-fault="${esc(fault.id)}">${icon('map')} Lihat di peta</button>
      ${!resolved ? `<button class="btn btn-xs btn-primary" data-repair-fault="${esc(fault.id)}">${icon('check')} Pulihkan</button>` : ''}
    </div>
  </div>`;
}

export async function render(view, params = {}) {
  let faultTab = 'active';
  let highlightedAlarm = params.alarmId || '';
  let lastLocate = locateCache && locateCache.projectId === state.projectId ? locateCache.data : null;
  let resultFaultId = params.faultId || lastLocate?.fault?.id || '';

  const cableId = params.cableId && cableById(params.cableId) ? params.cableId : (sortedCables()[0]?.id || '');

  view.innerHTML = `<div class="page">
    <div class="page-toolbar">
      <div>
        <h2>Fault locator & gangguan</h2>
        <p>POSGIS memetakan jarak OTDR menjadi titik koordinat presisi, memicu alarm, dan menandai kabel yang putus.</p>
      </div>
      <div class="page-toolbar__right">
        <button class="btn btn-soft btn-sm" data-goto-map>${icon('map')} Live Map</button>
        <button class="btn btn-soft btn-sm" data-refresh>${icon('refresh')} Refresh</button>
        <button class="btn btn-primary btn-sm" data-simulate-device>${icon('zap')} Simulasi gangguan</button>
      </div>
    </div>

    <div class="fault-layout">
      <div class="col" style="gap:14px">
        <section class="panel locator-panel">
          <div class="panel-head">
            <div><h3>${icon('crosshair')} POSGIS locator</h3><p>Hitung titik putus dari jarak kabel / OTDR</p></div>
            <span class="pill pill--accent">LOCAL ENGINE</span>
          </div>
          <div class="panel-body">
            <form class="locator-form" id="locator-form" autocomplete="off">
              ${field('Kabel yang dianalisis', `<select name="cableId" required>${cableOptions(cableId)}</select>`)}
              <div class="grid-2">
                ${field('Jarak dari sisi A', '<div class="input-wrap"><input name="distanceKm" type="number" min="0" step="0.001" placeholder="contoh 0.218" /><span style="padding-right:10px;color:var(--dim);font-size:10px">km</span></div>', 'Kosongkan untuk memakai persentase')}
                ${field('Sumber deteksi', `<select name="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>`)}
              </div>
              <div>
                <div class="row row--between mb-1" style="font-size:10.5px">
                  <span class="muted">Atau perkiraan posisi pada kabel</span>
                  <span class="range-val" id="ratio-label">50%</span>
                </div>
                <div class="range-row">
                  <input type="range" name="ratio" min="0" max="100" step="1" value="50" id="ratio-range" />
                </div>
                <div class="chip-tabs mt-1">
                  <button type="button" class="chip" data-ratio="25">25%</button>
                  <button type="button" class="chip" data-ratio="50">50%</button>
                  <button type="button" class="chip" data-ratio="75">75%</button>
                  <button type="button" class="chip" data-ratio="100">Ujung B</button>
                </div>
                <div class="hint mt-2" id="cable-hint">${icon('info')} Pilih kabel untuk melihat panjang total dan estimasi jarak.</div>
              </div>
              ${field('Catatan / hasil OTDR', '<textarea name="description" rows="2" placeholder="Contoh: OTDR 218 m dari ODC Sumbersari, redaman 1.8 dB."></textarea>')}
              <button class="btn btn-primary btn-block" type="submit" id="locate-btn">${icon('crosshair')} <span>Lokalisasi titik putus</span></button>
            </form>
            <div id="locator-result-slot"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div><h3>${icon('zap')} Simulasi gangguan perangkat</h3><p>Untuk validasi alarm, animasi, dan notifikasi NOC</p></div>
          </div>
          <div class="panel-body">
            <form class="locator-form" id="device-form" autocomplete="off">
              ${field('Perangkat', `<select name="nodeId" required>${deviceOptions()}</select>`)}
              <div class="grid-2">
                ${field('Tingkat', `<select name="severity"><option value="critical">Kritis</option><option value="warning">Peringatan</option></select>`)}
                ${field('Sumber', `<select name="source"><option value="manual">Manual</option><option value="hioso">OLT HiOSO</option><option value="genieacs">GenieACS</option><option value="mikrotik">MikroTik</option></select>`)}
              </div>
              ${field('Judul gangguan', '<input name="title" placeholder="Perangkat offline: OLT Jember" />')}
              ${field('Deskripsi', '<textarea name="description" rows="2" placeholder="Opsional — keterangan untuk tim lapangan."></textarea>')}
              <button class="btn btn-soft btn-block" type="submit" id="device-btn">${icon('zap')} <span>Simulasikan gangguan perangkat</span></button>
            </form>
          </div>
        </section>
      </div>

      <div class="col" style="gap:14px">
        <section class="panel">
          <div class="panel-head">
            <div><h3>${icon('alert-triangle')} Gangguan</h3><p id="fault-summary">—</p></div>
            <div class="seg-tabs">
              <button class="seg-tab active" data-fault-tab="active">Aktif <span class="dim" id="fault-active-count">0</span></button>
              <button class="seg-tab" data-fault-tab="resolved">Riwayat</button>
            </div>
          </div>
          <div class="fault-list" id="fault-list"></div>
          <div class="panel-foot"><span id="fault-foot">—</span><span>POSGIS · WGS84</span></div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div><h3>${icon('bell')} Alarm aktif</h3><p id="alarm-summary">—</p></div>
            <div class="panel-head__actions">
              <button class="btn btn-xs btn-soft" data-ack-all>${icon('check')} ACK semua</button>
            </div>
          </div>
          <div class="fault-list" id="alarm-list"></div>
          <div class="panel-foot"><span>Klik ikon peta untuk fokus ke lokasi</span><span>Realtime</span></div>
        </section>
      </div>
    </div>
  </div>`;

  const listEl = view.querySelector('#fault-list');
  const alarmEl = view.querySelector('#alarm-list');
  const summaryEl = view.querySelector('#fault-summary');
  const alarmSummaryEl = view.querySelector('#alarm-summary');
  const activeCountEl = view.querySelector('#fault-active-count');
  const footEl = view.querySelector('#fault-foot');
  const resultSlot = view.querySelector('#locator-result-slot');
  const cableSelect = view.querySelector('#locator-form [name="cableId"]');
  const ratioRange = view.querySelector('#ratio-range');
  const ratioLabel = view.querySelector('#ratio-label');
  const cableHint = view.querySelector('#cable-hint');
  const locateBtn = view.querySelector('#locate-btn');
  const deviceBtn = view.querySelector('#device-btn');

  const cable = () => cableById(cableSelect.value);

  function updateCableHint() {
    const c = cable();
    const ratio = Number(ratioRange.value) || 0;
    const total = Number(c?.lengthM) || 0;
    const approx = (ratio / 100) * total;
    ratioLabel.textContent = `${ratio}%`;
    if (!c) {
      cableHint.innerHTML = `${icon('info')} Belum ada kabel pada project ini. Tambahkan kabel terlebih dahulu.`;
      return;
    }
    cableHint.innerHTML = `${icon('ruler')} <b>${esc(c.name)}</b> · total ${fmt.km(total)} · estimasi titik ${ratio}% = <b>${fmt.km(approx)}</b> dari sisi A.`;
  }

  function renderFaults() {
    const active = state.faults.filter((f) => f.status === 'active');
    const resolved = state.faults.filter((f) => f.status === 'resolved');
    const list = (faultTab === 'active' ? active : resolved)
      .slice()
      .sort((a, b) => new Date(b.detectedAt || 0) - new Date(a.detectedAt || 0));

    activeCountEl.textContent = String(active.length);
    summaryEl.textContent = `${active.length} aktif · ${resolved.length} riwayat`;
    footEl.textContent = `${list.length} entri ditampilkan`;

    if (!list.length) {
      listEl.innerHTML = empty(
        faultTab === 'active' ? 'check-circle' : 'clock',
        faultTab === 'active' ? 'Tidak ada gangguan aktif' : 'Belum ada riwayat gangguan',
        faultTab === 'active' ? 'Seluruh kabel dan perangkat dalam kondisi normal.' : 'Gangguan yang sudah dipulihkan akan tampil di sini.'
      );
      return;
    }

    listEl.innerHTML = list
      .slice(0, 40)
      .map((fault) => {
        const cableItem = cableById(fault.cableId);
        const nodeItem = nodeById(fault.nodeId);
        const activeItem = fault.status === 'active';
        const highlight = fault.id === resultFaultId;
        return `<div class="fault-row" data-fault-row="${esc(fault.id)}" style="${highlight ? 'background:rgba(34,211,238,.055)' : ''}">
          ${severityBox(faultSeverity(fault))}
          <div class="fr-title">
            <b>${esc(fault.title)}</b>
            <span>${esc(cableItem?.name || nodeItem?.name || 'Perangkat')} · ${esc(SOURCES[fault.source] || fault.source || 'manual')} · ${esc(fmt.ago(fault.detectedAt))}</span>
          </div>
          <div class="mono">${esc(faultLocation(fault))}</div>
          <div class="col" style="gap:3px;align-items:flex-start">
            <span class="pill ${activeItem ? 'pill--danger' : 'pill--ok'}">${activeItem ? 'AKTIF' : 'RESOLVED'}</span>
            <span class="dim" style="font-size:9px">${Number.isFinite(Number(fault.distanceM)) ? fmt.km(fault.distanceM) : '—'}</span>
          </div>
          <div class="cell-actions">
            <button class="icon-btn" data-fault-detail="${esc(fault.id)}" title="Detail">${icon('eye')}</button>
            <button class="icon-btn" data-map-fault="${esc(fault.id)}" title="Fokus di peta">${icon('crosshair')}</button>
            ${activeItem ? `<button class="icon-btn" data-repair-fault="${esc(fault.id)}" title="Pulihkan">${icon('check')}</button>` : ''}
          </div>
        </div>`;
      })
      .join('');
  }

  function renderAlarms() {
    const alarms = activeAlarms()
      .slice()
      .sort((a, b) => {
        const rank = { critical: 0, major: 1, warning: 2, info: 3 };
        return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
      });
    const unacked = alarms.filter((a) => !a.acknowledged).length;
    alarmSummaryEl.textContent = `${alarms.length} alarm · ${unacked} belum di-ACK`;

    if (!alarms.length) {
      alarmEl.innerHTML = empty('check-circle', 'Tidak ada alarm aktif', 'Semua alarm sudah di-ACK atau dipulihkan.');
      return;
    }

    alarmEl.innerHTML = alarms
      .slice(0, 50)
      .map((alarm) => {
        const highlight = alarm.id === highlightedAlarm;
        const fault = alarm.faultId ? state.faults.find((f) => f.id === alarm.faultId) : null;
        return `<div class="fault-row" data-alarm-row="${esc(alarm.id)}" style="${highlight ? 'background:rgba(245,165,36,.055)' : ''}">
          ${severityBox(alarm.severity || 'info')}
          <div class="fr-title">
            <b>${esc(alarm.title)}</b>
            <span>${esc(alarm.message || '')}${alarm.count > 1 ? ` · ${alarm.count}×` : ''}</span>
          </div>
          <div class="mono">${esc(alarm.source || 'system')}<br/>${esc(fmt.time(alarm.createdAt))}</div>
          <div class="col" style="gap:3px;align-items:flex-start">
            <span class="pill ${alarm.acknowledged ? 'pill--info' : 'pill--warn'}">${alarm.acknowledged ? 'ACK' : 'BARU'}</span>
            <span class="dim" style="font-size:9px">${esc(fmt.ago(alarm.lastSeenAt || alarm.createdAt))}</span>
          </div>
          <div class="cell-actions">
            ${!alarm.acknowledged ? `<button class="icon-btn" data-ack-alarm="${esc(alarm.id)}" title="Acknowledge">${icon('check')}</button>` : ''}
            <button class="icon-btn" data-resolve-alarm="${esc(alarm.id)}" title="Selesaikan alarm">${icon('check-circle')}</button>
            ${fault ? `<button class="icon-btn" data-map-fault="${esc(fault.id)}" title="Fokus gangguan">${icon('crosshair')}</button>` : (alarm.nodeId ? `<button class="icon-btn" data-map-node="${esc(alarm.nodeId)}" title="Fokus perangkat">${icon('crosshair')}</button>` : '')}
          </div>
        </div>`;
      })
      .join('');
  }

  function refreshLists() {
    renderFaults();
    renderAlarms();
    updateCableHint();
  }

  function showDetail(data) {
    lastLocate = data;
    locateCache = { projectId: state.projectId, data };
    resultSlot.innerHTML = detailHTML(data);
    resultSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadFault(faultId) {
    try {
      const data = await api.get(`/faults/${faultId}`);
      showDetail({ ...data, source: data.fault?.source });
      resultFaultId = faultId;
      renderFaults();
    } catch (err) {
      errorToast(err);
    }
  }

  ratioRange.addEventListener('input', updateCableHint);
  cableSelect.addEventListener('change', updateCableHint);
  view.querySelectorAll('[data-ratio]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ratioRange.value = btn.dataset.ratio;
      updateCableHint();
      view.querySelector('#locator-form [name="distanceKm"]').value = '';
    });
  });

  view.querySelector('#locator-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!cableSelect.value) {
      toast.warn('Kabel belum dipilih', 'Tambahkan kabel pada project lalu ulangi.');
      return;
    }
    const form = event.currentTarget;
    const distanceKm = form.querySelector('[name="distanceKm"]').value;
    const ratio = Number(ratioRange.value) / 100;
    const body = {
      cableId: cableSelect.value,
      source: form.querySelector('[name="source"]').value,
      description: form.querySelector('[name="description"]').value.trim(),
      projectId: state.projectId,
    };
    if (distanceKm !== '') body.distanceKm = Number(distanceKm);
    else body.ratio = ratio;

    locateBtn.disabled = true;
    const original = locateBtn.innerHTML;
    locateBtn.innerHTML = '<span class="boot-spinner" style="width:14px;height:14px;border-width:1.5px"></span> <span>Menghitung…</span>';
    try {
      const result = await api.post('/faults/locate', body);
      showDetail({
        fault: result.fault,
        cable: result.cable,
        totalM: result.totalM,
        distanceM: result.distanceM,
        nearest: result.nearest,
        downstream: result.downstream || [],
        source: body.source,
      });
      resultFaultId = result.fault.id;
      toast.fault('Titik putus ditemukan', `${result.fault.title} · ${fmt.km(result.distanceM)} dari sisi A.`);
      requestRefresh();
    } catch (err) {
      errorToast(err);
    } finally {
      locateBtn.disabled = false;
      locateBtn.innerHTML = original;
    }
  });

  view.querySelector('#device-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const nodeId = form.querySelector('[name="nodeId"]').value;
    if (!nodeId) {
      toast.warn('Perangkat belum dipilih', 'Pilih node perangkat yang akan disimulasikan.');
      return;
    }
    deviceBtn.disabled = true;
    const original = deviceBtn.innerHTML;
    deviceBtn.innerHTML = '<span class="boot-spinner" style="width:14px;height:14px;border-width:1.5px"></span> <span>Membuat gangguan…</span>';
    try {
      const result = await api.post('/faults/device', {
        nodeId,
        severity: form.querySelector('[name="severity"]').value,
        source: form.querySelector('[name="source"]').value,
        title: form.querySelector('[name="title"]').value.trim(),
        description: form.querySelector('[name="description"]').value.trim(),
        projectId: state.projectId,
      });
      showDetail({ fault: result.fault, downstream: result.affected || [], source: result.fault.source });
      resultFaultId = result.fault.id;
      toast.fault('Gangguan perangkat dibuat', result.fault.title);
      requestRefresh();
    } catch (err) {
      errorToast(err);
    } finally {
      deviceBtn.disabled = false;
      deviceBtn.innerHTML = original;
    }
  });

  view.querySelector('[data-simulate-device]')?.addEventListener('click', () => {
    view.querySelector('#device-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    view.querySelector('#device-form [name="nodeId"]')?.focus();
  });
  view.querySelector('[data-goto-map]')?.addEventListener('click', () => navigate('map'));
  view.querySelector('[data-refresh]')?.addEventListener('click', () => requestRefresh());

  view.querySelectorAll('[data-fault-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      faultTab = btn.dataset.faultTab;
      view.querySelectorAll('[data-fault-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      renderFaults();
    });
  });

  view.addEventListener('click', async (event) => {
    const detail = event.target.closest('[data-fault-detail]');
    if (detail) {
      loadFault(detail.dataset.faultDetail);
      return;
    }

    const mapFault = event.target.closest('[data-map-fault]');
    if (mapFault) {
      setFocus('fault', mapFault.dataset.mapFault);
      navigate('map');
      return;
    }

    const mapNode = event.target.closest('[data-map-node]');
    if (mapNode) {
      setFocus('node', mapNode.dataset.mapNode);
      navigate('map');
      return;
    }

    const repair = event.target.closest('[data-repair-fault]');
    if (repair) {
      const fault = state.faults.find((f) => f.id === repair.dataset.repairFault);
      if (!fault) return;
      const ok = await confirmDialog({
        title: 'Pulihkan gangguan?',
        message: `${fault.title}. Status kabel/perangkat akan dikembalikan normal dan alarm terkait diselesaikan.`,
        confirmText: 'Pulihkan',
        iconName: 'check-circle',
      });
      if (!ok) return;
      repair.disabled = true;
      try {
        await api.post(`/faults/${fault.id}/repair`, {});
        toast.success('Gangguan dipulihkan', fault.title);
        if (resultFaultId === fault.id) {
          const resolved = { ...fault, status: 'resolved', resolvedAt: new Date().toISOString() };
          showDetail({ ...(lastLocate || {}), fault: resolved });
          locateCache = { projectId: state.projectId, data: { ...(lastLocate || {}), fault: resolved } };
        }
        requestRefresh();
      } catch (err) {
        errorToast(err);
        repair.disabled = false;
      }
      return;
    }

    const ack = event.target.closest('[data-ack-alarm]');
    if (ack) {
      ack.disabled = true;
      try {
        await api.post(`/alarms/${ack.dataset.ackAlarm}/ack`, {});
        toast.success('Alarm di-ACK', 'Alarm ditandai sudah ditangani.');
        requestRefresh();
      } catch (err) {
        errorToast(err);
        ack.disabled = false;
      }
      return;
    }

    const resolve = event.target.closest('[data-resolve-alarm]');
    if (resolve) {
      resolve.disabled = true;
      try {
        await api.post(`/alarms/${resolve.dataset.resolveAlarm}/resolve`, {});
        toast.success('Alarm diselesaikan', 'Alarm dipindahkan ke riwayat.');
        requestRefresh();
      } catch (err) {
        errorToast(err);
        resolve.disabled = false;
      }
      return;
    }

    if (event.target.closest('[data-ack-all]')) {
      try {
        const result = await api.post('/alarms/ack-all', { projectId: state.projectId });
        toast.success('Semua alarm di-ACK', `${result.count || 0} alarm ditandai sudah ditangani.`);
        requestRefresh();
      } catch (err) {
        errorToast(err);
      }
    }
  });

  refreshLists();

  if (lastLocate) {
    showDetail(lastLocate);
  } else if (resultFaultId) {
    setTimeout(() => loadFault(resultFaultId), 80);
  } else if (params.alarmId) {
    const alarmRow = view.querySelector(`[data-alarm-row="${params.alarmId}"]`);
    if (alarmRow) alarmRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!highlightedAlarm) highlightedAlarm = params.alarmId;
  }
}

export default { render };
