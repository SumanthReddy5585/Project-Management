import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Download, Link2, Trash2, ListPlus, Lock, Inbox, User, UserX, AlertTriangle, Clock, Sparkles, CheckCircle2, Layers, Search, MessageSquare, StickyNote, Zap, X, ArrowLeft, Star, BookOpen, Send, RotateCcw, History } from 'lucide-react';
import { get, post, patch, del, download } from '../api/client.js';
import { useLoad, useDebounced } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtDateTime, fmtRelative, labelize, fmtDuration } from '../lib/format.js';
import { Avatar, Card, Empty, ErrorBox, Field, Loading, Modal, Pagination, PriorityBadge, priorityLabel, Select, SlaTimer, StatusBadge, useToast, fieldErrors, Notice, ConfirmButton, SortHeader, ProjectChip } from '../components/ui.jsx';
import { FileList, Message, MentionTextarea } from '../components/collab.jsx';

const PRIS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const TYPES = [['QUESTION', 'Question'], ['BUG', 'Problem / bug'], ['SERVICE_REQUEST', 'Service request'], ['CHANGE_REQUEST', 'Change request']];

// ---------------------------------------------------------------- New ticket
export function NewTicket({ onClose, onCreated }) {
  const { isCustomer } = useAuth();
  const refs = useLoad(() => Promise.all([get('/projects', { pageSize: 100 }), get('/org/ticket-settings'), isCustomer ? { data: [] } : get('/org/customers'), isCustomer ? { data: [] } : get('/org/members', { pageSize: 200 })]), []);
  const [f, setF] = useState({ subject: '', description: '', type: 'QUESTION', priority: 'MEDIUM', category: '', projectId: '', customerCompanyId: '', assigneeId: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(f.subject, 400);
  const suggestions = useLoad(() => (dq.trim().length >= 4 ? get('/kb/articles', { q: dq.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).sort((a, b) => b.length - a.length).slice(0, 2).join(' ') || dq.trim() }) : Promise.resolve(null)), [dq]);
  const [projects, settings, customers, members] = refs.data ? [refs.data[0].data, refs.data[1], refs.data[2].data, refs.data[3].data] : [[], { categories: [] }, [], []];
  const agents = members.filter((m) => m.role !== 'CUSTOMER' && m.status === 'ACTIVE');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const t = await post('/tickets', { ...f, category: f.category || null, projectId: f.projectId || null, customerCompanyId: f.customerCompanyId || null, assigneeId: f.assigneeId || null }); onCreated(t); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const fe = fieldErrors(err);
  const set = (k) => (v) => setF((o) => ({ ...o, [k]: v?.target ? v.target.value : v ?? '' }));
  return (
    <Modal open size="lg" onClose={onClose} title={isCustomer ? 'Raise a ticket' : 'New ticket'} footer={<><span className="me-auto small text-muted">{isCustomer ? 'You will be notified of every reply.' : 'The client only sees public replies.'}</span><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="nt" disabled={busy || f.subject.trim().length < 3 || !f.description.trim()}>{busy ? 'Submitting…' : 'Submit ticket'}</button></>}>
      <ErrorBox error={err} />
      <form id="nt" onSubmit={submit}>
        <Field label="Subject" error={fe.subject} hint="One line that sums up the problem">{(id) => <input id={id} className="form-control" placeholder="e.g. Checkout page shows an error on iPhone" value={f.subject} onChange={set('subject')} autoFocus />}</Field>
        {suggestions.data?.data.length > 0 && <div className="notice info mb-3"><BookOpen size={15} className="mt-1 flex-shrink-0" /><div><div className="fw-semibold mb-1">These help articles might answer it:</div>{suggestions.data.data.slice(0, 3).map((a) => <div key={a.id}><Link to={`/kb/${a.id}`} target="_blank" rel="noopener">{a.title}</Link></div>)}</div></div>}
        <Field label="Description" hint="What happened, what you expected, and any error message. You can attach screenshots after submitting.">{(id) => <textarea id={id} className="form-control" rows={6} value={f.description} onChange={set('description')} />}</Field>
        <div className="row">
          <div className="col-md-6"><Field label="Type">{(id) => <Select id={id} value={f.type} onChange={set('type')} options={TYPES.map(([v, l]) => ({ value: v, label: l }))} />}</Field></div>
          <div className="col-md-6"><Field label="Priority" hint={f.priority === 'CRITICAL' ? 'Use Urgent only when work has stopped.' : undefined}>{(id) => <Select id={id} value={f.priority} onChange={set('priority')} options={PRIS.map((p) => ({ value: p, label: priorityLabel(p) }))} />}</Field></div>
          <div className="col-md-6"><Field label="Category">{(id) => <Select id={id} value={f.category} onChange={set('category')} placeholder="Choose…" options={settings.categories.map((c) => ({ value: c, label: c }))} />}</Field></div>
          <div className="col-md-6"><Field label="Related project">{(id) => <Select id={id} value={f.projectId} onChange={set('projectId')} placeholder="None" options={projects.map((p) => ({ value: p.id, label: p.name }))} />}</Field></div>
          {!isCustomer && <div className="col-md-6"><Field label="Client">{(id) => <Select id={id} value={f.customerCompanyId} onChange={set('customerCompanyId')} placeholder="From project / internal" options={customers.map((c) => ({ value: c.id, label: c.name }))} />}</Field></div>}
          {!isCustomer && <div className="col-md-6"><Field label="Assign to">{(id) => <Select id={id} value={f.assigneeId} onChange={set('assigneeId')} placeholder="Unassigned (goes to the queue)" options={agents.map((m) => ({ value: m.userId, label: m.name }))} />}</Field></div>}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Queue
const STAFF_VIEWS = [
  ['mine', 'My open tickets', User], ['unassigned', 'Unassigned', UserX], ['overdue', 'SLA breached', AlertTriangle], ['open', 'All open', Inbox],
  ['new', 'New', Sparkles], ['waiting', 'Waiting on client', Clock], ['resolved', 'Resolved & closed', CheckCircle2], ['all', 'All tickets', Layers],
];
const CLIENT_VIEWS = [['open', 'Open', Inbox], ['waiting', 'Waiting for my reply', MessageSquare], ['resolved', 'Resolved', CheckCircle2], ['requested', 'Raised by me', User], ['all', 'All company tickets', Layers]];

function BulkBar({ ids, agents, onDone, onClear }) {
  const toast = useToast();
  const run = async (body, label) => {
    try { const r = await post('/tickets/bulk', { ids, ...body }); toast(`${label}: ${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`, r.skipped.length ? 'error' : 'success'); onDone(); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="bulkbar">
      <strong>{ids.length} selected</strong>
      <select className="form-select form-select-sm" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && run({ assigneeId: e.target.value === '-' ? null : e.target.value }, 'Assigned')} aria-label="Assign selected">
        <option value="">Assign to…</option><option value="-">Unassign</option>{agents.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}</select>
      <select className="form-select form-select-sm" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && run({ priority: e.target.value }, 'Priority changed')} aria-label="Set priority">
        <option value="">Priority…</option>{PRIS.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}</select>
      <select className="form-select form-select-sm" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && run({ status: e.target.value }, 'Status changed')} aria-label="Set status">
        <option value="">Status…</option>{['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'].map((s) => <option key={s} value={s}>{labelize(s)}</option>)}</select>
      <button className="btn btn-sm btn-ghost ms-auto" onClick={onClear}><X size={14} /> Clear</button>
    </div>
  );
}

export function TicketsList() {
  const { isCustomer, user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const defaultView = isCustomer ? 'open' : 'mine';
  const view = params.get('view') || defaultView;
  const creating = params.get('new') === '1';
  const [q, setQ] = useState('');
  const [prio, setPrio] = useState('');
  const [assignee, setAssignee] = useState('');
  const projectId = params.get('project') || '';
  const [sort, setSort] = useState({ field: 'updatedAt', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(() => new Set());
  const dq = useDebounced(q);
  const onSort = (field) => setSort((x) => ({ field, dir: x.field === field && x.dir === 'desc' ? 'asc' : 'desc' }));
  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; });
  useEffect(() => { setPage(1); setSel(new Set()); }, [view, dq, prio, assignee, projectId]);
  const query = { view, q: dq || undefined, priority: prio || undefined, assigneeId: assignee || undefined, projectId: projectId || undefined, page, pageSize: 25, sort: sort.field, dir: sort.dir };
  // tickets are shown project by project: you see the tickets of the projects you are on
  const myProjects = useLoad(() => get('/projects', { status: 'DRAFT,ACTIVE,ON_HOLD,COMPLETED', pageSize: 200, sort: 'name', dir: 'asc' }), []);
  const list = useLoad(() => get('/tickets', query), [JSON.stringify(query)]);
  const views = useLoad(() => get('/tickets/views'), []);
  const members = useLoad(() => (isCustomer ? Promise.resolve({ data: [] }) : get('/org/members', { pageSize: 200 })), []);
  const agents = (members.data?.data || []).filter((m) => m.role !== 'CUSTOMER' && m.status === 'ACTIVE');
  useLive((e) => e.type.startsWith('ticket'), (e) => { list.reload({ silent: true }); views.reload({ silent: true }); if (e.type === 'ticket.created' && !e.self && !isCustomer) toast('New ticket arrived', 'live-evt'); });
  const VIEWS = isCustomer ? CLIENT_VIEWS : STAFF_VIEWS;
  const current = VIEWS.find((v) => v[0] === view) || VIEWS[0];
  const rows = list.data?.data || [];
  const allSel = rows.length > 0 && rows.every((t) => sel.has(t.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exportCsv = () => download(`/tickets/export.csv?${new URLSearchParams(Object.entries({ ...query, page: undefined, pageSize: undefined }).filter(([, v]) => v))}`, 'tickets.csv').catch((e) => toast(e.message, 'error'));
  return (
    <>
      <div className="page-header">
        <div><h1 className="h-page">{isCustomer ? 'My tickets' : 'Tickets'}</h1><div className="sub">{isCustomer ? 'Everything you and your colleagues have raised with us.' : 'Tickets of your projects — pick up, reply, resolve. Changes appear live.'}</div></div>
        <div className="d-flex gap-2">{!isCustomer && <button className="btn btn-light" onClick={exportCsv}><Download size={15} /> Export</button>}<button className="btn btn-primary" onClick={() => setParam('new', '1')}><Plus size={15} /> {isCustomer ? 'Raise a ticket' : 'New ticket'}</button></div>
      </div>
      <div className="desk">
        <nav className="views" aria-label="Ticket views">
          <div className="vh">Views</div>
          {VIEWS.map(([k, label, Icon]) => <button key={k} className={view === k ? 'active' : ''} onClick={() => setParam('view', k === defaultView ? '' : k)} aria-current={view === k ? 'page' : undefined}>
            <Icon size={15} />{label}<span className={`n ${k === 'overdue' && views.data?.[k] ? 'hot' : ''}`}>{views.data?.[k] ?? ''}</span></button>)}
        </nav>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="queue-toolbar">
            <strong className="me-2 d-none d-md-inline">{current[1]}</strong>
            <div className="search-in"><Search size={15} /><input className="form-control form-control-sm" placeholder="Search subject or #number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tickets" /></div>
            <select className="form-select form-select-sm" style={{ width: 'auto', maxWidth: 220 }} value={projectId} onChange={(e) => setParam('project', e.target.value)} aria-label="Filter by project">
              <option value="">All my projects</option>{(myProjects.data?.data || []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}<option value="none">No project</option></select>
            <select className="form-select form-select-sm" style={{ width: 'auto' }} value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Filter by priority"><option value="">Any priority</option>{PRIS.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}</select>
            {!isCustomer && !['mine', 'unassigned'].includes(view) && <select className="form-select form-select-sm" style={{ width: 'auto' }} value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Filter by assignee"><option value="">Anyone</option><option value="me">Me</option><option value="none">Unassigned</option>{agents.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}</select>}
            <span className="ms-auto small text-muted">{list.data?.meta?.total ?? '…'} tickets</span>
          </div>
          {sel.size > 0 && <BulkBar ids={[...sel]} agents={agents} onClear={() => setSel(new Set())} onDone={() => { setSel(new Set()); list.reload(); views.reload(); }} />}
          <ErrorBox error={list.error} onRetry={list.reload} />
          {list.loading && !list.data ? <div className="p-3"><Loading rows={6} /></div> : rows.length === 0 ? (
            <Empty icon={view === 'overdue' ? CheckCircle2 : Inbox} title={view === 'overdue' ? 'No SLA breaches — nice work' : view === 'unassigned' ? 'Every ticket has an owner' : view === 'mine' ? 'Your queue is empty' : 'No tickets here'}
              action={view === 'mine' && !isCustomer ? <button className="btn btn-sm btn-light" onClick={() => setParam('view', 'unassigned')}>Pick up unassigned tickets</button> : isCustomer ? <button className="btn btn-sm btn-primary" onClick={() => setParam('new', '1')}>Raise a ticket</button> : null}>{dq ? 'Try a different search.' : ''}</Empty>
          ) : (
            <div className="table-wrap"><table className="table table-hover mb-0">
              <thead><tr>
                {!isCustomer && <th style={{ width: 36 }}><input type="checkbox" className="form-check-input" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((t) => t.id)))} aria-label="Select all on this page" /></th>}
                <SortHeader field="number" sort={sort} onSort={onSort}>Ticket</SortHeader>
                <SortHeader field="priority" sort={sort} onSort={onSort}>Priority</SortHeader>
                <SortHeader field="status" sort={sort} onSort={onSort}>Status</SortHeader>
                <th>{isCustomer ? 'Raised by' : 'Assignee'}</th>
                {!isCustomer && <SortHeader field="resolutionDueAt" sort={sort} onSort={onSort}>SLA</SortHeader>}
                {isCustomer && <SortHeader field="updatedAt" sort={sort} onSort={onSort}>Updated</SortHeader>}
              </tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id} className="row-link" onClick={() => nav(`/tickets/${t.id}`)}>
                  {!isCustomer && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="form-check-input" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ticket ${t.number}`} /></td>}
                  <td style={{ maxWidth: 380 }}>
                    <Link to={`/tickets/${t.id}`} className="tk-subject" onClick={(e) => e.stopPropagation()}>{t.subject}</Link>
                    <div className="tk-meta"><span className="mono">#{t.number}</span>{t.project ? <> · <span className="tk-proj" title={t.project.name}><ProjectChip code={t.project.code} size={15} />{t.project.code}</span></> : !isCustomer ? <> · <span className="text-muted">No project</span></> : null}{!isCustomer && <> · <strong className="fw-semibold" style={{ color: 'var(--ink-soft)' }}>{t.customerName || 'Internal'}</strong></>} · {labelize(t.type)}{t.category ? ` · ${t.category}` : ''}{!isCustomer && t.tags?.length ? ` · ${t.tags.map((x) => `#${x}`).join(' ')}` : ''}</div>
                  </td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{isCustomer ? <span className="small">{t.requesterId === user.id ? 'You' : t.requesterName}</span>
                    : t.assigneeName ? <span className="d-inline-flex align-items-center gap-2 small text-nowrap" title={t.assigneeName}><Avatar sm name={t.assigneeName} />{t.assigneeName.split(' ')[0]}</span> : <span className="pill pill-outline">Unassigned</span>}</td>
                  {!isCustomer && <td className="nowrap"><SlaTimer ticket={t} /></td>}
                  {isCustomer && <td className="small text-muted text-nowrap" title={fmtDateTime(t.updatedAt)}>{fmtRelative(t.updatedAt)}</td>}
                </tr>))}</tbody>
            </table></div>)}
          <div className="px-3 pb-2"><Pagination meta={list.data?.meta} onPage={setPage} /></div>
        </div>
      </div>
      {creating && <NewTicket onClose={() => setParam('new', '')} onCreated={(t) => { toast(`Ticket #${t.number} created`, 'success'); nav(`/tickets/${t.id}`); }} />}
    </>
  );
}

// ---------------------------------------------------------------- Ticket workspace
const fill = (body, ctx) => body.replace(/\{\{\s*(requester|number|agent|subject)\s*\}\}/g, (_m, k) => ctx[k] ?? '');

function CannedPicker({ onPick, ctx }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data } = useLoad(() => (open ? get('/canned-responses') : Promise.resolve(null)), [open]);
  const rows = (data?.data || []).filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="position-relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(!open)} aria-expanded={open}><Zap size={14} /> Canned reply</button>
      {open && <div className="new-menu" style={{ left: 0, right: 'auto', bottom: 'calc(100% + 6px)', top: 'auto', width: 330 }}>
        <input className="form-control form-control-sm mb-1" placeholder="Search replies…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search canned replies" />
        {rows.map((c) => <button type="button" key={c.id} onClick={() => { onPick(fill(c.body, ctx)); setOpen(false); }}><span className="min-w-0"><span className="fw-semibold">{c.title}</span><small className="truncate">{c.body.replace(/\s+/g, ' ').slice(0, 70)}</small></span></button>)}
        {data && rows.length === 0 && <div className="small text-muted p-2">No canned replies yet. Add them in Settings.</div>}
        {!data && <div className="small text-muted p-2">Loading…</div>}
      </div>}
    </div>
  );
}

function Composer({ t, isCustomer, mentionable, onSent }) {
  const { user } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState('PUBLIC');
  const [body, setBody] = useState('');
  const [after, setAfter] = useState('');
  const [busy, setBusy] = useState(false);
  const internal = mode === 'INTERNAL' && !isCustomer;
  const send = async (e) => {
    e.preventDefault(); if (!body.trim()) return; setBusy(true);
    try {
      await post(`/tickets/${t.id}/messages`, { body, visibility: isCustomer ? 'PUBLIC' : mode });
      if (after) { const fresh = await get(`/tickets/${t.id}`); await post(`/tickets/${t.id}/status`, { status: after, version: fresh.version }); }
      setBody(''); setAfter(''); onSent(internal ? 'Note added' : 'Reply sent');
    } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  const afterOptions = isCustomer ? [] : t.allowedStatuses.filter((s) => ['WAITING_ON_CUSTOMER', 'RESOLVED', 'IN_PROGRESS'].includes(s));
  return (
    <form onSubmit={send} className={`composer ${internal ? 'internal' : ''}`}>
      {!isCustomer && <div className="composer-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'PUBLIC'} className={mode === 'PUBLIC' ? 'active' : ''} onClick={() => setMode('PUBLIC')}><Send size={14} /> Reply to client</button>
        <button type="button" role="tab" aria-selected={mode === 'INTERNAL'} className={`note ${mode === 'INTERNAL' ? 'active' : ''}`} onClick={() => setMode('INTERNAL')}><StickyNote size={14} /> Internal note</button>
      </div>}
      {internal && <div className="small px-3 pt-2" style={{ color: '#92400e' }}><Lock size={12} /> Visible to your team only — never shown to the client, in emails or in exports.</div>}
      <label htmlFor="reply" className="visually-hidden">{internal ? 'Internal note' : 'Reply'}</label>
      <MentionTextarea id="reply" value={body} onChange={setBody} people={isCustomer ? [] : mentionable} rows={4} placeholder={isCustomer ? 'Write a reply to the support team…' : internal ? 'Add a note for your team. Type @ to mention someone.' : `Reply to ${t.requesterName}…`} />
      <div className="bar">
        {!isCustomer && !internal && <CannedPicker ctx={{ requester: t.requesterName?.split(' ')[0], number: t.number, agent: user.name, subject: t.subject }} onPick={(txt) => setBody((b) => (b ? `${b}\n\n${txt}` : txt))} />}
        {afterOptions.length > 0 && <select className="form-select form-select-sm ms-auto" style={{ width: 'auto' }} value={after} onChange={(e) => setAfter(e.target.value)} aria-label="Status after sending">
          <option value="">Keep status ({labelize(t.status)})</option>{afterOptions.map((s) => <option key={s} value={s}>Then set: {labelize(s)}</option>)}</select>}
        <button className={`btn btn-sm ${internal ? 'btn-warning' : 'btn-primary'} ${afterOptions.length ? '' : 'ms-auto'}`} disabled={busy || !body.trim()}>{busy ? 'Sending…' : internal ? 'Add note' : 'Send reply'}</button>
      </div>
    </form>
  );
}

function Csat({ t, onDone }) {
  const toast = useToast();
  const [rating, setRating] = useState(t.csatRating || 0);
  const [comment, setComment] = useState(t.csatComment || '');
  const [editing, setEditing] = useState(!t.csatRating);
  const save = async () => { try { await post(`/tickets/${t.id}/csat`, { rating, comment }); toast('Thanks for your feedback', 'success'); setEditing(false); onDone(); } catch (e) { toast(e.message, 'error'); } };
  const stars = (n) => <Star size={18} fill={n <= t.csatRating ? '#f59e0b' : 'none'} color={n <= t.csatRating ? '#f59e0b' : '#cbd5e1'} />;
  if (!editing) return <Card title="Your rating"><div className="d-flex align-items-center gap-2"><span className="stars">{[1, 2, 3, 4, 5].map((n) => <span key={n}>{stars(n)}</span>)}</span><button className="btn btn-sm btn-link ms-auto" onClick={() => setEditing(true)}>Change</button></div>{t.csatComment && <p className="small text-muted mt-2 mb-0">“{t.csatComment}”</p>}</Card>;
  return (
    <Card title="How did we do?">
      <div className="stars mb-2" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)}><Star size={24} fill={n <= rating ? '#f59e0b' : 'none'} color={n <= rating ? '#f59e0b' : '#cbd5e1'} /></button>)}</div>
      <textarea className="form-control form-control-sm mb-2" rows={2} placeholder="Anything we could do better? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Feedback" />
      <button className="btn btn-sm btn-primary" disabled={!rating} onClick={save}>Submit rating</button>
    </Card>
  );
}

function SlaPanel({ t }) {
  const row = (label, clock, doneAt) => {
    if (!clock || clock.state === 'NONE') return null;
    let tone = 'ok'; let text;
    if (doneAt) { tone = clock.state === 'MET' ? 'ok' : 'risk'; text = clock.state === 'MET' ? 'Met' : 'Missed'; }
    else if (clock.state === 'PAUSED') { tone = ''; text = 'Paused'; }
    else if (clock.state === 'BREACHED') { tone = 'risk'; text = `${fmtDuration(Date.now() - new Date(clock.dueAt))} over`; }
    else { tone = clock.state === 'AT_RISK' ? 'warn' : 'ok'; text = `${fmtDuration((clock.remainingMinutes ?? 0) * 60000)} left`; }
    return <div className={`timer ${tone}`}><span><span className="d-block fw-semibold">{label}</span><span className="small text-muted">{doneAt ? fmtDateTime(doneAt) : `Due ${fmtDateTime(clock.dueAt)}`}</span></span><span className="t">{text}</span></div>;
  };
  return <>{row('First reply', t.sla.response, t.firstResponseAt)}{row('Resolution', t.sla.resolution, t.resolvedAt)}{t.status === 'WAITING_ON_CUSTOMER' && <div className="small text-muted">Clocks are paused until the client replies.</div>}<div className="small text-muted mt-1">Times count working hours only.</div></>;
}

function TagEditor({ tags, onSave }) {
  const [v, setV] = useState('');
  const add = (e) => { e.preventDefault(); const x = v.trim().toLowerCase().replace(/\s+/g, '-'); if (x && !tags.includes(x)) onSave([...tags, x]); setV(''); };
  return (
    <div className="d-flex flex-wrap gap-1 align-items-center">
      {tags.map((x) => <span key={x} className="pill pill-neutral">#{x}<button type="button" className="btn p-0 border-0 lh-1" aria-label={`Remove tag ${x}`} onClick={() => onSave(tags.filter((y) => y !== x))}><X size={11} /></button></span>)}
      <form onSubmit={add}><input className="form-control form-control-sm" style={{ width: 110 }} placeholder="Add tag" value={v} onChange={(e) => setV(e.target.value)} aria-label="Add tag" /></form>
    </div>
  );
}

export function TicketDetail() {
  const { ticketId } = useParams();
  const { isCustomer, user } = useAuth();
  const toast = useToast();
  const { data: t, error, loading, reload } = useLoad(() => get(`/tickets/${ticketId}`), [ticketId]);
  const staff = useLoad(() => (isCustomer ? Promise.resolve(null) : get('/org/members', { pageSize: 200 })), []);
  const [linking, setLinking] = useState(false);
  const [taskFor, setTaskFor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const bottom = useRef(null);
  useLive((e) => e.ticketId === ticketId, (e) => { reload({ silent: true }); if (!e.self && e.type === 'ticket.message') toast('New message on this ticket', 'live-evt'); }, [ticketId]);
  const internalPeople = useMemo(() => (staff.data?.data || []).filter((m) => m.role !== 'CUSTOMER' && m.status === 'ACTIVE'), [staff.data]);
  if (loading && !t) return <Loading rows={8} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const staffIds = new Set(internalPeople.map((m) => m.userId));
  const sideOf = (authorId) => (isCustomer ? (authorId === user.id || authorId === t.requesterId ? 'client' : 'agent') : staffIds.has(authorId) ? 'agent' : 'client');
  const mentionable = [...internalPeople.map((m) => ({ id: m.userId, name: m.name })), ...(t.requesterId ? [{ id: t.requesterId, name: t.requesterName }] : [])];
  const update = async (changes, msg = 'Saved') => { try { await patch(`/tickets/${t.id}`, { ...changes, version: t.version }); reload({ silent: true }); toast(msg, 'success'); } catch (x) { toast(x.message, 'error'); reload(); } };
  const setStatus = async (status) => { try { await post(`/tickets/${t.id}/status`, { status, version: t.version }); reload({ silent: true }); toast(`Status: ${labelize(status)}`, 'success'); } catch (x) { toast(x.message, 'error'); reload(); } };
  const closed = ['RESOLVED', 'CLOSED'].includes(t.status);
  const primary = isCustomer ? (t.status === 'RESOLVED' && t.allowedStatuses.includes('CLOSED') ? ['CLOSED', 'Confirm it’s fixed'] : null)
    : t.allowedStatuses.includes('RESOLVED') ? ['RESOLVED', 'Resolve'] : null;
  const timeline = [...t.messages.map((m) => ({ kind: 'msg', at: m.createdAt, m })),
    ...(showHistory ? t.history.filter((h) => !['ticket.replied', 'ticket.internal_note', 'ticket.created'].includes(h.action)).map((h, i) => ({ kind: 'evt', at: h.createdAt, h, i })) : [])]
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  return (
    <>
      <div className="mb-2"><Link to="/tickets" className="small d-inline-flex align-items-center gap-1 text-muted"><ArrowLeft size={14} /> {isCustomer ? 'My tickets' : 'Tickets'}</Link></div>
      <div className="ticket-ws">
        <div className="min-w-0">
          <div className="ticket-head">
            <div className="d-flex align-items-center gap-2 flex-wrap small text-muted"><span className="mono">#{t.number}</span><span>·</span><span>{labelize(t.type)}</span>{t.category && <><span>·</span><span>{t.category}</span></>}<span>·</span><span>opened {fmtRelative(t.createdAt)} by {t.requesterName}</span></div>
            <h1>{t.subject}</h1>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <StatusBadge status={t.status} /><PriorityBadge priority={t.priority} />{!isCustomer && <SlaTimer ticket={t} />}
              <div className="ms-auto d-flex gap-2 flex-wrap">
                {!isCustomer && t.canWork && !t.assigneeId && <button className="btn btn-sm btn-light" onClick={() => update({ assigneeId: user.id }, 'Assigned to you')}><User size={14} /> Assign to me</button>}
                {t.allowedStatuses.filter((s) => s !== primary?.[0] && !(isCustomer && s === 'RESOLVED') && !(s === 'CLOSED' && t.status !== 'RESOLVED')).map((s) => <button key={s} className="btn btn-sm btn-light" onClick={() => setStatus(s)}>{s === 'OPEN' && closed ? <><RotateCcw size={13} /> Reopen</> : labelize(s)}</button>)}
                {primary && <button className="btn btn-sm btn-success" onClick={() => setStatus(primary[0])}><CheckCircle2 size={14} /> {primary[1]}</button>}
              </div>
            </div>
          </div>
          <Card title={<><MessageSquare size={16} /> Conversation</>} actions={!isCustomer && <button className="btn btn-sm btn-ghost" onClick={() => setShowHistory(!showHistory)}><History size={14} /> {showHistory ? 'Hide activity' : 'Show activity'}</button>}>
            <div className="thread mb-3">
              <div className="msg client"><Avatar name={t.requesterName} /><div className="bubble"><div className="meta"><strong>{t.requesterName}</strong>{!isCustomer && <span className="pill pill-neutral py-0">Client</span>}<span title={fmtDateTime(t.createdAt)}>{fmtRelative(t.createdAt)}</span></div><div className="body">{t.description}</div></div></div>
              {timeline.map((x) => (x.kind === 'msg'
                ? <Message key={x.m.id} m={{ ...x.m, showPublic: !isCustomer }} side={sideOf(x.m.author?.id)} internalLabel="Internal note" />
                : <div key={`h${x.i}`} className="msg event"><span><strong className="text-body">{x.h.actorName}</strong> {labelize(x.h.action.replace('ticket.', '').replace(/_/g, ' '))}{x.h.metadata?.to && <> → {labelize(x.h.metadata.to)}</>} · {fmtRelative(x.h.createdAt)}</span></div>))}
              <div ref={bottom} />
            </div>
            {t.status === 'CLOSED' ? <Notice>This ticket is closed. {isCustomer ? 'Still having trouble? Reopen it above and reply.' : 'Reopen it to reply.'}</Notice>
              : (t.canWork || isCustomer) && <Composer t={t} isCustomer={isCustomer} mentionable={mentionable} onSent={(msg) => { toast(msg, 'success'); reload({ silent: true }); setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); }} />}
          </Card>
          <Card title="Attachments" className="mt-3"><FileList targetType="ticket" targetId={t.id} /></Card>
        </div>

        <aside className="side-panel">
          {isCustomer && closed && t.requesterId === user.id && <Csat t={t} onDone={() => reload({ silent: true })} />}
          <Card title="Properties">
            {!isCustomer ? <>
              <div className="field-row"><label htmlFor="tp-as">Assignee</label><Select id="tp-as" value={t.assigneeId} onChange={(v) => update({ assigneeId: v || null }, v ? 'Assigned' : 'Unassigned')} placeholder="Unassigned" options={internalPeople.map((m) => ({ value: m.userId, label: m.name }))} /></div>
              <div className="field-row"><label htmlFor="tp-pr">Priority</label><Select id="tp-pr" value={t.priority} onChange={(v) => v && update({ priority: v }, 'Priority changed — SLA targets recalculated')} options={PRIS.map((p) => ({ value: p, label: priorityLabel(p) }))} /></div>
              <div className="field-row"><label htmlFor="tp-ty">Type</label><Select id="tp-ty" value={t.type} onChange={(v) => v && update({ type: v })} options={TYPES.map(([v, l]) => ({ value: v, label: l }))} /></div>
              <div className="field-row"><span>Tags</span><TagEditor tags={t.tags || []} onSave={(tags) => update({ tags }, 'Tags updated')} /></div>
            </> : <>
              <div className="field-row"><span>Priority</span><PriorityBadge priority={t.priority} /></div>
              <div className="field-row"><span>Type</span><span>{labelize(t.type)}</span></div>
            </>}
            <div className="field-row"><span>Requester</span><span className="d-inline-flex align-items-center gap-2"><Avatar sm name={t.requesterName} />{t.requesterName}</span></div>
            <div className="field-row"><span>Client</span><span>{t.customerName || 'Internal'}</span></div>
            <div className="field-row"><span>Project</span><span>{t.project ? <Link to={`/projects/${t.project.id}`}>{t.project.name}</Link> : '—'}</span></div>
          </Card>
          {!isCustomer && <Card title={<><Clock size={15} /> SLA</>}><SlaPanel t={t} />{t.csatRating && <div className="mt-2 small"><span className="text-muted">Client rating:</span> <strong>{t.csatRating}/5</strong>{t.csatComment && <div className="text-muted">“{t.csatComment}”</div>}</div>}</Card>}
          {!isCustomer && <Card title={<><Link2 size={15} /> Linked tasks</>} actions={t.canWork && <div className="d-flex gap-1"><button className="btn btn-sm btn-light" onClick={() => setLinking(true)} title="Link an existing task">Link</button><button className="btn btn-sm btn-light" onClick={() => setTaskFor(true)}><ListPlus size={13} /> Task</button></div>}>
            {t.links.length === 0 ? <div className="small text-muted">Escalate to delivery by creating a task — it stays linked to this ticket.</div> : <ul className="list-plain">{t.links.map((l) => <li key={l.workItemId}><Link to={`/projects/${l.projectId}/tasks?item=${l.workItemId}`} className="flex-grow-1 truncate small"><span className="mono">{l.key}</span> {l.title}</Link><StatusBadge status={l.status} />
              {t.canWork && <ConfirmButton className="btn btn-sm btn-ghost btn-icon" title="Unlink this task?" confirmLabel="Unlink" onConfirm={async () => { await del(`/tickets/${t.id}/links/${l.workItemId}`); reload(); }}><Trash2 size={13} aria-label="Unlink" /></ConfirmButton>}</li>)}</ul>}
          </Card>}
          {isCustomer && <Card title={<><Clock size={15} /> Timeline</>}><ul className="list-plain">{t.history.slice(-6).map((h, i) => <li key={i} className="small"><span className="flex-grow-1">{labelize(h.action.replace('ticket.', '').replace(/_/g, ' '))}{h.metadata?.to && ` → ${labelize(h.metadata.to)}`}</span><span className="text-muted">{fmtRelative(h.createdAt)}</span></li>)}</ul></Card>}
        </aside>
      </div>
      {linking && <LinkWorkModal ticket={t} onClose={() => setLinking(false)} onDone={() => { setLinking(false); reload(); }} />}
      {taskFor && <CreateTaskModal ticket={t} onClose={() => setTaskFor(false)} onDone={(w) => { setTaskFor(false); reload(); toast(`${w.key} created and linked`, 'success'); }} />}
    </>
  );
}

function LinkWorkModal({ ticket, onClose, onDone }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const res = useLoad(() => (dq.length >= 2 ? get('/search', { q: dq }) : Promise.resolve(null)), [dq]);
  const toast = useToast();
  const link = async (w) => { try { await post(`/tickets/${ticket.id}/links`, { workItemId: w.id }); onDone(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Modal open onClose={onClose} title="Link to an existing task">
      <Field label="Find a task" hint="Type part of its title">{(id) => <input id={id} className="form-control" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}</Field>
      <ul className="list-plain">{(res.data?.workItems || []).map((w) => <li key={w.id}><span className="mono">{w.key}</span><span className="flex-grow-1 truncate">{w.title}</span><button className="btn btn-sm btn-outline-primary" onClick={() => link(w)}>Link</button></li>)}
        {res.data && res.data.workItems.length === 0 && <li className="small text-muted">No matches.</li>}</ul>
    </Modal>
  );
}

function CreateTaskModal({ ticket, onClose, onDone }) {
  const projects = useLoad(() => get('/projects', { pageSize: 100, status: 'ACTIVE,ON_HOLD,DRAFT' }), []);
  const [projectId, setProjectId] = useState(ticket.project?.id || '');
  const detail = useLoad(() => (projectId ? get(`/projects/${projectId}`) : Promise.resolve(null)), [projectId]);
  const [f, setF] = useState({ title: ticket.subject, phaseId: '', assigneeId: '' });
  const [err, setErr] = useState(null);
  const submit = async () => { setErr(null); try { onDone(await post(`/tickets/${ticket.id}/create-task`, { projectId, title: f.title, phaseId: f.phaseId || null, assigneeId: f.assigneeId || null })); } catch (e) { setErr(e); } };
  return (
    <Modal open onClose={onClose} title={`Create a task from ticket #${ticket.number}`} footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!projectId || !f.title.trim()} onClick={submit}>Create task</button></>}>
      <ErrorBox error={err} />
      <p className="small text-muted">The conversation stays on the ticket. The new task links back here, so the client keeps one place to follow.</p>
      <Field label="Project">{(id) => <Select id={id} value={projectId} onChange={(v) => setProjectId(v || '')} placeholder="Choose…" options={(projects.data?.data || []).map((p) => ({ value: p.id, label: p.name }))} />}</Field>
      <Field label="Task title">{(id) => <input id={id} className="form-control" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
      {detail.data && <div className="row"><div className="col-6"><Field label="Phase">{(id) => <Select id={id} value={f.phaseId} onChange={(v) => setF({ ...f, phaseId: v || '' })} placeholder="None" options={detail.data.phases.map((p) => ({ value: p.id, label: p.name }))} />}</Field></div>
        <div className="col-6"><Field label="Assignee">{(id) => <Select id={id} value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v || '' })} placeholder="Unassigned" options={detail.data.members.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role)).map((m) => ({ value: m.id, label: m.name }))} />}</Field></div></div>}
    </Modal>
  );
}
