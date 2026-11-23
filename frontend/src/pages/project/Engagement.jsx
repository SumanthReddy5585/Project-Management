import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { FileCheck2, Plus, Send, MessagesSquare, Lock, Globe, Megaphone, CheckCircle2, XCircle, RotateCcw, Check, X, ListChecks, GitPullRequest, FileText, ChevronDown, ChevronRight, Paperclip, Upload } from 'lucide-react';
import { get, post, patch } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtDateTime, fmtRelative, todayISO } from '../../lib/format.js';
import { Card, Empty, ErrorBox, Field, Loading, Modal, Select, StatusBadge, useToast, Avatar, HealthBadge, Segmented } from '../../components/ui.jsx';
import { CommentThread, FileList, MentionTextarea, VisibilityToggle } from '../../components/collab.jsx';
import { useProject } from './Workspace.jsx';

function ReviewModal({ d, initial = 'APPROVED', onClose, onDone }) {
  const { project } = useProject();
  const [decision, setDecision] = useState(initial);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const cur = d.versions[0];
  const submit = async () => { setErr(null); setBusy(true); try { await post(`/projects/${project.id}/deliverables/${d.id}/review`, { versionNumber: d.currentVersion, decision, comment: comment || undefined }); onDone(decision); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onClose} title={`${d.name} · version ${d.currentVersion}`} footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button>
      <button className={`btn ${decision === 'APPROVED' ? 'btn-success' : 'btn-warning'}`} onClick={submit} disabled={busy || (decision === 'CHANGES_REQUESTED' && !comment.trim())}>{decision === 'APPROVED' ? <><CheckCircle2 size={15} /> Approve version {d.currentVersion}</> : <><RotateCcw size={15} /> Send back for changes</>}</button></>}>
      <ErrorBox error={err} />
      {cur?.files?.length > 0 && <div className="mb-3"><div className="form-label">Open the document</div><FileList targetType="deliverableVersion" targetId={cur.id} compact /></div>}
      <div className="ap-decide" role="radiogroup" aria-label="Decision">
        <button type="button" role="radio" aria-checked={decision === 'APPROVED'} className={`ok ${decision === 'APPROVED' ? 'on' : ''}`} onClick={() => setDecision('APPROVED')}><CheckCircle2 size={18} /><b>Approve</b><span>It is good to go</span></button>
        <button type="button" role="radio" aria-checked={decision === 'CHANGES_REQUESTED'} className={`warn ${decision === 'CHANGES_REQUESTED' ? 'on' : ''}`} onClick={() => setDecision('CHANGES_REQUESTED')}><RotateCcw size={18} /><b>Request changes</b><span>The manager uploads a new version</span></button>
      </div>
      <Field label={decision === 'CHANGES_REQUESTED' ? 'What needs to change? (required)' : 'Comment (optional)'}>{(id) => <textarea id={id} className="form-control" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={decision === 'CHANGES_REQUESTED' ? 'e.g. Section 3 needs the revised budget' : ''} />}</Field>
      <div className="form-text">Your decision applies to version {d.currentVersion} only and is recorded with your name and the time.</div>
    </Modal>
  );
}

/** The steps a document goes through, and where it is now. */
function steps(d, isCustomer) {
  const cur = d.versions[0];
  const last = cur?.approvals?.at(-1);
  const dirOk = (cur?.approvals || []).some((a) => a.by === 'DIRECTOR' && a.decision === 'APPROVED');
  const st = (k) => {
    if (d.status === 'APPROVED') return 'done';
    if (d.status === 'CHANGES_REQUESTED') return k === 'prep' ? 'now' : last?.by === (k === 'dir' ? 'DIRECTOR' : 'CLIENT') ? 'bad' : k === 'dir' && dirOk ? 'done' : 'todo';
    if (d.status === 'DRAFT') return k === 'prep' ? 'now' : 'todo';
    if (k === 'prep') return 'done';
    if (k === 'dir') return d.awaiting === 'DIRECTOR' ? 'now' : 'done';
    return d.awaiting === 'CUSTOMER' ? 'now' : 'todo';
  };
  const out = [['prep', 'Prepared'], ...(isCustomer ? [] : [['dir', 'Director']]), ...(d.customerVisible || isCustomer ? [['cli', 'Client']] : [])].map(([k, label]) => ({ k, label, state: st(k) }));
  return [...out, { k: 'end', label: 'Approved', state: d.status === 'APPROVED' ? 'done' : 'todo' }];
}

function Stepper({ items }) {
  return <ol className="ap-steps" aria-label="Approval steps">{items.map((x) => <li key={x.k} className={x.state}>
    <span className="b">{x.state === 'done' ? <Check size={11} strokeWidth={3} /> : x.state === 'bad' ? <X size={11} strokeWidth={3} /> : null}</span>{x.label}</li>)}</ol>;
}

const FILTERS = [['action', 'Needs action'], ['review', 'In review'], ['changes', 'Changes requested'], ['approved', 'Approved'], ['draft', 'Drafts'], ['all', 'All']];

/**
 * Approvals: one place for everything that needs a decision on this project — the plan, documents and
 * change requests — with who has to act next and the action right there.
 */
export function Deliverables() {
  const { project, can } = useProject();
  const { isCustomer, user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get(`/projects/${project.id}/deliverables`), [project.id]);
  const plan = useLoad(() => (isCustomer ? Promise.resolve(null) : get(`/projects/${project.id}/plan`)), [project.id]);
  const crs = useLoad(() => (isCustomer || !can('register.view') ? Promise.resolve({ data: [] }) : get(`/projects/${project.id}/registers/change-requests`)), [project.id]);
  const [creating, setCreating] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [filter, setFilter] = useState(null);
  const act = async (fn, msg) => { try { await fn(); toast(msg, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } };
  const manage = data?.canManage && !project.readOnly;
  const docs = data?.data || [];
  const mine = (d) => (d.canReviewNow && !project.readOnly) || (manage && (d.status === 'DRAFT' || d.status === 'CHANGES_REQUESTED'));
  const match = { action: mine, review: (d) => d.status === 'IN_REVIEW', changes: (d) => d.status === 'CHANGES_REQUESTED', approved: (d) => d.status === 'APPROVED', draft: (d) => d.status === 'DRAFT', all: () => true };
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, docs.filter(match[k]).length]));
  const f = filter ?? (counts.action ? 'action' : 'all');
  const shown = docs.filter(match[f]);
  const decider = can('change.decide') && !project.readOnly;
  const pendingCrs = (crs.data?.data || []).filter((r) => ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status));
  const decideCr = (r, status) => act(() => patch(`/projects/${project.id}/registers/change-requests/${r.id}`, { status }), `Change request ${status === 'APPROVED' ? 'approved' : 'rejected'}`).then(() => crs.reload());
  const toggle = (id) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const p = plan.data;
  const dirName = data?.director?.name || p?.director?.name || 'the project director';
  const planState = !p ? null : p.approved ? ['done', 'Approved and locked', `by ${p.approvedBy?.name || dirName} on ${fmtDate(p.approvedAt)}`]
    : p.submitted ? ['now', `Waiting for ${dirName}`, `sent by ${p.submittedBy?.name || 'the manager'} ${fmtRelative(p.submittedAt)}`]
      : p.returnedAt ? ['bad', 'Sent back for changes', p.returnNote || ''] : ['todo', 'Being built', 'not sent for approval yet'];
  return (
    <>
      {!isCustomer && <div className="ap-flow">
        <div><span className="n">1</span><b>The project manager prepares</b><span>the plan, documents and change requests</span></div>
        <div><span className="n">2</span><b>{dirName} approves</b><span>or sends it back with a note</span></div>
        {project.customerVisible && <div><span className="n">3</span><b>The client signs off</b><span>documents shared with them</span></div>}
      </div>}

      {!isCustomer && (p || pendingCrs.length > 0) && <div className="row g-3 mb-3">
        {p && <div className="col-lg-6"><div className={`ap-item plan ${planState[0]}`}>
          <span className="ap-ic"><ListChecks size={18} /></span>
          <div className="min-w-0 flex-grow-1"><div className="fw-semibold">Project plan</div><div className="small text-muted truncate">{planState[1]} · {planState[2]}</div></div>
          <Link to={`/projects/${project.id}/plan`} className={`btn btn-sm ${p.canApprove || p.canSubmit ? 'btn-primary' : 'btn-light'}`}>{p.canApprove ? 'Review the plan' : p.canSubmit ? 'Send for approval' : 'Open the plan'}</Link>
        </div></div>}
        <div className="col-lg-6"><div className={`ap-item ${pendingCrs.length ? 'now' : 'done'}`}>
          <span className="ap-ic"><GitPullRequest size={18} /></span>
          <div className="min-w-0 flex-grow-1"><div className="fw-semibold">Change requests</div><div className="small text-muted">{pendingCrs.length ? `${pendingCrs.length} waiting for ${dirName}` : 'Nothing waiting for a decision'}</div></div>
          <Link to={`/projects/${project.id}/risks?tab=change-requests`} className="btn btn-sm btn-light">Open the register</Link>
        </div>
          {pendingCrs.length > 0 && <ul className="ap-crs">{pendingCrs.slice(0, 4).map((r) => <li key={r.id}>
            <span className="truncate flex-grow-1"><b>{r.title}</b>{r.scheduleImpactDays ? <span className="text-muted small"> · +{r.scheduleImpactDays} days</span> : null}</span>
            {decider && (r.createdById !== user?.id || project.role === 'ADMIN') ? <><button className="btn btn-sm btn-outline-success" onClick={() => decideCr(r, 'APPROVED')}>Approve</button><button className="btn btn-sm btn-outline-danger" onClick={() => decideCr(r, 'REJECTED')}>Reject</button></>
              : <span className="small text-muted">with the director</span>}</li>)}</ul>}
        </div>
      </div>}

      <div className="ap-docs-head">
        <h3><FileCheck2 size={17} /> Documents for sign-off</h3>
        {docs.length > 0 && <div className="ap-filters" role="tablist" aria-label="Show documents">{FILTERS.filter(([k]) => k === 'all' || counts[k] || k === f).map(([k, label]) => <button key={k} role="tab" aria-selected={f === k} className={f === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}<span>{counts[k]}</span></button>)}</div>}
        {manage && <button className="btn btn-sm btn-primary ms-auto" onClick={() => setCreating({ name: '', description: '', dueDate: '', customerVisible: project.customerVisible, phaseId: '' })}><Plus size={14} /> New document</button>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : docs.length === 0 ? <div className="card"><Empty icon={FileCheck2} title="Nothing to approve yet">{isCustomer ? 'When your team sends something for sign-off, it shows up here.' : 'Add a document (a charter, a design, a test report), attach the file and send it to the director.'}</Empty></div>
        : shown.length === 0 ? <div className="card"><Empty icon={CheckCircle2} title="Nothing here">Try another filter.</Empty></div> : (
          <div className="ap-docs">{shown.map((d) => {
            const cur = d.versions[0];
            const files = cur?.files?.length || 0;
            const isOpen = open.has(d.id);
            const late = d.dueDate && d.dueDate < todayISO() && d.status !== 'APPROVED';
            const lastNote = cur?.approvals?.filter((a) => a.decision === 'CHANGES_REQUESTED').at(-1);
            return (
              <article key={d.id} className={`ap-doc ${mine(d) ? 'mine' : ''}`}>
                <div className="ap-doc-main">
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggle(d.id)} aria-expanded={isOpen} aria-label={isOpen ? `Hide details of ${d.name}` : `Show details of ${d.name}`}>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                  <span className="ap-ic doc"><FileText size={17} /></span>
                  <div className="min-w-0 flex-grow-1">
                    <div className="d-flex align-items-center gap-2 flex-wrap"><button className="ap-name" onClick={() => toggle(d.id)}>{d.name}</button><StatusBadge status={d.status} />
                      {!isCustomer && (d.customerVisible ? <span className="pill pill-sky"><Globe size={11} /> Director, then client</span> : <span className="pill pill-neutral"><Lock size={11} /> Internal</span>)}</div>
                    <div className="small text-muted">{cur ? `Version ${d.currentVersion} · ${files} file${files === 1 ? '' : 's'}` : 'No version yet'}{d.dueDate ? <span className={late ? 'text-danger fw-semibold' : ''}> · due {fmtDate(d.dueDate)}</span> : ''}{d.phaseId && project.phases.find((x) => x.id === d.phaseId) ? ` · ${project.phases.find((x) => x.id === d.phaseId).name}` : ''}</div>
                  </div>
                  <Stepper items={steps(d, isCustomer)} />
                  <div className="ap-act">
                    {d.canReviewNow && !project.readOnly && <><button className="btn btn-sm btn-success" onClick={() => setReviewing({ d, initial: 'APPROVED' })}><CheckCircle2 size={14} /> Approve</button>
                      <button className="btn btn-sm btn-outline-warning" onClick={() => setReviewing({ d, initial: 'CHANGES_REQUESTED' })}>Request changes</button></>}
                    {manage && d.status === 'DRAFT' && cur && (files ? <button className="btn btn-sm btn-primary" onClick={() => act(() => post(`/projects/${project.id}/deliverables/${d.id}/submit`), `Sent to ${d.customerVisible && !project.directorId ? 'the client' : dirName}`)}><Send size={13} /> Send for approval</button>
                      : <button className="btn btn-sm btn-outline-primary" onClick={() => setOpen((o) => new Set(o).add(d.id))}><Paperclip size={13} /> Attach the file</button>)}
                    {manage && (!cur || d.status === 'CHANGES_REQUESTED' || d.status === 'APPROVED') && <button className={`btn btn-sm ${d.status === 'CHANGES_REQUESTED' || !cur ? 'btn-primary' : 'btn-light'}`} onClick={() => act(async () => { await post(`/projects/${project.id}/deliverables/${d.id}/versions`, {}); setOpen((o) => new Set(o).add(d.id)); }, `Version ${d.currentVersion + 1} ready — attach the file`)}><Upload size={13} /> {cur ? 'Upload a new version' : 'Add the file'}</button>}
                    {!d.canReviewNow && !mine(d) && d.awaiting && !isCustomer && <span className="small text-muted text-nowrap">{d.awaiting === 'DIRECTOR' ? `With ${dirName}` : 'With the client'}</span>}
                  </div>
                </div>
                {lastNote && d.status === 'CHANGES_REQUESTED' && <div className="ap-note"><RotateCcw size={14} /><div><b>{lastNote.reviewer}</b> asked for changes: {lastNote.comment}</div></div>}
                {isOpen && <div className="ap-doc-body">
                  {d.description && <p className="small mb-2">{d.description}</p>}
                  {d.versions.length === 0 ? <div className="small text-muted">No versions yet.</div> : d.versions.map((v, i) => (
                    <div key={v.id} className={`ap-ver ${i ? 'old' : ''}`}>
                      <div className="d-flex justify-content-between small mb-1"><strong>Version {v.versionNumber}{i === 0 && ' (current)'}</strong><span className="text-muted">{v.createdBy} · {fmtDateTime(v.createdAt)}</span></div>
                      {v.note && <div className="small mb-1">{v.note}</div>}
                      {i === 0 && manage && d.status === 'DRAFT' ? <FileList targetType="deliverableVersion" targetId={v.id} compact onChange={reload} /> : <FileList targetType="deliverableVersion" targetId={v.id} compact />}
                      {v.approvals.map((a, k) => <div key={k} className={`ap-dec ${a.decision === 'APPROVED' ? 'ok' : 'warn'}`}>{a.decision === 'APPROVED' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}<div><strong>{a.reviewer}</strong>{!isCustomer && <span className="text-muted"> ({a.by === 'CLIENT' ? 'client' : 'director'})</span>} {a.decision === 'APPROVED' ? 'approved' : 'requested changes'} · {fmtDateTime(a.createdAt)}{a.comment && <div className="mt-1" style={{ whiteSpace: 'pre-wrap' }}>{a.comment}</div>}</div></div>)}
                    </div>))}
                </div>}
              </article>);
          })}</div>)}
      {creating && <Modal open onClose={() => setCreating(null)} title="New document for sign-off" footer={<><button className="btn btn-light" onClick={() => setCreating(null)}>Cancel</button><button className="btn btn-primary" disabled={!creating.name.trim()} onClick={() => act(async () => { const d = await post(`/projects/${project.id}/deliverables`, { ...creating, dueDate: creating.dueDate || null, phaseId: creating.phaseId || null, description: creating.description || null }); setCreating(null); setFilter('all'); setOpen((o) => new Set(o).add(d.id)); }, 'Created — now attach the file')}>Create</button></>}>
        <Field label="Name">{(id) => <input id={id} className="form-control" placeholder="e.g. Solution design" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} autoFocus />}</Field>
        <Field label="Description (optional)">{(id) => <textarea id={id} className="form-control" rows={2} value={creating.description} onChange={(e) => setCreating({ ...creating, description: e.target.value })} />}</Field>
        <div className="row"><div className="col-6"><Field label="Needed by">{(id) => <input id={id} type="date" className="form-control" value={creating.dueDate} onChange={(e) => setCreating({ ...creating, dueDate: e.target.value })} />}</Field></div>
          <div className="col-6"><Field label="Stage">{(id) => <Select id={id} value={creating.phaseId} onChange={(v) => setCreating({ ...creating, phaseId: v || '' })} placeholder="None" options={project.phases.map((ph) => ({ value: ph.id, label: ph.name }))} />}</Field></div></div>
        <div className="form-check form-switch"><input className="form-check-input" type="checkbox" id="dcv" disabled={!project.customerVisible} checked={creating.customerVisible} onChange={(e) => setCreating({ ...creating, customerVisible: e.target.checked })} /><label className="form-check-label" htmlFor="dcv">The client signs it off too (after {dirName}){!project.customerVisible && <span className="text-muted"> — turn on client access for the project first</span>}</label></div>
        <div className="form-text mt-2">Next: attach the file, then send it for approval.</div>
      </Modal>}
      {reviewing && <ReviewModal d={reviewing.d} initial={reviewing.initial} onClose={() => setReviewing(null)} onDone={(dec) => { toast(dec === 'APPROVED' ? 'Approved' : 'Sent back for changes', 'success'); reload(); }} />}
    </>
  );
}

function StatusUpdates() {
  const { project, can, reload: reloadProject } = useProject();
  const { isCustomer } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get(`/projects/${project.id}/updates`), [project.id]);
  const [f, setF] = useState(null);
  const publish = async () => { try { await post(`/projects/${project.id}/updates`, f); toast('Update posted', 'success'); setF(null); reload(); reloadProject(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      {can('update.publish') && !project.readOnly && <div className="d-flex justify-content-end mb-3"><button className="btn btn-sm btn-primary" onClick={() => setF({ title: '', body: '', health: project.health, customerVisible: false, applyHealth: true })}><Megaphone size={14} /> Post an update</button></div>}
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <div className="card"><Empty icon={Megaphone} title="No updates yet">{isCustomer ? 'Your project team will post progress here.' : 'A short weekly note keeps everyone in the loop.'}</Empty></div> : (
        <div className="d-flex flex-column gap-3">{data.data.map((u) => (
          <article key={u.id} className="card p-3">
            <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
              <Avatar sm name={u.author?.name} /><strong>{u.author?.name}</strong><span className="small text-muted">{fmtRelative(u.createdAt)}</span>
              <span className="ms-auto d-flex gap-2"><HealthBadge health={u.health} />{!isCustomer && (u.customerVisible ? <span className="pill pill-sky"><Globe size={11} /> Shared with client</span> : <span className="pill pill-neutral"><Lock size={11} /> Team only</span>)}</span>
            </div>
            <h3 className="h6 fw-bold mb-1">{u.title}</h3>
            <div style={{ whiteSpace: 'pre-wrap' }}>{u.body}</div>
          </article>))}</div>)}
      {f && <Modal open size="lg" onClose={() => setF(null)} title="Post an update" footer={<><button className="btn btn-light" onClick={() => setF(null)}>Cancel</button><button className="btn btn-primary" disabled={!f.title.trim() || !f.body.trim()} onClick={publish}>Post</button></>}>
        <Field label="Headline">{(id) => <input id={id} className="form-control" placeholder="Design signed off, build starts Monday" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="What happened, what's next">{(id) => <textarea id={id} rows={6} className="form-control" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <div className="mb-3"><Segmented label="How is it going?" value={f.health} onChange={(v) => setF({ ...f, health: v })} options={[['GREEN', 'On track'], ['AMBER', 'At risk'], ['RED', 'Off track']]} /></div>
        <div className="form-check mb-2"><input className="form-check-input" type="checkbox" id="ah" checked={f.applyHealth} onChange={(e) => setF({ ...f, applyHealth: e.target.checked })} /><label className="form-check-label" htmlFor="ah">Also update the project's status</label></div>
        <div className="form-check form-switch"><input className="form-check-input" type="checkbox" id="ucv" disabled={!project.customerVisible} checked={f.customerVisible} onChange={(e) => setF({ ...f, customerVisible: e.target.checked })} /><label className="form-check-label" htmlFor="ucv">Share with client {!project.customerVisible && <span className="text-muted">(client access is off for this project)</span>}</label></div>
      </Modal>}
    </>
  );
}

function Conversations() {
  const { project, people, can } = useProject();
  const { isCustomer } = useAuth();
  const { discussionId } = useParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => get(`/projects/${project.id}/discussions`), [project.id]);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const create = async () => { setErr(null); try { const d = await post(`/projects/${project.id}/discussions`, { ...f, visibility: isCustomer ? 'PUBLIC' : f.visibility }); setF(null); reload(); nav(`/projects/${project.id}/updates/${d.id}`); } catch (e) { setErr(e); } };
  const current = data?.data.find((d) => d.id === discussionId);
  return (
    <div className="row g-3">
      <div className="col-lg-4"><Card title="Conversations" actions={!project.readOnly && <button className="btn btn-sm btn-primary" onClick={() => setF({ title: '', body: '', visibility: isCustomer ? 'PUBLIC' : 'INTERNAL' })}><Plus size={14} /> New</button>} bodyClass="p-0">
        <ErrorBox error={error} />
        {loading && !data ? <div className="p-3"><Loading /></div> : data?.data.length === 0 ? <Empty icon={MessagesSquare} title="No conversations yet" /> : (
          <ul className="list-plain px-3">{data.data.map((d) => <li key={d.id}><Link to={`/projects/${project.id}/updates/${d.id}`} className={`flex-grow-1 truncate ${d.id === discussionId ? 'fw-bold' : ''}`}>{d.title}</Link>
            {!isCustomer && (d.visibility === 'INTERNAL' ? <Lock size={12} className="text-muted" aria-label="Team only" /> : <Globe size={12} className="text-primary" aria-label="Shared with client" />)}<span className="small text-muted">{d.comments}</span></li>)}</ul>)}
      </Card></div>
      <div className="col-lg-8">{current ? <Card title={<span className="d-flex align-items-center gap-2">{current.title}{!isCustomer && (current.visibility === 'INTERNAL' ? <span className="pill pill-neutral"><Lock size={11} /> Team only</span> : <span className="pill pill-sky"><Globe size={11} /> Shared with client</span>)}</span>}>
        <CommentThread targetType="discussion" targetId={current.id} people={current.visibility === 'INTERNAL' ? people.filter((p) => p.role !== 'CUSTOMER') : people} /></Card>
        : <div className="card"><Empty icon={MessagesSquare} title="Pick a conversation">{isCustomer ? 'Ask your project team anything here.' : 'Team-only conversations are never shown to the client.'}</Empty></div>}</div>
      {f && <Modal open size="lg" onClose={() => setF(null)} title="Start a conversation" footer={<><button className="btn btn-light" onClick={() => setF(null)}>Cancel</button><button className="btn btn-primary" disabled={!f.title.trim() || !f.body.trim()} onClick={create}>Start</button></>}>
        <ErrorBox error={err} />
        <Field label="Topic">{(id) => <input id={id} className="form-control" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Message" hint="Type @ to mention someone.">{(id) => <MentionTextarea id={id} value={f.body} onChange={(v) => setF({ ...f, body: v })} people={f.visibility === 'INTERNAL' && !isCustomer ? people.filter((p) => p.role !== 'CUSTOMER') : people} rows={4} />}</Field>
        {!isCustomer && <VisibilityToggle value={f.visibility} onChange={(v) => setF({ ...f, visibility: v })} canInternal={can('comment.internal')} canPublic={project.customerVisible} publicHint="Turn on client access for this project first" />}
      </Modal>}
    </div>
  );
}

/** Updates tab: status posts and conversations in one place. */
export function UpdatesTab() {
  const { discussionId } = useParams();
  const [view, setView] = useState(discussionId ? 'talk' : 'posts');
  const v = discussionId ? 'talk' : view;
  const nav = useNavigate();
  const { project } = useProject();
  return (
    <>
      <div className="mb-3"><Segmented label="Show" value={v} onChange={(x) => { setView(x); if (x === 'posts' && discussionId) nav(`/projects/${project.id}/updates`); }} options={[['posts', 'Status updates', Megaphone], ['talk', 'Conversations', MessagesSquare]]} /></div>
      {v === 'posts' ? <StatusUpdates /> : <Conversations />}
    </>
  );
}

export function ProjectFiles() {
  const { project } = useProject();
  return <Card title="Project files"><FileList targetType="project" targetId={project.id} /><div className="form-text mt-2">Files attached to work items, tickets and deliverables are kept with those records.</div></Card>;
}
