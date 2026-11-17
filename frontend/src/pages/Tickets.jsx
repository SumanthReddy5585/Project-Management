import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, LifeBuoy, Download, Link2, Trash2, ListPlus, Lock, ChevronDown } from 'lucide-react';
import { get, post, patch, del, download } from '../api/client.js';
import { useLoad, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtDateTime, fmtRelative, labelize } from '../lib/format.js';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pagination, PriorityBadge, Select, SlaBadge, StatusBadge, useToast, fieldErrors, Notice, ConfirmButton, Segmented, Avatar } from '../components/ui.jsx';
import { FileList, Message, MentionTextarea } from '../components/collab.jsx';

const STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'];
const PRIS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const opts = (xs) => xs.map((x) => ({ value: x, label: labelize(x) }));

function NewTicket({ onClose, onCreated }) {
  const { isCustomer } = useAuth();
  const refs = useLoad(() => Promise.all([get('/projects', { pageSize: 100 }), get('/org/ticket-settings'), isCustomer ? { data: [] } : get('/org/customers')]), []);
  const [f, setF] = useState({ subject: '', description: '', type: 'QUESTION', priority: 'MEDIUM', category: '', projectId: '', customerCompanyId: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [projects, settings, customers] = refs.data ? [refs.data[0].data, refs.data[1], refs.data[2].data] : [[], { categories: [] }, []];
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(null);
    try { const t = await post('/tickets', { ...f, category: f.category || null, projectId: f.projectId || null, customerCompanyId: f.customerCompanyId || null }); onCreated(t); } catch (x) { setErr(x); } finally { setBusy(false); } };
  const fe = fieldErrors(err);
  return (
    <Modal open size="lg" onClose={onClose} title="New request" footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="nt" disabled={busy || f.subject.trim().length < 3 || !f.description.trim()}>{busy ? 'Sending…' : 'Send request'}</button></>}>
      <ErrorBox error={err} />
      <form id="nt" onSubmit={submit}>
        <div className="mb-3"><Segmented label="What kind of request?" value={f.type} onChange={(v) => setF({ ...f, type: v })} options={[['QUESTION', 'Question'], ['BUG', 'Something is broken'], ['SERVICE_REQUEST', 'Need something done'], ['CHANGE_REQUEST', 'Change request']]} /></div>
        <Field label="Subject" error={fe.subject}>{(id) => <input id={id} className="form-control" placeholder="Short summary" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} autoFocus />}</Field>
        <Field label="Details" hint="You can attach screenshots after sending.">{(id) => <textarea id={id} className="form-control" rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <div className="mb-3"><Segmented label="How urgent?" value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={[['LOW', 'Low'], ['MEDIUM', 'Normal'], ['HIGH', 'High'], ['CRITICAL', 'Urgent']]} /></div>
        <details className="more"><summary><ChevronDown size={15} /> More options</summary>
          <div className="row">
            <div className="col-md-6"><Field label="Project">{(id) => <Select id={id} value={f.projectId} onChange={(v) => setF({ ...f, projectId: v || '' })} placeholder="Not about a specific project" options={projects.map((p) => ({ value: p.id, label: p.name }))} />}</Field></div>
            <div className="col-md-6"><Field label="Category">{(id) => <Select id={id} value={f.category} onChange={(v) => setF({ ...f, category: v || '' })} placeholder="—" options={settings.categories.map((c) => ({ value: c, label: c }))} />}</Field></div>
            {!isCustomer && <div className="col-md-6"><Field label="Client">{(id) => <Select id={id} value={f.customerCompanyId} onChange={(v) => setF({ ...f, customerCompanyId: v || '' })} placeholder="From the project / internal" options={customers.map((c) => ({ value: c.id, label: c.name }))} />}</Field></div>}
          </div>
        </details>
      </form>
    </Modal>
  );
}

const slaAlert = (t) => [t.sla.response, t.sla.resolution].find((c) => c?.state === 'BREACHED') || [t.sla.response, t.sla.resolution].find((c) => c?.state === 'AT_RISK');

export function TicketsList() {
  const { isCustomer } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params0, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('open');
  const [who, setWho] = useState('');
  const [page, setPage] = useState(1);
  const creating = params0.get('new') === '1';
  const setCreating = (on) => setParams((p) => { const n = new URLSearchParams(p); if (on) n.set('new', '1'); else n.delete('new'); return n; });
  const dq = useDebounced(q);
  const params = { q: dq || undefined, status: status === 'all' ? undefined : status === 'done' ? 'RESOLVED,CLOSED' : 'open', assigneeId: ['me', 'none'].includes(who) ? who : undefined, sla: who === 'late' ? 'BREACHED' : undefined, page, sort: 'updatedAt', dir: 'desc' };
  const { data, error, loading, reload } = useLoad(() => get('/tickets', params), [JSON.stringify(params)]);
  const reset = (fn) => (v) => { fn(v || ''); setPage(1); };
  return (
    <>
      <PageHeader title="Requests" sub={isCustomer ? 'Ask your project team for help and follow the replies here.' : 'Questions, issues and change requests from clients and the team.'}
        actions={<>{!isCustomer && <button className="btn btn-light" title="Download as CSV" onClick={() => download(`/tickets/export.csv?${new URLSearchParams(Object.entries(params).filter(([k, v]) => v && !['page'].includes(k)))}`, 'requests.csv').catch((e) => toast(e.message, 'error'))}><Download size={15} /> Export</button>}
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New request</button></>} />
      <div className="filters">
        <input className="form-control" style={{ maxWidth: 260 }} placeholder="Search requests" value={q} onChange={(e) => reset(setQ)(e.target.value)} aria-label="Search requests" />
        <Segmented label="Status" value={status} onChange={reset(setStatus)} options={[['open', 'Open'], ['done', 'Resolved'], ['all', 'All']]} />
        {!isCustomer && <Segmented label="Show" value={who} onChange={reset(setWho)} options={[['', 'Everyone'], ['me', 'Mine'], ['none', 'Unassigned'], ['late', 'Overdue']]} />}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="card p-2">
        {loading && !data ? <div className="p-3"><Loading /></div> : data?.data.length === 0 ? <Empty icon={LifeBuoy} title={status === 'open' ? 'No open requests' : 'No requests'} action={<button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>New request</button>}>{status === 'open' ? 'All caught up.' : ''}</Empty> : (
          data.data.map((t) => {
            const alert = slaAlert(t);
            return (
              <div key={t.id} className="task-row" role="link" tabIndex={-1} style={{ cursor: 'pointer' }} onClick={() => nav(`/tickets/${t.id}`)}>
                <span className="mono small text-muted" style={{ width: 44 }}>#{t.number}</span>
                <div className="flex-grow-1 min-w-0"><Link to={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} className="title d-block truncate">{t.subject}</Link>
                  <div className="small text-muted truncate">{[!isCustomer && (t.customerName || 'Internal'), t.project?.name, fmtRelative(t.updatedAt)].filter(Boolean).join(' · ')}</div></div>
                {['HIGH', 'CRITICAL'].includes(t.priority) && <PriorityBadge priority={t.priority} />}
                {alert && !['RESOLVED', 'CLOSED'].includes(t.status) && <span className={`pill ${alert.state === 'BREACHED' ? 'pill-risk' : 'pill-warn'}`}>{alert.state === 'BREACHED' ? 'Overdue' : 'Due soon'}</span>}
                <StatusBadge status={t.status} />
                {!isCustomer && (t.assigneeName ? <Avatar sm name={t.assigneeName} title={t.assigneeName} /> : <span className="avatar sm" style={{ background: 'var(--surface-soft)', color: 'var(--muted)' }} title="Not assigned">?</span>)}
              </div>);
          }))}
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      {creating && <NewTicket onClose={() => setCreating(false)} onCreated={(t) => { toast(`Request #${t.number} sent`, 'success'); nav(`/tickets/${t.id}`); }} />}
    </>
  );
}

export function TicketDetail() {
  const { ticketId } = useParams();
  const { isCustomer } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data: t, error, loading, reload } = useLoad(() => get(`/tickets/${ticketId}`), [ticketId]);
  const staff = useLoad(() => (isCustomer ? Promise.resolve(null) : get('/org/members', { pageSize: 200 })), []);
  const [body, setBody] = useState('');
  const [vis, setVis] = useState('PUBLIC');
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [taskFor, setTaskFor] = useState(false);
  if (loading && !t) return <Loading rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const internalPeople = (staff.data?.data || []).filter((m) => m.role !== 'CUSTOMER' && m.status === 'ACTIVE');
  const mentionable = vis === 'INTERNAL' ? internalPeople.map((m) => ({ id: m.userId, name: m.name })) : [...internalPeople.map((m) => ({ id: m.userId, name: m.name })), { id: t.requesterId, name: t.requesterName }];
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(`/tickets/${t.id}/messages`, { body, visibility: isCustomer ? 'PUBLIC' : vis }); setBody(''); reload(); } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  const update = async (changes) => { try { await patch(`/tickets/${t.id}`, { ...changes, version: t.version }); reload(); toast('Saved', 'success'); } catch (x) { toast(x.message, 'error'); reload(); } };
  const setStatus = async (status) => { try { await post(`/tickets/${t.id}/status`, { status, version: t.version }); reload(); } catch (x) { toast(x.message, 'error'); reload(); } };
  const verb = { OPEN: t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'Reopen' : 'Mark open', IN_PROGRESS: 'Start working', WAITING_ON_CUSTOMER: 'Waiting on client', RESOLVED: 'Mark resolved', CLOSED: isCustomer ? 'All good, close it' : 'Close' };
  return (
    <>
      <PageHeader eyebrow={<><Link to="/tickets">Requests</Link> · #{t.number}</>} title={t.subject}
        sub={<span className="d-flex gap-2 align-items-center flex-wrap mt-1"><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /><span className="small">{labelize(t.type)}</span><SlaBadge clock={t.sla.response} label="First reply" /><SlaBadge clock={t.sla.resolution} label="Fix" /></span>}
        actions={t.allowedStatuses.map((s) => <button key={s} className={`btn btn-sm ${s === 'RESOLVED' || (isCustomer && s === 'CLOSED') ? 'btn-primary' : 'btn-light'}`} onClick={() => setStatus(s)}>{verb[s]}</button>)} />
      <div className="row g-3">
        <div className="col-lg-8">
          <Card title="Conversation">
            <div className="thread mb-3">
              <div className="msg"><div className="meta"><strong className="text-body">{t.requesterName}</strong><span>opened {fmtDateTime(t.createdAt)}</span></div><div className="body">{t.description}</div></div>
              {t.messages.map((m) => <Message key={m.id} m={{ ...m, showPublic: !isCustomer }} internalLabel="Team-only note" />)}
            </div>
            {t.status === 'CLOSED' ? <Notice>This request is closed. Reopen it to keep talking.</Notice> : (t.canWork || isCustomer) && (
              <form onSubmit={send} className="composer">
                {!isCustomer && <div className="mb-2"><Segmented label="Reply type" value={vis} onChange={setVis} options={[['PUBLIC', 'Reply to client'], ['INTERNAL', 'Team-only note', Lock]]} /></div>}
                {vis === 'INTERNAL' && !isCustomer && <div className="notice internal mb-2"><Lock size={14} /> Only your team sees this. The client never does — not here, in emails or in exports.</div>}
                <label htmlFor="reply" className="visually-hidden">Reply</label>
                <MentionTextarea id="reply" value={body} onChange={setBody} people={isCustomer ? [] : mentionable} rows={4} placeholder={isCustomer ? 'Write a reply…' : vis === 'PUBLIC' ? 'Write to the client…' : 'Note for your team…'} />
                <div className="text-end mt-2"><button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>{busy ? 'Sending…' : vis === 'INTERNAL' && !isCustomer ? 'Save note' : 'Send reply'}</button></div>
              </form>)}
          </Card>
          <Card title="Attachments" className="mt-3"><FileList targetType="ticket" targetId={t.id} /></Card>
        </div>
        <div className="col-lg-4 d-flex flex-column gap-3">
          <Card title="Details"><dl className="kv">
            <dt>Requester</dt><dd>{t.requesterName}</dd><dt>Client</dt><dd>{t.customerName || 'Internal'}</dd>
            <dt>Project</dt><dd>{t.project ? <Link to={`/projects/${t.project.id}`}>{t.project.name}</Link> : '—'}</dd>
            <dt>Category</dt><dd>{t.category || '—'}</dd>
            {!isCustomer && <><dt>Assignee</dt><dd><Select aria-label="Assignee" value={t.assigneeId} onChange={(v) => update({ assigneeId: v })} placeholder="Unassigned" options={internalPeople.map((m) => ({ value: m.userId, label: m.name }))} /></dd>
              <dt>Priority</dt><dd><Select aria-label="Priority" value={t.priority} onChange={(v) => update({ priority: v })} options={opts(PRIS)} /><div className="form-text">Changing this resets the target times.</div></dd>
              <dt>Severity</dt><dd><Select aria-label="Severity" value={String(t.severity)} onChange={(v) => update({ severity: Number(v) })} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}${n === 1 ? ' (highest)' : ''}` }))} /></dd></>}
            <dt>First reply</dt><dd>{t.firstResponseAt ? fmtDateTime(t.firstResponseAt) : `Due ${fmtDateTime(t.responseDueAt)}`}</dd>
            <dt>Resolved</dt><dd>{t.resolvedAt ? fmtDateTime(t.resolvedAt) : `Due ${fmtDateTime(t.resolutionDueAt)}`}</dd>
          </dl>
            {t.status === 'WAITING_ON_CUSTOMER' && <div className="form-text">Target times are paused while you wait on the client. Their reply restarts them.</div>}</Card>
          {!isCustomer && <Card title="Linked tasks" actions={t.canWork && <div className="d-flex gap-1"><button className="btn btn-sm btn-light" onClick={() => setLinking(true)}><Link2 size={13} /> Link</button><button className="btn btn-sm btn-light" onClick={() => setTaskFor(true)}><ListPlus size={13} /> Make a task</button></div>}>
            {t.links.length === 0 ? <div className="small text-muted">Not linked to any task yet.</div> : <ul className="list-plain">{t.links.map((l) => <li key={l.workItemId}><Link to={`/projects/${l.projectId}/tasks?item=${l.workItemId}`} className="flex-grow-1 truncate"><span className="mono">{l.key}</span> {l.title}</Link><StatusBadge status={l.status} />
              {t.canWork && <ConfirmButton className="btn btn-sm btn-ghost btn-icon" title="Unlink?" confirmLabel="Unlink" onConfirm={async () => { await del(`/tickets/${t.id}/links/${l.workItemId}`); reload(); }}><Trash2 size={13} aria-label="Unlink" /></ConfirmButton>}</li>)}</ul>}
            <div className="form-text mt-1">The request and the task each keep their own status.</div></Card>}
          <Card title="History"><ul className="list-plain">{t.history.map((h, i) => <li key={i} className="small"><span className="flex-grow-1">{h.actorName} · {labelize(h.action.replace('ticket.', ''))}{h.metadata?.to && ` → ${labelize(h.metadata.to)}`}</span><span className="text-muted">{fmtRelative(h.createdAt)}</span></li>)}</ul></Card>
        </div>
      </div>
      {linking && <LinkWorkModal ticket={t} onClose={() => setLinking(false)} onDone={() => { setLinking(false); reload(); }} />}
      {taskFor && <CreateTaskModal ticket={t} onClose={() => setTaskFor(false)} onDone={(w) => { setTaskFor(false); reload(); toast(`${w.key} added and linked`, 'success'); }} />}
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
    <Modal open onClose={onClose} title={`Make a task from request #${ticket.number}`} footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!projectId || !f.title.trim()} onClick={submit}>Create task</button></>}>
      <ErrorBox error={err} />
      <p className="small text-muted">The conversation stays here. The new task links back to this request.</p>
      <Field label="Project">{(id) => <Select id={id} value={projectId} onChange={(v) => setProjectId(v || '')} placeholder="Choose…" options={(projects.data?.data || []).map((p) => ({ value: p.id, label: p.name }))} />}</Field>
      <Field label="Task title">{(id) => <input id={id} className="form-control" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
      {detail.data && <div className="row"><div className="col-6"><Field label="Phase">{(id) => <Select id={id} value={f.phaseId} onChange={(v) => setF({ ...f, phaseId: v || '' })} placeholder="None" options={detail.data.phases.map((p) => ({ value: p.id, label: p.name }))} />}</Field></div>
        <div className="col-6"><Field label="Assignee">{(id) => <Select id={id} value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v || '' })} placeholder="Unassigned" options={detail.data.members.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role)).map((m) => ({ value: m.id, label: m.name }))} />}</Field></div></div>}
    </Modal>
  );
}
