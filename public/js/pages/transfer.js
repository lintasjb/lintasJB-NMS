/* lintasJB NMS — Import / Export KML, KMZ, GeoJSON, CSV */
import * as api from '../api.js';
import { state } from '../state.js';
import { esc, icon, fmt, toast, errorToast, empty, confirmDialog, modal, NODE_TYPES, CABLE_TYPES } from '../ui.js';
import { requestRefresh } from '../forms.js';

const ACCEPT = '.kml,.kmz,.geojson,.json,.csv';
const FORMATS = [
  { id: 'kml', label: 'KML', icon: 'globe', desc: 'Google Earth / Maps' },
  { id: 'kmz', label: 'KMZ', icon: 'box', desc: 'KML terkompresi' },
  { id: 'geojson', label: 'GeoJSON', icon: 'map', desc: 'QGIS & web GIS' },
  { id: 'csv', label: 'CSV Node', icon: 'grid', desc: 'Spreadsheet node' },
  { id: 'csv-cables', label: 'CSV Kabel', icon: 'cable', desc: 'Spreadsheet rute' },
];

function formatBytes(bytes) {
  return fmt.bytes(bytes);
}

function historyIcon(action = '') {
  if (action === 'io.import') return 'upload';
  if (action === 'io.export') return 'download';
  return 'swap';
}

function previewHTML(preview) {
  if (!preview) return '';
  const warnings = preview.warnings || [];
  return `<div class="mt-2" id="import-preview">
    <div class="row row--between mb-1">
      <b style="font-size:11.5px">Pratinjau ${esc(preview.format || 'file')}</b>
      <span class="dim" style="font-size:9.5px">${esc(preview.fileName || '')}</span>
    </div>
    <div class="grid-2 mb-2">
      <div class="locator-result" style="margin-top:0;padding:10px 12px">
        <div class="locator-result__head">${icon('network')} Node</div>
        <div class="locator-result__coords" style="font-size:20px">${fmt.num(preview.nodeCount || 0)}</div>
        <div class="locator-result__meta"><span>titik koordinat</span></div>
      </div>
      <div class="locator-result" style="margin-top:0;padding:10px 12px">
        <div class="locator-result__head">${icon('cable')} Kabel</div>
        <div class="locator-result__coords" style="font-size:20px">${fmt.num(preview.cableCount || 0)}</div>
        <div class="locator-result__meta"><span>rute polyline</span></div>
      </div>
    </div>
    ${preview.nodes?.length ? `<div class="preview-list mb-2">${preview.nodes.slice(0, 12).map((n) => {
      const meta = NODE_TYPES[n.type] || { short: 'NODE', color: '#8ba0bd' };
      return `<div class="preview-item"><span class="layer-dot" style="background:${meta.color};flex:0 0 auto"></span><b>${esc(n.name)}</b><span>${esc(meta.short)} · ${fmt.coord(n.lat, n.lng, 5)}</span></div>`;
    }).join('')}</div>` : ''}
    ${preview.cables?.length ? `<div class="preview-list mb-2">${preview.cables.slice(0, 8).map((c) => {
      const meta = CABLE_TYPES[c.type] || { label: c.type, color: '#22d3ee' };
      return `<div class="preview-item"><span class="layer-dot" style="background:${meta.color};flex:0 0 auto"></span><b>${esc(c.name)}</b><span>${esc(meta.label)} · ${fmt.km(c.lengthM)}</span></div>`;
    }).join('')}</div>` : ''}
    ${warnings.length ? `<div class="hint hint--warn">${icon('alert-triangle')}<div>${warnings.map((w) => esc(w)).join('<br/>')}</div></div>` : ''}
    <div class="hint mt-2">${icon('info')} Import akan menambahkan data ke project <b>${esc(state.project?.name || 'aktif')}</b>. Node yang berdekatan akan otomatis ditautkan sebagai ujung kabel.</div>
  </div>`;
}

export async function render(view) {
  let file = null;
  let preview = null;
  let busy = false;

  view.innerHTML = `<div class="page">
    <div class="page-toolbar">
      <div>
        <h2>Import / export peta project</h2>
        <p>Bawa data KML/KMZ dari Google Earth, GeoJSON dari QGIS, atau CSV aset ke project ${esc(state.project?.name || 'aktif')}.</p>
      </div>
      <div class="page-toolbar__right">
        <button class="btn btn-soft btn-sm" data-guide>${icon('info')} Panduan format</button>
        <button class="btn btn-soft btn-sm" data-template>${icon('download')} Template CSV</button>
      </div>
    </div>

    <div class="transfer-grid">
      <div class="col" style="gap:14px">
        <section class="panel">
          <div class="panel-head">
            <div><h3>${icon('upload')} Import ke project</h3><p>Maksimal 25 MB · satu file per proses</p></div>
            <span class="pill pill--accent">${esc(state.project?.code || 'PROJECT')}</span>
          </div>
          <div class="panel-body">
            <input type="file" id="import-file" accept="${ACCEPT}" class="hidden" />
            <div class="dropzone" id="dropzone" role="button" tabindex="0" aria-label="Pilih file KML, KMZ, GeoJSON, atau CSV">
              <div class="dz-ico">${icon('upload')}</div>
              <b>Letakkan file di sini atau klik untuk memilih</b>
              <p>Data aset dan rute kabel akan dipetakan otomatis ke koordinat WGS84.</p>
              <div class="dz-formats"><span class="dz-format">KML</span><span class="dz-format">KMZ</span><span class="dz-format">GEOJSON</span><span class="dz-format">CSV</span></div>
            </div>
            <div id="file-slot"></div>
            <div id="status-slot"></div>
            <div id="preview-slot"></div>
          </div>
          <div class="panel-foot">
            <span id="import-foot">Belum ada file dipilih</span>
            <div class="row">
              <button class="btn btn-xs btn-soft" data-preview disabled>${icon('eye')} Pratinjau</button>
              <button class="btn btn-xs btn-primary" data-import disabled>${icon('upload')} Import sekarang</button>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><div><h3>${icon('clock')} Riwayat import / export</h3><p>Jejak aktivitas file pada project ini</p></div></div>
          <div class="panel-body" id="history-slot">${empty('clock', 'Memuat riwayat…')}</div>
        </section>
      </div>

      <div class="col" style="gap:14px">
        <section class="panel">
          <div class="panel-head">
            <div><h3>${icon('download')} Export project</h3><p>${fmt.num(state.nodes.length)} node · ${fmt.num(state.cables.length)} kabel</p></div>
          </div>
          <div class="panel-body">
            <div class="format-grid">
              ${FORMATS.map((f) => `<button class="format-card" data-export="${f.id}">
                <span class="fmt-ico">${icon(f.icon)}</span>
                <span><b>${esc(f.label)}</b><span>${esc(f.desc)}</span></span>
              </button>`).join('')}
            </div>
            <div class="hint mt-2">${icon('shield')} Export mempertahankan atribut node, status, warna kabel, jumlah core, dan geometri rute.</div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><div><h3>${icon('database')} Isi project</h3><p>Ringkasan data yang akan dibawa</p></div></div>
          <div class="panel-body">
            <div class="license-grid" style="grid-template-columns:1fr 1fr">
              <div><span>Node</span><b>${fmt.num(state.nodes.length)}</b></div>
              <div><span>Kabel</span><b>${fmt.num(state.cables.length)}</b></div>
              <div><span>Panjang fiber</span><b>${fmt.km(state.cables.reduce((sum, c) => sum + (Number(c.lengthM) || 0), 0))}</b></div>
              <div><span>ONT</span><b>${fmt.num(state.nodes.filter((n) => n.type === 'ont').length)}</b></div>
            </div>
            <div class="divider"></div>
            <div class="composition">
              ${Object.entries(NODE_TYPES).map(([type, meta]) => {
                const count = state.nodes.filter((n) => n.type === type).length;
                const max = Math.max(1, state.nodes.length);
                return `<div class="comp-row"><span>${esc(meta.label)}</span><div class="comp-bar"><i style="width:${Math.round((count / max) * 100)}%;background:${meta.color}"></i></div><b>${count}</b></div>`;
              }).join('')}
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>`;

  const dropzone = view.querySelector('#dropzone');
  const fileInput = view.querySelector('#import-file');
  const fileSlot = view.querySelector('#file-slot');
  const previewSlot = view.querySelector('#preview-slot');
  const statusSlot = view.querySelector('#status-slot');
  const footEl = view.querySelector('#import-foot');
  const previewBtn = view.querySelector('[data-preview]');
  const importBtn = view.querySelector('[data-import]');
  const historySlot = view.querySelector('#history-slot');

  function setBusy(value, label = '') {
    busy = value;
    previewBtn.disabled = value || !file;
    importBtn.disabled = value || !file;
    dropzone.style.opacity = value ? '.6' : '';
    if (label) statusSlot.innerHTML = `<div class="hint mt-2" id="import-status">${icon('refresh')} ${esc(label)}</div>`;
    else if (value) statusSlot.innerHTML = '';
  }

  function clearPreview() {
    preview = null;
    previewSlot.innerHTML = '';
  }

  function renderFile() {
    if (!file) {
      fileSlot.innerHTML = '';
      footEl.textContent = 'Belum ada file dipilih';
      previewBtn.disabled = true;
      importBtn.disabled = true;
      return;
    }
    const ext = (file.name.split('.').pop() || '').toUpperCase();
    fileSlot.innerHTML = `<div class="file-selected">
      <span class="cell-icon">${icon('file')}</span>
      <div class="grow"><b>${esc(file.name)}</b><span>${esc(ext)} · ${formatBytes(file.size)}</span></div>
      <button class="icon-btn" data-clear-file title="Hapus file">${icon('x')}</button>
    </div>`;
    footEl.textContent = `${file.name} · ${formatBytes(file.size)}`;
    previewBtn.disabled = busy;
    importBtn.disabled = busy;
  }

  function acceptFile(next) {
    if (!next) return;
    if (!/\.(kml|kmz|geojson|json|csv)$/i.test(next.name)) {
      toast.error('Format tidak didukung', 'Gunakan file KML, KMZ, GeoJSON, atau CSV.');
      return;
    }
    if (next.size > 25 * 1024 * 1024) {
      toast.error('File terlalu besar', 'Ukuran maksimal 25 MB.');
      return;
    }
    file = next;
    clearPreview();
    statusSlot.innerHTML = '';
    renderFile();
  }

  async function ensureProject() {
    if (state.project?.id) return true;
    toast.warn('Project belum tersedia', 'Halaman akan dimuat ulang sebelum import.');
    requestRefresh();
    return false;
  }

  function handleImportError(err) {
    if (err?.status === 403) {
      toast.error('Akses project berakhir', 'Project tidak lagi tersedia untuk akun ini. Data akan disegarkan.');
      requestRefresh();
    } else {
      errorToast(err);
    }
  }

  async function runPreview(dryRunOnly = true) {
    if (!file || busy) return null;
    if (!await ensureProject()) return null;
    clearPreview();
    setBusy(true, 'Membaca file dan memvalidasi geometri…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('dryRun', '1');
      fd.append('projectId', state.projectId || state.project.id);
      const result = await api.upload('/io/import', fd, (progress) => {
        const pct = Math.round(progress * 100);
        statusSlot.innerHTML = `<div class="hint mt-2">${icon('upload')} Mengunggah ${pct}%…</div>`;
      });
      preview = result.preview;
      previewSlot.innerHTML = previewHTML(preview);
      statusSlot.innerHTML = `<div class="hint mt-2">${icon('check-circle')} File valid. Tinjau pratinjau, lalu jalankan import.</div>`;
      importBtn.disabled = false;
      if (!dryRunOnly) return result;
      return result;
    } catch (err) {
      handleImportError(err);
      return null;
    } finally {
      setBusy(false);
      renderFile();
    }
  }

  async function runImport() {
    if (!file || busy) return;
    if (!await ensureProject()) return;
    if (!preview) {
      const result = await runPreview();
      if (!result) return;
    }
    const nodes = preview?.nodeCount || 0;
    const cables = preview?.cableCount || 0;
    if (!nodes && !cables) {
      toast.warn('Tidak ada data', 'File tidak memuat node atau kabel yang dapat diimport.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Import ke project?',
      message: `${nodes} node dan ${cables} kabel akan ditambahkan ke ${state.project?.name || 'project aktif'}. Tindakan ini tidak menghapus data lama.`,
      confirmText: 'Import sekarang',
      iconName: 'upload',
    });
    if (!ok) return;

    setBusy(true, `Mengimport ${nodes} node dan ${cables} kabel…`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('dryRun', '0');
      fd.append('projectId', state.projectId || state.project.id);
      const result = await api.upload('/io/import', fd, (progress) => {
        statusSlot.innerHTML = `<div class="hint mt-2">${icon('upload')} Mengunggah ${Math.round(progress * 100)}%…</div>`;
      });
      toast.success('Import selesai', result.message || `${nodes} node dan ${cables} kabel ditambahkan.`);
      file = null;
      preview = null;
      fileInput.value = '';
      renderFile();
      clearPreview();
      statusSlot.innerHTML = '';
      requestRefresh();
      loadHistory();
    } catch (err) {
      handleImportError(err);
    } finally {
      setBusy(false);
      renderFile();
    }
  }

  async function exportProject(format) {
    if (busy) return;
    const isCables = format === 'csv-cables';
    const actual = isCables ? 'csv' : format;
    const layer = isCables ? 'cables' : 'nodes';
    const name = `${state.project?.code || 'lintasjb'}-${actual}${isCables ? '-cables' : ''}`;
    try {
      statusSlot.innerHTML = `<div class="hint mt-2">${icon('download')} Menyiapkan export ${actual.toUpperCase()}…</div>`;
      const fileName = await api.download(
        `/io/export${api.qs({ format: actual, layer, projectId: state.projectId })}`,
        `${name}.${actual === 'csv' ? 'csv' : actual}`
      );
      toast.success('Export siap', `${fileName} berhasil diunduh.`);
      loadHistory();
    } catch (err) {
      errorToast(err);
    } finally {
      statusSlot.innerHTML = '';
    }
  }

  async function loadHistory() {
    try {
      const data = await api.get(`/io/history${api.qs({ projectId: state.projectId })}`);
      const items = data.history || [];
      if (!items.length) {
        historySlot.innerHTML = empty('clock', 'Belum ada riwayat', 'Import atau export pertama Anda akan tercatat di sini.');
        return;
      }
      historySlot.innerHTML = `<div class="history-list">${items.slice(0, 12).map((item) => `<div class="history-item">
        <div class="act-ico">${icon(historyIcon(item.action))}</div>
        <div class="grow"><p>${esc(item.detail)}</p><span>${esc(item.userName || 'Sistem')} · ${esc(fmt.ago(item.at))}</span></div>
      </div>`).join('')}</div>`;
    } catch (err) {
      historySlot.innerHTML = empty('alert-triangle', 'Gagal memuat riwayat', err.message);
    }
  }

  function openGuide() {
    modal({
      title: 'Panduan format import',
      subtitle: 'Struktur file yang dikenali lintasJB NMS',
      iconName: 'info',
      size: 'wide',
      body: `<div class="col" style="gap:12px">
        <div class="hint">${icon('globe')}<div><b>KML / KMZ</b><br/>Placemark <b>Point</b> menjadi node; <b>LineString</b> menjadi kabel. ExtendedData opsional: <span class="mono">type, status, code, serial, address, from, to, fiberCount, color</span>. File KMZ dapat memuat <span class="mono">doc.kml</span>.</div></div>
        <div class="hint">${icon('map')}<div><b>GeoJSON</b><br/>FeatureCollection berisi Point dan LineString. Properti <span class="mono">name, type, status, from, to</span> akan dipakai sebagai metadata node/kabel.</div></div>
        <div class="hint">${icon('grid')}<div><b>CSV node</b><br/>Header yang dikenali: <span class="mono">name, code, type, status, lat, lng, address, serial, vendor, model, genieacsSerial</span>. Pemisah koma, titik koma, atau tab.</div></div>
        <div class="hint hint--warn">${icon('alert-triangle')}<div><b>Tips</b><br/>Gunakan koordinat WGS84 (latitude, longitude). Node hasil import berstatus <span class="mono">planned</span> kecuali kolom status diisi. Kabel akan otomatis mencari node terdekat dalam radius 80 m sebagai ujung rute.</div></div>
      </div>`,
      footer: '<button class="btn btn-soft" data-modal-close>Tutup</button>',
    });
  }

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
    acceptFile(event.dataTransfer?.files?.[0]);
  });
  fileInput.addEventListener('change', () => {
    acceptFile(fileInput.files?.[0]);
    fileInput.value = '';
  });

  view.addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-file]')) {
      file = null;
      clearPreview();
      statusSlot.innerHTML = '';
      renderFile();
      return;
    }
    if (event.target.closest('[data-preview]')) {
      runPreview();
      return;
    }
    if (event.target.closest('[data-import]')) {
      runImport();
      return;
    }
    const exportBtn = event.target.closest('[data-export]');
    if (exportBtn) {
      exportProject(exportBtn.dataset.export);
      return;
    }
    if (event.target.closest('[data-guide]')) {
      openGuide();
      return;
    }
    if (event.target.closest('[data-template]')) {
      api.download('/io/template?format=csv', 'lintasjb-node-template.csv')
        .then((name) => toast.success('Template diunduh', name))
        .catch(errorToast);
    }
  });

  renderFile();
  loadHistory();
}

export default { render };
