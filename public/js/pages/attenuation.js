/* =============================================================================
 * lintasJB NMS — Kalkulator redaman optik (link budget FTTH)
 * ========================================================================== */
import {
  esc, icon, toast, copyText,
} from '../ui.js';

const SPLITTERS = {
  none: { label: 'Tanpa splitter', loss: 0 },
  s2: { label: '1:2', loss: 3.5 },
  s4: { label: '1:4', loss: 7 },
  s8: { label: '1:8', loss: 10.5 },
  s16: { label: '1:16', loss: 14 },
  s32: { label: '1:32', loss: 17.5 },
  s64: { label: '1:64', loss: 21 },
};

const LOSS_PER_KM = { 1310: 0.35, 1550: 0.22 };
const DEFAULT_STATE = {
  name: 'Link FTTH',
  length: 5,
  wave: 1310,
  perKm: 0.35,
  splices: 4,
  spliceLoss: 0.1,
  connectors: 2,
  connectorLoss: 0.5,
  splitter: 's8',
  splitterLoss: 10.5,
  margin: 3,
  tx: 2,
  rx: -24,
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '-';
}

function calculate(v) {
  const perKm = Math.max(0, num(v.perKm, 0.35));
  const fiber = Math.max(0, num(v.length)) * perKm;
  const splice = Math.max(0, num(v.splices)) * Math.max(0, num(v.spliceLoss, 0.1));
  const connector = Math.max(0, num(v.connectors)) * Math.max(0, num(v.connectorLoss, 0.5));
  const splitterLoss = v.splitter === 'custom'
    ? Math.max(0, num(v.splitterLoss))
    : (SPLITTERS[v.splitter]?.loss || 0);
  const others = splice + connector + splitterLoss;
  const linkLoss = fiber + others;
  const margin = Math.max(0, num(v.margin, 3));
  const tx = num(v.tx, 2);
  const rx = num(v.rx, -24);
  const budget = tx - rx - margin;
  const received = tx - linkLoss;
  const headroom = budget - linkLoss;
  const ok = headroom >= 0 && budget > 0;
  const maxKm = perKm > 0 ? Math.max(0, (budget - others) / perKm) : Infinity;
  const used = budget > 0 ? Math.min(100, Math.round((linkLoss / budget) * 100)) : 100;
  return {
    perKm, fiber, splice, connector, splitterLoss, others, linkLoss,
    margin, tx, rx, budget, received, headroom, ok, maxKm, used,
  };
}

function resultMarkup(v, r) {
  const statusCls = r.ok ? 'pill--ok' : 'pill--danger';
  const maxLabel = Number.isFinite(r.maxKm) ? `${round(r.maxKm, 2)} km` : 'tanpa batas';
  const rows = [
    ['Serat optik', `${round(num(v.length))} km × ${round(r.perKm)} dB/km`, r.fiber],
    ['Sambungan (splice)', `${num(v.splices)} × ${round(num(v.spliceLoss, 0.1))} dB`, r.splice],
    ['Konektor', `${num(v.connectors)} × ${round(num(v.connectorLoss, 0.5))} dB`, r.connector],
    ['Splitter', SPLITTERS[v.splitter]?.label || 'Custom', r.splitterLoss],
  ];
  return `<div class="att-result">
    <div class="att-status">
      <span class="pill ${statusCls}">${r.ok ? 'LAYAK' : 'TIDAK LAYAK'}</span>
      <span class="muted">${r.ok ? 'Daya masih memenuhi sensitivitas penerima.' : 'Daya terima di bawah sensitivitas / margin.'}</span>
    </div>
    <div class="att-hero">
      <div><span>Total redaman</span><b>${round(r.linkLoss)} dB</b></div>
      <div><span>Daya terima estimasi</span><b>${round(r.received)} dBm</b></div>
      <div><span>Sisa margin</span><b>${round(r.headroom)} dB</b></div>
      <div><span>Jarak maksimal</span><b>${maxLabel}</b></div>
    </div>
    <div class="usage-bar"><i style="width:${r.used}%" class="${r.ok ? '' : 'is-bad'}"></i></div>
    <div class="row row--between mt-1" style="font-size:9.5px;color:var(--dim)">
      <span>Pemakaian anggaran redaman</span><span>${r.used}%</span>
    </div>
    <div class="att-breakdown">
      ${rows.map(([label, detail, value]) => `<div class="att-row"><span><b>${esc(label)}</b><small>${esc(detail)}</small></span><b>${round(value)} dB</b></div>`).join('')}
      <div class="att-row att-row--total"><span><b>Anggaran tersedia</b><small> TX ${round(r.tx)} dBm − RX ${round(r.rx)} dBm − margin ${round(r.margin)} dB</small></span><b>${round(r.budget)} dB</b></div>
    </div>
    <div class="row mt-2">
      <button type="button" class="btn btn-xs btn-soft" id="att-copy">${icon('copy')} Salin ringkasan</button>
      <span class="muted" style="font-size:10px">Estimasi teoritis — ukur dengan OTDR/power meter untuk verifikasi.</span>
    </div>
  </div>`;
}

export async function render(view) {
  const state = { ...DEFAULT_STATE };
  view.innerHTML = `<div class="page">
    <div class="page-toolbar">
      <div>
        <h2>Kalkulator redaman optik</h2>
        <p>Estimasi total loss, daya terima, dan jarak maksimal untuk rancangan jaringan FTTH.</p>
      </div>
      <div class="page-toolbar__right">
        <button class="btn btn-soft btn-sm" id="att-reset">${icon('refresh')} Reset</button>
      </div>
    </div>

    <div class="att-layout">
      <section class="panel">
        <div class="panel-head"><div><h3>${icon('calculator')} Parameter link</h3><p>Hasil dihitung otomatis saat nilai diubah</p></div><span class="pill pill--accent">LOCAL</span></div>
        <div class="panel-body">
          <form id="att-form" autocomplete="off">
            <label class="field"><span>Nama link / segmen</span><input name="name" value="${esc(state.name)}" /></label>
            <div class="grid-2 mt-2">
              <label class="field"><span>Panjang fiber (km)</span><input name="length" type="number" min="0" step="0.001" value="${state.length}" /></label>
              <label class="field"><span>Panjang gelombang</span><select name="wave"><option value="1310">1310 nm</option><option value="1550">1550 nm</option></select></label>
            </div>
            <div class="grid-2 mt-2">
              <label class="field"><span>Redaman serat (dB/km)</span><input name="perKm" type="number" min="0" step="0.01" value="${state.perKm}" /></label>
              <label class="field"><span>Margin desain (dB)</span><input name="margin" type="number" min="0" step="0.5" value="${state.margin}" /></label>
            </div>
            <div class="divider"></div>
            <div class="grid-2">
              <label class="field"><span>Jumlah sambungan</span><input name="splices" type="number" min="0" step="1" value="${state.splices}" /></label>
              <label class="field"><span>Redaman per sambungan (dB)</span><input name="spliceLoss" type="number" min="0" step="0.01" value="${state.spliceLoss}" /></label>
            </div>
            <div class="grid-2 mt-2">
              <label class="field"><span>Jumlah konektor</span><input name="connectors" type="number" min="0" step="1" value="${state.connectors}" /></label>
              <label class="field"><span>Redaman per konektor (dB)</span><input name="connectorLoss" type="number" min="0" step="0.01" value="${state.connectorLoss}" /></label>
            </div>
            <div class="divider"></div>
            <label class="field"><span>Splitter</span><select name="splitter">${Object.entries(SPLITTERS).map(([k, s]) => `<option value="${k}" ${k === state.splitter ? 'selected' : ''}>${esc(s.label)} — ${s.loss} dB</option>`).join('')}<option value="custom">Custom</option></select></label>
            <label class="field mt-2"><span>Redaman splitter custom (dB)</span><input name="splitterLoss" type="number" min="0" step="0.1" value="${state.splitterLoss}" /></label>
            <div class="divider"></div>
            <div class="grid-2">
              <label class="field"><span>Daya TX (dBm)</span><input name="tx" type="number" step="0.1" value="${state.tx}" /></label>
              <label class="field"><span>Sensitivitas RX (dBm)</span><input name="rx" type="number" step="0.1" value="${state.rx}" /></label>
            </div>
            <div class="hint mt-2">${icon('info')} Nilai bawaan memakai serat SM G.652: 0,35 dB/km @1310 nm dan 0,22 dB/km @1550 nm.</div>
          </form>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><div><h3>${icon('activity')} Hasil perhitungan</h3><p>Link budget optik</p></div></div>
        <div class="panel-body" id="att-result"></div>
      </section>
    </div>
  </div>`;

  const form = view.querySelector('#att-form');
  const resultEl = view.querySelector('#att-result');
  let last = null;

  function refresh() {
    for (const el of form.elements) {
      if (!el.name) continue;
      state[el.name] = el.type === 'number' ? el.value : el.value;
    }
    state.wave = String(state.wave);
    last = calculate(state);
    resultEl.innerHTML = resultMarkup(state, last);
    resultEl.querySelector('#att-copy')?.addEventListener('click', async () => {
      const text = [
        `Kalkulator Redaman — ${state.name || 'Link FTTH'}`,
        `Panjang: ${state.length} km @ ${state.wave} nm`,
        `Total redaman: ${round(last.linkLoss)} dB`,
        `Daya terima: ${round(last.received)} dBm`,
        `Anggaran: ${round(last.budget)} dB | Sisa margin: ${round(last.headroom)} dB`,
        `Jarak maksimal: ${Number.isFinite(last.maxKm) ? round(last.maxKm, 2) + ' km' : 'tanpa batas'}`,
        `Status: ${last.ok ? 'LAYAK' : 'TIDAK LAYAK'}`,
      ].join('\n');
      try { await copyText(text); toast.success('Ringkasan disalin'); }
      catch { toast.warn('Gagal menyalin', 'Salin manual dari layar.'); }
    });
  }

  form.addEventListener('input', refresh);
  form.addEventListener('change', (event) => {
    if (event.target.name === 'wave') {
      form.querySelector('[name="perKm"]').value = LOSS_PER_KM[event.target.value] ?? 0.35;
    }
    if (event.target.name === 'splitter' && event.target.value !== 'custom') {
      form.querySelector('[name="splitterLoss"]').value = SPLITTERS[event.target.value]?.loss || 0;
    }
    refresh();
  });

  view.querySelector('#att-reset')?.addEventListener('click', () => {
    for (const [key, value] of Object.entries(DEFAULT_STATE)) {
      const el = form.querySelector(`[name="${key}"]`);
      if (el) el.value = value;
    }
    refresh();
    toast.info('Kalkulator direset', 'Nilai kembali ke bawaan.');
  });

  refresh();
}

export default { render };
