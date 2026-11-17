import { useEffect, useState } from 'react';
import { Link2, Trash2, Plus, Lock, Globe, AlertTriangle } from 'lucide-react';
import { get, patch, post, del, put } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtHours, labelize } from '../../lib/format.js';
import { Drawer, ErrorBox, Loading, StatusBadge, PriorityBadge, TypeTag, Meter, Field, Select, useToast, ConfirmButton, Notice } from '../../components/ui.jsx';
import { CommentThread, FileList } from '../../components/collab.jsx';
import { useProject } from './Workspace.jsx';

const STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED'];

export function WorkItemDrawer({ itemId, onClose }) {
  const { project, can, people, assignable, openItem, reload: reloadProject } = useProject();
  const { isCustomer } = useAuth();
  const toast = useToast();
  const { data: it, error, loading, reload, setData } = useLoad(() => (itemId ? get(`/projects/${project.id}/work-items/${itemId}`) : Promise.resolve(null)), [itemId]);
  const [edit, setEdit] = useState(null);
  const [depFor, setDepFor] = useState('');
  const all = useLoad(() => (itemId && !isCustomer ? get(`/projects/${project.id}/work-items`, { all: 'true' }) : Promise.resolve(null)), [itemId]);
  useEffect(() => { setEdit(null); }, [itemId]);
  if (!itemId) return null;
  const save = async (changes) => {
    try {
      const r = await patch(`/projects/${project.id}/work-items/${it.id}`, { ...changes, version: it.version });
      setData((d) => ({ ...d, ...r }));
      if (r.downstreamConflicts?.length) toast(`${r.downstreamConflicts.length} successor(s) now start too early. Use Timeline → reschedule to preview the impact.`, 'error');
      else toast('Saved', 'success');
      reload(); reloadProject();
      return true;
    } catch (e) { toast(e.status === 409 ? 'Someone else changed this item — reloaded the latest version.' : e.message, 'error'); if (e.status === 409) reload(); return false; }
  };
  const header = it && <>
    <div className="d-flex align-items-center gap-2 small text-muted mb-1"><TypeTag type={it.type} /><span className="mono">{it.key}</span>
      {it.ancestors?.map((a) => <button key={a.id} className="btn btn-link btn-sm p-0" onClick={() => openItem(a.id)}>› {a.title}</button>)}</div>
    <h2 className="h5 mb-2">{it.title}</h2>
    <div className="d-flex gap-2 align-items-center flex-wrap"><StatusBadge status={it.status} />{!isCustomer && <PriorityBadge priority={it.priority} />}
      {!isCustomer && (it.customerVisible ? <span className="pill pill-blue"><Globe size={10} /> Customer-visible</span> : <span className="pill pill-warn"><Lock size={10} /> Internal only</span>)}</div>
  </>;
  const canEdit = it?.canEdit && !project.readOnly;
  const manager = can('work.editAny');
  return (
    <Drawer open onClose={onClose} header={header || <span>Loading…</span>}>
      <ErrorBox error={error} />
      {loading && !it && <Loading rows={5} />}
      {it && <>
        {it.scheduleConflicts?.length > 0 && <Notice tone="warn" icon={AlertTriangle}>Starts before its predecessor finishes. Earliest allowed start: {fmtDate(it.scheduleConflicts[0].earliestStart)}.</Notice>}
        <div className="row g-3 mt-1 mb-3">
          <div className="col-sm-6"><div className="small-caps mb-1">Progress</div><Meter value={it.progress} />{it.children.length > 0 && <div className="form-text">Rolled up from {it.children.length} child item(s).</div>}</div>
          {!isCustomer && <div className="col-sm-6"><div className="small-caps mb-1">Effort</div><div>{it.estimateHours != null ? fmtHours(it.estimateHours) : 'No estimate'} estimated · {fmtHours(it.actualHours)} logged</div></div>}
        </div>
        {canEdit && it.type !== 'MODULE' && it.children.length === 0 && (
          <div className="d-flex gap-2 align-items-end flex-wrap mb-3 p-2 border rounded">
            <Field label="Status" className="mb-0">{(id) => <Select id={id} value={it.status} onChange={(v) => save({ status: v })} options={STATUSES.map((s) => ({ value: s, label: labelize(s) }))} />}</Field>
            {it.type !== 'MILESTONE' && <Field label="% complete" className="mb-0">{(id) => <input id={id} type="number" min="0" max="100" step="5" className="form-control" style={{ width: 100 }} defaultValue={it.percentComplete} key={it.version} onBlur={(e) => Number(e.target.value) !== it.percentComplete && save({ percentComplete: Number(e.target.value) })} />}</Field>}
            <div className="form-text mb-1">Done sets 100%; 100% without Done moves to In review.</div>
          </div>)}
        <dl className="kv mb-3">
          {!isCustomer && <><dt>Assignee</dt><dd>{manager && canEdit ? <Select aria-label="Assignee" value={it.assigneeId} onChange={(v) => save({ assigneeId: v })} placeholder="Unassigned" options={assignable.map((m) => ({ value: m.id, label: m.name }))} /> : people.find((m) => m.id === it.assigneeId)?.name || 'Unassigned'}</dd></>}
          <dt>Planned</dt><dd>{fmtDate(it.plannedStart)} → {fmtDate(it.plannedFinish)}</dd>
          {!isCustomer && <><dt>Actual</dt><dd>{fmtDate(it.actualStart)} → {fmtDate(it.actualFinish)}</dd><dt>Phase</dt><dd>{it.phase?.name || '—'}</dd>
            {it.labels?.length > 0 && <><dt>Labels</dt><dd className="d-flex gap-1 flex-wrap">{it.labels.map((l) => <span key={l} className="pill pill-outline">{l}</span>)}</dd></>}</>}
        </dl>
        {manager && canEdit && !edit && <button className="btn btn-sm btn-light mb-3" onClick={() => setEdit({ title: it.title, description: it.description || '', acceptanceCriteria: it.acceptanceCriteria || '', plannedStart: it.plannedStart || '', plannedFinish: it.plannedFinish || '', estimateHours: it.estimateHours ?? '', priority: it.priority, customerVisible: it.customerVisible, labels: (it.labels || []).join(', ') })}>Edit details</button>}
        {edit && <form className="border rounded p-3 mb-3" onSubmit={async (e) => { e.preventDefault(); const ok = await save({ title: edit.title, description: edit.description || null, acceptanceCriteria: edit.acceptanceCriteria || null, plannedStart: edit.plannedStart || null, plannedFinish: edit.plannedFinish || null, estimateHours: edit.estimateHours === '' ? null : Number(edit.estimateHours), priority: edit.priority, customerVisible: edit.customerVisible, labels: edit.labels.split(',').map((s) => s.trim()).filter(Boolean) }); if (ok) setEdit(null); }}>
          <Field label="Title">{(id) => <input id={id} className="form-control" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}</Field>
          <div className="row"><div className="col-6"><Field label="Planned start">{(id) => <input id={id} type="date" className="form-control" value={edit.plannedStart} onChange={(e) => setEdit({ ...edit, plannedStart: e.target.value })} />}</Field></div>
            <div className="col-6"><Field label="Planned finish" hint="Changing dates never moves other items.">{(id) => <input id={id} type="date" className="form-control" value={edit.plannedFinish} onChange={(e) => setEdit({ ...edit, plannedFinish: e.target.value })} />}</Field></div>
            {it.type !== 'MILESTONE' && <div className="col-6"><Field label="Estimate (hours)">{(id) => <input id={id} type="number" min="0" step="0.5" className="form-control" value={edit.estimateHours} onChange={(e) => setEdit({ ...edit, estimateHours: e.target.value })} />}</Field></div>}
            <div className="col-6"><Field label="Priority">{(id) => <Select id={id} value={edit.priority} onChange={(v) => setEdit({ ...edit, priority: v })} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: labelize(v) }))} />}</Field></div></div>
          <Field label="Description">{(id) => <textarea id={id} className="form-control" rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />}</Field>
          <Field label="Acceptance criteria">{(id) => <textarea id={id} className="form-control" rows={2} value={edit.acceptanceCriteria} onChange={(e) => setEdit({ ...edit, acceptanceCriteria: e.target.value })} />}</Field>
          <Field label="Labels" hint="Comma-separated">{(id) => <input id={id} className="form-control" value={edit.labels} onChange={(e) => setEdit({ ...edit, labels: e.target.value })} />}</Field>
          <div className="form-check form-switch mb-3"><input className="form-check-input" type="checkbox" role="switch" id="cv" checked={edit.customerVisible} disabled={!project.customerVisible} onChange={(e) => setEdit({ ...edit, customerVisible: e.target.checked })} /><label className="form-check-label" htmlFor="cv">Visible to customer {!project.customerVisible && '(project not shared)'}</label></div>
          <div className="d-flex gap-2"><button className="btn btn-primary btn-sm">Save</button><button type="button" className="btn btn-light btn-sm" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>}
        {!edit && it.description && <><h3 className="h-section">Description</h3><p style={{ whiteSpace: 'pre-wrap' }}>{it.description}</p></>}
        {!edit && it.acceptanceCriteria && <><h3 className="h-section">Acceptance criteria</h3><p style={{ whiteSpace: 'pre-wrap' }}>{it.acceptanceCriteria}</p></>}
        {it.children.length > 0 && <><h3 className="h-section mt-3">Child items</h3><ul className="list-plain mb-3">{it.children.map((c) => <li key={c.id}><TypeTag type={c.type} /><button className="btn btn-link p-0 text-start flex-grow-1 truncate" onClick={() => openItem(c.id)}>{c.title}</button><StatusBadge status={c.status} /><span className="small" style={{ width: 40 }}>{Math.round(c.progress ?? 0)}%</span></li>)}</ul></>}
        {!isCustomer && it.checklist && <Checklist it={it} canEdit={canEdit} reload={reload} projectId={project.id} />}
        {!isCustomer && it.dependencies && (
          <><h3 className="h-section mt-3">Dependencies <span className="text-muted text-lowercase fw-normal">(finish-to-start)</span></h3>
            <ul className="list-plain">{it.dependencies.map((d) => <li key={d.id}><span className="small-caps" style={{ width: 90 }}>{d.direction === 'predecessor' ? 'Waits for' : 'Blocks'}</span>
              <button className="btn btn-link p-0 text-start flex-grow-1 truncate" onClick={() => openItem(d.item.id)}>{d.item.title}</button><StatusBadge status={d.item.status} />
              {d.type !== 'FS' && <span className="pill pill-outline" title="Stored but not used in scheduling calculations">{d.type} · not scheduled</span>}
              {it.canSchedule && <ConfirmButton className="btn btn-sm btn-ghost btn-icon" title="Remove dependency?" confirmLabel="Remove" onConfirm={async () => { await del(`/projects/${project.id}/dependencies/${d.id}`); reload(); }}><Trash2 size={14} aria-label="Remove dependency" /></ConfirmButton>}</li>)}
              {it.dependencies.length === 0 && <li className="text-muted small">No dependencies.</li>}</ul>
            {it.canSchedule && !project.readOnly && it.type !== 'MODULE' && <form className="d-flex gap-2 mt-2" onSubmit={async (e) => { e.preventDefault(); if (!depFor) return; try { const r = await post(`/projects/${project.id}/dependencies`, { predecessorId: depFor, successorId: it.id }); toast(r.conflict ? 'Linked — this item now starts before its predecessor finishes' : 'Dependency added', r.conflict ? 'error' : 'success'); setDepFor(''); reload(); } catch (x) { toast(x.message, 'error'); } }}>
              <Select aria-label="Predecessor" value={depFor} onChange={(v) => setDepFor(v || '')} placeholder="Add predecessor…" options={(all.data?.data || []).filter((x) => x.id !== it.id && x.type !== 'MODULE' && !it.dependencies.some((d) => d.item.id === x.id)).map((x) => ({ value: x.id, label: `${x.key} ${x.title}` }))} />
              <button className="btn btn-sm btn-outline-primary" disabled={!depFor}><Link2 size={14} /> Link</button></form>}
          </>)}
        {!isCustomer && it.tickets?.length > 0 && <><h3 className="h-section mt-3">Linked tickets</h3><ul className="list-plain">{it.tickets.map((t) => <li key={t.id}><a href={`/tickets/${t.id}`} className="flex-grow-1">#{t.number} {t.subject}</a><span className="small text-muted">{t.linkType === 'CREATED_FROM' ? 'created from' : 'related'}</span><StatusBadge status={t.status} /></li>)}</ul></>}
        <h3 className="h-section mt-4">Attachments</h3>
        <FileList targetType="workItem" targetId={it.id} compact />
        <h3 className="h-section mt-4">Comments</h3>
        <CommentThread targetType="workItem" targetId={it.id} people={people} />
        {can('work.delete') && !project.readOnly && <div className="mt-4 pt-3 border-top"><ConfirmButton title={`Delete ${it.key}?`} message="This removes the item and its children. Items with logged time cannot be deleted — cancel them instead." confirmLabel="Delete" onConfirm={async () => { await del(`/projects/${project.id}/work-items/${it.id}`); onClose(); reloadProject(); toast('Deleted', 'success'); }}><Trash2 size={14} /> Delete item</ConfirmButton></div>}
      </>}
    </Drawer>
  );
}

function Checklist({ it, canEdit, reload, projectId }) {
  const [text, setText] = useState('');
  const base = `/projects/${projectId}/work-items/${it.id}/checklist`;
  const done = it.checklist.filter((c) => c.done).length;
  return (
    <><h3 className="h-section mt-3">Checklist {it.checklist.length > 0 && <span className="text-muted fw-normal">{done}/{it.checklist.length}</span>}</h3>
      <ul className="list-plain">{it.checklist.map((c) => <li key={c.id}><input type="checkbox" className="form-check-input m-0" id={`ck-${c.id}`} checked={c.done} disabled={!canEdit} onChange={async () => { await patch(`${base}/${c.id}`, { done: !c.done }); reload(); }} />
        <label htmlFor={`ck-${c.id}`} className={`flex-grow-1 ${c.done ? 'text-decoration-line-through text-muted' : ''}`}>{c.text}</label>
        {canEdit && <button className="btn btn-sm btn-ghost btn-icon" aria-label="Remove checklist item" onClick={async () => { await del(`${base}/${c.id}`); reload(); }}><Trash2 size={13} /></button>}</li>)}</ul>
      {canEdit && <form className="d-flex gap-2 mt-1" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await post(base, { text }); setText(''); reload(); }}>
        <input className="form-control form-control-sm" placeholder="Add checklist item" value={text} onChange={(e) => setText(e.target.value)} aria-label="New checklist item" /><button className="btn btn-sm btn-light" disabled={!text.trim()}><Plus size={14} /> Add</button></form>}
    </>
  );
}
