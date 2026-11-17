import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Inbox, Loader2, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { labelize, initials } from '../lib/format.js';

// ---------- Badges ----------
const STATUS_TONE = {
  TODO: 'neutral', IN_PROGRESS: 'blue', BLOCKED: 'risk', IN_REVIEW: 'warn', DONE: 'ok', CANCELLED: 'outline',
  DRAFT: 'neutral', ACTIVE: 'blue', ON_HOLD: 'warn', COMPLETED: 'ok', ARCHIVED: 'outline',
  NEW: 'dark', OPEN: 'blue', WAITING_ON_CUSTOMER: 'warn', RESOLVED: 'ok', CLOSED: 'outline',
  SUBMITTED: 'blue', APPROVED: 'ok', REJECTED: 'risk', CHANGES_REQUESTED: 'warn',
  UNDER_REVIEW: 'warn', IMPLEMENTED: 'ok',
};
export const Pill = ({ tone = 'neutral', children, title }) => <span className={`pill pill-${tone}`} title={title}>{children}</span>;
export const StatusBadge = ({ status }) => <Pill tone={STATUS_TONE[status] || 'neutral'}>{labelize(status)}</Pill>;
const PRI_TONE = { LOW: 'outline', MEDIUM: 'neutral', HIGH: 'warn', CRITICAL: 'risk' };
export const PriorityBadge = ({ priority }) => <Pill tone={PRI_TONE[priority]}>{labelize(priority)}</Pill>;
export const HealthBadge = ({ health }) => (
  <span className="d-inline-flex align-items-center gap-1 small fw-semibold" title={`Health: ${labelize(health)}`}>
    <span className={`dot dot-${health}`} aria-hidden="true" />{labelize(health)}
  </span>
);
const SLA_TONE = { MET: 'ok', ON_TRACK: 'blue', AT_RISK: 'warn', BREACHED: 'risk', PAUSED: 'neutral', NONE: 'outline' };
export const SlaBadge = ({ clock, label }) => clock && clock.state !== 'NONE'
  ? <Pill tone={SLA_TONE[clock.state]} title={clock.dueAt ? `Due ${new Date(clock.dueAt).toLocaleString()}` : undefined}>{label}: {labelize(clock.state)}</Pill> : null;
export const TypeTag = ({ type }) => <span className="small-caps">{labelize(type)}</span>;

export function Meter({ value, label }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="d-flex align-items-center gap-2">
      <div className={`meter flex-grow-1 ${v >= 100 ? 'ok' : ''}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label || 'Progress'}><span style={{ width: `${v}%` }} /></div>
      <span className="small fw-semibold" style={{ minWidth: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value == null ? '—' : `${Math.round(v)}%`}</span>
    </div>
  );
}

export const Avatar = ({ name }) => <span className="avatar" aria-hidden="true">{initials(name)}</span>;

// ---------- States ----------
export const Spinner = ({ label = 'Loading' }) => <span className="d-inline-flex align-items-center gap-2 text-muted"><Loader2 size={16} className="spin" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" /><span>{label}…</span></span>;
export function Loading({ rows = 4 }) {
  return <div className="py-2" aria-busy="true" aria-live="polite">{[...Array(rows)].map((_, i) => <div key={i} className="skeleton mb-2" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}
export function Empty({ icon: Icon = Inbox, title, children, action }) {
  return <div className="empty"><div className="icon"><Icon size={22} aria-hidden="true" /></div><h3>{title}</h3>{children && <div className="small mb-3">{children}</div>}{action}</div>;
}
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="notice risk mb-3" role="alert">
      <AlertTriangle size={16} aria-hidden="true" className="mt-1 flex-shrink-0" />
      <div className="flex-grow-1">
        <div className="fw-semibold">{error.status === 404 ? 'Not found or you no longer have access.' : error.message}</div>
        {error.details?.length > 0 && <ul className="mb-0 ps-3 small">{error.details.map((d, i) => <li key={i}>{d.path ? `${d.path}: ` : ''}{d.message}</li>)}</ul>}
        {error.requestId && <div className="small opacity-75">Reference: <span className="mono">{error.requestId}</span></div>}
      </div>
      {onRetry && <button className="btn btn-sm btn-light" onClick={onRetry}>Retry</button>}
    </div>
  );
}
export function Notice({ tone = 'info', children, icon: Icon = Info }) {
  return <div className={`notice ${tone}`}><Icon size={16} aria-hidden="true" className="mt-1 flex-shrink-0" /><div>{children}</div></div>;
}

export function PageHeader({ title, sub, actions, eyebrow }) {
  return (
    <div className="page-header">
      <div className="min-w-0">{eyebrow && <div className="small-caps mb-1">{eyebrow}</div>}<h1 className="h-page">{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {actions && <div className="d-flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', bodyClass = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="card-header"><h2>{title}</h2>{actions}</div>}
      <div className={`card-body ${bodyClass}`}>{children}</div>
    </section>
  );
}
export const Stat = ({ label, value, hint, tone }) => (
  <div className="card stat h-100"><div className="label">{label}</div><div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>{hint && <div className="hint">{hint}</div>}</div>
);

// ---------- Modal / Drawer ----------
function useFocusTrap(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const node = ref.current;
    const first = node?.querySelector('input, select, textarea, button:not([data-close]), [href]');
    (first || node)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab' && node) {
        const f = [...node.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  return ref;
}

export function Modal({ open, title, onClose, children, footer, size }) {
  const ref = useFocusTrap(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`dialog ${size || ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="dialog-header"><h2 id={id}>{title}</h2><button className="btn btn-ghost btn-icon" data-close onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, header, children }) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
        <div className="drawer-header"><div className="flex-grow-1 min-w-0">{header}</div><button className="btn btn-ghost btn-icon" data-close onClick={onClose} aria-label="Close panel"><X size={18} /></button></div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

/** Button that asks for confirmation in a dialog before running a destructive action. */
export function ConfirmButton({ children, title = 'Are you sure?', message, confirmLabel = 'Confirm', onConfirm, className = 'btn btn-sm btn-outline-danger', disabled, tone = 'danger' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async () => { setBusy(true); setErr(null); try { await onConfirm(); setOpen(false); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}>{children}</button>
      <Modal open={open} title={title} onClose={() => setOpen(false)} footer={<>
        <button className="btn btn-light" onClick={() => setOpen(false)}>Cancel</button>
        <button className={`btn btn-${tone}`} onClick={run} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button></>}>
        <ErrorBox error={err} />{message}
      </Modal>
    </>
  );
}

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, message, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast-item ${t.tone}`}>{t.tone === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}<span className="flex-grow-1">{t.message}</span>
          <button className="btn btn-icon p-0 text-white" aria-label="Dismiss" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}><X size={14} /></button></div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Forms ----------
export function Field({ label, hint, error, children, className = 'mb-3', id: givenId }) {
  const auto = useId();
  const id = givenId || auto;
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={className}>
      {label && <label className="form-label" htmlFor={id}>{label}</label>}
      {child}
      {hint && !error && <div className="form-text">{hint}</div>}
      {error && <div className="invalid-feedback d-block">{error}</div>}
    </div>
  );
}
/** Map server validation details to a {field: message} object. */
export const fieldErrors = (err) => Object.fromEntries((err?.details || []).map((d) => [d.path, d.message]));

export function Select({ value, onChange, options, placeholder, id, required, disabled, 'aria-label': aria }) {
  return (
    <select id={id} className="form-select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} required={required} disabled={disabled} aria-label={aria}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ---------- Table helpers ----------
export function SortHeader({ field, sort, onSort, children }) {
  const active = sort.field === field;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return <th aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}><button className="sort" onClick={() => onSort(field)}>{children}<Icon size={12} aria-hidden="true" /></button></th>;
}
export function Pagination({ meta, onPage }) {
  if (!meta || meta.pages <= 1) return meta ? <div className="small text-muted px-3 py-2">{meta.total} result{meta.total === 1 ? '' : 's'}</div> : null;
  return (
    <nav className="d-flex align-items-center justify-content-between px-3 py-2 border-top" aria-label="Pagination">
      <span className="small text-muted">Page {meta.page} of {meta.pages} · {meta.total} results</span>
      <div className="d-flex gap-1">
        <button className="btn btn-sm btn-light" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
        <button className="btn btn-sm btn-light" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
      </div>
    </nav>
  );
}
