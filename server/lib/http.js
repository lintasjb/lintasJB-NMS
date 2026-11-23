import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

/**
 * Small dependency-free HTTP client with:
 * - Basic auth
 * - cookie jar (needed by HiOSO web UIs)
 * - redirect following
 * - gzip/deflate decompression
 * - optional self-signed TLS (RouterOS default certificates)
 */
export class HttpClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || '';
    this.timeout = options.timeout || 12000;
    this.insecure = options.insecure !== false;
    this.cookies = new Map();
    this.defaultHeaders = {
      'User-Agent': 'lintasJB-NMS/1.0',
      Accept: 'application/json, text/plain, text/html, */*',
      ...(options.headers || {}),
    };
    if (options.username) {
      const token = Buffer.from(`${options.username}:${options.password || ''}`).toString('base64');
      this.defaultHeaders.Authorization = `Basic ${token}`;
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(setCookie) {
    if (!setCookie) return;
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const raw of list) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  async request(pathOrUrl, opts = {}) {
    const {
      method = 'GET',
      headers = {},
      body,
      form,
      json,
      redirects = 5,
      timeout = this.timeout,
      insecure = this.insecure,
    } = opts;

    let url;
    try {
      url = new URL(pathOrUrl, this.baseUrl || undefined);
    } catch {
      throw new Error(`Invalid URL: ${this.baseUrl}${pathOrUrl}`);
    }
    let payload = body;
    const merged = { ...this.defaultHeaders, ...headers };
    if (form) {
      payload = new URLSearchParams(form).toString();
      merged['Content-Type'] = 'application/x-www-form-urlencoded';
      merged['Content-Length'] = Buffer.byteLength(payload);
    } else if (json !== undefined) {
      payload = JSON.stringify(json);
      merged['Content-Type'] = 'application/json';
      merged['Content-Length'] = Buffer.byteLength(payload);
    } else if (payload && !merged['Content-Type']) {
      merged['Content-Type'] = 'application/json';
    }
    const cookie = this.cookieHeader();
    if (cookie) merged.Cookie = cookie;

    const result = await new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers: merged,
          timeout,
          rejectUnauthorized: url.protocol === 'https:' ? !insecure : undefined,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let buf = Buffer.concat(chunks);
            const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
            try {
              if (encoding.includes('gzip')) buf = zlib.gunzipSync(buf);
              else if (encoding.includes('deflate')) buf = zlib.inflateSync(buf);
              else if (encoding.includes('br')) buf = zlib.brotliDecompressSync(buf);
            } catch {
              /* keep raw body */
            }
            resolve({ status: res.statusCode, headers: res.headers, buffer: buf, text: buf.toString('utf8') });
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error(`Timeout ${timeout} ms saat menghubungi ${url.host}`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

    this.storeCookies(result.headers['set-cookie']);
    const location = result.headers.location;
    if ([301, 302, 303, 307, 308].includes(result.status) && location && redirects > 0) {
      const next = new URL(location, url).toString();
      return this.request(next, {
        ...opts,
        method: result.status === 303 ? 'GET' : method,
        body: result.status === 303 ? undefined : body,
        form: result.status === 303 ? undefined : form,
        redirects: redirects - 1,
      });
    }

    let data = null;
    const ct = String(result.headers['content-type'] || '');
    if (result.text && (ct.includes('json') || /^[\s]*[[{]/.test(result.text))) {
      try {
        data = JSON.parse(result.text);
      } catch {
        data = null;
      }
    }
    return {
      status: result.status,
      headers: result.headers,
      text: result.text,
      data,
      ok: result.status >= 200 && result.status < 300,
    };
  }

  get(path, opts = {}) {
    return this.request(path, { ...opts, method: 'GET' });
  }

  post(path, opts = {}) {
    return this.request(path, { ...opts, method: 'POST' });
  }
}

export function basicAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username || ''}:${password || ''}`).toString('base64')}`;
}
