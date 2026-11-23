/* lintasJB NMS — Kabel & Rute */
import * as api from '../api.js';
import { state, nodeById, faultForCable } from '../state.js';
import {
  esc, icon, fmt, toast, errorToast, empty, statusPill, cableMeta, CABLE_TYPES, CABLE_STATUS,
  debounce, confirmDialog,
} from '../ui.js';
import { openCableModal, openCableDrawer, requestRefresh } from '../forms.js';
import { setFocus, navigate } from '../router.js';

export async function render(view) {
  const totalKm = state.cables.reduce((sum, c) => sum + (Number(c.lengthM) || 0), 0) / 1000;
  let typeFilter = '';
  let query = '';

  view.innerHTML = `<div class="page">
    <div class="page-toolbar">
      <div><h2>Kabel & rute fiber</h2><p>${fmt.num(state.cables.length)} kabel · ${fmt.num(totalKm, 2)} km · animasi aliran data sesuai warna dan tipe.</p></div>
      <div class="page-toolbar__right">
        <button class="btn btn-soft btn-sm" data-draw>${icon('route')} Gambar di peta</button>
        <button class="btn btn-soft btn-sm" data-transfer>${icon('swap')} Import / Export</button>
        <button class="btn btn-primary btn-sm" data-add>${icon('plus')} Tambah kabel</button>
      </div>
    </div>

    <div class="chip-tabs mb-2" id="cable-chips">
      <button class="chip active" data-type="">Semua <span class="dim">${state.cables.length}</span></button>
      ${Object.entries(CABLE_TYPES).map(([type, meta]) => {
        const count = state.cables.filter((c) => c.type === type).length;
        return `<button class="chip" data-type="${type}"><span class="layer-dot" style="background:${meta.color}"></span>${esc(meta.label)} <span class="dim">${count}</span></button>`;
      }).join('')}
    </div>

    <div class="filter-bar">
      <div class="filter-search">${icon('search')}<input id="cable-search" placeholder="Cari nama kabel, kode, atau node…" autocomplete="off" /></div>
      <select id="cable-status">
        <option value="">Semua status</option>
        ${Object.entries(CABLE_STATUS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}
      </select>
      <div class="grow"></div>
      <span class="muted" style="font-size:10.5px" id="cable-count">${fmt.num(state.cables.length)} kabel</span>
    </div>

    <div class="cable-grid" id="cable-grid"></div>
  </div>`;

  const grid = view.querySelector('#cable-grid');
  const countEl = view.querySelector('#cable-count');

  function filtered() {
    const q = query.trim().toLowerCase();
    return state.cables
      .filter((c) => !typeFilter || c.type === typeFilter)
      .filter((c) => {
        const statusSel = view.querySelector('#cable-status')?.value || '';
        return !statusSel || c.status === statusSel;
      })
      .filter((c) => {
        if (!q) return true;
        const from = nodeById(c.fromNodeId);
        const to = nodeById(c.toNodeId);
        return [c.name, c.code, from?.name, to?.name].some((v) => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
  }

  function card(cable) {
    const meta = cableMeta(cable.type);
    const from = nodeById(cable.fromNodeId);
    const to = nodeById(cable.toNodeId);
    const fault = faultForCable(cable.id);
    const anim = cable.animation?.type || 'flow';
    const dur = Math.max(0.35, 1.25 / (Number(cable.animation?.speed) || 1)).toFixed(2);
    const classes = ['cable-line', anim === 'none' || anim === 'static' ? '' : `cable-anim-${anim}`, anim === 'glow' ? 'cable-anim-glow' : '', cable.animation?.reverse ? 'reverse' : '', fault ? 'cable-fault' : ''].filter(Boolean).join(' ');
    const used = Number(cable.usedFibers) || 0;
    const total = Number(cable.fiberCount) || 0;
    const util = total ? Math.round((used / total) * 100) : 0;
    return `<article class="cable-card" data-card="${esc(cable.id)}">
      <div class="cable-preview">
        <svg viewBox="0 0 320 30" preserveAspectRatio="none">
          <path d="M2 21 C 64 5, 118 30, 178 13 S 268 4, 318 19" fill="none" stroke="${esc(cable.color)}" stroke-width="3" class="${classes}" style="--cable-color:${esc(cable.color)};--dur:${dur}s;filter:drop-shadow(0 0 4px ${esc(cable.color)}66)"/>
        </svg>
      </div>
      <div class="cable-card__head">
        <div><b>${esc(cable.name)}</b><small>${esc(cable.code || cable.id)}</small></div>
        <div class="col" style="align-items:flex-end;gap:4px">
          ${statusPill(cable.status, CABLE_STATUS)}
          ${fault ? `<span class="pill pill--danger">${icon('alert-triangle')} Putus</span>` : ''}
        </div>
      </div>
      <div class="cable-card__body">
        <div class="cable-route">
          <span class="route-node" title="${esc(from?.name || '')}">${esc(from?.name || 'Titik A')}</span>
          ${icon('arrow-right')}
          <span class="route-node" title="${esc(to?.name || '')}">${esc(to?.name || 'Titik B')}</span>
        </div>
        <div class="cable-stats">
          <div><span>Panjang</span><b>${fmt.km(cable.lengthM)}</b></div>
          <div><span>Core</span><b>${used}/${total}</b></div>
          <div><span>Utilisasi</span><b>${util}%</b></div>
          <div><span>Animasi</span><b>${esc(anim)}</b></div>
        </div>
        <div class="usage-bar"><i style="width:${util}%;background:${esc(cable.color)}"></i></div>
      </div>
      <div class="cable-card__foot">
        <span class="muted" style="font-size:10px"><span class="cable-swatch" style="background:${esc(cable.color)}"></span>${esc(meta.label)}</span>
        <div class="cell-actions">
          <button class="icon-btn" data-focus="${esc(cable.id)}" title="Fokus di peta">${icon('crosshair')}</button>
          <button class="icon-btn" data-locate="${esc(cable.id)}" title="Fault locator">${icon('alert-triangle')}</button>
          <button class="icon-btn" data-view="${esc(cable.id)}" title="Detail">${icon('eye')}</button>
          <button class="icon-btn" data-edit="${esc(cable.id)}" title="Edit">${icon('edit')}</button>
          <button class="icon-btn" data-delete="${esc(cable.id)}" title="Hapus">${icon('trash')}</button>
        </div>
      </div>
    </article>`;
  }

  function renderCards() {
    const list = filtered();
    countEl.textContent = `${fmt.num(list.length)} kabel`;
    if (!list.length) {
      grid.innerHTML = `<div class="panel" style="grid-column:1/-1">${empty('cable', 'Belum ada kabel', 'Tambahkan kabel atau gambar rute baru langsung dari Live Map.')}</div>`;
      return;
    }
    grid.innerHTML = list.map(card).join('');
  }

  view.querySelector('#cable-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-type]');
    if (!chip) return;
    typeFilter = chip.dataset.type;
    view.querySelectorAll('#cable-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderCards();
  });

  view.querySelector('#cable-search').addEventListener('input', debounce((event) => {
    query = event.target.value;
    renderCards();
  }, 180));

  view.querySelector('#cable-status').addEventListener('change', renderCards);

  view.addEventListener('click', async (event) => {
    const focus = event.target.closest('[data-focus]');
    if (focus) { setFocus('cable', focus.dataset.focus); navigate('map'); return; }
    const locate = event.target.closest('[data-locate]');
    if (locate) { navigate('faults', { cableId: locate.dataset.locate }); return; }
    const viewBtn = event.target.closest('[data-view]');
    if (viewBtn) { openCableDrawer(state.cables.find((c) => c.id === viewBtn.dataset.view)); return; }
    const edit = event.target.closest('[data-edit]');
    if (edit) { openCableModal({ cable: state.cables.find((c) => c.id === edit.dataset.edit) }); return; }
    const del = event.target.closest('[data-delete]');
    if (del) {
      const cable = state.cables.find((c) => c.id === del.dataset.delete);
      if (!cable) return;
      const ok = await confirmDialog({
        title: 'Hapus kabel?',
        message: `Kabel ${cable.name} akan dihapus dari peta dan topologi.`,
        confirmText: 'Hapus kabel',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/cables/${cable.id}`);
        toast.success('Kabel dihapus', `${cable.name} berhasil dihapus.`);
        requestRefresh();
      } catch (err) { errorToast(err); }
    }
  });

  view.querySelector('[data-add]').addEventListener('click', () => openCableModal({}));
  view.querySelector('[data-draw]').addEventListener('click', () => {
    navigate('map');
    setTimeout(() => toast.info('Mode gambar kabel', 'Klik tombol kabel di toolbar peta, lalu klik peta untuk membuat rute.'), 500);
  });
  view.querySelector('[data-transfer]').addEventListener('click', () => navigate('transfer'));

  renderCards();
}

export default { render };
