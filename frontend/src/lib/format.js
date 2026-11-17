// Plain-language names for internal codes, shown everywhere in the UI.
const FRIENDLY = {
  TODO: 'To do', IN_PROGRESS: 'In progress', IN_REVIEW: 'In review', WAITING_ON_CUSTOMER: 'Waiting on client', ON_HOLD: 'On hold',
  NEW: 'New', CHANGES_REQUESTED: 'Changes requested', SERVICE_REQUEST: 'Service request', CHANGE_REQUEST: 'Change request',
  CUSTOMER: 'Client', EMPLOYEE: 'Team member', MANAGER: 'Manager', ADMIN: 'Admin', MEMBER: 'Member', VIEWER: 'Viewer (read-only)',
  MODULE: 'Group', TASK: 'Task', SUBTASK: 'Subtask', MILESTONE: 'Milestone', GREEN: 'On track', AMBER: 'At risk', RED: 'Off track',
  ON_TRACK: 'On track', AT_RISK: 'At risk', BREACHED: 'Overdue', MET: 'Met', PAUSED: 'Paused', INTERNAL: 'Team only', PUBLIC: 'Shared with client',
};
export const labelize = (s) => (s ? FRIENDLY[s] || s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '');

// Each project gets a stable color from its code.
const PROJECT_COLORS = ['#7950f2', '#12b886', '#228be6', '#e64980', '#fd7e14', '#15aabf', '#be4bdb', '#40c057'];
export const projectColor = (key = '') => PROJECT_COLORS[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PROJECT_COLORS.length];
export const dueInfo = (d, done) => {
  if (!d) return null;
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const text = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : diff < 0 ? `${-diff} days late` : diff < 7 ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }) : new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return { text, tone: done ? '' : diff < 0 ? 'late' : diff <= 2 ? 'soon' : '' };
};
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
