import axios from 'axios';

// Same-origin API (Vite proxy in dev, reverse proxy in production) so the session cookie is first-party.
export const api = axios.create({ baseURL: '/api', withCredentials: true, timeout: 30000 });
let csrf = '';
export const setCsrf = (t) => { csrf = t || ''; };

api.interceptors.request.use((c) => {
  if (csrf && !['get', 'head'].includes(c.method)) c.headers['X-CSRF-Token'] = csrf;
  return c;
});
api.interceptors.response.use((r) => r, (err) => {
  const e = err.response?.data?.error;
  err.status = err.response?.status;
  err.message = e?.message || (err.status ? `Request failed (${err.status})` : 'Network error — check your connection');
  err.details = e?.details;
  err.requestId = err.response?.data?.requestId;
  if (err.status === 401 && !String(err.config?.url).startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
  return Promise.reject(err);
});

export const get = (url, params) => api.get(url, { params }).then((r) => r.data);
export const post = (url, body) => api.post(url, body).then((r) => r.data);
export const patch = (url, body) => api.patch(url, body).then((r) => r.data);
export const put = (url, body) => api.put(url, body).then((r) => r.data);
export const del = (url) => api.delete(url).then((r) => r.data);
export const upload = (form) => api.post('/files', form).then((r) => r.data);
/** Authorized download: fetch as blob through the API, then hand to the browser. */
export async function download(url, filename) {
  const r = await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(r.data);
  const a = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
