/* lintasJB NMS — Leaflet map engine */
import { state, faultForCable, faultForNode } from './state.js';
import { esc, icon, nodeMeta, cableMeta, fmt, NODE_STATUS, statusPill, cableAnimClasses } from './ui.js';
import { pointAtDistance, pathLength } from './geo.js';

const L = window.L;
const VIEW_KEY = 'lintasjb.mapview';

const WEIGHT = { backbone: 5.5, feeder: 4.4, distribution: 3.4, drop: 2.4 };

export function createMap(container, options = {}) {
  const opts = {
    mini: false,
    interactive: true,
    onNode: null,
    onCable: null,
    onFault: null,
    onMouseMove: null,
    onViewChange: null,
    ...options,
  };
  if (!L) throw new Error('Leaflet gagal dimuat.');
  const project = state.project;
  const settingsMap = state.settings?.map || {};
  let center = project?.center || settingsMap.center || [-8.2, 114.02];
  let zoom = project?.zoom || settingsMap.zoom || 10;
  let restoredView = false;

  if (!opts.mini && project?.id) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`${VIEW_KEY}.${project.id}`) || 'null');
      if (saved && Number.isFinite(saved.lat)) {
        center = [saved.lat, saved.lng];
        zoom = saved.zoom;
        restoredView = true;
      }
    } catch { /* ignore */ }
  }

  let destroyed = false;
  const map = L.map(container, {
    center,
    zoom,
    zoomControl: false,
    attributionControl: !opts.mini,
    preferCanvas: false,
    minZoom: 2,
    maxZoom: 22,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 140,
    wheelDebounceTime: 30,
    inertia: true,
    inertiaDeceleration: 3000,
    inertiaMaxSpeed: 1400,
    easeLinearity: 0.25,
    zoomAnimationThreshold: 4,
    fadeAnimation: true,
    markerZoomAnimation: true,
    doubleClickZoom: true,
    dragging: opts.interactive,
    touchZoom: opts.interactive,
    scrollWheelZoom: opts.interactive,
    boxZoom: opts.interactive,
    keyboard: opts.interactive,
    tap: opts.interactive,
  });
  if (!opts.mini) {
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 120 }).addTo(map);
    if (map.attributionControl) map.attributionControl.setPrefix(false);
  }

  map.createPane('cablesPane');
  map.getPane('cablesPane').style.zIndex = 410;
  map.createPane('faultsPane');
  map.getPane('faultsPane').style.zIndex = 660;

  let tileLayer = null;
  let currentBasemap = null;

  const layers = {
    cables: L.layerGroup().addTo(map),
    nodes: L.layerGroup().addTo(map),
    faults: L.layerGroup().addTo(map),
    user: L.layerGroup().addTo(map),
    draw: L.layerGroup().addTo(map),
    search: L.layerGroup().addTo(map),
    routeHandles: L.layerGroup().addTo(map),
  };

  let drawState = null;
  let pickState = null;
  let userMarker = null;
  let accuracyCircle = null;
  let searchMarker = null;
  let routePickState = null;
  let routeEditState = null;

  function applyContainerClasses() {
    container.classList.toggle('no-labels', !state.filters.labels);
    container.classList.toggle('no-anim', !state.filters.animate);
  }

  function setBasemap(id, { silent = false } = {}) {
    const list = state.basemaps || [];
    const custom = (state.settings.customBasemaps || [])
      .filter((b) => b.enabled !== false && b.url && !b.url.includes('YOUR_KEY'))
      .map((b) => ({ ...b, maxNativeZoom: b.maxNativeZoom ?? b.maxZoom ?? 19 }));
    const chosen = [...list, ...custom].find((b) => b.id === id) || list[0];
    if (!chosen) return null;
    currentBasemap = chosen;
    if (tileLayer) {
      map.removeLayer(tileLayer);
      tileLayer = null;
    }
    if (chosen.url) {
      // maxNativeZoom = zoom tertinggi yang benar-benar tersedia dari penyedia.
      // Di atas itu Leaflet memperbesar tile terakhir, sehingga tidak muncul
      // placeholder "Map data not yet available" saat zoom dekat.
      const native = chosen.maxNativeZoom ?? chosen.maxZoom ?? 19;
      // Batasi zoom tampilan beberapa level di atas zoom asli penyedia.
      // Di perangkat sentuh, pinch zoom mudah melewati batas tile sehingga
      // memunculkan placeholder "Map data not yet available".
      const viewMax = Math.min(22, native + 3);
      map.setMaxZoom(viewMax);
      const tileOpts = {
        maxZoom: viewMax,
        maxNativeZoom: native,
        attribution: chosen.attribution || '',
        crossOrigin: true,
        keepBuffer: 4,
        updateWhenZooming: false,
        className: 'nms-tiles',
      };
      if (chosen.subdomains) tileOpts.subdomains = chosen.subdomains;
      tileLayer = L.tileLayer(chosen.url, tileOpts);
      tileLayer.addTo(map);
      tileLayer.bringToBack();
    }
    if (!silent) {
      state.settings.map.basemap = chosen.id;
      document.dispatchEvent(new CustomEvent('nms:basemap', { detail: chosen.id }));
    }
    return chosen;
  }

  /**
   * Pasang listener aksi pada KONTEN popup, bukan pada tombolnya.
   * Leaflet menulis ulang innerHTML popup setelah event popupopen, sehingga
   * tombol yang ada saat event itu fired bukan lagi tombol yang diklik user.
   * Elemen popup-nya sendiri stabil, jadi delegation di sini aman.
   */
  function bindPopupAction(popupEl, selector, handler) {
    if (!popupEl || popupEl.dataset.actionBound === '1') return;
    popupEl.dataset.actionBound = '1';
    popupEl.addEventListener('click', (event) => {
      const trigger = event.target.closest?.(selector);
      if (!trigger) return;
      handler(trigger);
    });
  }

  function nodePopup(node) {
    const m = nodeMeta(node.type);
    return `<div style="min-width:200px">
      <div class="row" style="gap:7px">
        <span class="cell-icon" style="color:${m.color};width:24px;height:24px">${icon(m.icon)}</span>
        <div><b style="font-size:12px">${esc(node.name)}</b><div style="font-size:9.5px;color:#8ba0bd">${esc(m.label)} · ${esc(node.code || '—')}</div></div>
      </div>
      <div class="row" style="margin-top:8px;gap:6px">${statusPill(node.status)}<span class="muted" style="font-size:9.5px">${esc(node.address || '')}</span></div>
      <button class="btn btn-xs btn-primary" style="margin-top:9px" data-open-node="${esc(node.id)}">Detail node</button>
    </div>`;
  }

  function cablePopup(cable) {
    const m = cableMeta(cable.type);
    const fault = faultForCable(cable.id);
    return `<div style="min-width:205px">
      <div class="row" style="gap:7px">
        <span class="cell-icon" style="color:${cable.color || m.color};width:24px;height:24px">${icon(m.icon)}</span>
        <div><b style="font-size:12px">${esc(cable.name)}</b><div style="font-size:9.5px;color:#8ba0bd">${esc(m.label)} · ${esc(cable.code || '—')}</div></div>
      </div>
      <div class="row" style="margin-top:8px;gap:10px;font-size:9.5px;color:#8ba0bd">
        <span>${fmt.km(cable.lengthM)}</span><span>${Number(cable.fiberCount) || 0} core</span>
        ${fault ? '<span style="color:#ff7f95">GANGGUAN</span>' : ''}
      </div>
      <button class="btn btn-xs btn-primary" style="margin-top:9px" data-open-cable="${esc(cable.id)}">Detail kabel</button>
    </div>`;
  }

  function renderNodes() {
    layers.nodes.clearLayers();
    for (const node of state.nodes) {
      if (state.filters.nodes[node.type] === false) continue;
      const meta = nodeMeta(node.type);
      const fault = faultForNode(node.id);
      const html = `<div class="node-marker type-${esc(node.type)} st-${esc(node.status)} ${fault ? 'is-fault' : ''}" style="--node-color:${meta.color}">
        <div class="nm-halo"></div>
        <div class="nm-icon">${icon(meta.icon)}</div>
        <div class="nm-status ${esc(node.status)}"></div>
        <div class="nm-label">${esc(node.name)}</div>
      </div>`;
      const marker = L.marker([node.lat, node.lng], {
        icon: L.divIcon({ className: 'node-icon-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
        riseOnHover: true,
        zIndexOffset: node.type === 'pop' ? 900 : node.type === 'olt' ? 800 : node.type === 'ont' ? 100 : 400,
        pane: 'markerPane',
      });
      marker.bindPopup(nodePopup(node), { closeButton: true, offset: [0, -12], maxWidth: 280 });
      marker.on('popupopen', (event) => {
        bindPopupAction(event.popup.getElement(), '[data-open-node]', (btn) => {
          const target = state.nodes.find((n) => n.id === btn.dataset.openNode);
          if (!target) return;
          marker.closePopup();
          opts.onNode?.(target);
        });
      });
      marker.on('click', () => {
        if (!pickState && !drawState && !routePickState && !routeEditState) marker.openPopup();
      });
      marker.addTo(layers.nodes);
    }
  }

  function renderCables() {
    layers.cables.clearLayers();
    for (const cable of state.cables) {
      if (state.filters.cables[cable.type] === false) continue;
      if (!Array.isArray(cable.path) || cable.path.length < 2) continue;
      const fault = faultForCable(cable.id);
      const color = cable.color || cableMeta(cable.type).color;
      const weight = WEIGHT[cable.type] || 3;
      const anim = cable.animation?.type || 'flow';
      const speed = Number(cable.animation?.speed) || 1;
      const reverse = Boolean(cable.animation?.reverse);

      const casing = L.polyline(cable.path, {
        pane: 'cablesPane',
        color: '#04101c',
        weight: weight + 4.5,
        opacity: 0.62,
        lineCap: 'round',
        interactive: false,
      });
      casing.addTo(layers.cables);

      const classes = cableAnimClasses(anim, { reverse, fault: Boolean(fault) }).split(' ');
      if (cable.status === 'planned' || cable.status === 'decommissioned') classes.push('cable-dim');

      const line = L.polyline(cable.path, {
        pane: 'cablesPane',
        color: fault ? '#ff3355' : color,
        weight,
        opacity: fault ? 1 : cable.status === 'planned' ? 0.5 : 0.92,
        dashArray: cable.status === 'planned' ? '7 8' : null,
        className: classes.join(' '),
        interactive: true,
        bubblingMouseEvents: false,
      });
      line.addTo(layers.cables);
      const el = line.getElement?.();
      if (el) {
        el.style.setProperty('--cable-color', color);
        el.style.setProperty('--dur', `${Math.max(0.35, 1.25 / speed).toFixed(2)}s`);
      }

      const hit = L.polyline(cable.path, {
        pane: 'cablesPane',
        color: '#ffffff',
        weight: Math.max(16, weight + 10),
        opacity: 0,
        interactive: true,
      });
      hit.addTo(layers.cables);

      const open = () => {
        if (routePickState) {
          const pick = routePickState.onPick;
          cancelRoutePick({ silent: true });
          setTimeout(() => map.closePopup(), 0);
          pick?.(cable);
          return;
        }
        if (routeEditState) { setTimeout(() => map.closePopup(), 0); return; }
        if (!pickState && !drawState) opts.onCable?.(cable);
      };
      line.on('click', open);
      hit.on('click', open);
      line.bindPopup(cablePopup(cable), { maxWidth: 290 });
      line.on('popupopen', (event) => {
        bindPopupAction(event.popup.getElement(), '[data-open-cable]', (btn) => {
          const target = state.cables.find((c) => c.id === btn.dataset.openCable);
          if (!target) return;
          line.closePopup();
          opts.onCable?.(target);
        });
      });
      hit.bindTooltip(
        `<b>${esc(cable.name)}</b><br><span style="color:#8ba0bd">${esc(cableMeta(cable.type).label)} · ${fmt.km(cable.lengthM)}${fault ? ' · GANGGUAN' : ''}</span>`,
        { sticky: true, direction: 'top', opacity: 1 }
      );
    }
  }

  function renderFaults() {
    layers.faults.clearLayers();
    if (!state.filters.faults) return;
    for (const fault of state.faults.filter((f) => f.status === 'active' && Array.isArray(f.point))) {
      const html = `<div class="fault-marker">
        <div class="fm-rings"><div class="fm-core">${icon('alert-triangle')}</div></div>
        <div class="fm-label">${esc(fault.type === 'device' ? 'GANGGUAN PERANGKAT' : `PUTUS · ${fmt.km(fault.distanceM)}`)}</div>
      </div>`;
      const marker = L.marker(fault.point, {
        icon: L.divIcon({ className: 'fault-marker-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
        zIndexOffset: 2000,
        pane: 'faultsPane',
        interactive: true,
      });
      marker.bindPopup(`<div style="min-width:210px">
        <div class="row" style="gap:7px;color:#ff7f95"><b style="font-size:12px">${esc(fault.title)}</b></div>
        <p style="font-size:10px;color:#c3d2e7;margin-top:5px">${esc(fault.description || '')}</p>
        <div class="mono" style="font-size:9.5px;color:#8ba0bd;margin-top:6px">${fmt.coord(fault.point[0], fault.point[1])}</div>
        <button class="btn btn-xs btn-danger" style="margin-top:9px" data-open-fault="${esc(fault.id)}">Buka fault locator</button>
      </div>`, { maxWidth: 300 });
      marker.on('popupopen', (event) => {
        bindPopupAction(event.popup.getElement(), '[data-open-fault]', (btn) => {
          const target = state.faults.find((f) => f.id === btn.dataset.openFault);
          if (target) opts.onFault?.(target);
        });
      });
      marker.addTo(layers.faults);
    }
  }

  function renderAll() {
    applyContainerClasses();
    renderCables();
    renderFaults();
    renderNodes();
  }

  function fit({ padding = [40, 40], animate = true } = {}) {
    const points = [];
    for (const node of state.nodes) {
      if (state.filters.nodes[node.type] === false) continue;
      points.push([node.lat, node.lng]);
    }
    for (const cable of state.cables) {
      if (state.filters.cables[cable.type] === false) continue;
      for (const p of cable.path || []) points.push(p);
    }
    if (!points.length) {
      map.setView(state.project?.center || state.settings.map.center || [-8.2, 114.02], state.project?.zoom || 10, { animate });
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding, maxZoom: 16, animate });
  }

  function flyToNode(nodeId, { zoom: targetZoom = 17 } = {}) {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    map.flyTo([node.lat, node.lng], targetZoom, { duration: 0.8 });
    const marker = layers.nodes.getLayers().find((m) => {
      const ll = m.getLatLng?.();
      return ll && Math.abs(ll.lat - node.lat) < 1e-9 && Math.abs(ll.lng - node.lng) < 1e-9;
    });
    setTimeout(() => marker?.openPopup?.(), 900);
  }

  function focusCable(cableId) {
    const cable = state.cables.find((c) => c.id === cableId);
    if (!cable) return;
    map.fitBounds(L.latLngBounds(cable.path), { padding: [60, 60], maxZoom: 17 });
  }

  function focusFault(faultId) {
    const fault = state.faults.find((f) => f.id === faultId);
    if (!fault?.point) return;
    map.flyTo(fault.point, 17, { duration: 0.8 });
  }

  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Browser tidak mendukung geolokasi.'));
        return;
      }
      map.locate({ setView: true, maxZoom: 17, enableHighAccuracy: true, timeout: 12000 });
      const cleanup = () => {
        map.off('locationfound', found);
        map.off('locationerror', failed);
      };
      const found = (event) => {
        cleanup();
        showUserLocation(event.latlng, event.accuracy);
        resolve(event);
      };
      const failed = (event) => {
        cleanup();
        reject(new Error(event.message || 'Lokasi tidak dapat dibaca.'));
      };
      map.on('locationfound', found);
      map.on('locationerror', failed);
    });
  }

  function showUserLocation(latlng, accuracy = 0) {
    if (userMarker) layers.user.removeLayer(userMarker);
    if (accuracyCircle) layers.user.removeLayer(accuracyCircle);
    if (accuracy) {
      accuracyCircle = L.circle(latlng, {
        radius: Math.min(accuracy, 5000),
        className: 'accuracy-circle',
        stroke: true,
        weight: 1,
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(layers.user);
    }
    const html = `<div class="user-location"><div class="ul-ring"></div><div class="ul-dot"></div></div>`;
    userMarker = L.marker(latlng, {
      icon: L.divIcon({ className: 'node-icon-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
      zIndexOffset: 2500,
      interactive: false,
    }).addTo(layers.user);
    userMarker.bindTooltip('Lokasi Anda', { direction: 'top', offset: [0, -14] });
  }

  function showSearchPin(point, label = 'Titik koordinat') {
    if (searchMarker) layers.search.removeLayer(searchMarker);
    const html = `<div class="search-location"><div class="sl-ring"></div><div class="sl-dot"></div></div>`;
    searchMarker = L.marker(point, {
      icon: L.divIcon({ className: 'search-pin-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
      zIndexOffset: 2400,
    }).addTo(layers.search);
    searchMarker.bindPopup(
      `<div style="min-width:180px">
        <div class="row" style="gap:7px"><span style="color:var(--warn)">${icon('crosshair')}</span><b>${esc(label)}</b></div>
        <div class="mono" style="font-size:10px;color:#8ba0bd;margin-top:6px">${fmt.coord(point[0], point[1], 7)}</div>
        <div style="font-size:9.5px;color:#8ba0bd;margin-top:4px">WGS84 · gunakan tombol ambil koordinat untuk titik baru</div>
      </div>`,
      { maxWidth: 260 }
    );
    searchMarker.bindTooltip(`${icon('pin')} ${esc(label)}`, { direction: 'top', offset: [0, -12] });
    return searchMarker;
  }

  function flyToPoint(point, { zoom = 17, label = 'Titik koordinat' } = {}) {
    if (!Array.isArray(point) || point.length < 2) return;
    const ll = [Number(point[0]), Number(point[1])];
    if (!ll.every(Number.isFinite)) return;
    map.flyTo(ll, zoom, { duration: 0.8 });
    showSearchPin(ll, label);
    setTimeout(() => { if (!destroyed) searchMarker?.openPopup?.(); }, 850);
  }

  function clearSearchPin() {
    if (searchMarker) layers.search.removeLayer(searchMarker);
    searchMarker = null;
  }

  /* ------------------------------------ edit rute kabel -------------------- */
  function startRoutePick({ onPick, onCancel } = {}) {
    cancelRoutePick({ silent: true });
    cancelEditRoute({ silent: true });
    routePickState = { onPick, onCancel };
    container.classList.add('mode-route-pick');
    map.getContainer().style.cursor = 'crosshair';
  }

  function cancelRoutePick({ silent = false } = {}) {
    if (!routePickState) return;
    const prev = routePickState;
    routePickState = null;
    container.classList.remove('mode-route-pick');
    map.getContainer().style.cursor = '';
    if (!silent) prev.onCancel?.();
  }

  function redrawRouteLine() {
    if (!routeEditState) return;
    if (routeEditState.line) {
      layers.draw.removeLayer(routeEditState.line);
      routeEditState.line = null;
    }
    if (routeEditState.path.length < 2) return;
    routeEditState.line = L.polyline(routeEditState.path, {
      pane: 'cablesPane',
      color: '#f5a524',
      weight: 7,
      opacity: 1,
      dashArray: '9 7',
      className: 'route-edit-line',
    }).addTo(layers.draw);
  }

  function renderRouteEdit() {
    if (!routeEditState) return;
    layers.routeHandles.clearLayers();
    redrawRouteLine();
    routeEditState.path.forEach((p, i) => {
      const selected = i === routeEditState.selected;
      const marker = L.marker(p, {
        icon: L.divIcon({
          className: 'route-handle-wrap',
          html: `<div class="route-handle ${selected ? 'selected' : ''}">${i + 1}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        draggable: true,
        autoPan: true,
        zIndexOffset: 2200 + i,
        bubblingMouseEvents: false,
      }).addTo(layers.routeHandles);
      marker.bindTooltip(`Titik ${i + 1} · ${fmt.coord(p[0], p[1], 6)}`, { direction: 'top', offset: [0, -12] });
      marker.on('drag', (event) => {
        const ll = event.target.getLatLng();
        routeEditState.path[i] = [Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))];
        redrawRouteLine();
      });
      marker.on('dragend', () => routeEditState?.onChange?.(routeEditState.path));
      marker.on('click', () => {
        if (!routeEditState) return;
        routeEditState.selected = i;
        renderRouteEdit();
        routeEditState.onChange?.(routeEditState.path);
      });
      marker.on('contextmenu', (event) => {
        L.DomEvent.preventDefault(event.originalEvent);
        deleteRoutePoint(i);
      });
    });
  }

  function startEditRoute(cable, { onChange, onSave, onCancel } = {}) {
    cancelRoutePick({ silent: true });
    cancelEditRoute({ silent: true });
    cancelPick({ silent: true });
    cancelDrawCable({ silent: true });
    const clone = (cable.path || []).map((p) => [Number(p[0]), Number(p[1])]);
    routeEditState = {
      cable,
      path: clone,
      original: clone.map((p) => [...p]),
      selected: -1,
      addMode: false,
      onChange,
      onSave,
      onCancel,
      line: null,
    };
    container.classList.add('mode-edit-route');
    map.getContainer().style.cursor = '';
    routeEditState.onMapClick = (event) => {
      if (!routeEditState?.addMode) return;
      routeEditState.path.push([Number(event.latlng.lat.toFixed(7)), Number(event.latlng.lng.toFixed(7))]);
      routeEditState.selected = routeEditState.path.length - 1;
      routeEditState.addMode = false;
      map.getContainer().style.cursor = '';
      renderRouteEdit();
      routeEditState.onChange?.(routeEditState.path);
    };
    map.on('click', routeEditState.onMapClick);
    renderRouteEdit();
    if (clone.length) map.fitBounds(L.latLngBounds(clone), { padding: [70, 70], maxZoom: 18, animate: true });
  }

  function cancelEditRoute({ silent = false } = {}) {
    if (!routeEditState) return;
    const prev = routeEditState;
    routeEditState = null;
    map.off('click', prev.onMapClick);
    layers.draw.clearLayers();
    layers.routeHandles.clearLayers();
    container.classList.remove('mode-edit-route');
    map.getContainer().style.cursor = '';
    if (!silent) prev.onCancel?.();
  }

  function finishEditRoute() {
    if (!routeEditState || routeEditState.path.length < 2) return false;
    const path = routeEditState.path.map((p) => [...p]);
    routeEditState.onSave?.(path);
    return true;
  }

  function addRoutePoint() {
    if (!routeEditState) return;
    routeEditState.addMode = true;
    map.getContainer().style.cursor = 'crosshair';
    routeEditState.onChange?.(routeEditState.path);
  }

  function deleteRoutePoint(index) {
    if (!routeEditState || routeEditState.path.length <= 2) return false;
    const target = Number.isInteger(index) ? index : routeEditState.selected >= 0 ? routeEditState.selected : routeEditState.path.length - 1;
    if (target < 0 || target >= routeEditState.path.length) return false;
    routeEditState.path.splice(target, 1);
    routeEditState.selected = -1;
    renderRouteEdit();
    routeEditState.onChange?.(routeEditState.path);
    return true;
  }

  function undoRoutePoint() {
    if (!routeEditState || routeEditState.path.length <= 2) return false;
    return deleteRoutePoint(routeEditState.path.length - 1);
  }

  function resetRouteEdit() {
    if (!routeEditState) return;
    routeEditState.path = routeEditState.original.map((p) => [...p]);
    routeEditState.selected = -1;
    routeEditState.addMode = false;
    map.getContainer().style.cursor = '';
    renderRouteEdit();
    routeEditState.onChange?.(routeEditState.path);
  }

  function setPickMode(kind, { onPick, onCancel, onChange } = {}) {
    cancelPick();
    cancelRoutePick({ silent: true });
    cancelEditRoute({ silent: true });
    pickState = { kind, onPick, onCancel, onChange };
    container.classList.toggle('mode-add-node', kind === 'node');
    container.classList.toggle('mode-coordinate', kind === 'coordinate');
    map.getContainer().style.cursor = 'crosshair';
    const move = (event) => {
      if (!pickState) return;
      onChange?.(event.latlng);
    };
    const click = (event) => {
      if (!pickState) return;
      const cb = pickState.onPick;
      const ll = event.latlng;
      cancelPick();
      cb?.([Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))]);
    };
    pickState.offMove = move;
    pickState.offClick = click;
    map.on('mousemove', move);
    map.on('click', click);
    return pickState;
  }

  function cancelPick({ silent = false } = {}) {
    if (!pickState) return;
    const prev = pickState;
    pickState = null;
    map.off('mousemove', prev.offMove);
    map.off('click', prev.offClick);
    container.classList.remove('mode-add-node', 'mode-coordinate');
    map.getContainer().style.cursor = '';
    if (!silent) prev.onCancel?.();
  }

  function redrawDraft() {
    layers.draw.clearLayers();
    if (!drawState) return;
    const path = drawState.path;
    if (path.length) {
      L.polyline(path, {
        pane: 'cablesPane',
        color: drawState.color,
        weight: 4,
        opacity: 0.95,
        dashArray: '10 7',
        className: drawState.path.length > 1 ? 'cable-anim-flow' : '',
      }).addTo(layers.draw);
      path.forEach((p, i) => {
        L.circleMarker(p, {
          radius: i === 0 ? 6 : 4,
          color: drawState.color,
          weight: 2,
          fillColor: '#07101b',
          fillOpacity: 1,
        }).addTo(layers.draw);
        if (i > 0) {
          const seg = pathLength([path[i - 1], p]);
          const mid = [(path[i - 1][0] + p[0]) / 2, (path[i - 1][1] + p[1]) / 2];
          if (seg > 40) {
            L.marker(mid, {
              icon: L.divIcon({ className: '', html: `<span style="font-size:9px;color:#22d3ee;background:#07101bcc;border:1px solid #22d3ee55;padding:1px 4px;border-radius:3px;white-space:nowrap">${fmt.km(seg)}</span>`, iconSize: [0, 0] }),
              interactive: false,
            }).addTo(layers.draw);
          }
        }
      });
    }
    drawState.onChange?.(path);
  }

  function startDrawCable({ color = '#22d3ee', onChange, onFinish } = {}) {
    cancelPick();
    cancelRoutePick({ silent: true });
    cancelEditRoute({ silent: true });
    if (drawState) cancelDrawCable();
    drawState = { path: [], color, onChange, onFinish };
    container.classList.add('mode-draw-cable');
    map.getContainer().style.cursor = 'crosshair';
    map.doubleClickZoom.disable();
    drawState.clickHandler = (event) => {
      if (!drawState) return;
      drawState.path.push([Number(event.latlng.lat.toFixed(7)), Number(event.latlng.lng.toFixed(7))]);
      redrawDraft();
    };
    drawState.moveHandler = (event) => {
      if (!drawState?.path.length) return;
      redrawDraft();
      const path = [...drawState.path, [event.latlng.lat, event.latlng.lng]];
      L.polyline(path.slice(-2), { pane: 'cablesPane', color: drawState.color, weight: 2, opacity: 0.45, dashArray: '5 6' }).addTo(layers.draw);
    };
    map.on('click', drawState.clickHandler);
    map.on('mousemove', drawState.moveHandler);
    redrawDraft();
  }

  function undoDrawPoint() {
    if (!drawState?.path.length) return;
    drawState.path.pop();
    redrawDraft();
  }

  function finishDrawCable() {
    if (!drawState) return false;
    if (drawState.path.length < 2) return false;
    const path = [...drawState.path];
    const cb = drawState.onFinish;
    cleanupDraw();
    cb?.(path);
    return true;
  }

  function cancelDrawCable({ silent = false } = {}) {
    if (!drawState) return;
    const cb = drawState.onCancel;
    cleanupDraw();
    layers.draw.clearLayers();
    if (!silent) cb?.();
  }

  function cleanupDraw() {
    if (!drawState) return;
    map.off('click', drawState.clickHandler);
    map.off('mousemove', drawState.moveHandler);
    map.doubleClickZoom.enable();
    container.classList.remove('mode-draw-cable');
    map.getContainer().style.cursor = '';
    drawState = null;
    layers.draw.clearLayers();
  }

  function setLabels(enabled) {
    state.filters.labels = Boolean(enabled);
    applyContainerClasses();
  }

  function setAnimations(enabled) {
    state.filters.animate = Boolean(enabled);
    applyContainerClasses();
  }

  function refreshFilters() {
    applyContainerClasses();
    renderAll();
  }

  map.on('mousemove', (event) => {
    opts.onMouseMove?.({ lat: event.latlng.lat, lng: event.latlng.lng, zoom: map.getZoom() });
  });
  // Jeda animasi CSS saat peta digeser supaya panning terasa ringan.
  map.on('movestart', () => container.classList.add('map-moving'));
  map.on('moveend', () => container.classList.remove('map-moving'));
  map.on('moveend', () => {
    if (opts.mini) return;
    try {
      const c = map.getCenter();
      sessionStorage.setItem(`${VIEW_KEY}.${state.project?.id || 'default'}`, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
    } catch { /* ignore */ }
    opts.onViewChange?.({ center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() });
  });

  setBasemap(settingsMap.basemap || 'cartoDark', { silent: true });
  renderAll();

  return {
    map,
    layers,
    renderAll,
    renderNodes,
    renderCables,
    renderFaults,
    refreshFilters,
    setBasemap,
    getBasemap: () => currentBasemap,
    hasSavedView: () => restoredView,
    getView: () => ({ center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() }),
    fit,
    flyToNode,
    focusCable,
    focusFault,
    flyToPoint,
    showSearchPin,
    clearSearchPin,
    locate,
    showUserLocation,
    startPickMode: setPickMode,
    cancelPick,
    startRoutePick,
    cancelRoutePick,
    startEditRoute,
    cancelEditRoute,
    finishEditRoute,
    addRoutePoint,
    deleteRoutePoint,
    undoRoutePoint,
    resetRouteEdit,
    isRouteEditing: () => Boolean(routeEditState),
    startDrawCable,
    undoDrawPoint,
    finishDrawCable,
    cancelDrawCable,
    isDrawing: () => Boolean(drawState),
    isPicking: () => Boolean(pickState),
    getDrawPath: () => (drawState ? [...drawState.path] : []),
    setLabels,
    setAnimations,
    invalidate: () => setTimeout(() => {
      if (destroyed || !map.getContainer()?.isConnected) return;
      try { map.invalidateSize(); } catch { /* map detached during route change */ }
    }, 80),
    destroy: () => {
      destroyed = true;
      try { map.remove(); } catch { /* ignore */ }
    },
    pointAtDistance,
  };
}

export default createMap;
