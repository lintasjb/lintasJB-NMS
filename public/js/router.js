/* lintasJB NMS — hash router */
export const ROUTES = {
  dashboard: { title: 'Dashboard', subtitle: 'Ringkasan kondisi jaringan' },
  map: { title: 'Live Map', subtitle: 'Topologi FTTH realtime & fault locator' },
  assets: { title: 'Aset Jaringan', subtitle: 'POP, OLT, ODC, ODP, joint closure, dan ONT' },
  cables: { title: 'Kabel & Rute', subtitle: 'Backbone, feeder, distribusi, dan drop' },
  faults: { title: 'Fault Locator', subtitle: 'Deteksi titik putus kabel & gangguan perangkat' },
  devices: { title: 'Perangkat', subtitle: 'GenieACS, OLT multi-vendor, dan MikroTik RouterOS' },
  transfer: { title: 'Import / Export', subtitle: 'KML, KMZ, GeoJSON, dan CSV untuk project peta' },
  settings: { title: 'Pengaturan', subtitle: 'Branding, peta, alarm, lisensi, dan integrasi' },
  admin: { title: 'Admin Panel', subtitle: 'Kelola pengguna, project, aktivitas, dan sistem' },
  about: { title: 'Tentang Aplikasi', subtitle: 'Informasi produk, teknologi, kontak, dan kredit' },
};

export function parseHash() {
  const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [viewPart, queryPart] = raw.split('?');
  const view = ROUTES[viewPart] ? viewPart : 'dashboard';
  const params = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { view, params };
}

export function currentView() {
  return parseHash().view;
}

export function navigate(view, params = {}) {
  const safe = ROUTES[view] ? view : 'dashboard';
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  }
  const next = `#/${safe}${query.toString() ? `?${query}` : ''}`;
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}

export function setFocus(kind, id, extra = {}) {
  try {
    sessionStorage.setItem('lintasjb.focus', JSON.stringify({ kind, id, ...extra, at: Date.now() }));
  } catch { /* ignore */ }
}

export function takeFocus() {
  try {
    const raw = sessionStorage.getItem('lintasjb.focus');
    if (!raw) return null;
    sessionStorage.removeItem('lintasjb.focus');
    const value = JSON.parse(raw);
    if (Date.now() - Number(value.at || 0) > 60000) return null;
    return value;
  } catch {
    return null;
  }
}

export default { ROUTES, navigate, parseHash, currentView, setFocus, takeFocus };
