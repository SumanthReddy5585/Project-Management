import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { FileCheck2, Plus, Send, MessagesSquare, Lock, Globe, Megaphone, CheckCircle2, XCircle } from 'lucide-react';
import { get, post, patch } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtDateTime, fmtRelative } from '../../lib/format.js';
import { Card, Empty, ErrorBox, Field, Loading, Modal, Select, StatusBadge, useToast, Avatar, HealthBadge, Segmented } from '../../components/ui.jsx';
import { CommentThread, FileList, MentionTextarea, VisibilityToggle } from '../../components/collab.jsx';
import { useProject } from './Workspace.jsx';

function ReviewModal({ d, onClose, onDone }) {
  const { project } = useProject();
  const [decision, setDecision] = useState('APPROVED');
  const [comment, setComment] = useState('');
  const [err, setErr] = useState(null);
  const submit = async () => { setErr(null); try { await post(`/projects/${project.id}/deliverables/${d.id}/review`, { versionNumber: d.currentVersion, decision, comment: comment || undefined }); onDone(); onClose(); } catch (e) { setErr(e); } };
  return (
    <Modal open onClose={onClose} title={`${d.name} · version ${d.currentVersion}`} footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={decision === 'CHANGES_REQUESTED' && !comment.trim()}>Submit</button></>}>
      <ErrorBox error={err} />
      <p className="small text-muted">Your decision applies to version {d.currentVersion} only and is recorded with your name and the time.</p>
      <fieldset className="mb-3"><legend className="form-label">Decision</legend>
        <div className="form-check"><input className="form-check-input" type="radio" name="dec" id="dec-a" checked={decision === 'APPROVED'} onChange={() => setDecision('APPROVED')} /><label className="form-check-label" htmlFor="dec-a">Approve</label></div>
        <div className="form-check"><input className="form-check-input" type="radio" name="dec" id="dec-c" checked={decision === 'CHANGES_REQUESTED'} onChange={() => setDecision('CHANGES_REQUESTED')} /><label className="form-check-label" htmlFor="dec-c">Request changes</label></div></fieldset>
      <Field label={decision === 'CHANGES_REQUESTED' ? 'What needs to change? (required)' : 'Comments (optional)'}>{(id) => <textarea id={id} className="form-control" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />}</Field>
    </Modal>
  );
}

export function Deliverables() {
  const { project } = useProject();
  const { isCustomer } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get(`/projects/${project.id}/deliverables`), [project.id]);
  const [creating, setCreating] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const act = async (fn, msg) => { try { await fn(); toast(msg, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } };
  const manage = data?.canManage && !project.readOnly;
  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3"><div className="small text-muted">{isCustomer ? 'Things waiting for your sign-off.' : 'Upload a file, send it for sign-off, and see who approved what.'}</div>
        {manage && <button className="btn btn-sm btn-primary" onClick={() => setCreating({ name: '', description: '', dueDate: '', customerVisible: project.customerVisible, phaseId: '' })}><Plus size={14} /> New approval</button>}</div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <div className="card"><Empty icon={FileCheck2} title="Nothing to approve yet">{isCustomer ? 'When your team sends something for sign-off, it shows up here.' : 'Create one when you have a document or design for someone to sign off.'}</Empty></div> : (
        <div className="d-flex flex-column gap-3">{data.data.map((d) => {
          const cur = d.versions[0];
          return (
            <Card key={d.id} title={<span className="d-flex align-items-center gap-2">{d.name} <StatusBadge status={d.status} />{!isCustomer && (d.customerVisible ? <span className="pill pill-sky"><Globe size={11} /> Client signs off</span> : <span className="pill pill-neutral"><Lock size={11} /> Team sign-off</span>)}</span>}
              actions={<div className="d-flex gap-2">
                {manage && ['DRAFT', 'CHANGES_REQUESTED', 'APPROVED'].includes(d.status) && <button className="btn btn-sm btn-light" onClick={() => act(() => post(`/projects/${project.id}/deliverables/${d.id}/versions`, {}), `Version ${d.currentVersion + 1} created`)}>New version</button>}
                {manage && d.status === 'DRAFT' && cur && <button className="btn btn-sm btn-outline-primary" disabled={!cur.files.length} title={!cur.files.length ? 'Attach a file first' : undefined} onClick={() => act(() => post(`/projects/${project.id}/deliverables/${d.id}/submit`), 'Sent for sign-off')}><Send size={13} /> Send for sign-off</button>}
                {data.canReview && d.status === 'IN_REVIEW' && (isCustomer || !d.customerVisible || project.role === 'ADMIN') && <button className="btn btn-sm btn-primary" onClick={() => setReviewing(d)}>Approve or request changes</button>}
              </div>}>
              <div className="small text-muted mb-2">{d.dueDate ? `Due ${fmtDate(d.dueDate)}` : 'No due date'}{d.description && ` · ${d.description}`}</div>
              {d.versions.length === 0 ? <div className="small text-muted">{manage ? 'Click "New version" to attach files.' : 'No versions yet.'}</div> : d.versions.map((v, i) => (
                <div key={v.id} className={`border rounded p-2 mb-2 ${i ? 'opacity-75' : ''}`}>
                  <div className="d-flex justify-content-between small mb-1"><strong>Version {v.versionNumber}{i === 0 && ' (current)'}</strong><span className="text-muted">{v.createdBy} · {fmtDateTime(v.createdAt)}</span></div>
                  {v.note && <div className="small mb-1">{v.note}</div>}
                  {i === 0 && manage && d.status === 'DRAFT' ? <FileList targetType="deliverableVersion" targetId={v.id} compact onChange={reload} /> : <FileList targetType="deliverableVersion" targetId={v.id} compact />}
                  {v.approvals.map((a, k) => <div key={k} className={`notice ${a.decision === 'APPROVED' ? 'info' : 'warn'} mt-2`}>{a.decision === 'APPROVED' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<div><strong>{a.reviewer}</strong> {a.decision === 'APPROVED' ? 'approved' : 'requested changes on'} v{v.versionNumber} · {fmtDateTime(a.createdAt)}{a.comment && <div className="mt-1" style={{ whiteSpace: 'pre-wrap' }}>{a.comment}</div>}</div></div>)}
                </div>))}
            </Card>);
        })}</div>)}
      {creating && <Modal open onClose={() => setCreating(null)} title="New approval" footer={<><button className="btn btn-light" onClick={() => setCreating(null)}>Cancel</button><button className="btn btn-primary" disabled={!creating.name.trim()} onClick={() => act(async () => { await post(`/projects/${project.id}/deliverables`, { ...creating, dueDate: creating.dueDate || null, phaseId: creating.phaseId || null, description: creating.description || null }); setCreating(null); }, 'Approval created')}>Create</button></>}>
        <Field label="Name">{(id) => <input id={id} className="form-control" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />}</Field>
        <Field label="Description">{(id) => <textarea id={id} className="form-control" value={creating.description} onChange={(e) => setCreating({ ...creating, description: e.target.value })} />}</Field>
        <div className="row"><div className="col-6"><Field label="Due date">{(id) => <input id={id} type="date" className="form-control" value={creating.dueDate} onChange={(e) => setCreating({ ...creating, dueDate: e.target.value })} />}</Field></div>
          <div className="col-6"><Field label="Phase">{(id) => <Select id={id} value={creating.phaseId} onChange={(v) => setCreating({ ...creating, phaseId: v || '' })} placeholder="None" options={project.phases.map((p) => ({ value: p.id, label: p.name }))} />}</Field></div></div>
        <div className="form-check form-switch"><input className="form-check-input" type="checkbox" id="dcv" disabled={!project.customerVisible} checked={creating.customerVisible} onChange={(e) => setCreating({ ...creating, customerVisible: e.target.checked })} /><label className="form-check-label" htmlFor="dcv">Client signs this off</label></div>
      </Modal>}
      {reviewing && <ReviewModal d={reviewing} onClose={() => setReviewing(null)} onDone={() => { toast('Decision recorded', 'success'); reload(); }} />}
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
