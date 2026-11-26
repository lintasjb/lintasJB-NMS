/* lintasJB NMS — API client */
const API = '/api';
const TOKEN_KEY = 'lintasjb.token';
const PROJECT_KEY = 'lintasjb.project';

function readToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
}

export function getToken() {
  return readToken();
}

export function setSession({ token, user, projectId, remember = true } = {}) {
  if (token) {
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_KEY);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  if (user) localStorage.setItem('lintasjb.user', JSON.stringify(user));
  if (projectId) localStorage.setItem(PROJECT_KEY, projectId);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('lintasjb.user');
}

export function getProjectId() {
  return localStorage.getItem(PROJECT_KEY) || '';
}

export function setProjectId(id) {
  if (!id) localStorage.removeItem(PROJECT_KEY);
  else localStorage.setItem(PROJECT_KEY, id);
}

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function authHeaders(extra = {}) {
  const token = readToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

export async function request(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
  const opts = { method, headers: authHeaders(headers), signal };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path.startsWith('http') ? path : `${API}${path}`, opts);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Tidak dapat terhubung ke server. Pastikan lintasJB NMS berjalan.', 0);
  }
  if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/register')) {
    clearSession();
    window.dispatchEvent(new CustomEvent('nms:unauthorized'));
  }
  if (raw) {
    if (!res.ok) {
      let payload = null;
      try { payload = await res.json(); } catch { /* ignore */ }
      throw new ApiError(payload?.error || `Permintaan gagal (${res.status}).`, res.status, payload);
    }
    return res;
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    let message = data?.error || data?.message || `Permintaan gagal (${res.status}).`;
    throw new ApiError(message, res.status, data);
  }
  return data;
}

export const get = (path, opts) => request(path, { ...opts, method: 'GET' });
export const post = (path, body, opts) => request(path, { ...opts, method: 'POST', body });
export const put = (path, body, opts) => request(path, { ...opts, method: 'PUT', body });
export const del = (path, opts) => request(path, { ...opts, method: 'DELETE' });

export function qs(params = {}) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') s.set(k, v);
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}

export const auth = {
  login: (email, password) => post('/auth/login', { email, password }),
  register: (payload) => post('/auth/register', payload),
  me: () => get('/auth/me'),
  updateProfile: (payload) => put('/auth/me', payload),
  changePassword: (payload) => put('/auth/me/password', payload),
  users: () => get('/auth/users'),
  updateUser: (id, payload) => put(`/auth/users/${id}`, payload),
  deleteUser: (id) => del(`/auth/users/${id}`),
};

export const bootstrap = (projectId) => get(`/bootstrap${qs({ projectId })}`);
export const stats = (projectId) => get(`/stats${qs({ projectId })}`);

export function download(path, fallbackName = 'lintasjb-export') {
  return request(path, { raw: true }).then(async (res) => {
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    let name = fallbackName;
    const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(disposition);
    if (match) {
      try { name = decodeURIComponent(match[1].replace(/"/g, '')); } catch { name = match[1]; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return name;
  });
}

export function upload(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}${path}`);
    const token = readToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText || 'null'); } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else if (xhr.status === 401) {
        clearSession();
        window.dispatchEvent(new CustomEvent('nms:unauthorized'));
        reject(new ApiError('Sesi kedaluwarsa. Silakan login kembali.', 401, data));
      } else {
        reject(new ApiError(data?.error || `Upload gagal (${xhr.status}).`, xhr.status, data));
      }
    });
    xhr.addEventListener('error', () => reject(new ApiError('Upload gagal: koneksi ke server terputus.', 0)));
    xhr.send(formData);
  });
}

let source = null;
let reconnectTimer = null;
let retry = 0;

export function connectEvents(handlers = {}) {
  closeEvents();
  const token = readToken();
  if (!token) return null;
  source = new EventSource(`${API}/events?token=${encodeURIComponent(token)}`);
  const types = [
    'hello', 'fault', 'fault:resolved', 'alarm', 'alarm:changed', 'alarms:ack-all',
    'node:changed', 'cable:changed', 'nodes', 'projects', 'settings', 'license',
    'import', 'router:changed',
  ];
  source.addEventListener('open', () => {
    retry = 0;
    handlers.onStatus?.('online');
  });
  source.addEventListener('error', () => {
    handlers.onStatus?.('offline');
    if (source && source.readyState === EventSource.CLOSED) {
      closeEvents();
      const delay = Math.min(30000, 2000 * 2 ** retry++);
      reconnectTimer = setTimeout(() => connectEvents(handlers), delay);
    }
  });
  for (const type of types) {
    source.addEventListener(type, (event) => {
      let data = {};
      try { data = JSON.parse(event.data); } catch { /* ignore */ }
      handlers.onEvent?.(type, data);
    });
  }
  return source;
}

export function closeEvents() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (source) source.close();
  source = null;
}

export const integration = {
  overview: (projectId) => get(`/integrations/overview${qs({ projectId })}`),
  genieacsTest: (payload) => post('/integrations/genieacs/test', payload),
  genieacsDevices: () => get('/integrations/genieacs/devices'),
  genieacsRefresh: (id) => post(`/integrations/genieacs/refresh/${id}`, {}),
  genieacsReboot: (id) => post(`/integrations/genieacs/reboot/${id}`, {}),
  genieacsSync: (projectId, createMissing) => post('/integrations/genieacs/sync', { projectId, createMissing }),
  olts: (projectId) => get(`/olts${qs({ projectId })}`),
  createOlt: (payload) => post('/olts', payload),
  updateOlt: (id, payload) => put(`/olts/${id}`, payload),
  deleteOlt: (id) => del(`/olts/${id}`),
  testOlt: (id, payload = {}) => post(`/olts/${id}/test`, payload),
  testOltDraft: (payload) => post('/olts/test-connection', payload),
  execOlt: (id, command) => post(`/olts/${id}/exec`, { command }),
  onus: (id) => get(`/olts/${id}/onus`),
  syncOlt: (id, createMissing) => post(`/olts/${id}/sync`, { createMissing }),
  routers: (projectId) => get(`/routers${qs({ projectId })}`),
  createRouter: (payload) => post('/routers', payload),
  updateRouter: (id, payload) => put(`/routers/${id}`, payload),
  deleteRouter: (id) => del(`/routers/${id}`),
  testRouter: (id, payload = {}) => post(`/routers/${id}/test`, payload),
  testRouterDraft: (payload) => post('/routers/test-connection', payload),
  interfaces: (id) => get(`/routers/${id}/interfaces`),
  syncRouter: (id) => post(`/routers/${id}/sync`),
  monitorStatus: () => get('/monitor/status'),
  runMonitor: () => post('/monitor/run', {}),
};

export const admin = {
  overview: () => get('/admin/overview'),
  activity: (params = {}) => get(`/admin/activity${qs(params)}`),
  pricing: () => get('/admin/pricing'),
  savePricing: (plans) => put('/admin/pricing', { plans }),
  backup: () => download('/admin/backup', 'lintasjb-backup.json'),
  createUser: (payload) => post('/auth/users', payload),
  resetPassword: (id, newPassword) => post(`/auth/users/${id}/password`, { newPassword }),
  viewPassword: (id) => get(`/auth/users/${id}/password`),
  projects: () => get('/projects'),
  createProject: (payload) => post('/projects', payload),
  duplicateProject: (id, name) => post(`/projects/${id}/duplicate`, { name }),
  deleteProject: (id) => del(`/projects/${id}`),
};

export default {
  get, post, put, del, request, qs, download, upload,
  auth, bootstrap, stats, integration, admin,
  getToken, setSession, clearSession, getProjectId, setProjectId,
  connectEvents, closeEvents,
};
