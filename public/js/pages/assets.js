/* lintasJB NMS — Aset Jaringan */
import * as api from '../api.js';
import { state, nodeById } from '../state.js';
import { esc, icon, fmt, toast, errorToast, empty, statusPill, nodeMeta, NODE_TYPES, NODE_STATUS, debounce, confirmDialog } from '../ui.js';
import { openNodeModal, openNodeDrawer, requestRefresh } from '../forms.js';
import { setFocus, navigate } from '../router.js';

const TYPE_ORDER = ['pop', 'router', 'server', 'olt', 'odc', 'closure', 'odp', 'ont'];
const PAGE_SIZE = 60;

export async function render(view) {
  let page = 1;
  const filters = { q: '', type: '', status: '' };
  const selected = new Set();
  const canWrite = ['superadmin', 'admin', 'operator'].includes(state.user?.role) && !state.user?.demo;

  view.innerHTML = `<div class="page">
    <div class="page-toolbar">
      <div><h2>Aset jaringan</h2><p>Kelola seluruh node FTTH: POP, router, server, OLT, ODC, ODP, joint closure, dan ONT.</p></div>
      <div class="page-toolbar__right">
        <button class="btn btn-soft btn-sm" data-import>${icon('upload')} Import</button>
        <button class="btn btn-soft btn-sm" data-export>${icon('download')} Export</button>
        <button class="btn btn-soft btn-sm" data-refresh>${icon('refresh')} Refresh</button>
        <button class="btn btn-primary btn-sm" data-add>${icon('plus')} Tambah node</button>
      </div>
    </div>

    <div class="chip-tabs mb-2" id="type-chips">
      <button class="chip active" data-type="">Semua <span class="dim">${state.nodes.length}</span></button>
      ${TYPE_ORDER.map((t) => {
        const m = nodeMeta(t);
        const count = state.nodes.filter((n) => n.type === t).length;
        return `<button class="chip" data-type="${t}"><span class="layer-dot" style="background:${m.color}"></span>${esc(m.label)} <span class="dim">${count}</span></button>`;
      }).join('')}
    </div>

    <div class="filter-bar">
      <div class="filter-search">${icon('search')}<input id="asset-search" placeholder="Cari nama, kode, serial, atau alamat…" autocomplete="off" /></div>
      <select id="status-filter">
        <option value="">Semua status</option>
        ${Object.entries(NODE_STATUS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}
      </select>
      <div class="grow"></div>
      <span class="muted" style="font-size:10.5px" id="asset-count">${fmt.num(state.nodes.length)} node</span>
    </div>

    <section class="panel table-panel">
      ${canWrite ? `<div class="bulk-bar hidden" id="bulk-bar"><b id="bulk-count">0 node dipilih</b><span class="grow"></span><button type="button" class="btn btn-xs btn-soft" data-bulk-clear>Batalkan pilihan</button><button type="button" class="btn btn-xs btn-danger" data-bulk-delete>${icon('trash')} Hapus dipilih</button></div>` : ''}
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            ${canWrite ? '<th class="col-check"><input type="checkbox" data-check-all title="Pilih semua di halaman ini" /></th>' : ''}
            <th>Node</th><th>Tipe</th><th>Status</th><th>Parent</th><th>Koordinat</th><th>Port</th><th>Kabel</th><th>Update</th><th></th>
          </tr></thead>
          <tbody id="asset-rows"></tbody>
        </table>
      </div>
      <div class="table-footer"><span id="asset-page-info">—</span><span>Data project ${esc(state.project?.name || '—')}</span></div>
    </section>
  </div>`;

  const rows = view.querySelector('#asset-rows');
  const countEl = view.querySelector('#asset-count');
  const pageInfo = view.querySelector('#asset-page-info');

  function filtered() {
    const q = filters.q.trim().toLowerCase();
    return state.nodes
      .filter((n) => !filters.type || n.type === filters.type)
      .filter((n) => !filters.status || n.status === filters.status)
      .filter((n) => !q || [n.name, n.code, n.serial, n.genieacsSerial, n.address].some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => {
        const ta = TYPE_ORDER.indexOf(a.type);
        const tb = TYPE_ORDER.indexOf(b.type);
        if (ta !== tb) return ta - tb;
        return String(a.name).localeCompare(String(b.name), 'id');
      });
  }

  function renderRows() {
    const list = filtered();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    countEl.textContent = `${fmt.num(list.length)} node`;
    pageInfo.textContent = list.length ? `Menampilkan ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, list.length)} dari ${list.length}` : 'Tidak ada data';

    if (!slice.length) {
      rows.innerHTML = `<tr><td colspan="${canWrite ? 10 : 9}">${empty('search', 'Node tidak ditemukan', 'Ubah kata kunci atau filter tipe/status.')}</td></tr>`;
      return;
    }

    rows.innerHTML = slice.map((node) => {
      const meta = nodeMeta(node.type);
      const parent = node.parentId ? nodeById(node.parentId) : null;
      const cableCount = state.cables.filter((c) => c.fromNodeId === node.id || c.toNodeId === node.id).length;
      return `<tr data-row="${esc(node.id)}">
        ${canWrite ? `<td class="col-check"><input type="checkbox" data-node-check="${esc(node.id)}" ${selected.has(node.id) ? 'checked' : ''} title="Pilih node" /></td>` : ''}
        <td><div class="cell-main"><span class="cell-icon" style="color:${meta.color}">${icon(meta.icon)}</span><div><b>${esc(node.name)}</b><small class="mono">${esc(node.code || '—')}</small></div></div></td>
        <td><span class="pill" style="border-color:${meta.color}44;color:${meta.color}">${esc(meta.short)}</span></td>
        <td>${statusPill(node.status)}</td>
        <td>${parent ? `<span class="muted" style="font-size:10.5px">${esc(parent.name)}</span>` : '<span class="dim">—</span>'}</td>
        <td class="cell-coord">${fmt.coord(node.lat, node.lng)}</td>
        <td class="mono" style="font-size:10px">${node.capacity ? `${Number(node.usedPorts) || 0}/${Number(node.capacity)}` : '—'}</td>
        <td class="mono" style="font-size:10px">${cableCount}</td>
        <td class="muted" style="font-size:9.5px">${esc(fmt.ago(node.updatedAt))}</td>
        <td><div class="cell-actions">
          <button class="icon-btn" data-focus="${esc(node.id)}" title="Fokus di peta">${icon('crosshair')}</button>
          <button class="icon-btn" data-view="${esc(node.id)}" title="Detail">${icon('eye')}</button>
          <button class="icon-btn" data-edit="${esc(node.id)}" title="Edit">${icon('edit')}</button>
          <button class="icon-btn" data-delete="${esc(node.id)}" title="Hapus">${icon('trash')}</button>
        </div></td>
      </tr>`;
    }).join('');

    if (totalPages > 1) {
      pageInfo.innerHTML = `<span>Halaman ${page} / ${totalPages}</span>
        <span class="row" style="gap:4px">
          <button class="btn btn-xs btn-soft" data-page="prev" ${page === 1 ? 'disabled' : ''}>Prev</button>
          <button class="btn btn-xs btn-soft" data-page="next" ${page === totalPages ? 'disabled' : ''}>Next</button>
        </span>`;
    }
    updateBulk();
  }

  function updateBulk() {
    const bar = view.querySelector('#bulk-bar');
    if (!bar) return;
    bar.classList.toggle('hidden', selected.size === 0);
    const count = view.querySelector('#bulk-count');
    if (count) count.textContent = `${fmt.num(selected.size)} node dipilih`;
    const all = view.querySelector('[data-check-all]');
    if (all) {
      const ids = filtered().slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((n) => n.id);
      all.checked = ids.length > 0 && ids.every((id) => selected.has(id));
    }
  }

  view.addEventListener('change', (event) => {
    if (event.target.matches('[data-node-check]')) {
      const id = event.target.dataset.nodeCheck;
      if (event.target.checked) selected.add(id);
      else selected.delete(id);
      updateBulk();
      return;
    }
    if (event.target.matches('[data-check-all]')) {
      const ids = filtered().slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((n) => n.id);
      for (const id of ids) {
        if (event.target.checked) selected.add(id);
        else selected.delete(id);
      }
      renderRows();
      updateBulk();
    }
  });

  view.querySelector('#type-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-type]');
    if (!chip) return;
    filters.type = chip.dataset.type;
    page = 1;
    view.querySelectorAll('#type-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderRows();
  });

  view.querySelector('#asset-search').addEventListener('input', debounce((event) => {
    filters.q = event.target.value;
    page = 1;
    renderRows();
  }, 180));

  view.querySelector('#status-filter').addEventListener('change', (event) => {
    filters.status = event.target.value;
    page = 1;
    renderRows();
  });

  view.addEventListener('click', async (event) => {
    if (event.target.closest('[data-bulk-clear]')) {
      selected.clear();
      renderRows();
      updateBulk();
      return;
    }
    const bulk = event.target.closest('[data-bulk-delete]');
    if (bulk) {
      const ids = [...selected];
      if (!ids.length) return;
      const ok = await confirmDialog({
        title: `Hapus ${ids.length} node?`,
        message: `Sebanyak ${fmt.num(ids.length)} node beserta kabel dan alarm terkait akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`,
        confirmText: `Hapus ${ids.length} node`,
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.post('/nodes/bulk-delete', { ids });
        toast.success('Node dihapus', `${res.deleted} node dan ${res.deletedCables} kabel dihapus.`);
        selected.clear();
        requestRefresh();
      } catch (err) { errorToast(err); }
      return;
    }
    const pg = event.target.closest('[data-page]');
    if (pg) {
      const list = filtered();
      const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      page = pg.dataset.page === 'next' ? Math.min(totalPages, page + 1) : Math.max(1, page - 1);
      renderRows();
      return;
    }
    const focus = event.target.closest('[data-focus]');
    if (focus) { setFocus('node', focus.dataset.focus); navigate('map'); return; }

    const detail = event.target.closest('[data-view]');
    if (detail) { openNodeDrawer(nodeById(detail.dataset.view)); return; }

    const edit = event.target.closest('[data-edit]');
    if (edit) { openNodeModal({ node: nodeById(edit.dataset.edit) }); return; }

    const del = event.target.closest('[data-delete]');
    if (del) {
      const node = nodeById(del.dataset.delete);
      if (!node) return;
      const ok = await confirmDialog({
        title: 'Hapus node?',
        message: `Node ${node.name} dan kabel yang terhubung akan dihapus permanen.`,
        confirmText: 'Hapus node',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/nodes/${node.id}`);
        selected.delete(node.id);
        toast.success('Node dihapus', `${node.name} berhasil dihapus.`);
        updateBulk();
        requestRefresh();
      } catch (err) { errorToast(err); }
    }
  });

  view.querySelector('[data-add]').addEventListener('click', () => openNodeModal({}));
  view.querySelector('[data-import]').addEventListener('click', () => navigate('transfer'));
  view.querySelector('[data-export]').addEventListener('click', () => navigate('transfer'));
  view.querySelector('[data-refresh]').addEventListener('click', () => {
    renderRows();
    toast.info('Data disegarkan', 'Menampilkan data terbaru dari server.');
    requestRefresh();
  });

  renderRows();
}

export default { render };
