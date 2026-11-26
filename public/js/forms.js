/* lintasJB NMS — shared node/cable forms & detail drawers */
import * as api from './api.js';
import { state, nodeById, cableById, faultForCable, faultForNode, cablesOfNode, childrenOf } from './state.js';
import {
  esc, icon, fmt, modal, drawer, confirmDialog, toast, errorToast,
  nodeMeta, cableMeta, typePicker, bindTypePicker, statusPill, NODE_STATUS, CABLE_STATUS,
  ANIMATIONS, PALETTE, formValues, field, select, statusPill as pill, cableAnimClasses,
} from './ui.js';
import { pathLength, midpoint } from './geo.js';
import { navigate } from './router.js';

export function requestRefresh() {
  document.dispatchEvent(new CustomEvent('nms:refresh'));
}

const nodeOptions = (selected, includeEmpty = true, skipId = '') => {
  const groups = [
    ['pop', 'POP'], ['router', 'Router'], ['server', 'Server'], ['olt', 'OLT'],
    ['odc', 'ODC'], ['closure', 'Joint Closure'], ['odp', 'ODP'], ['ont', 'ONT'],
  ];
  const options = includeEmpty ? [{ value: '', label: '— Tanpa parent —' }] : [];
  for (const [type, label] of groups) {
    for (const node of state.nodes.filter((n) => n.type === type && n.id !== skipId)) {
      options.push({ value: node.id, label: `${label} · ${node.name}${node.code ? ` (${node.code})` : ''}` });
    }
  }
  return options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(selected || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
};

export function openNodeModal({ node = null, latlng = null, type: presetType = 'odp', onSaved } = {}) {
  const editing = Boolean(node);
  const type = node?.type || presetType || 'odp';
  const lat = node?.lat ?? latlng?.[0] ?? state.project?.center?.[0] ?? state.settings.map.center[0];
  const lng = node?.lng ?? latlng?.[1] ?? state.project?.center?.[1] ?? state.settings.map.center[1];
  const body = `
    <form id="node-form" autocomplete="off">
      <div class="form-section">
        <div class="form-section__title">${icon('network')} Tipe node</div>
        ${typePicker('nodeType', type)}
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('info')} Identitas</div>
        <div class="grid-2">
          ${field('Nama node', `<input name="name" value="${esc(node?.name || '')}" placeholder="ODP Kalivates 01" required />`)}
          ${field('Kode', `<input name="code" value="${esc(node?.code || '')}" placeholder="ODP-KLV-01" />`)}
        </div>
        <div class="grid-2 mt-2">
          ${field('Status', `<select name="status">${Object.entries(NODE_STATUS).map(([k, v]) => `<option value="${k}" ${node?.status === k || (!node && k === 'online') ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>`)}
          ${field('Parent / uplink', `<div class="parent-picker"><input type="search" class="parent-picker__search" data-parent-search placeholder="Cari nama atau kode node…" aria-label="Cari parent" /><select name="parentId" data-parent-select>${nodeOptions(node?.parentId, true, node?.id)}</select></div>`)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('pin')} Koordinat</div>
        <div class="position-row">
          ${field('Latitude', `<input name="lat" type="number" step="0.0000001" value="${esc(lat)}" required />`)}
          ${field('Longitude', `<input name="lng" type="number" step="0.0000001" value="${esc(lng)}" required />`)}
        </div>
        <small class="muted" style="display:block;margin-top:6px">Tip: gunakan tombol pin di Live Map untuk mengambil koordinat langsung dari peta.</small>
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('server')} Perangkat</div>
        <div class="grid-2">
          ${field('Vendor', `<input name="vendor" value="${esc(node?.vendor || '')}" placeholder="HiOSO / ZTE / Huawei" />`)}
          ${field('Model', `<input name="model" value="${esc(node?.model || '')}" placeholder="HA7304" />`)}
        </div>
        <div class="grid-2 mt-2">
          ${field('Serial number', `<input name="serial" value="${esc(node?.serial || '')}" placeholder="SN perangkat" />`)}
          ${field('Serial GenieACS', `<input name="genieacsSerial" value="${esc(node?.genieacsSerial || '')}" placeholder="8812A1B2C3D4" />`)}
        </div>
        <div class="grid-3 mt-2">
          ${field('Kapasitas port', `<input name="capacity" type="number" min="0" value="${esc(node?.capacity ?? 0)}" />`)}
          ${field('Port terpakai', `<input name="usedPorts" type="number" min="0" value="${esc(node?.usedPorts ?? 0)}" />`)}
          ${field('OLT terkait', `<select name="oltId"><option value="">— Tidak ada —</option>${(state.integrations.olts || []).map((o) => `<option value="${esc(o.id)}" ${node?.oltId === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('pin')} Detail lokasi</div>
        ${field('Alamat', `<input name="address" value="${esc(node?.address || '')}" placeholder="Jl. Contoh No. 1, Jember" />`)}
        <label class="field mt-2"><span>Catatan</span><textarea name="notes" placeholder="Informasi splitter, port, atau catatan lapangan">${esc(node?.notes || '')}</textarea></label>
      </div>
    </form>`;

  return modal({
    title: editing ? 'Edit node' : 'Tambah node',
    subtitle: editing ? node.name : 'Tambahkan aset FTTH ke project aktif',
    iconName: editing ? 'edit' : 'plus',
    size: 'wide',
    body,
    footer: `<button class="btn btn-soft" data-modal-close>Batal</button>
      <button class="btn btn-primary" data-save>${icon('save')} ${editing ? 'Simpan perubahan' : 'Tambah node'}</button>`,
    onMount(ui, root) {
      let selectedType = type;
      bindTypePicker(root, 'nodeType', (value) => { selectedType = value; });
      const parentSearch = root.querySelector('[data-parent-search]');
      const parentSelect = root.querySelector('[data-parent-select]');
      if (parentSearch && parentSelect) {
        const allOptions = [...parentSelect.options].map((o) => ({ value: o.value, label: o.textContent }));
        parentSearch.addEventListener('input', () => {
          const query = parentSearch.value.trim().toLowerCase();
          const current = parentSelect.value;
          const matches = allOptions.filter((o) =>
            !query || o.value === current || o.label.toLowerCase().includes(query)
          );
          parentSelect.innerHTML = matches
            .map((o) => `<option value="${esc(o.value)}" ${o.value === current ? 'selected' : ''}>${esc(o.label)}</option>`)
            .join('');
        });
      }
      const form = root.querySelector('#node-form');
      const save = root.querySelector('[data-save]');
      save.addEventListener('click', async () => {
        const values = formValues(form);
        if (!values.name?.trim()) { toast.warn('Nama wajib diisi', 'Isi nama node terlebih dahulu.'); return; }
        const payload = {
          projectId: state.projectId,
          type: selectedType,
          name: values.name.trim(),
          code: values.code?.trim() || '',
          status: values.status,
          parentId: values.parentId || null,
          lat: Number(values.lat),
          lng: Number(values.lng),
          vendor: values.vendor || '',
          model: values.model || '',
          serial: values.serial || '',
          genieacsSerial: values.genieacsSerial || '',
          capacity: Number(values.capacity) || 0,
          usedPorts: Number(values.usedPorts) || 0,
          oltId: values.oltId || '',
          address: values.address || '',
          notes: values.notes || '',
        };
        save.disabled = true;
        save.innerHTML = 'Menyimpan…';
        try {
          const result = editing ? await api.put(`/nodes/${node.id}`, payload) : await api.post('/nodes', payload);
          ui.close();
          toast.success(editing ? 'Node diperbarui' : 'Node ditambahkan', `${result.node?.name || payload.name} tersimpan.`);
          onSaved?.(result.node);
          requestRefresh();
        } catch (err) {
          errorToast(err);
        } finally {
          save.disabled = false;
          save.innerHTML = `${icon('save')} ${editing ? 'Simpan perubahan' : 'Tambah node'}`;
        }
      });
    },
  });
}

export function openCableModal({ cable = null, fromNodeId = '', toNodeId = '', path = null, onSaved } = {}) {
  const editing = Boolean(cable);
  const initialType = cable?.type || 'distribution';
  let routePath = path && path.length >= 2 ? path : cable?.path || null;
  const from = cable?.fromNodeId || fromNodeId || '';
  const to = cable?.toNodeId || toNodeId || '';
  const color = cable?.color || cableMeta(initialType).color;
  const anim = cable?.animation?.type || 'flow';
  const speed = cable?.animation?.speed || 1;
  const reverse = Boolean(cable?.animation?.reverse);

  const body = `
    <form id="cable-form" autocomplete="off">
      <div class="form-section">
        <div class="form-section__title">${icon('cable')} Identitas kabel</div>
        <div class="grid-2">
          ${field('Nama kabel', `<input name="name" value="${esc(cable?.name || '')}" placeholder="Feeder OLT–ODC Patrang" required />`)}
          ${field('Kode', `<input name="code" value="${esc(cable?.code || '')}" placeholder="FD-PTR-01" />`)}
        </div>
        <div class="grid-2 mt-2">
          ${field('Tipe kabel', select('type', Object.entries({ backbone: 'Backbone', feeder: 'Feeder', distribution: 'Distribusi', drop: 'Drop' }).map(([v, l]) => ({ value: v, label: l })), initialType))}
          ${field('Status', select('status', Object.entries(CABLE_STATUS).map(([v, s]) => ({ value: v, label: s.label })), cable?.status || 'active'))}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('route')} Rute</div>
        <div class="grid-2">
          ${field('Node awal (A)', `<select name="fromNodeId"><option value="">— Pilih node —</option>${state.nodes.map((n) => `<option value="${esc(n.id)}" ${n.id === from ? 'selected' : ''}>${esc(nodeMeta(n.type).short)} · ${esc(n.name)}</option>`).join('')}</select>`)}
          ${field('Node akhir (B)', `<select name="toNodeId"><option value="">— Pilih node —</option>${state.nodes.map((n) => `<option value="${esc(n.id)}" ${n.id === to ? 'selected' : ''}>${esc(nodeMeta(n.type).short)} · ${esc(n.name)}</option>`).join('')}</select>`)}
        </div>
        <div class="path-info mt-2">
          ${icon('ruler')}
          <span>Rute: <b data-path-info>${routePath ? `${routePath.length} titik · ${fmt.km(pathLength(routePath))}` : 'Garis lurus antar node'}</b></span>
        </div>
        <small class="muted" style="display:block;margin-top:6px">Untuk menggambar rute mengikuti jalan, gunakan tombol <b>Gambar kabel</b> di Live Map.</small>
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('palette')} Warna & animasi</div>
        <div class="grid-2">
          ${field('Animasi', select('animationType', Object.entries(ANIMATIONS).map(([v, l]) => ({ value: v, label: l })), anim))}
          ${field('Kecepatan', `<input type="range" min="0.2" max="5" step="0.1" name="speed" value="${esc(speed)}" /><div class="row row--between"><small class="muted">Lambat</small><small class="mono" data-speed-label>${Number(speed).toFixed(1)}×</small><small class="muted">Cepat</small></div>`)}
        </div>
        <label class="check mt-2"><input type="checkbox" name="reverse" ${reverse ? 'checked' : ''}/><span>Arah animasi terbalik (B → A)</span></label>
        <div class="swatch-row mt-3" data-swatches>
          ${PALETTE.map((c) => `<button type="button" class="swatch ${c.toLowerCase() === String(color).toLowerCase() ? 'active' : ''}" style="background:${c}" data-color="${c}" title="${c}"></button>`).join('')}
          <input type="color" name="color" value="${esc(color)}" style="width:34px;height:26px;padding:0;border:0;background:transparent" title="Warna kustom" />
        </div>
        <div class="anim-preview mt-2" data-anim-preview></div>
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('database')} Kapasitas fiber</div>
        <div class="grid-2">
          ${field('Jumlah core', `<input type="number" name="fiberCount" min="0" value="${esc(cable?.fiberCount ?? 12)}" />`)}
          ${field('Core terpakai', `<input type="number" name="usedFibers" min="0" value="${esc(cable?.usedFibers ?? 0)}" />`)}
        </div>
        <label class="field mt-2"><span>Catatan</span><textarea name="notes" placeholder="Informasi jalur, duct, atau splice">${esc(cable?.notes || '')}</textarea></label>
      </div>
    </form>`;

  return modal({
    title: editing ? 'Edit kabel' : 'Tambah kabel',
    subtitle: editing ? cable.name : 'Hubungkan dua node dengan rute fiber',
    iconName: editing ? 'edit' : 'cable',
    size: 'wide',
    body,
    footer: `<button class="btn btn-soft" data-modal-close>Batal</button>
      <button class="btn btn-primary" data-save>${icon('save')} ${editing ? 'Simpan perubahan' : 'Tambah kabel'}</button>`,
    onMount(ui, root) {
      const form = root.querySelector('#cable-form');
      const colorInput = form.querySelector('[name="color"]');
      const speedInput = form.querySelector('[name="speed"]');
      const speedLabel = root.querySelector('[data-speed-label]');
      const typeSelect = form.querySelector('[name="type"]');
      const animSelect = form.querySelector('[name="animationType"]');
      const reverseInput = form.querySelector('[name="reverse"]');
      const preview = root.querySelector('[data-anim-preview]');
      const info = root.querySelector('[data-path-info]');

      const updateInfo = () => {
        const fromId = form.querySelector('[name="fromNodeId"]').value;
        const toId = form.querySelector('[name="toNodeId"]').value;
        if (routePath?.length >= 2) {
          info.textContent = `${routePath.length} titik · ${fmt.km(pathLength(routePath))}`;
          return;
        }
        const a = nodeById(fromId);
        const b = nodeById(toId);
        if (a && b) {
          const p = [[a.lat, a.lng], [b.lat, b.lng]];
          info.textContent = `Garis lurus · ${fmt.km(pathLength(p))}`;
        } else info.textContent = 'Pilih node awal dan akhir';
      };

      const updatePreview = () => {
        const c = colorInput.value;
        const a = animSelect.value;
        const dur = Math.max(0.35, 1.25 / Number(speedInput.value || 1)).toFixed(2);
        const classes = cableAnimClasses(a, { reverse: reverseInput.checked });
        preview.innerHTML = `<svg viewBox="0 0 300 20" preserveAspectRatio="none">
          <path d="M2 14 C 60 2, 110 20, 170 8 S 250 2, 298 12" fill="none" stroke="${c}" stroke-width="3.5"
            class="${classes}" style="--cable-color:${c};--dur:${dur}s"/>
        </svg>`;
      };

      root.querySelector('[data-swatches]').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-color]');
        if (!btn) return;
        colorInput.value = btn.dataset.color;
        root.querySelectorAll('[data-swatches] .swatch').forEach((s) => s.classList.toggle('active', s === btn));
        updatePreview();
      });
      colorInput.addEventListener('input', updatePreview);
      speedInput.addEventListener('input', () => { speedLabel.textContent = `${Number(speedInput.value).toFixed(1)}×`; updatePreview(); });
      animSelect.addEventListener('change', updatePreview);
      reverseInput.addEventListener('change', updatePreview);
      typeSelect.addEventListener('change', () => {
        const suggested = cableMeta(typeSelect.value).color;
        if (!editing) {
          colorInput.value = suggested;
          root.querySelectorAll('[data-swatches] .swatch').forEach((s) => s.classList.toggle('active', s.dataset.color.toLowerCase() === suggested.toLowerCase()));
          updatePreview();
        }
      });
      form.querySelector('[name="fromNodeId"]').addEventListener('change', updateInfo);
      form.querySelector('[name="toNodeId"]').addEventListener('change', updateInfo);
      updateInfo();
      updatePreview();

      const save = root.querySelector('[data-save]');
      save.addEventListener('click', async () => {
        const values = formValues(form);
        if (!values.name?.trim()) { toast.warn('Nama wajib diisi', 'Isi nama kabel terlebih dahulu.'); return; }
        let finalPath = routePath?.length >= 2 ? routePath : null;
        if (!finalPath) {
          const a = nodeById(values.fromNodeId);
          const b = nodeById(values.toNodeId);
          if (!a || !b) {
            toast.warn('Rute belum lengkap', 'Pilih node awal dan akhir, atau gambar rute di peta.');
            return;
          }
          if (a.id === b.id) { toast.warn('Rute tidak valid', 'Node awal dan akhir tidak boleh sama.'); return; }
          finalPath = [[a.lat, a.lng], [b.lat, b.lng]];
        }
        const payload = {
          projectId: state.projectId,
          name: values.name.trim(),
          code: values.code?.trim() || '',
          type: values.type,
          status: values.status,
          fromNodeId: values.fromNodeId || null,
          toNodeId: values.toNodeId || null,
          path: finalPath,
          color: values.color,
          animation: { type: values.animationType, speed: Number(values.speed), reverse: values.reverse },
          fiberCount: Number(values.fiberCount) || 0,
          usedFibers: Number(values.usedFibers) || 0,
          notes: values.notes || '',
        };
        save.disabled = true;
        save.innerHTML = 'Menyimpan…';
        try {
          const result = editing ? await api.put(`/cables/${cable.id}`, payload) : await api.post('/cables', payload);
          ui.close();
          toast.success(editing ? 'Kabel diperbarui' : 'Kabel ditambahkan', `${result.cable?.name || payload.name} tersimpan.`);
          onSaved?.(result.cable);
          requestRefresh();
        } catch (err) {
          errorToast(err);
        } finally {
          save.disabled = false;
          save.innerHTML = `${icon('save')} ${editing ? 'Simpan perubahan' : 'Tambah kabel'}`;
        }
      });
    },
  });
}

export function openNodeDrawer(node, { onEdit } = {}) {
  if (!node) return;
  const meta = nodeMeta(node.type);
  const cables = cablesOfNode(node.id);
  const children = childrenOf(node.id);
  const fault = faultForNode(node.id);
  const parent = node.parentId ? nodeById(node.parentId) : null;
  const properties = Object.entries(node.properties || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined);

  const body = `
    <div class="row" style="gap:12px;margin-bottom:14px">
      <div class="int-ico" style="width:44px;height:44px;color:${meta.color}">${icon(meta.icon)}</div>
      <div class="grow">
        <b style="font-size:14px">${esc(node.name)}</b>
        <div class="muted" style="font-size:10.5px">${esc(meta.label)} · ${esc(node.code || '—')}</div>
        <div style="margin-top:6px">${statusPill(node.status)}</div>
      </div>
    </div>
    ${fault ? `<div class="awg mb-2"><b>${esc(fault.title)}</b><br>${esc(fault.description || '')}<br><span class="mono">${fmt.coord(fault.point?.[0], fault.point?.[1])}</span></div>` : ''}
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-xs btn-soft" data-fly="${esc(node.id)}">${icon('crosshair')} Fokus di peta</button>
      ${fault ? `<button class="btn btn-xs btn-danger" data-fault="${esc(fault.id)}">${icon('alert-triangle')} Buka gangguan</button>` : ''}
    </div>
    <div class="form-section">
      <div class="form-section__title">${icon('pin')} Lokasi</div>
      <div class="path-info">${icon('crosshair')}<span class="mono">${fmt.coord(node.lat, node.lng)}</span></div>
      ${node.address ? `<p class="muted mt-1" style="font-size:11px">${esc(node.address)}</p>` : ''}
    </div>
    <div class="form-section">
      <div class="form-section__title">${icon('network')} Topologi</div>
      <div class="switch-row"><div><b>Parent / uplink</b><span>${esc(parent?.name || 'Tidak ada')}</span></div><span class="muted">${parent ? esc(nodeMeta(parent.type).short) : '—'}</span></div>
      <div class="switch-row"><div><b>Kabel terhubung</b><span>${cables.length} kabel</span></div><span class="mono">${cables.length}</span></div>
      <div class="switch-row"><div><b>Node downstream</b><span>${children.length} node</span></div><span class="mono">${children.length}</span></div>
      ${node.capacity ? `<div class="switch-row"><div><b>Kapasitas</b><span>${Number(node.usedPorts) || 0} / ${Number(node.capacity)} port terpakai</span></div><span class="mono">${Math.round(((Number(node.usedPorts) || 0) / Number(node.capacity)) * 100)}%</span></div>` : ''}
    </div>
    ${(node.vendor || node.model || node.serial || node.genieacsSerial || node.oltId) ? `<div class="form-section">
      <div class="form-section__title">${icon('cpu')} Perangkat</div>
      ${node.vendor ? `<div class="switch-row"><div><b>Vendor</b></div><span class="muted">${esc(node.vendor)}</span></div>` : ''}
      ${node.model ? `<div class="switch-row"><div><b>Model</b></div><span class="muted">${esc(node.model)}</span></div>` : ''}
      ${node.serial ? `<div class="switch-row"><div><b>Serial</b></div><span class="mono">${esc(node.serial)}</span></div>` : ''}
      ${node.genieacsSerial ? `<div class="switch-row"><div><b>GenieACS</b></div><span class="mono">${esc(node.genieacsSerial)}</span></div>` : ''}
      ${node.oltId ? `<div class="switch-row"><div><b>OLT</b></div><span class="muted">${esc((state.integrations.olts || []).find((o) => o.id === node.oltId)?.name || node.oltId)}</span></div>` : ''}
    </div>` : ''}
    ${properties.length ? `<div class="form-section">
      <div class="form-section__title">${icon('database')} Properti</div>
      ${properties.map(([k, v]) => `<div class="switch-row"><div><b>${esc(k)}</b></div><span class="muted">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span></div>`).join('')}
    </div>` : ''}
    ${node.notes ? `<div class="form-section"><div class="form-section__title">${icon('edit')} Catatan</div><p class="muted" style="font-size:11px;line-height:1.6">${esc(node.notes)}</p></div>` : ''}
    ${cables.length ? `<div class="form-section">
      <div class="form-section__title">${icon('cable')} Kabel terkait</div>
      ${cables.slice(0, 10).map((c) => `<div class="switch-row"><div><b>${esc(c.name)}</b><span>${esc(cableMeta(c.type).label)} · ${fmt.km(c.lengthM)}</span></div><span class="cable-swatch" style="background:${esc(c.color)}"></span></div>`).join('')}
    </div>` : ''}`;

  const d = drawer({
    title: 'Detail node',
    subtitle: `${meta.label} · ${node.code || node.id}`,
    body,
    footer: `<button class="btn btn-xs btn-danger" data-delete>${icon('trash')} Hapus</button>
      <button class="btn btn-sm btn-soft grow" data-edit>${icon('edit')} Edit node</button>`,
    onMount(ui, root) {
      root.querySelector('[data-edit]')?.addEventListener('click', () => {
        ui.close();
        if (onEdit) onEdit(node);
        else openNodeModal({ node });
      });
      root.querySelector('[data-fly]')?.addEventListener('click', () => {
        import('./router.js').then(({ setFocus, navigate }) => { setFocus('node', node.id); navigate('map'); });
      });
      root.querySelector('[data-fault]')?.addEventListener('click', () => {
        import('./router.js').then(({ navigate }) => navigate('faults', { faultId: fault.id }));
      });
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Hapus node?',
          message: `Node ${node.name} beserta kabel yang terhubung akan dihapus permanen.`,
          confirmText: 'Hapus node',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/nodes/${node.id}`);
          ui.close();
          toast.success('Node dihapus', `${node.name} telah dihapus.`);
          requestRefresh();
        } catch (err) { errorToast(err); }
      });
    },
  });
  return d;
}

export function openCableDrawer(cable, { onEdit } = {}) {
  if (!cable) return;
  const meta = cableMeta(cable.type);
  const fault = faultForCable(cable.id);
  const a = cable.fromNodeId ? nodeById(cable.fromNodeId) : null;
  const b = cable.toNodeId ? nodeById(cable.toNodeId) : null;
  const used = Number(cable.usedFibers) || 0;
  const total = Number(cable.fiberCount) || 0;
  const pct = total ? Math.round((used / total) * 100) : 0;
  const animation = cable.animation || {};
  const anim = animation.type || 'flow';
  const dur = Math.max(0.35, 1.25 / (Number(animation.speed) || 1)).toFixed(2);
  const classes = cableAnimClasses(anim, { reverse: Boolean(animation.reverse), fault: Boolean(fault) });

  const body = `
    <div class="row" style="gap:12px;margin-bottom:14px">
      <div class="int-ico" style="width:44px;height:44px;color:${esc(cable.color)}">${icon(meta.icon)}</div>
      <div class="grow">
        <b style="font-size:14px">${esc(cable.name)}</b>
        <div class="muted" style="font-size:10.5px">${esc(meta.label)} · ${esc(cable.code || '—')}</div>
        <div style="margin-top:6px">${statusPill(cable.status, CABLE_STATUS)}</div>
      </div>
    </div>
    ${fault ? `<div class="awg mb-2"><b>${esc(fault.title)}</b><br>${esc(fault.description || '')}<br><span class="mono">Putus di ${fmt.km(fault.distanceM)} · ${fmt.coord(fault.point?.[0], fault.point?.[1])}</span></div>` : ''}
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-xs btn-soft" data-fly>${icon('crosshair')} Fokus di peta</button>
      <button class="btn btn-xs ${fault ? 'btn-danger' : 'btn-soft'}" data-locate>${icon('crosshair')} ${fault ? 'Lihat gangguan' : 'Fault locator'}</button>
    </div>
    <div class="form-section">
      <div class="form-section__title">${icon('route')} Rute</div>
      <div class="cable-route" style="flex-wrap:wrap">
        <span class="route-node">${esc(a?.name || 'Titik A')}</span>${icon('arrow-right')}<span class="route-node">${esc(b?.name || 'Titik B')}</span>
      </div>
      <div class="cable-stats mt-2">
        <div><span>Panjang</span><b>${fmt.km(cable.lengthM)}</b></div>
        <div><span>Core</span><b>${used}/${total}</b></div>
        <div><span>Utilisasi</span><b>${pct}%</b></div>
        <div><span>Titik rute</span><b>${cable.path?.length || 0}</b></div>
      </div>
      <div class="usage-bar"><i style="width:${pct}%"></i></div>
    </div>
    <div class="form-section">
      <div class="form-section__title">${icon('palette')} Animasi</div>
      <div class="anim-preview"><svg viewBox="0 0 300 20" preserveAspectRatio="none">
        <path d="M2 14 C 60 2, 110 20, 170 8 S 250 2, 298 12" fill="none" stroke="${esc(cable.color)}" stroke-width="3.5" class="${classes}" style="--cable-color:${esc(cable.color)};--dur:${dur}s"/>
      </svg></div>
      <div class="switch-row mt-2"><div><b>${esc(ANIMATIONS[anim] || anim)}</b><span>Kecepatan ${Number(animation.speed || 1).toFixed(1)}× ${animation.reverse ? '· arah terbalik' : ''}</span></div><span class="cable-swatch" style="background:${esc(cable.color)}"></span></div>
    </div>
    ${cable.notes ? `<div class="form-section"><div class="form-section__title">${icon('edit')} Catatan</div><p class="muted" style="font-size:11px;line-height:1.6">${esc(cable.notes)}</p></div>` : ''}`;

  const d = drawer({
    title: 'Detail kabel',
    subtitle: cable.code || cable.id,
    body,
    footer: `<button class="btn btn-xs btn-danger" data-delete>${icon('trash')} Hapus</button>
      <button class="btn btn-sm btn-soft grow" data-edit>${icon('edit')} Edit kabel</button>`,
    onMount(ui, root) {
      root.querySelector('[data-edit]')?.addEventListener('click', () => {
        ui.close();
        if (onEdit) onEdit(cable);
        else openCableModal({ cable });
      });
      root.querySelector('[data-fly]')?.addEventListener('click', () => {
        import('./router.js').then(({ setFocus, navigate }) => { setFocus('cable', cable.id); navigate('map'); });
      });
      root.querySelector('[data-locate]')?.addEventListener('click', () => {
        import('./router.js').then(({ navigate }) => navigate('faults', { cableId: cable.id }));
      });
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Hapus kabel?',
          message: `Kabel ${cable.name} akan dihapus dari peta dan topologi.`,
          confirmText: 'Hapus kabel',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/cables/${cable.id}`);
          ui.close();
          toast.success('Kabel dihapus', `${cable.name} telah dihapus.`);
          requestRefresh();
        } catch (err) { errorToast(err); }
      });
    },
  });
  return d;
}
