/* lintasJB NMS — Live Map */
import * as api from '../api.js';
import { state, availableBasemaps, basemapById, nodeById, cableById, faultForCable, nodeTypeCounts, saveFilters } from '../state.js';
import {
  esc, icon, fmt, toast, errorToast, modal, NODE_TYPES, CABLE_TYPES, ANIMATIONS,
  copyText, fmt as f,
} from '../ui.js';
import { createMap } from '../map.js';
import { openNodeModal, openCableModal, openNodeDrawer, openCableDrawer, requestRefresh } from '../forms.js';
import { takeFocus } from '../router.js';
import { registerCleanup } from '../lifecycle.js';
import { pointAtDistance, pathLength } from '../geo.js';
import { parseCoordinate, searchObjects } from '../geosearch.js';

const BASEMAP_GROUPS = ['Gelap', 'Terang', 'Standar', 'Satelit', 'Topografi', 'Kustom', 'Lainnya'];

export async function render(view) {
  const types = nodeTypeCounts();
  const basemaps = availableBasemaps();
  const current = basemapById(state.settings.map?.basemap);
  const ontTotal = state.nodes.filter((n) => n.type === 'ont').length;
  const ontOnline = state.nodes.filter((n) => n.type === 'ont' && n.status === 'online').length;

  view.innerHTML = `<div class="map-page">
    <div class="map-canvas" id="map-canvas"></div>

    <div class="map-hud">
      <div class="map-hud__title">
        ${icon('route')}
        <div><b>${esc(state.project?.name || 'Live Map')}</b><br><span>${esc(state.project?.code || '')} · ${fmt.num(state.nodes.length)} node · ${fmt.num(state.cables.length)} kabel</span></div>
      </div>
      <div class="map-hud__stats">
        <div class="map-hud__stat"><i style="background:var(--ok)"></i> ONT <b>${ontOnline}/${ontTotal}</b></div>
        <div class="map-hud__stat"><i style="background:var(--danger)"></i> Fault <b>${state.faults.filter((x) => x.status === 'active').length}</b></div>
        <div class="map-hud__stat"><i style="background:var(--accent)"></i> Zoom <b id="zoom-label">${state.settings.map?.zoom || 10}</b></div>
      </div>
    </div>

    <div class="map-search" id="map-search">
      <div class="ms-input">
        ${icon('search')}
        <input id="map-search-input" type="text" placeholder="Cari nama objek atau tempel koordinat…" autocomplete="off" spellcheck="false" aria-label="Cari objek atau koordinat" />
        <button class="ms-icon" data-search-clear title="Hapus pencarian" aria-label="Hapus pencarian">${icon('x')}</button>
        <button class="ms-icon" data-search-paste title="Tempel koordinat dari clipboard" aria-label="Tempel koordinat">${icon('copy')}</button>
      </div>
      <div class="ms-results" id="map-search-results"></div>
    </div>

    <div class="map-toolbar" id="map-toolbar">
      <button class="mt-btn" data-tip="Tambah node" data-menu="add-menu">${icon('plus')}</button>
      <div class="mt-menu" id="add-menu">
        <div class="mt-menu__label">Tambah node ke peta</div>
        ${Object.entries(NODE_TYPES).map(([type, meta]) => `<button data-add-node="${type}">${icon(meta.icon)} ${esc(meta.label)}</button>`).join('')}
      </div>
      <button class="mt-btn" data-tip="Gambar rute kabel" data-action="draw">${icon('cable')}</button>
      <button class="mt-btn" data-tip="Edit rute kabel" data-action="edit-route">${icon('edit')}</button>
      <div class="mt-sep"></div>
      <button class="mt-btn" data-tip="Lokasi saya" data-action="locate">${icon('navigation')}</button>
      <button class="mt-btn" data-tip="Ambil titik koordinat" data-action="coordinate">${icon('crosshair')}</button>
      <div class="mt-sep"></div>
      <button class="mt-btn" data-tip="Layer & basemap" data-action="layers">${icon('layers')}</button>
      <button class="mt-btn" data-tip="Fit ke seluruh jaringan" data-action="fit">${icon('route')}</button>
      <button class="mt-btn" data-tip="Fullscreen" data-action="fullscreen">${icon('monitor')}</button>
    </div>

    <button class="map-side-toggle" id="map-side-toggle" aria-label="Layer">${icon('layers')}</button>

    <aside class="map-side" id="map-side">
      <div class="map-panel">
        <div class="map-panel__head"><b>${icon('layers')} Basemap</b><span class="layer-count">${basemaps.length} pilihan</span></div>
        <div class="basemap-current">
          <div class="bm-thumb" id="bm-thumb" style="background:${esc(current?.accent || '#0b1220')}"></div>
          <div class="bm-info"><b id="bm-name">${esc(current?.name || '—')}</b><span id="bm-group">${esc(current?.group || 'Basemap')}</span></div>
          <button class="icon-btn" data-action="cycle-bm" title="Basemap berikutnya">${icon('refresh')}</button>
        </div>
        <div class="basemap-list">
          ${basemaps.map((b) => `<button class="bm-option ${b.id === current?.id ? 'active' : ''}" data-bm="${esc(b.id)}" title="${esc(b.name)}">
            <span class="bm-img" style="background:${esc(b.accent || '#0b1220')}"></span>
            <span>${esc(b.name)}</span>
          </button>`).join('')}
        </div>
      </div>

      <div class="map-panel">
        <div class="map-panel__head"><b>${icon('filter')} Layer</b><button class="link-btn" data-action="all-layers">Semua</button></div>
        <div class="map-panel__body">
          <div class="layer-group">
            <div class="layer-group__title">Node (${state.nodes.length})</div>
            ${Object.entries(NODE_TYPES).map(([type, meta]) => `<div class="layer-row">
              <label class="check"><input type="checkbox" data-layer-node="${type}" ${state.filters.nodes[type] !== false ? 'checked' : ''}/><span class="layer-dot" style="background:${meta.color}"></span><span>${esc(meta.label)}</span></label>
              <span class="layer-count">${types[type] || 0}</span>
            </div>`).join('')}
          </div>
          <div class="layer-group">
            <div class="layer-group__title">Kabel (${state.cables.length})</div>
            ${Object.entries(CABLE_TYPES).map(([type, meta]) => `<div class="layer-row">
              <label class="check"><input type="checkbox" data-layer-cable="${type}" ${state.filters.cables[type] !== false ? 'checked' : ''}/><span class="layer-dot" style="background:${meta.color}"></span><span>${esc(meta.label)}</span></label>
              <span class="layer-count">${state.cables.filter((c) => c.type === type).length}</span>
            </div>`).join('')}
          </div>
          <div class="layer-group">
            <div class="layer-group__title">Tampilan</div>
            <div class="layer-row"><label class="check"><input type="checkbox" data-layer-fault ${state.filters.faults ? 'checked' : ''}/><span>Marker gangguan</span></label></div>
            <div class="layer-row"><label class="check"><input type="checkbox" data-layer-labels ${state.filters.labels ? 'checked' : ''}/><span>Label node</span></label></div>
            <div class="layer-row"><label class="check"><input type="checkbox" data-layer-anim ${state.filters.animate ? 'checked' : ''}/><span>Animasi kabel</span></label></div>
          </div>
        </div>
      </div>

      <div class="map-panel">
        <div class="map-panel__head"><b>${icon('info')} Legenda</b><span class="layer-count">POSGIS</span></div>
        <div class="map-legend">
          ${Object.entries(CABLE_TYPES).map(([, m]) => `<span class="legend-item"><i style="background:${m.color}"></i>${esc(m.label)}</span>`).join('')}
          <span class="legend-item node"><i style="background:var(--danger)"></i>Fault</span>
          <span class="legend-item node"><i style="background:var(--accent)"></i>Lokasi Anda</span>
        </div>
      </div>
    </aside>

    <div class="map-coords">
      ${icon('crosshair')}
      <span>Lat <b id="coord-lat">—</b></span>
      <span>Lng <b id="coord-lng">—</b></span>
      <span class="dim">·</span>
      <span>Zoom <b id="coord-zoom">${state.settings.map?.zoom || 10}</b></span>
    </div>

    <div id="drawbar-slot"></div>
  </div>`;

  const canvas = view.querySelector('#map-canvas');
  const side = view.querySelector('#map-side');
  const toolbar = view.querySelector('#map-toolbar');
  const addMenu = view.querySelector('#add-menu');
  const drawbarSlot = view.querySelector('#drawbar-slot');
  // Panel layer & basemap disembunyikan oleh default dan hanya muncul
  // saat tombol "Layer & basemap" diklik (klik lagi untuk menutup).
  const setSideState = (collapsed) => {
    side.classList.toggle('collapsed', Boolean(collapsed));
    if (collapsed) side.classList.remove('mobile-open');
  };
  setSideState(true);
  let ctl;

  const clearDrawbar = () => { drawbarSlot.innerHTML = ''; };
  const showDrawbar = ({ title, text, actions = [] }) => {
    drawbarSlot.innerHTML = `<div class="map-drawbar">
      <div class="db-ico">${icon('crosshair')}</div>
      <div class="db-text"><b>${esc(title)}</b><span>${esc(text)}</span></div>
      <div class="db-actions">${actions.map((a) => `<button class="${a.primary ? 'btn btn-xs btn-primary' : a.danger ? 'btn btn-xs btn-danger' : a.label ? 'btn btn-xs btn-soft' : 'icon-btn'}" data-db="${a.id}" title="${esc(a.title || a.label || '')}">${a.icon ? icon(a.icon) : ''}${a.label ? `<span>${esc(a.label)}</span>` : ''}</button>`).join('')}</div>
    </div>`;
  };

  const beginNodePlacement = (type) => {
    addMenu.classList.remove('open');
    toolbar.querySelector('[data-action="edit-route"]')?.classList.remove('active');
    ctl?.cancelRoutePick({ silent: true });
    ctl?.cancelEditRoute({ silent: true });
    const meta = NODE_TYPES[type];
    showDrawbar({
      title: `Menempatkan ${meta.label}`,
      text: 'Klik pada peta untuk menentukan koordinat node baru.',
      actions: [{ id: 'cancel', label: 'Batal', icon: 'x' }],
    });
    ctl.startPickMode('node', {
      onPick: (latlng) => {
        clearDrawbar();
        openNodeModal({ type, latlng });
      },
      onCancel: () => clearDrawbar(),
    });
    toolbar.querySelector('[data-action="draw"]')?.classList.remove('active');
  };

  const beginCableDraw = () => {
    addMenu.classList.remove('open');
    toolbar.querySelector('[data-action="edit-route"]')?.classList.remove('active');
    ctl?.cancelRoutePick({ silent: true });
    ctl?.cancelEditRoute({ silent: true });
    toolbar.querySelector('[data-action="draw"]')?.classList.add('active');
    const update = (path) => {
      showDrawbar({
        title: 'Menggambar rute kabel',
        text: path.length ? `${path.length} titik · ${fmt.km(pathLength(path))}` : 'Klik peta untuk titik awal, lanjutkan mengikuti jalur kabel.',
        actions: [
          { id: 'undo', icon: 'swap', title: 'Hapus titik terakhir' },
          { id: 'finish', label: 'Selesai', icon: 'check', primary: true },
          { id: 'cancel', icon: 'x', title: 'Batal' },
        ],
      });
    };
    ctl.startDrawCable({ color: '#22d3ee', onChange: update, onFinish: (path) => {
      toolbar.querySelector('[data-action="draw"]')?.classList.remove('active');
      clearDrawbar();
      openCableModal({ path, onSaved: () => {} });
    } });
    update([]);
  };

  const setBasemap = (id) => {
    const bm = ctl.setBasemap(id);
    if (!bm) return;
    view.querySelectorAll('[data-bm]').forEach((b) => b.classList.toggle('active', b.dataset.bm === id));
    const name = view.querySelector('#bm-name');
    const group = view.querySelector('#bm-group');
    const thumb = view.querySelector('#bm-thumb');
    if (name) name.textContent = bm.name;
    if (group) group.textContent = bm.group || 'Basemap';
    if (thumb) thumb.style.background = bm.accent || '#0b1220';
    api.put('/settings', { map: { basemap: id } }).catch(() => {});
    toast.info('Basemap diganti', bm.name);
  };

  const cycleBasemap = () => {
    const list = availableBasemaps();
    const idx = list.findIndex((b) => b.id === (ctl.getBasemap()?.id || ''));
    const next = list[(idx + 1) % list.length];
    if (next) setBasemap(next.id);
  };

  const openCoordinateModal = async (latlng) => {
    const [lat, lng] = latlng;
    const nearest = state.nodes
      .map((n) => ({ n, d: Math.hypot(n.lat - lat, n.lng - lng) * 111320 }))
      .sort((a, b) => a.d - b.d)[0];
    modal({
      title: 'Titik koordinat',
      subtitle: 'Koordinat diambil dari posisi klik pada peta',
      iconName: 'crosshair',
      size: 'sm',
      body: `<div class="locator-result" style="margin-top:0">
        <div class="locator-result__head">${icon('pin')} Latitude / Longitude</div>
        <div class="locator-result__coords">${fmt.coord(lat, lng, 7)}</div>
        <div class="locator-result__meta"><span>WGS84</span><span>${nearest ? `terdekat: ${esc(nearest.n.name)} (${fmt.km(nearest.d)})` : 'belum ada node terdekat'}</span></div>
      </div>
      <div class="hint mt-2">${icon('info')} Gunakan koordinat ini untuk menambah node, atau salin ke perangkat GPS/OTDR.</div>`,
      footer: `<button class="btn btn-soft" data-copy>${icon('copy')} Salin</button>
        <button class="btn btn-primary" data-add>${icon('plus')} Tambah node di sini</button>`,
      onMount(ui, root) {
        root.querySelector('[data-copy]').addEventListener('click', () => copyText(`${lat.toFixed(7)}, ${lng.toFixed(7)}`));
        root.querySelector('[data-add]').addEventListener('click', () => { ui.close(); openNodeModal({ latlng }); });
      },
    });
  };

  ctl = createMap(canvas, {
    onNode: (node) => openNodeDrawer(node),
    onCable: (cable) => openCableDrawer(cable),
    onFault: (fault) => {
      import('../router.js').then(({ navigate }) => navigate('faults', { faultId: fault.id }));
    },
    onMouseMove: ({ lat, lng, zoom }) => {
      const a = view.querySelector('#coord-lat');
      const b = view.querySelector('#coord-lng');
      const z = view.querySelector('#coord-zoom');
      const z2 = view.querySelector('#zoom-label');
      if (a) a.textContent = lat.toFixed(6);
      if (b) b.textContent = lng.toFixed(6);
      if (z) z.textContent = zoom.toFixed(2);
      if (z2) z2.textContent = Number(zoom).toFixed(1);
    },
    onViewChange: ({ zoom }) => {
      const z = view.querySelector('#coord-zoom');
      const z2 = view.querySelector('#zoom-label');
      if (z) z.textContent = Number(zoom).toFixed(2);
      if (z2) z2.textContent = Number(zoom).toFixed(1);
    },
  });

  ctl.invalidate();
  const viewNow = ctl.getView();
  const zoomLabel = view.querySelector('#zoom-label');
  if (zoomLabel) zoomLabel.textContent = Number(viewNow.zoom).toFixed(1);
  const coordZoom = view.querySelector('#coord-zoom');
  if (coordZoom) coordZoom.textContent = Number(viewNow.zoom).toFixed(2);
  const coordLat = view.querySelector('#coord-lat');
  const coordLng = view.querySelector('#coord-lng');
  if (coordLat) coordLat.textContent = Number(viewNow.center[0]).toFixed(6);
  if (coordLng) coordLng.textContent = Number(viewNow.center[1]).toFixed(6);
  const focus = takeFocus();
  if (focus?.kind === 'node') {
    setTimeout(() => ctl.flyToNode(focus.id), 180);
  } else if (focus?.kind === 'cable') {
    setTimeout(() => ctl.focusCable(focus.id), 180);
  } else if (focus?.kind === 'fault') {
    setTimeout(() => ctl.focusFault(focus.id), 180);
  } else if (focus?.kind === 'point' && Array.isArray(focus.point)) {
    setTimeout(() => ctl.flyToPoint(focus.point, { label: 'Titik yang dicari' }), 180);
  } else if (state.nodes.length && !ctl.hasSavedView()) {
    ctl.fit({ padding: [50, 50], animate: false });
  }

  /* ---------------------------------------------------------------- search */
  const searchBox = view.querySelector('#map-search');
  const searchInput = view.querySelector('#map-search-input');
  const searchResults = view.querySelector('#map-search-results');
  let searchRows = [];
  let searchIndex = 0;

  const closeSearchResults = () => { searchResults.innerHTML = ''; searchRows = []; };

  const renderSearch = () => {
    const q = searchInput.value.trim();
    if (!q) { closeSearchResults(); return; }
    const coord = parseCoordinate(q);
    searchRows = [];
    if (coord) {
      searchRows.push({
        kind: 'coordinate',
        label: `Koordinat · ${fmt.coord(coord.lat, coord.lng, 6)}`,
        sub: `Buka di peta · WGS84 · ${coord.source}`,
        icon: 'crosshair',
        color: 'var(--warn)',
        point: [coord.lat, coord.lng],
      });
    }
    searchRows.push(...searchObjects(q, {
      nodes: state.nodes,
      cables: state.cables,
      faults: state.faults.filter((f) => f.status === 'active'),
      meta: { node: (type) => NODE_TYPES[type] || {}, cable: (type) => CABLE_TYPES[type] || {} },
      limit: coord ? 8 : 12,
    }));
    if (!searchRows.length) {
      searchResults.innerHTML = `<div class="ms-empty">${icon('search')}<span>Tidak ada hasil. Coba nama node/kabel atau koordinat seperti <b>-8.1694, 113.7012</b>.</span></div>`;
      return;
    }
    searchIndex = Math.min(searchIndex, searchRows.length - 1);
    searchResults.innerHTML = searchRows.map((row, i) => `
      <button class="ms-result ${i === searchIndex ? 'active' : ''}" data-ms-index="${i}">
        <span class="cell-icon" style="color:${esc(row.color)}">${icon(row.icon || 'pin')}</span>
        <span class="grow"><b>${esc(row.label)}</b><span>${esc(row.sub || '')}</span></span>
        <span class="ms-kind">${esc(row.kind)}</span>
      </button>`).join('');
    searchResults.querySelector(`[data-ms-index="${searchIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const chooseSearch = (i = searchIndex) => {
    const row = searchRows[i];
    if (!row) return;
    if (row.kind === 'coordinate') {
      ctl.flyToPoint(row.point, { label: 'Titik yang dicari' });
      toast.info('Koordinat ditemukan', `${fmt.coord(row.point[0], row.point[1], 6)} · WGS84.`);
    } else if (row.kind === 'node') {
      ctl.flyToNode(row.id);
    } else if (row.kind === 'cable') {
      ctl.focusCable(row.id);
    } else if (row.kind === 'fault') {
      ctl.focusFault(row.id);
    }
    closeSearchResults();
  };

  searchInput.addEventListener('focus', () => {
    if (ctl.isPicking() || ctl.isDrawing()) {
      ctl.cancelPick({ silent: true });
      ctl.cancelDrawCable({ silent: true });
      toolbar.querySelector('[data-action="draw"]')?.classList.remove('active');
      clearDrawbar();
    }
    if (searchInput.value.trim()) renderSearch();
  });
  searchInput.addEventListener('input', () => { searchIndex = 0; renderSearch(); });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!searchRows.length) return;
      event.preventDefault();
      searchIndex = event.key === 'ArrowDown'
        ? Math.min(searchRows.length - 1, searchIndex + 1)
        : Math.max(0, searchIndex - 1);
      renderSearch();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      chooseSearch();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSearchResults();
      searchInput.blur();
    }
  });

  searchResults.addEventListener('click', (event) => {
    const row = event.target.closest('[data-ms-index]');
    if (row) chooseSearch(Number(row.dataset.msIndex));
  });

  searchBox.querySelector('[data-search-clear]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    searchInput.value = '';
    closeSearchResults();
    ctl.clearSearchPin();
    searchInput.focus();
  });

  searchBox.querySelector('[data-search-paste]')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { toast.warn('Clipboard kosong', 'Salin koordinat terlebih dahulu.'); return; }
      searchInput.value = text.trim();
      searchIndex = 0;
      renderSearch();
      searchInput.focus();
    } catch {
      toast.warn('Clipboard tidak dapat dibaca', 'Browser memblokir akses clipboard. Tekan Ctrl+V di kolom pencarian.');
      searchInput.focus();
    }
  });

  const closeSearchOutside = (event) => {
    if (!searchBox.contains(event.target)) closeSearchResults();
  };
  document.addEventListener('click', closeSearchOutside);

  /* ------------------------------------------------------------ edit rute */
  const routeInfo = (path) => `${(path || []).length} titik · ${fmt.km(pathLength(path || []))}`;

  const beginRouteEdit = (cable) => {
    if (!cable) return;
    toolbar.querySelector('[data-action="edit-route"]')?.classList.add('active');
    const updateText = (path) => {
      const el = drawbarSlot.querySelector('.db-text span');
      if (el) el.textContent = `${cable.name} · ${routeInfo(path)}`;
    };
    showDrawbar({
      title: 'Edit rute',
      text: `${cable.name} · ${routeInfo(cable.path)}`,
      actions: [
        { id: 'route-add', label: 'Tambah titik', icon: 'plus' },
        { id: 'route-delete', label: 'Hapus titik', icon: 'trash' },
        { id: 'route-undo', icon: 'swap', title: 'Hapus titik terakhir' },
        { id: 'route-reset', icon: 'refresh', title: 'Kembalikan rute awal' },
        { id: 'route-cancel', label: 'Batal', icon: 'x' },
        { id: 'route-save', label: 'Simpan rute', icon: 'save', primary: true },
      ],
    });
    ctl.startEditRoute(cable, {
      onChange: updateText,
      onSave: async (path) => {
        try {
          await api.put(`/cables/${cable.id}`, { path });
          ctl.cancelEditRoute({ silent: true });
          toolbar.querySelector('[data-action="edit-route"]')?.classList.remove('active');
          clearDrawbar();
          toast.success('Rute tersimpan', `${cable.name} · ${routeInfo(path)}.`);
          requestRefresh();
        } catch (err) {
          errorToast(err);
        }
      },
      onCancel: () => {
        toolbar.querySelector('[data-action="edit-route"]')?.classList.remove('active');
        clearDrawbar();
      },
    });
    toast.info('Mode edit rute', 'Seret titik kuning, klik titik untuk memilih, atau Tambah titik lalu klik peta.');
  };

  view.addEventListener('click', async (event) => {
    const menuBtn = event.target.closest('[data-menu]');
    if (menuBtn) {
      event.stopPropagation();
      addMenu.classList.toggle('open');
      return;
    }
    const addNode = event.target.closest('[data-add-node]');
    if (addNode) { beginNodePlacement(addNode.dataset.addNode); return; }

    const bm = event.target.closest('[data-bm]');
    if (bm) { setBasemap(bm.dataset.bm); return; }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) {
      if (action === 'draw') {
        if (ctl.isDrawing()) { ctl.cancelDrawCable(); toolbar.querySelector('[data-action="draw"]')?.classList.remove('active'); clearDrawbar(); }
        else if (ctl.isPicking()) { ctl.cancelPick(); clearDrawbar(); }
        else beginCableDraw();
      } else if (action === 'edit-route') {
        if (ctl.isRouteEditing()) {
          ctl.cancelEditRoute();
          toolbar.querySelector('[data-action="edit-route"]')?.classList.remove('active');
          clearDrawbar();
        } else {
          showDrawbar({
            title: 'Edit rute kabel',
            text: 'Klik kabel di peta yang rutenya ingin diubah.',
            actions: [{ id: 'cancel', label: 'Batal', icon: 'x' }],
          });
          ctl.startRoutePick({
            onPick: (cable) => beginRouteEdit(cable),
            onCancel: () => clearDrawbar(),
          });
        }
      } else if (action === 'locate') {
        try {
          const result = await ctl.locate();
          toast.success('Lokasi ditemukan', `Akurasi ±${Math.round(result.accuracy || 0)} m.`);
        } catch (err) { toast.error('Gagal membaca lokasi', err.message); }
      } else if (action === 'coordinate') {
        if (ctl.isPicking() || ctl.isDrawing()) { ctl.cancelPick({ silent: true }); ctl.cancelDrawCable({ silent: true }); clearDrawbar(); }
        showDrawbar({ title: 'Ambil titik koordinat', text: 'Klik peta untuk menampilkan latitude/longitude.', actions: [{ id: 'cancel', label: 'Batal', icon: 'x' }] });
        ctl.startPickMode('coordinate', {
          onPick: (ll) => { clearDrawbar(); openCoordinateModal(ll); },
          onCancel: () => clearDrawbar(),
        });
      } else if (action === 'layers') {
        const willOpen = side.classList.contains('collapsed');
        setSideState(!willOpen);
        if (window.innerWidth <= 640 && willOpen) side.classList.add('mobile-open');
      } else if (action === 'fit') {
        ctl.fit();
        toast.info('Peta di-fit', 'Menampilkan seluruh node dan kabel.');
      } else if (action === 'fullscreen') {
        const page = view.querySelector('.map-page');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else page?.requestFullscreen?.().then(() => ctl.invalidate()).catch(() => toast.warn('Fullscreen ditolak', 'Browser tidak mengizinkan mode fullscreen.'));
      } else if (action === 'cycle-bm') {
        cycleBasemap();
      } else if (action === 'all-layers') {
        for (const type of Object.keys(NODE_TYPES)) state.filters.nodes[type] = true;
        for (const type of Object.keys(CABLE_TYPES)) state.filters.cables[type] = true;
        state.filters.faults = true;
        view.querySelectorAll('[data-layer-node],[data-layer-cable],[data-layer-fault]').forEach((c) => { c.checked = true; });
        saveFilters();
        ctl.refreshFilters();
        toast.info('Semua layer aktif', 'Seluruh node, kabel, dan marker gangguan ditampilkan.');
      }
      return;
    }

    const db = event.target.closest('[data-db]')?.dataset.db;
    if (db) {
      if (db === 'cancel') {
        ctl.cancelPick();
        ctl.cancelRoutePick();
        ctl.cancelEditRoute();
        ctl.cancelDrawCable();
        toolbar.querySelector('[data-action="draw"]')?.classList.remove('active');
        toolbar.querySelector('[data-action="edit-route"]')?.classList.remove('active');
        clearDrawbar();
      } else if (db === 'route-add') {
        ctl.addRoutePoint();
        toast.info('Tambah titik rute', 'Klik pada peta untuk menambah titik baru.');
      } else if (db === 'route-delete') {
        if (!ctl.deleteRoutePoint()) toast.warn('Titik tidak dihapus', 'Rute minimal terdiri dari dua titik.');
      } else if (db === 'route-undo') {
        if (!ctl.undoRoutePoint()) toast.warn('Titik tidak dihapus', 'Rute minimal terdiri dari dua titik.');
      } else if (db === 'route-reset') {
        ctl.resetRouteEdit();
        toast.info('Rute dikembalikan', 'Titik rute kembali ke kondisi sebelum diedit.');
      } else if (db === 'route-save') {
        if (!ctl.finishEditRoute()) toast.warn('Rute belum cukup', 'Rute minimal terdiri dari dua titik.');
      } else if (db === 'route-cancel') {
        ctl.cancelEditRoute();
        toolbar.querySelector('[data-action="edit-route"]')?.classList.remove('active');
        clearDrawbar();
      } else if (db === 'undo') {
        ctl.undoDrawPoint();
        const path = ctl.getDrawPath();
        if (!path.length) { ctl.cancelDrawCable(); toolbar.querySelector('[data-action="draw"]')?.classList.remove('active'); clearDrawbar(); }
      } else if (db === 'finish') {
        if (!ctl.finishDrawCable()) {
          toast.warn('Rute belum cukup', 'Tambahkan minimal dua titik pada peta.');
        }
      }
      return;
    }
  });

  view.querySelector('#map-side-toggle')?.addEventListener('click', (event) => {
    event.stopPropagation();
    setSideState(false);
    side.classList.toggle('mobile-open');
  });

  view.querySelectorAll('[data-layer-node]').forEach((input) => {
    input.addEventListener('change', () => {
      state.filters.nodes[input.dataset.layerNode] = input.checked;
      saveFilters();
      ctl.refreshFilters();
    });
  });
  view.querySelectorAll('[data-layer-cable]').forEach((input) => {
    input.addEventListener('change', () => {
      state.filters.cables[input.dataset.layerCable] = input.checked;
      saveFilters();
      ctl.refreshFilters();
    });
  });
  view.querySelector('[data-layer-fault]')?.addEventListener('change', (event) => {
    state.filters.faults = event.target.checked;
    saveFilters();
    ctl.refreshFilters();
  });
  view.querySelector('[data-layer-labels]')?.addEventListener('change', (event) => {
    state.filters.labels = event.target.checked;
    saveFilters();
    ctl.setLabels(event.target.checked);
  });
  view.querySelector('[data-layer-anim]')?.addEventListener('change', (event) => {
    state.filters.animate = event.target.checked;
    saveFilters();
    ctl.setAnimations(event.target.checked);
  });

  const hideMenu = (event) => {
    if (!toolbar.contains(event.target)) addMenu.classList.remove('open');
  };
  document.addEventListener('click', hideMenu);

  registerCleanup(() => {
    document.removeEventListener('click', hideMenu);
    document.removeEventListener('click', closeSearchOutside);
    ctl?.destroy();
  });
}

export default { render };
