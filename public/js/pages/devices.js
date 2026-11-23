/* lintasJB NMS — Perangkat: GenieACS, OLT, RouterOS */
import * as api from '../api.js';
import { state, nodeById } from '../state.js';
import {
  esc, icon, fmt, toast, errorToast, empty, modal, confirmDialog, statusPill,
  field, select, formValues, debounce,
} from '../ui.js';
import { requestRefresh } from '../forms.js';
import { navigate } from '../router.js';

const VENDORS = {
  hioso: 'HiOSO', mikrotik: 'MikroTik', huawei: 'Huawei', zte: 'ZTE', fiberhome: 'FiberHome',
  nokia: 'Nokia', vsol: 'VSOL', raisecom: 'Raisecom', cdata: 'C-Data', generic: 'Generic',
};
const MODELS = {
  hioso: ['HA7304', 'HA7304S', 'HA7308', 'FHA7104', 'FHA7108', 'EPON 1U', 'EPON 2U', 'GPON 4P'],
  mikrotik: ['CRS328-4C-20S-4S+RM', 'CRS305-1G-4S+IN'],
  huawei: ['MA5800-X7', 'MA5800-X15', 'EA5800-X7'],
  zte: ['C320', 'C300', 'C620'],
  fiberhome: ['AN5516-01', 'AN5516-06'],
  nokia: ['7360 ISAM FX-4', '7360 ISAM FX-8'],
  vsol: ['V1600D', 'V1600G2'],
  raisecom: ['ISCOM5508'],
  cdata: ['FD1304'],
  generic: ['Generic OLT'],
};

const SSH_PRESETS = {
  huawei: { test: 'display version', onus: 'display ont info 0 all' },
  zte: { test: 'show version', onus: 'show gpon onu state' },
  hioso: { test: 'show version', onus: 'show onu all' },
  fiberhome: { test: 'show version', onus: 'show onu all' },
  nokia: { test: 'show version', onus: 'show ont all' },
  vsol: { test: 'show version', onus: 'show onu all' },
  raisecom: { test: 'show version', onus: 'show onu info' },
  cdata: { test: 'show version', onus: 'show onu all' },
  mikrotik: { test: '/system resource print', onus: '/interface print' },
  generic: { test: 'show version', onus: 'show onu all' },
};

const OLT_DEFAULT_PORT = { http: 80, rest: 443, snmp: 161, ssh: 22, cli: 22 };


function statusLine(ok, label, extra = '') {
  const cls = ok === true ? 'dot--ok' : ok === false ? 'dot--err' : 'dot--idle';
  return `<span class="status-line"><span class="dot ${cls}"></span>${esc(label)}${extra ? `<span class="olt-meta">${esc(extra)}</span>` : ''}</span>`;
}

function oltTone(olt) {
  if (!olt.enabled) return { ok: null, label: 'Nonaktif' };
  if (olt.lastResult?.ok) return { ok: true, label: 'Terhubung' };
  if (olt.lastResult && olt.lastResult.ok === false) return { ok: false, label: 'Error' };
  return { ok: null, label: 'Belum dipoll' };
}

function openOltModal({ olt = null } = {}) {
  const editing = Boolean(olt);
  const vendor = olt?.vendor || 'hioso';
  const models = MODELS[vendor] || MODELS.generic;
  const siteOptions = state.nodes.filter((n) => ['olt', 'pop', 'router'].includes(n.type));
  const protocol = olt?.protocol || 'http';
  const preset = SSH_PRESETS[vendor] || SSH_PRESETS.generic;
  const protoPage = (values) => (values.includes(protocol) ? '' : ' hidden');
  modal({
    title: editing ? `Edit OLT: ${olt.name}` : 'Tambah OLT',
    subtitle: editing ? olt.name : 'HiOSO dan multi-vendor EPON/GPON · HTTP, SNMP, atau remote SSH',
    iconName: 'radio',
    size: 'wide',
    body: `<form id="olt-form">
      <div class="form-section">
        <div class="form-section__title">${icon('radio')} Identitas OLT</div>
        <div class="grid-2">
          ${field('Nama OLT', `<input name="name" value="${esc(olt?.name || '')}" placeholder="OLT HiOSO HA7304 Cirahayu" required />`)}
          ${field('Site node', `<select name="siteNodeId"><option value="">— Tidak ditautkan —</option>${siteOptions.map((n) => `<option value="${esc(n.id)}" ${olt?.siteNodeId === n.id ? 'selected' : ''}>${esc(n.name)} (${esc(n.type.toUpperCase())})</option>`).join('')}</select>`)}
        </div>
        <div class="grid-2 mt-2">
          ${field('Vendor', `<select name="vendor">${Object.entries(VENDORS).map(([v, l]) => `<option value="${v}" ${vendor === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
          ${field('Model', `<select name="model">${models.map((m) => `<option value="${m}" ${olt?.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select>`)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('globe')} Koneksi manajemen</div>
        <div class="grid-3">
          ${field('Host / IP', `<input name="host" value="${esc(olt?.host || '')}" placeholder="10.10.0.2" required />`)}
          ${field('Protokol', select('protocol', [
            { value: 'http', label: 'HTTP Web UI' },
            { value: 'rest', label: 'REST / HTTPS' },
            { value: 'snmp', label: 'SNMP' },
            { value: 'ssh', label: 'SSH (remote CLI)' },
          ], protocol))}
          ${field('Port', `<input name="port" type="number" min="1" max="65535" value="${esc(olt?.port ?? OLT_DEFAULT_PORT[protocol] ?? 80)}" />`)}
        </div>
        <div class="grid-2 mt-2">
          ${field('Username', `<input name="username" value="${esc(olt?.username || '')}" placeholder="admin" />`)}
          ${field('Password', `<input name="password" type="password" autocomplete="new-password" placeholder="${olt?.hasPassword ? '•••••• (kosongkan jika tidak diubah)' : 'Password web / SNMP / SSH'}" />`)}
        </div>

        <div data-proto="http rest"${protoPage(['http', 'rest'])}>
          <div class="grid-2 mt-2">
            ${field('Login path', `<input name="loginPath" value="${esc(olt?.loginPath || '/login.cgi')}" />`)}
            ${field('ONU list path', `<input name="onuPath" value="${esc(olt?.onuPath || '/cgi-bin/onu_list.cgi')}" />`)}
          </div>
          <div class="switch-row mt-2"><div><b>Gunakan HTTPS / TLS</b><span>Sertifikat self-signed diizinkan.</span></div><label class="switch"><input type="checkbox" name="tls" ${olt?.tls ? 'checked' : ''}/><i></i></label></div>
        </div>

        <div data-proto="snmp"${protoPage(['snmp'])}>
          <div class="grid-2 mt-2">
            ${field('SNMP community', `<input name="community" value="${esc(olt?.snmp?.community || 'public')}" />`)}
            ${field('SNMP port', `<input name="snmpPort" type="number" value="${esc(olt?.snmp?.port ?? 161)}" />`)}
          </div>
          <div class="grid-2 mt-2">
            ${field('ONU status OID', `<input name="onuStatusOid" value="${esc(olt?.snmp?.onuStatusOid || '')}" placeholder="1.3.6.1.4.1.3320.101.10.1.1.1.6" />`)}
            ${field('ONU name OID', `<input name="onuNameOid" value="${esc(olt?.snmp?.onuNameOid || '')}" placeholder="opsional" />`)}
          </div>
          <div class="grid-2 mt-2">
            ${field('ONU MAC OID', `<input name="onuMacOid" value="${esc(olt?.snmp?.onuMacOid || '')}" placeholder="opsional" />`)}
            ${field('ONU RX OID', `<input name="onuRxOid" value="${esc(olt?.snmp?.onuRxOid || '')}" placeholder="opsional" />`)}
          </div>
        </div>

        <div data-proto="ssh cli"${protoPage(['ssh', 'cli'])}>
          <div class="grid-2 mt-2">
            ${field('Perintah tes', `<input name="sshTestCommand" value="${esc(olt?.sshTestCommand || preset.test)}" placeholder="show version" />`, 'Dijalankan saat Test Connection.')}
            ${field('Perintah ONU', `<input name="sshOnuCommand" value="${esc(olt?.sshOnuCommand || preset.onus)}" placeholder="show onu all" />`, 'Output CLI diparse otomatis (serial, status, RX, jarak).')}
          </div>
          <div class="grid-2 mt-2">
            ${field('Private key (opsional)', `<textarea name="sshPrivateKey" rows="3" placeholder="${olt?.hasSshKey ? 'Private key tersimpan. Kosongkan jika tidak diubah.' : '-----BEGIN OPENSSH PRIVATE KEY-----'}"></textarea>`, 'Kosongkan untuk memakai password. Key disimpan terenkripsi.')}
            ${field('Passphrase private key', `<input name="sshKeyPassphrase" type="password" autocomplete="new-password" placeholder="opsional" />`)}
          </div>
          <div class="mode-hint">Remote CLI membuka shell SSH dari server NMS, menangani prompt <span class="mono">--More--</span>, lalu menjalankan perintah. Setelah tersimpan, tombol <b>Remote SSH</b> tersedia di kartu OLT untuk terminal interaktif.</div>
        </div>

        <div class="switch-row mt-2"><div><b>Mode simulasi</b><span>Gunakan data ONU contoh tanpa koneksi ke OLT fisik</span></div><label class="switch"><input type="checkbox" name="simulated" ${olt?.simulated !== false ? 'checked' : ''}/><i></i></label></div>
        <div class="switch-row"><div><b>Ikuti monitor otomatis</b><span>Poll ONU setiap interval monitoring</span></div><label class="switch"><input type="checkbox" name="enabled" ${olt?.enabled !== false ? 'checked' : ''}/><i></i></label></div>
      </div>
      <div class="hint" data-proto-hint>${icon('info')} Pilih SSH untuk remote CLI OLT (Huawei/ZTE/HiOSO/FiberHome). Mode simulasi tetap tersedia untuk demo dan pelatihan NOC.</div>
    </form>`,
    footer: `<div class="left router-test-status" data-test-status><span class="dot"></span><span>Belum diuji</span></div>
      <button class="btn btn-soft" data-modal-close>Batal</button>
      <button class="btn btn-soft" data-test>${icon('zap')} Test Connection</button>
      <button class="btn btn-primary" data-save>${icon('save')} ${editing ? 'Simpan' : 'Tambah OLT'}</button>`,
    onMount(ui, root) {
      const form = root.querySelector('#olt-form');
      const vendorSel = form.querySelector('[name="vendor"]');
      const modelSel = form.querySelector('[name="model"]');
      const protocolSel = form.querySelector('[name="protocol"]');
      const portInput = form.querySelector('[name="port"]');
      const testInput = form.querySelector('[name="sshTestCommand"]');
      const onusInput = form.querySelector('[name="sshOnuCommand"]');
      const save = root.querySelector('[data-save]');
      const test = root.querySelector('[data-test]');
      const status = root.querySelector('[data-test-status]');
      const hint = root.querySelector('[data-proto-hint]');

      const applyProtocol = () => {
        const value = protocolSel.value;
        for (const el of form.querySelectorAll('[data-proto]')) {
          const list = String(el.dataset.proto || '').split(/\s+/);
          el.hidden = !list.includes(value);
        }
        if (hint) {
          hint.innerHTML = value === 'ssh'
            ? `${icon('info')} SSH membuka shell CLI OLT dari server NMS. Isi username/password atau private key, lalu sesuaikan perintah tes dan perintah ONU dengan firmware OLT.`
            : value === 'snmp'
              ? `${icon('info')} SNMP walk memakai OID privat per firmware. Isi minimal OID status ONU, lalu lengkapi OID nama/MAC/RX bila tersedia.`
              : value === 'rest'
                ? `${icon('info')} REST/HTTPS memakai endpoint web OLT. Aktifkan TLS untuk sertifikat self-signed.`
                : `${icon('info')} HTTP Web UI memakai form login dan tabel ONU. Path login/ONU dapat disesuaikan per firmware.`;
        }
      };
      applyProtocol();

      const vendorPreset = () => SSH_PRESETS[vendorSel.value] || SSH_PRESETS.generic;
      const applyVendorPreset = (previousVendor) => {
        const prev = SSH_PRESETS[previousVendor] || SSH_PRESETS.generic;
        const next = vendorPreset();
        if (!testInput.value.trim() || testInput.value === prev.test) testInput.value = next.test;
        if (!onusInput.value.trim() || onusInput.value === prev.onus) onusInput.value = next.onus;
      };
      let lastVendor = vendorSel.value;
      vendorSel.addEventListener('change', () => {
        modelSel.innerHTML = (MODELS[vendorSel.value] || MODELS.generic).map((m) => `<option value="${m}">${m}</option>`).join('');
        applyVendorPreset(lastVendor);
        lastVendor = vendorSel.value;
      });

      protocolSel.addEventListener('change', () => {
        const next = protocolSel.value;
        const prevDefault = OLT_DEFAULT_PORT[protocolSel.dataset.previous] ?? 80;
        if (!portInput.value || Number(portInput.value) === prevDefault) {
          portInput.value = OLT_DEFAULT_PORT[next] ?? 80;
        }
        protocolSel.dataset.previous = next;
        applyProtocol();
      });
      protocolSel.dataset.previous = protocolSel.value;

      const showStatus = (kind, text) => {
        status.className = `router-test-status ${kind}`.trim();
        status.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>`;
      };

      const readPayload = (v) => ({
        id: olt?.id,
        projectId: state.projectId,
        name: String(v.name || '').trim(),
        siteNodeId: v.siteNodeId || null,
        vendor: v.vendor,
        model: v.model,
        host: String(v.host || '').trim(),
        port: Number(v.port) || OLT_DEFAULT_PORT[v.protocol] || 80,
        protocol: v.protocol,
        tls: Boolean(v.tls),
        username: String(v.username || '').trim(),
        password: v.password || undefined,
        simulated: Boolean(v.simulated),
        enabled: Boolean(v.enabled),
        loginPath: String(v.loginPath || '').trim(),
        onuPath: String(v.onuPath || '').trim(),
        sshOnuCommand: String(v.sshOnuCommand || '').trim(),
        sshTestCommand: String(v.sshTestCommand || '').trim(),
        sshPrivateKey: String(v.sshPrivateKey || '').trim() || undefined,
        sshKeyPassphrase: String(v.sshKeyPassphrase || '').trim() || undefined,
        snmp: {
          community: String(v.community || '').trim(),
          port: Number(v.snmpPort) || 161,
          onuStatusOid: String(v.onuStatusOid || '').trim(),
          onuNameOid: String(v.onuNameOid || '').trim(),
          onuMacOid: String(v.onuMacOid || '').trim(),
          onuRxOid: String(v.onuRxOid || '').trim(),
        },
      });

      test.addEventListener('click', async () => {
        const v = formValues(form);
        if (!String(v.host || '').trim()) { toast.warn('Host belum diisi', 'Isi host/IP OLT terlebih dahulu.'); return; }
        if (v.simulated) {
          showStatus('ok', 'Mode simulasi aktif · data ONU contoh, tanpa koneksi fisik.');
          return;
        }
        const old = test.innerHTML;
        test.disabled = true;
        test.innerHTML = 'Menguji…';
        showStatus('', v.protocol === 'ssh' ? 'Membuka sesi SSH…' : 'Menghubungi OLT…');
        try {
          const result = await api.integration.testOltDraft(readPayload(v));
          const identity = result.resource?.identity || '';
          const detail = identity ? `${fmt.num(result.latencyMs)} ms · ${identity}` : result.message;
          showStatus('ok', `OK · ${detail}`.slice(0, 220));
        } catch (err) {
          showStatus('err', err.message);
        } finally {
          test.disabled = false;
          test.innerHTML = old;
        }
      });

      save.addEventListener('click', async () => {
        const v = formValues(form);
        if (!v.name?.trim() || !v.host?.trim()) { toast.warn('Data belum lengkap', 'Nama dan host OLT wajib diisi.'); return; }
        const payload = readPayload(v);
        delete payload.id;
        save.disabled = true;
        try {
          if (editing) await api.integration.updateOlt(olt.id, payload);
          else await api.integration.createOlt(payload);
          ui.close();
          toast.success(editing ? 'OLT diperbarui' : 'OLT ditambahkan', payload.name);
          requestRefresh();
        } catch (err) { errorToast(err); save.disabled = false; }
      });
    },
  });
}

function openSshConsole(olt) {
  const preset = SSH_PRESETS[olt.vendor] || SSH_PRESETS.generic;
  const quick = [...new Set([preset.test, preset.onus, 'show interface brief', 'display interface brief'])].filter(Boolean);
  modal({
    title: `Remote SSH · ${olt.name}`,
    subtitle: `${olt.username || 'user'}@${olt.host}:${olt.port} · ${VENDORS[olt.vendor] || olt.vendor}`,
    iconName: 'code',
    size: 'wide',
    body: `<div class="ssh-console">
      <div class="ssh-bar">
        <span class="dot dot--ok"></span>
        <span class="mono">${esc(olt.host)}:${esc(olt.port)}</span>
        <button type="button" class="link-btn" data-ssh-clear>Bersihkan</button>
      </div>
      <pre class="ssh-output" data-ssh-output>Remote CLI siap. Pilih perintah cepat di bawah atau tulis perintah sendiri.</pre>
      <form class="ssh-form" data-ssh-form>
        <input name="command" placeholder="${esc(preset.test)}" autocomplete="off" spellcheck="false" />
        <button class="btn btn-primary" type="submit">${icon('zap')} Jalankan</button>
      </form>
      <div class="ssh-quick">
        ${quick.map((cmd) => `<button type="button" class="btn btn-xs btn-soft" data-ssh-cmd="${esc(cmd)}">${esc(cmd)}</button>`).join('')}
      </div>
    </div>`,
    footer: `<span class="muted" style="font-size:10px">Sesi dijalankan dari server NMS dan dicatat di aktivitas.</span><button class="btn btn-soft" data-modal-close>Tutup</button>`,
    onMount(ui, root) {
      const form = root.querySelector('[data-ssh-form]');
      const input = form.querySelector('[name="command"]');
      const output = root.querySelector('[data-ssh-output]');
      const clear = root.querySelector('[data-ssh-clear]');
      const append = (text) => {
        output.textContent += `${output.textContent ? '\n' : ''}${text}`;
        output.scrollTop = output.scrollHeight;
      };
      let busy = false;
      const run = async (command) => {
        if (busy) return;
        const cmd = String(command || '').trim();
        if (!cmd) return;
        busy = true;
        input.value = cmd;
        append(`\n$ ${cmd}\n`);
        const submit = form.querySelector('button[type="submit"]');
        const old = submit.innerHTML;
        submit.disabled = true;
        submit.innerHTML = 'Menjalankan…';
        try {
          const result = await api.integration.execOlt(olt.id, cmd);
          append(result.output || '(tanpa output)');
        } catch (err) {
          append(`[ERROR] ${err.message}`);
        } finally {
          busy = false;
          submit.disabled = false;
          submit.innerHTML = old;
          input.focus();
        }
      };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        run(input.value);
      });
      for (const btn of root.querySelectorAll('[data-ssh-cmd]')) {
        btn.addEventListener('click', () => run(btn.dataset.sshCmd));
      }
      clear.addEventListener('click', () => {
        output.textContent = 'Output dibersihkan.';
      });
      input.focus();
    },
  });
}

const ROUTER_MODE_HINT = {
  api: 'API biner memakai service api (default 8728) atau api-ssl (default 8729). Port bebas diisi custom — cocok untuk RouterOS lama (< 7.1) yang belum punya REST API.',
  rest: 'REST API memakai service www-ssl (default 443) atau www. RouterOS v7+. Sertifikat self-signed diizinkan.',
  auto: 'Adapter mencoba API biner lebih dulu, lalu REST API. Cocok bila jenis service pada port tersebut belum diketahui.',
};

function routerSchemeOptions(mode) {
  if (mode === 'api') {
    return [
      { value: 'plain', label: 'api (RouterOS)' },
      { value: 'tls', label: 'api-ssl (TLS)' },
    ];
  }
  if (mode === 'rest') {
    return [
      { value: 'tls', label: 'https (TLS)' },
      { value: 'plain', label: 'http' },
    ];
  }
  return [{ value: 'auto', label: 'Deteksi otomatis' }];
}

function routerInitialScheme(router) {
  if (!router || (router.transport || 'auto') === 'auto') return 'auto';
  if (router.transport === 'api') return router.tls === false ? 'plain' : 'tls';
  return router.tls === false ? 'plain' : 'tls';
}

function openRouterModal({ router = null } = {}) {
  const editing = Boolean(router);
  const siteOptions = state.nodes.filter((n) => ['router', 'pop', 'server'].includes(n.type));
  const mode = router?.transport || 'api';
  const scheme = routerInitialScheme(router);
  modal({
    title: editing ? `Edit: ${router.name}` : 'Tambah router MikroTik',
    subtitle: 'Koneksi nyata RouterOS API biner / REST · tanpa simulasi · self-signed TLS didukung',
    iconName: 'router',
    size: 'wide',
    body: `<form id="router-form">
      <div class="form-section">
        <div class="form-section__title">${icon('router')} Identitas</div>
        <div class="grid-2">
          ${field('Nama router', `<input name="name" value="${esc(router?.name || '')}" placeholder="DIKI CIRAHAYU" required />`)}
          ${field('Site node', `<select name="siteNodeId"><option value="">— Tidak ditautkan —</option>${siteOptions.map((n) => `<option value="${esc(n.id)}" ${router?.siteNodeId === n.id ? 'selected' : ''}>${esc(n.name)} (${esc(n.type.toUpperCase())})</option>`).join('')}</select>`)}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('globe')} Koneksi RouterOS</div>
        <div class="grid-3">
          ${field('Host / IP', `<input name="host" value="${esc(router?.host || '')}" placeholder="103.115.20.10" required />`)}
          ${field('Mode koneksi', select('transport', [
            { value: 'api', label: 'API Biner (api)' },
            { value: 'rest', label: 'REST API (www-ssl)' },
            { value: 'auto', label: 'Deteksi otomatis' },
          ], mode))}
          ${field('Port', `<input name="port" type="number" value="${esc(router?.port ?? 8728)}" />`)}
        </div>
        <div class="grid-2 mt-2">
          ${field('Scheme', select('scheme', routerSchemeOptions(mode), scheme))}
          ${field('Username', `<input name="username" value="${esc(router?.username || '')}" placeholder="lintasjbNMS" />`)}
        </div>
        <div class="grid-2 mt-2">
          ${field('Password', `<input name="password" type="password" placeholder="${router?.hasPassword ? '•••••• (kosongkan jika tidak diubah)' : 'Password API'}" />`)}
          ${field('Password Env', `<input name="passwordEnv" value="${esc(router?.passwordEnv || '')}" placeholder="MIKROTIK_002_PASSWORD" />`, 'Opsional — password dibaca dari environment variable bila diisi.')}
        </div>
        <div class="mode-hint" data-mode-hint>${esc(ROUTER_MODE_HINT[mode] || ROUTER_MODE_HINT.auto)}</div>
        <div class="switch-row mt-2"><div><b>Aktifkan router</b><span>Ikut poll CPU, interface, PPPoE, dan alarm otomatis.</span></div><label class="switch"><input type="checkbox" name="enabled" ${router?.enabled !== false ? 'checked' : ''}/><i></i></label></div>
        ${field('Deskripsi', `<input name="description" value="${esc(router?.description || '')}" placeholder="pop-mkw" />`)}
      </div>
      <div class="form-section">
        <div class="form-section__title">${icon('activity')} Interface dimonitor</div>
        <label class="field"><span>Daftar interface</span><textarea name="monitoredInterfaces" placeholder="sfp-sfpplus1, ether1, pppoe-out1">${esc((router?.monitoredInterfaces || []).join(', '))}</textarea><small>Pisahkan dengan koma. Kosongkan bila tidak ingin alarm interface tertentu; ringkasan total/up tetap dibaca.</small></label>
      </div>
    </form>`,
    footer: `<div class="left router-test-status" data-test-status><span class="dot"></span><span>Belum diuji</span></div>
      <button class="btn btn-soft" data-modal-close>Batal</button>
      <button class="btn btn-soft" data-test>${icon('zap')} Test Connection</button>
      <button class="btn btn-primary" data-save>${icon('save')} ${editing ? 'Simpan' : 'Tambah router'}</button>`,
    onMount(ui, root) {
      const form = root.querySelector('#router-form');
      const save = root.querySelector('[data-save]');
      const test = root.querySelector('[data-test]');
      const status = root.querySelector('[data-test-status]');
      const modeSelect = form.elements.transport;
      const schemeSelect = form.elements.scheme;
      const portInput = form.elements.port;
      const hint = root.querySelector('[data-mode-hint]');

      const applySchemeOptions = (preferred) => {
        const nextMode = modeSelect.value;
        const options = routerSchemeOptions(nextMode);
        const pick = options.some((o) => o.value === preferred) ? preferred : options[0].value;
        schemeSelect.innerHTML = options.map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('');
        schemeSelect.value = pick;
        hint.textContent = ROUTER_MODE_HINT[nextMode] || ROUTER_MODE_HINT.auto;
      };
      applySchemeOptions(scheme);

      modeSelect.addEventListener('change', () => {
        const nextMode = modeSelect.value;
        const currentPort = Number(portInput.value) || 0;
        if (nextMode === 'api') {
          if ([0, 80, 443].includes(currentPort)) portInput.value = 8728;
          applySchemeOptions('plain');
        } else if (nextMode === 'rest') {
          if ([0, 8728, 8729].includes(currentPort)) portInput.value = 443;
          applySchemeOptions('tls');
        } else {
          applySchemeOptions('auto');
        }
      });

      const readPayload = (v) => {
        const schemeValue = v.scheme || 'auto';
        const isAuto = schemeValue === 'auto';
        const fallbackPort = v.transport === 'api'
          ? (schemeValue === 'tls' ? 8729 : 8728)
          : (schemeValue === 'tls' ? 443 : 80);
        return {
          id: router?.id,
          projectId: state.projectId,
          name: String(v.name || '').trim(),
          siteNodeId: v.siteNodeId || null,
          host: String(v.host || '').trim(),
          port: Number(v.port) || fallbackPort,
          transport: v.transport || 'api',
          tls: isAuto ? (router ? router.tls !== false : true) : schemeValue === 'tls',
          username: String(v.username || '').trim(),
          password: v.password || undefined,
          passwordEnv: String(v.passwordEnv || '').trim(),
          description: String(v.description || '').trim(),
          enabled: Boolean(v.enabled),
          monitoredInterfaces: String(v.monitoredInterfaces || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
        };
      };

      const showStatus = (kind, text) => {
        status.className = `router-test-status ${kind}`.trim();
        status.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>`;
      };

      test.addEventListener('click', async () => {
        const v = formValues(form);
        if (!v.host?.trim()) { toast.warn('Host belum diisi', 'Isi host/IP router terlebih dahulu.'); return; }
        if (!v.username?.trim() && !v.passwordEnv?.trim()) { toast.warn('Kredensial belum lengkap', 'Isi username dan password (atau password env).'); return; }
        const old = test.innerHTML;
        test.disabled = true;
        test.innerHTML = 'Menguji…';
        showStatus('', 'Menghubungi router…');
        try {
          const result = await api.integration.testRouterDraft(readPayload(v));
          const identity = result.resource?.identity || result.resource?.board || 'RouterOS';
          showStatus('ok', `OK · ${fmt.num(result.latencyMs)} ms · ${identity}`);
        } catch (err) {
          showStatus('err', err.message);
        } finally {
          test.disabled = false;
          test.innerHTML = old;
        }
      });

      save.addEventListener('click', async () => {
        const v = formValues(form);
        if (!v.name?.trim() || !v.host?.trim()) { toast.warn('Data belum lengkap', 'Nama dan host router wajib diisi.'); return; }
        const payload = readPayload(v);
        delete payload.id;
        save.disabled = true;
        try {
          if (editing) await api.integration.updateRouter(router.id, payload);
          else await api.integration.createRouter(payload);
          ui.close();
          toast.success(editing ? 'Router diperbarui' : 'Router ditambahkan', payload.name);
          requestRefresh();
        } catch (err) { errorToast(err); save.disabled = false; }
      });
    },
  });
}

async function testOlt(olt, button) {
  button.disabled = true;
  const old = button.innerHTML;
  button.innerHTML = 'Menguji…';
  try {
    const result = await api.integration.testOlt(olt.id);
    toast.success('OLT test berhasil', result.message || `${result.summary?.total || 0} ONU terbaca.`);
    requestRefresh();
  } catch (err) {
    toast.error('OLT test gagal', err.message);
  } finally { button.disabled = false; button.innerHTML = old; }
}

async function testRouter(router, button) {
  button.disabled = true;
  const old = button.innerHTML;
  button.innerHTML = 'Menguji…';
  try {
    const result = await api.integration.testRouter(router.id);
    toast.success('RouterOS test berhasil', result.message || 'REST API terhubung.');
    requestRefresh();
  } catch (err) {
    toast.error('RouterOS test gagal', err.message);
  } finally { button.disabled = false; button.innerHTML = old; }
}

async function showOnus(olt) {
  const m = modal({
    title: `ONU · ${olt.name}`,
    subtitle: 'Membaca daftar ONU dari OLT',
    iconName: 'radio',
    size: 'xl',
    body: `<div id="onu-body">${empty('refresh', 'Membaca ONU…', 'Menghubungi OLT dan mem-parsing daftar ONU.')}</div>`,
    footer: `<button class="btn btn-soft" data-modal-close>Tutup</button><button class="btn btn-primary" data-sync>${icon('refresh')} Sync ONT baru</button>`,
    onMount(ui, root) {
      const body = root.querySelector('#onu-body');
      api.integration.onus(olt.id).then((result) => {
        const onus = result.onus || [];
        const summary = result.summary || {};
        body.innerHTML = `
          <div class="row row--between mb-2">
            <div class="row" style="gap:14px">
              <span class="pill pill--accent">${fmt.num(summary.total ?? onus.length)} ONU</span>
              <span class="pill pill--ok">${fmt.num(summary.online ?? 0)} online</span>
              <span class="pill pill--danger">${fmt.num(summary.offline ?? 0)} offline</span>
              <span class="pill pill--warn">${fmt.num(summary.warning ?? 0)} warning</span>
            </div>
            <span class="muted" style="font-size:10px">${esc(result.message || '')}</span>
          </div>
          ${onus.length ? `<div class="table-wrap" style="max-height:420px;overflow:auto"><table class="data-table">
            <thead><tr><th>ONU</th><th>Serial / MAC</th><th>Pelanggan</th><th>Status</th><th>Rx</th><th>Jarak</th><th>Interface</th><th>ONT</th></tr></thead>
            <tbody>${onus.map((o) => `<tr>
              <td class="mono" style="font-size:10px">#${esc(o.onuId)}<br><span class="dim">${esc(o.name || '')}</span></td>
              <td class="mono" style="font-size:9.5px">${esc(o.serial || '—')}<br><span class="dim">${esc(o.mac || '')}</span></td>
              <td>${esc(o.customer || '—')}<br><span class="dim" style="font-size:9px">${esc(o.profile || '')}</span></td>
              <td>${statusPill(o.status)}</td>
              <td class="mono" style="font-size:10px">${o.rxPower !== null && o.rxPower !== undefined ? `${Number(o.rxPower).toFixed(2)} dBm` : '—'}</td>
              <td class="mono" style="font-size:10px">${o.distanceM ? fmt.km(o.distanceM) : '—'}</td>
              <td class="muted" style="font-size:9.5px">${esc(o.interface || '—')}</td>
              <td>${o.linkedNodeId ? `<span class="pill pill--ok">linked</span>` : '<span class="pill">baru</span>'}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : empty('radio', 'Tidak ada ONU', result.message || 'OLT tidak mengembalikan data ONU.')}`;
      }).catch((err) => {
        body.innerHTML = `<div class="awg">${esc(err.message)}</div><div class="hint mt-2">${icon('info')} Periksa host, kredensial, dan path ONU. Gunakan mode simulasi untuk demo.</div>`;
      });
      root.querySelector('[data-sync]').addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        btn.disabled = true;
        try {
          const result = await api.integration.syncOlt(olt.id, true);
          toast.success('Sync OLT selesai', result.message || 'ONT berhasil disinkronkan.');
          ui.close();
          requestRefresh();
        } catch (err) { errorToast(err); btn.disabled = false; }
      });
    },
  });
  return m;
}

async function showRouterInterfaces(router) {
  modal({
    title: `RouterOS · ${router.name}`,
    subtitle: 'CPU, interface, dan sesi PPPoE aktif',
    iconName: 'router',
    size: 'wide',
    body: `<div id="iface-body">${empty('refresh', 'Membaca RouterOS…')}</div>`,
    footer: `<button class="btn btn-soft" data-modal-close>Tutup</button><button class="btn btn-primary" data-refresh>${icon('refresh')} Sinkronkan</button>`,
    onMount(ui, root) {
      const body = root.querySelector('#iface-body');
      api.integration.interfaces(router.id).then((result) => {
        const r = result.resource || {};
        const summary = result.summary || {};
        body.innerHTML = `
          <div class="olt-stats">
            <div class="olt-stat"><span>CPU load</span><b>${Number(r.cpuLoad) || 0}%</b></div>
            <div class="olt-stat"><span>Uptime</span><b style="font-size:10px">${esc(r.uptime || '—')}</b></div>
            <div class="olt-stat"><span>Interface up</span><b>${summary.interfaceUp || 0}/${summary.interfaceTotal || 0}</b></div>
          </div>
          <div class="cable-stats mb-2">
            <div><span>Board</span><b>${esc(r.board || '—')}</b></div>
            <div><span>RouterOS</span><b>${esc(r.version || '—')}</b></div>
            <div><span>Memory</span><b>${fmt.bytes(r.freeMemory)} / ${fmt.bytes(r.totalMemory)}</b></div>
            <div><span>PPPoE</span><b>${summary.pppActive || 0} aktif</b></div>
          </div>
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Interface</th><th>Tipe</th><th>Status</th><th>Speed</th><th>Comment</th><th>Monitor</th></tr></thead>
            <tbody>${(result.interfaces || []).map((i) => `<tr>
              <td><b>${esc(i.name)}</b></td><td class="muted">${esc(i.type || '—')}</td>
              <td>${i.running && !i.disabled ? '<span class="pill pill--ok">UP</span>' : '<span class="pill pill--danger">DOWN</span>'}</td>
              <td class="mono" style="font-size:10px">${esc(i.speed || '—')}</td>
              <td class="muted" style="font-size:10px">${esc(i.comment || '')}</td>
              <td>${i.monitored ? '<span class="pill pill--accent">ya</span>' : '<span class="pill">tidak</span>'}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          ${(result.pppActive || []).length ? `<div class="section-title"><h3>Sesi PPPoE aktif (${result.pppActive.length})</h3></div>
            <div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Address</th><th>Uptime</th><th>Service</th></tr></thead><tbody>
            ${result.pppActive.slice(0, 50).map((p) => `<tr><td class="mono">${esc(p.name || '—')}</td><td class="mono">${esc(p.address || '—')}</td><td class="mono">${esc(p.uptime || '—')}</td><td class="muted">${esc(p.service || '')}</td></tr>`).join('')}
            </tbody></table></div>` : ''}`;
      }).catch((err) => {
        body.innerHTML = `<div class="awg">${esc(err.message)}</div>`;
      });
      root.querySelector('[data-refresh]').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try {
          await api.integration.syncRouter(router.id);
          toast.success('RouterOS disinkronkan', 'Data resource dan interface diperbarui.');
          ui.close();
          requestRefresh();
        } catch (err) { errorToast(err); event.currentTarget.disabled = false; }
      });
    },
  });
}

export async function render(view) {
  let tab = 'genieacs';
  view.innerHTML = `<div class="page">
    <div class="page-toolbar">
      <div><h2>Perangkat & integrasi</h2><p>Kelola GenieACS NBI, OLT HiOSO/multi-vendor, dan MikroTik RouterOS dalam satu tempat.</p></div>
      <div class="page-toolbar__right">
        <button class="btn btn-soft btn-sm" data-settings>${icon('settings')} Pengaturan integrasi</button>
        <button class="btn btn-primary btn-sm hidden" data-add-olt>${icon('plus')} Tambah OLT</button>
        <button class="btn btn-primary btn-sm hidden" data-add-router>${icon('plus')} Tambah router</button>
      </div>
    </div>
    <div class="device-tabs">
      <div class="seg-tabs" id="device-tabs">
        <button class="seg-tab active" data-tab="genieacs">${icon('globe')} GenieACS</button>
        <button class="seg-tab" data-tab="olts">${icon('radio')} OLT <span class="dim">${(state.integrations.olts || []).length}</span></button>
        <button class="seg-tab" data-tab="routers">${icon('router')} RouterOS <span class="dim">${(state.integrations.routers || []).length}</span></button>
        <button class="seg-tab" data-tab="monitor">${icon('activity')} Monitor</button>
      </div>
      <span class="muted" style="font-size:10px" id="device-summary">—</span>
    </div>
    <div id="device-content"></div>
  </div>`;

  const content = view.querySelector('#device-content');
  const addOlt = view.querySelector('[data-add-olt]');
  const addRouter = view.querySelector('[data-add-router]');
  const summary = view.querySelector('#device-summary');

  function genieView() {
    const cfg = state.settings.integrations?.genieacs || {};
    const cache = state.integrations.genieacs || { devices: [], faults: [] };
    const devices = cache.devices || [];
    const online = devices.filter((d) => d.online).length;
    const offline = devices.length - online;
    return `
      <section class="integration-card">
        <div class="ic-head">
          <div class="ic-logo">${icon('globe')}</div>
          <div class="ic-title"><b>GenieACS NBI ${statusPill(cfg.enabled ? 'online' : 'planned', { online: { label: 'Aktif', tone: 'ok' }, planned: { label: 'Nonaktif', tone: '' } })}</b><span>${esc(cfg.url || 'Belum dikonfigurasi')} · TR-069 CWMP</span></div>
          <div class="row">
            <button class="btn btn-sm btn-soft" data-genie-test>${icon('zap')} Test</button>
            <button class="btn btn-sm btn-primary" data-genie-sync>${icon('refresh')} Sync ONT</button>
            <button class="icon-btn" data-settings title="Konfigurasi">${icon('settings')}</button>
          </div>
        </div>
        <div class="ic-body">
          <div class="olt-stats" style="margin-top:0">
            <div class="olt-stat"><span>Device</span><b>${fmt.num(devices.length)}</b></div>
            <div class="olt-stat"><span>Online</span><b>${fmt.num(online)}</b></div>
            <div class="olt-stat"><span>Offline</span><b>${fmt.num(offline)}</b></div>
          </div>
          <div class="row row--between mt-2">
            <div class="status-line">${statusLine(cfg.enabled ? (cache.error ? false : true) : null, cache.error || (cfg.enabled ? 'NBI siap digunakan' : 'Aktifkan GenieACS di Pengaturan'), cache.lastRunAt ? `poll ${fmt.ago(cache.lastRunAt)}` : '')}</div>
            <span class="muted" style="font-size:10px">Offline threshold ${Math.round((cfg.offlineAfterSec || 600) / 60)} menit · poll ${Math.round((cfg.pollSeconds || 180) / 60)} menit</span>
          </div>
          ${cache.error ? `<div class="awg mt-2">${icon('alert-triangle')} ${esc(cache.error)}</div>` : ''}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h3>${icon('wifi')} Device GenieACS</h3><p>${devices.length ? `${devices.length} device ter-cache · terakhir ${fmt.ago(cache.lastRunAt)}` : 'Belum ada device. Klik Sync ONT setelah GenieACS dikonfigurasi.'}</p></div></div>
        ${devices.length ? `<div class="table-wrap" style="max-height:520px;overflow:auto"><table class="data-table">
          <thead><tr><th>Serial</th><th>Device</th><th>Status</th><th>IP / PPPoE</th><th>SSID</th><th>Rx</th><th>Last inform</th><th></th></tr></thead>
          <tbody>${devices.slice(0, 200).map((d) => `<tr>
            <td class="mono" style="font-size:10px">${esc(d.serial)}</td>
            <td><b>${esc([d.manufacturer, d.model].filter(Boolean).join(' '))}</b><br><span class="dim" style="font-size:9px">${esc(d.softwareVersion || '')}</span></td>
            <td>${d.online ? '<span class="pill pill--ok">Online</span>' : '<span class="pill pill--danger">Offline</span>'}</td>
            <td class="mono" style="font-size:9.5px">${esc(d.ip || '—')}<br><span class="dim">${esc(d.pppoeUser || '')}</span></td>
            <td class="muted" style="font-size:9.5px">${esc(d.ssid || '—')}</td>
            <td class="mono" style="font-size:10px">${d.rxPower !== null && d.rxPower !== undefined ? `${Number(d.rxPower).toFixed(2)} dBm` : '—'}</td>
            <td class="muted" style="font-size:9px">${esc(fmt.ago(d.lastInform))}</td>
            <td><div class="cell-actions">
              <button class="icon-btn" data-genie-refresh="${esc(d.id)}" title="Refresh object">${icon('refresh')}</button>
              <button class="icon-btn" data-genie-reboot="${esc(d.id)}" title="Reboot">${icon('zap')}</button>
            </div></td>
          </tr>`).join('')}</tbody>
        </table></div>` : empty('globe', 'Belum ada device GenieACS', 'Konfigurasikan URL NBI dan kredensial, lalu lakukan sinkronisasi.')}
      </section>`;
  }

  function oltView() {
    const olts = state.integrations.olts || [];
    const cache = state.integrations.cacheOlts || {};
    return `${olts.length ? `<div class="olt-grid">${olts.map((olt) => {
      const tone = oltTone(olt);
      const lr = olt.lastResult || {};
      const cached = cache[olt.id] || {};
      const total = lr.total ?? cached.summary?.total ?? cached.onus?.length ?? 0;
      const online = lr.online ?? cached.summary?.online ?? 0;
      const warning = lr.warning ?? cached.summary?.warning ?? 0;
      const site = olt.siteNodeId ? nodeById(olt.siteNodeId) : null;
      return `<article class="olt-card">
        <div class="olt-head">
          <div class="ic-logo">${icon('radio')}</div>
          <div class="olt-title"><b>${esc(olt.name)}</b><span>${esc(VENDORS[olt.vendor] || olt.vendor)} · ${esc(olt.model || '—')}</span></div>
          <div class="olt-actions">
            <button class="icon-btn" data-olt-test="${esc(olt.id)}" title="Test koneksi">${icon('zap')}</button>
            ${(olt.protocol === 'ssh' || olt.protocol === 'cli') ? `<button class="icon-btn" data-olt-ssh="${esc(olt.id)}" title="Remote SSH">${icon('code')}</button>` : ''}
            <button class="icon-btn" data-olt-onus="${esc(olt.id)}" title="Lihat ONU">${icon('eye')}</button>
            <button class="icon-btn" data-olt-edit="${esc(olt.id)}" title="Edit">${icon('edit')}</button>
            <button class="icon-btn" data-olt-del="${esc(olt.id)}" title="Hapus">${icon('trash')}</button>
          </div>
        </div>
        <div class="row" style="gap:6px;margin-top:9px;flex-wrap:wrap">
          ${olt.simulated ? '<span class="pill pill--purple">SIMULASI</span>' : `<span class="pill pill--accent">${esc(String(olt.protocol || '').toUpperCase())}</span>`}
          ${!olt.enabled ? '<span class="pill">NONAKTIF</span>' : ''}
          <span class="pill">${esc(olt.host)}:${esc(olt.port)}</span>
          ${site ? `<span class="pill pill--info">${esc(site.code || site.name)}</span>` : ''}
        </div>
        <div class="olt-stats">
          <div class="olt-stat"><span>ONU</span><b>${fmt.num(total)}</b></div>
          <div class="olt-stat"><span>Online</span><b class="text-ok">${fmt.num(online)}</b></div>
          <div class="olt-stat"><span>Warning</span><b class="text-warn">${fmt.num(warning)}</b></div>
        </div>
        <div class="olt-foot">
          ${statusLine(tone.ok, tone.label, lr.message || '')}
          <button class="link-btn" data-olt-sync="${esc(olt.id)}">${icon('refresh')} Sync</button>
        </div>
        <div class="olt-meta mt-1">Poll terakhir: ${esc(olt.lastPollAt ? fmt.ago(olt.lastPollAt) : 'belum pernah')} · ${esc(olt.username || 'tanpa user')}</div>
      </article>`;
    }).join('')}</div>` : `<section class="panel">${empty('radio', 'Belum ada OLT', 'Tambahkan OLT HiOSO atau vendor lain untuk membaca ONU dan status pelanggan.')}</section>`}`;
  }

  function routerView() {
    const routers = state.integrations.routers || [];
    const cache = state.integrations.cacheRouters || {};
    return `${routers.length ? `<div class="olt-grid">${routers.map((router) => {
      const lr = router.lastResult || {};
      const cached = cache[router.id] || {};
      const s = cached.summary || {};
      const res = cached.resource || {};
      const statusOk = router.enabled ? (lr.ok === true ? true : lr.ok === false ? false : null) : null;
      return `<article class="olt-card">
        <div class="olt-head">
          <div class="ic-logo">${icon('router')}</div>
          <div class="olt-title"><b>${esc(router.name)}</b><span>${esc(router.host)}:${esc(router.port)} · ${cached.transport === 'api' ? (cached.useTls ? 'API-SSL' : 'API NATIVE') : router.tls ? 'HTTPS' : 'HTTP'}</span></div>
          <div class="olt-actions">
            <button class="icon-btn" data-router-test="${esc(router.id)}" title="Test koneksi">${icon('zap')}</button>
            <button class="icon-btn" data-router-iface="${esc(router.id)}" title="Interface">${icon('activity')}</button>
            <button class="icon-btn" data-router-edit="${esc(router.id)}" title="Edit">${icon('edit')}</button>
            <button class="icon-btn" data-router-del="${esc(router.id)}" title="Hapus">${icon('trash')}</button>
          </div>
        </div>
        <div class="row" style="gap:6px;margin-top:9px;flex-wrap:wrap">
          <span class="pill pill--accent">${esc((cached.transport || router.transport || 'auto') === 'api' ? 'API NATIVE' : (cached.transport || router.transport) === 'rest' ? 'REST API' : 'AUTO DETEKSI')}</span>
          ${!router.enabled ? '<span class="pill">NONAKTIF</span>' : ''}
          <span class="pill">${esc(res.board || router.name)}</span>
        </div>
        <div class="olt-stats">
          <div class="olt-stat"><span>CPU</span><b>${Number(lr.cpu ?? res.cpuLoad ?? 0)}%</b></div>
          <div class="olt-stat"><span>Interface</span><b>${fmt.num(lr.interfaceUp ?? s.interfaceUp ?? 0)}/${fmt.num(lr.interfaceTotal ?? s.interfaceTotal ?? 0)}</b></div>
          <div class="olt-stat"><span>PPPoE</span><b>${fmt.num(lr.pppActive ?? s.pppActive ?? 0)}</b></div>
        </div>
        <div class="olt-foot">
          ${statusLine(statusOk, statusOk === true ? 'Terhubung' : statusOk === false ? 'Error' : 'Belum dipoll', lr.message || '')}
          <button class="link-btn" data-router-sync="${esc(router.id)}">${icon('refresh')} Sync</button>
        </div>
        <div class="olt-meta mt-1">${router.description ? `${esc(router.description)} · ` : ''}Uptime ${esc(lr.uptime || res.uptime || '—')} · poll ${esc(router.lastPollAt ? fmt.ago(router.lastPollAt) : 'belum pernah')}</div>
      </article>`;
    }).join('')}</div>` : `<section class="panel">${empty('router', 'Belum ada router MikroTik', 'Tambahkan router dan aktifkan RouterOS REST API untuk monitoring CPU, interface, dan PPPoE.')}</section>`}`;
  }

  async function monitorView() {
    content.innerHTML = `<section class="panel"><div class="panel-body">${empty('refresh', 'Membaca status monitor…')}</div></section>`;
    let status = null;
    try { status = await api.integration.monitorStatus(); } catch { /* ignore */ }
    const last = status?.lastRun || {};
    const runOlt = last.olts || [];
    const runRouter = last.routers || [];
    content.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">Status monitor</span><span class="kpi-ico">${icon('activity')}</span></div><div class="kpi-value" style="font-size:20px">${status?.running ? 'BERJALAN' : status?.enabled ? 'AKTIF' : 'NONAKTIF'}</div><div class="kpi-sub"><b>${status?.intervalSec || 0} detik</b><span>interval poll</span></div></div>
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">OLT dipoll</span><span class="kpi-ico">${icon('radio')}</span></div><div class="kpi-value">${runOlt.length}</div><div class="kpi-sub"><b>${runOlt.filter((o) => o.ok).length} OK</b><span>· ${runOlt.filter((o) => !o.ok).length} error</span></div></div>
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">Router dipoll</span><span class="kpi-ico">${icon('router')}</span></div><div class="kpi-value">${runRouter.length}</div><div class="kpi-sub"><b>${runRouter.filter((r) => r.ok).length} OK</b><span>· ${runRouter.filter((r) => !r.ok).length} error</span></div></div>
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">Fault baru</span><span class="kpi-ico">${icon('alert-triangle')}</span></div><div class="kpi-value">${(last.createdFaults || []).length}</div><div class="kpi-sub"><b>${(last.alarmsCreated || 0)} alarm</b><span>run terakhir</span></div></div>
      </div>
      <div class="dash-grid">
        <section class="panel">
          <div class="panel-head"><div><h3>${icon('clock')} Run terakhir</h3><p>${last.at ? fmt.datetime(last.at) : 'Belum pernah dijalankan'} · ${esc(last.reason || 'interval')}</p></div><button class="btn btn-sm btn-primary" data-monitor-run>${icon('play')} Jalankan monitor</button></div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Target</th><th>Tipe</th><th>Status</th><th>Detail</th></tr></thead><tbody>
            ${runOlt.map((o) => `<tr><td><b>${esc((state.integrations.olts || []).find((x) => x.id === o.id)?.name || o.id)}</b></td><td><span class="pill pill--accent">OLT</span></td><td>${o.ok ? '<span class="pill pill--ok">OK</span>' : '<span class="pill pill--danger">ERROR</span>'}</td><td class="muted" style="font-size:10px">${fmt.num(o.total || 0)} ONU · ${fmt.num(o.online || 0)} online · ${fmt.num(o.offline || 0)} offline</td></tr>`).join('')}
            ${runRouter.map((r) => `<tr><td><b>${esc((state.integrations.routers || []).find((x) => x.id === r.id)?.name || r.id)}</b></td><td><span class="pill pill--info">Router</span></td><td>${r.ok ? '<span class="pill pill--ok">OK</span>' : '<span class="pill pill--danger">ERROR</span>'}</td><td class="muted" style="font-size:10px">${fmt.num(r.down || 0)} interface down</td></tr>`).join('')}
          </tbody></table>${!runOlt.length && !runRouter.length ? empty('activity', 'Belum ada hasil poll') : ''}</div>
          <div class="panel-foot"><span>${esc((last.errors || []).join(' · ') || 'Tidak ada error')}</span><span>${fmt.num(last.durationMs || 0)} ms</span></div>
        </section>
        <section class="panel">
          <div class="panel-head"><div><h3>${icon('settings')} Konfigurasi monitor</h3><p>Ubah interval dan opsi auto-fault di Pengaturan</p></div></div>
          <div class="panel-body">
            ${statusLine(status?.enabled, status?.enabled ? 'Monitor otomatis aktif' : 'Monitor otomatis nonaktif')}
            <div class="switch-row"><div><b>Interval poll</b><span>${fmt.num(status?.intervalSec || 0)} detik</span></div><span class="mono">${Math.round((status?.intervalSec || 0) / 60)}m</span></div>
            <div class="switch-row"><div><b>Auto cable fault</b><span>Buat fault kabel saat ONT downstream hilang</span></div><span class="pill ${state.settings.monitor?.autoCableFault ? 'pill--ok' : ''}">${state.settings.monitor?.autoCableFault ? 'ON' : 'OFF'}</span></div>
            <div class="switch-row"><div><b>Auto create ONT</b><span>Buat node ONT dari perangkat baru</span></div><span class="pill ${state.settings.monitor?.autoCreateOnt ? 'pill--ok' : ''}">${state.settings.monitor?.autoCreateOnt ? 'ON' : 'OFF'}</span></div>
            <div class="switch-row"><div><b>Webhook token</b><span>Untuk event GenieACS eksternal</span></div><button class="link-btn" data-copy-webhook>Salin token</button></div>
            <button class="btn btn-soft btn-block mt-2" data-settings>${icon('settings')} Buka pengaturan monitoring</button>
          </div>
        </section>
      </div>`;
    content.querySelector('[data-settings]')?.addEventListener('click', () => navigate('settings', { tab: 'monitor' }));
    content.querySelector('[data-copy-webhook]')?.addEventListener('click', async () => {
      const { copyText } = await import('../ui.js');
      copyText(state.settings.integrations?.webhookToken || '');
    });
    content.querySelector('[data-monitor-run]')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      btn.innerHTML = 'Menjalankan…';
      try {
        const result = await api.integration.runMonitor();
        toast.success('Monitor selesai', `${result.olts?.length || 0} OLT · ${result.routers?.length || 0} router · ${result.createdFaults?.length || 0} fault baru.`);
        renderTab('monitor');
        requestRefresh();
      } catch (err) { errorToast(err); btn.disabled = false; }
    });
  }

  function renderTab(next) {
    tab = next;
    view.querySelectorAll('#device-tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === next));
    addOlt.classList.toggle('hidden', next !== 'olts');
    addRouter.classList.toggle('hidden', next !== 'routers');
    if (next === 'genieacs') { content.innerHTML = genieView(); summary.textContent = 'GenieACS TR-069 / CWMP'; bindTab(); }
    else if (next === 'olts') { content.innerHTML = oltView(); summary.textContent = `${(state.integrations.olts || []).length} OLT terdaftar`; bindTab(); }
    else if (next === 'routers') { content.innerHTML = routerView(); summary.textContent = `${(state.integrations.routers || []).length} router terdaftar`; bindTab(); }
    else { monitorView(); summary.textContent = 'Monitor otomatis'; }
  }

  function bindTab() {
    content.onclick = async (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      const settingsBtn = event.target.closest('[data-settings]');
      if (settingsBtn) { navigate('settings', { tab: 'integrations' }); return; }
      if (target.matches('[data-genie-test]')) {
        target.disabled = true;
        try {
          const result = await api.integration.genieacsTest({});
          toast.success('GenieACS terhubung', result.message || `${result.deviceCount || 0} device terbaca.`);
        } catch (err) { toast.error('GenieACS tidak terhubung', err.message); }
        finally { target.disabled = false; }
        return;
      }
      if (target.matches('[data-genie-sync]')) {
        const ok = await confirmDialog({ title: 'Sinkronisasi GenieACS', message: 'ONT baru akan dibuat dari device yang belum tertaut. Lanjutkan?', confirmText: 'Sync sekarang' });
        if (!ok) return;
        target.disabled = true;
        try {
          const result = await api.integration.genieacsSync(state.projectId, true);
          toast.success('Sync GenieACS selesai', result.message || 'ONT berhasil disinkronkan.');
          requestRefresh();
        } catch (err) { errorToast(err); target.disabled = false; }
        return;
      }
      const gRefresh = target.dataset.genieRefresh;
      if (gRefresh) {
        try { await api.integration.genieacsRefresh(gRefresh); toast.success('Refresh dikirim', 'Task refreshObject dikirim ke GenieACS.'); }
        catch (err) { errorToast(err); }
        return;
      }
      const gReboot = target.dataset.genieReboot;
      if (gReboot) {
        const ok = await confirmDialog({ title: 'Reboot ONT?', message: 'Perangkat akan reboot dan koneksi pelanggan terputus sementara.', confirmText: 'Reboot ONT', danger: true });
        if (!ok) return;
        try { await api.integration.genieacsReboot(gReboot); toast.success('Reboot dikirim', 'Task reboot dikirim ke perangkat.'); }
        catch (err) { errorToast(err); }
        return;
      }

      const oltTest = target.dataset.oltTest;
      if (oltTest) { const olt = (state.integrations.olts || []).find((o) => o.id === oltTest); if (olt) await testOlt(olt, target); return; }
      const oltSsh = target.dataset.oltSsh;
      if (oltSsh) { const olt = (state.integrations.olts || []).find((o) => o.id === oltSsh); if (olt) openSshConsole(olt); return; }
      const oltOnus = target.dataset.oltOnus;
      if (oltOnus) { const olt = (state.integrations.olts || []).find((o) => o.id === oltOnus); if (olt) showOnus(olt); return; }
      const oltSync = target.dataset.oltSync;
      if (oltSync) {
        target.disabled = true;
        try { const r = await api.integration.syncOlt(oltSync, true); toast.success('Sync OLT selesai', r.message || 'ONT diperbarui.'); requestRefresh(); }
        catch (err) { errorToast(err); target.disabled = false; }
        return;
      }
      const oltEdit = target.dataset.oltEdit;
      if (oltEdit) { openOltModal({ olt: (state.integrations.olts || []).find((o) => o.id === oltEdit) }); return; }
      const oltDel = target.dataset.oltDel;
      if (oltDel) {
        const olt = (state.integrations.olts || []).find((o) => o.id === oltDel);
        if (!olt) return;
        const ok = await confirmDialog({ title: 'Hapus OLT?', message: `OLT ${olt.name} akan dihapus dari integrasi. Node ONT tidak ikut dihapus.`, confirmText: 'Hapus OLT', danger: true });
        if (!ok) return;
        try { await api.integration.deleteOlt(olt.id); toast.success('OLT dihapus', olt.name); requestRefresh(); }
        catch (err) { errorToast(err); }
        return;
      }

      const rTest = target.dataset.routerTest;
      if (rTest) { const r = (state.integrations.routers || []).find((x) => x.id === rTest); if (r) await testRouter(r, target); return; }
      const rIface = target.dataset.routerIface;
      if (rIface) { const r = (state.integrations.routers || []).find((x) => x.id === rIface); if (r) showRouterInterfaces(r); return; }
      const rSync = target.dataset.routerSync;
      if (rSync) {
        target.disabled = true;
        try { await api.integration.syncRouter(rSync); toast.success('RouterOS disinkronkan', 'Data interface dan resource diperbarui.'); requestRefresh(); }
        catch (err) { errorToast(err); target.disabled = false; }
        return;
      }
      const rEdit = target.dataset.routerEdit;
      if (rEdit) { openRouterModal({ router: (state.integrations.routers || []).find((x) => x.id === rEdit) }); return; }
      const rDel = target.dataset.routerDel;
      if (rDel) {
        const r = (state.integrations.routers || []).find((x) => x.id === rDel);
        if (!r) return;
        const ok = await confirmDialog({ title: 'Hapus router?', message: `Router ${r.name} akan dihapus dari integrasi monitoring.`, confirmText: 'Hapus router', danger: true });
        if (!ok) return;
        try { await api.integration.deleteRouter(r.id); toast.success('Router dihapus', r.name); requestRefresh(); }
        catch (err) { errorToast(err); }
      }
    };
  }

  view.querySelector('#device-tabs').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tab]');
    if (btn) renderTab(btn.dataset.tab);
  });
  addOlt.addEventListener('click', () => openOltModal({}));
  addRouter.addEventListener('click', () => openRouterModal({}));

  renderTab(tab);
}

export default { render };
