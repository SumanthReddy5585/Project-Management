export const labelize = (s) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '');
export const fmtDate = (d) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtRelative = (d) => {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (Math.abs(s) < 60) return 'just now';
  const units = [[86400 * 30, 'month'], [86400 * 7, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [n, u] of units) if (Math.abs(s) >= n) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.round(s / n), u);
  return '';
};
export const fmtHours = (h) => `${Number(h || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
export const fmtMoney = (v, c) => (v == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: c || 'USD', maximumFractionDigits: 0 }).format(v));
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const addDaysISO = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const mondayOf = (d) => { const x = new Date(`${d}T00:00:00Z`); const wd = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - wd); return x.toISOString().slice(0, 10); };
export const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
/** Render "@[Name](id)" mention markup as plain "@Name". */
export const renderMentions = (s = '') => s.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi, '@$1');
