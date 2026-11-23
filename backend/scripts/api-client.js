// Minimal cookie-aware API client (Node fetch). Used by the demo seed and E2E checks.
export class ApiClient {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }
  async req(method, path, body, { raw = false, form } = {}) {
    const headers = { 'x-csrf-token': this.csrf, cookie: this.cookie, ...(process.env.SEED_ORIGIN && { origin: process.env.SEED_ORIGIN }) };
    let payload;
    if (form) payload = form; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + path, { method, headers, body: payload });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const [kv] = c.split(';'); if (/=$/.test(kv) || /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c)) this.cookie = ''; else this.cookie = kv; }
    if (raw) return res;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (data?.csrfToken) this.csrf = data.csrfToken;
    if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status} ${data?.error?.message}`); e.status = res.status; e.data = data; throw e; }
    return data;
  }
  get(p) { return this.req('GET', p); } post(p, b) { return this.req('POST', p, b ?? {}); } patch(p, b) { return this.req('PATCH', p, b); }
  put(p, b) { return this.req('PUT', p, b); } del(p, b) { return this.req('DELETE', p, b); }
  login(email, password) { return this.post('/api/auth/login', { email, password }); }
}
