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

  if (!opts.mini && project?.id) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`${VIEW_KEY}.${project.id}`) || 'null');
      if (saved && Number.isFinite(saved.lat)) {
        center = [saved.lat, saved.lng];
        zoom = saved.zoom;
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
    zoomSnap: 0.25,
    wheelPxPerZoomLevel: 90,
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
  };

  let drawState = null;
  let pickState = null;
  let userMarker = null;
  let accuracyCircle = null;

  function applyContainerClasses() {
    container.classList.toggle('no-labels', !state.filters.labels);
    container.classList.toggle('no-anim', !state.filters.animate);
  }

  function setBasemap(id, { silent = false } = {}) {
    const list = state.basemaps || [];
    const custom = (state.settings.customBasemaps || []).filter((b) => b.enabled !== false && b.url && !b.url.includes('YOUR_KEY'));
    const chosen = [...list, ...custom.map((b) => ({ ...b, maxZoom: 22 }))].find((b) => b.id === id) || list[0];
    if (!chosen) return null;
    currentBasemap = chosen;
    if (tileLayer) {
      map.removeLayer(tileLayer);
      tileLayer = null;
    }
    if (chosen.url) {
      const tileOpts = {
        maxZoom: chosen.maxZoom || 19,
        maxNativeZoom: chosen.maxZoom || 19,
        attribution: chosen.attribution || '',
        crossOrigin: true,
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
        const el = event.popup.getElement();
        el?.querySelector('[data-open-node]')?.addEventListener('click', () => {
          marker.closePopup();
          opts.onNode?.(node);
        });
      });
      marker.on('click', () => { if (!pickState && !drawState) marker.openPopup(); });
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

      const open = () => { if (!pickState && !drawState) opts.onCable?.(cable); };
      line.on('click', open);
      hit.on('click', open);
      line.bindPopup(cablePopup(cable), { maxWidth: 290 });
      line.on('popupopen', (event) => {
        const popupEl = event.popup.getElement();
        popupEl?.querySelector('[data-open-cable]')?.addEventListener('click', () => {
          line.closePopup();
          opts.onCable?.(cable);
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
        event.popup.getElement()?.querySelector('[data-open-fault]')?.addEventListener('click', () => opts.onFault?.(fault));
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

  function setPickMode(kind, { onPick, onCancel, onChange } = {}) {
    cancelPick();
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
    fit,
    flyToNode,
    focusCable,
    focusFault,
    locate,
    showUserLocation,
    startPickMode: setPickMode,
    cancelPick,
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
