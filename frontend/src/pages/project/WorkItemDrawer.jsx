import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Trash2, Plus, Lock, Globe, AlertTriangle, Pencil, ListChecks } from 'lucide-react';
import { get, patch, post, del } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtHours, labelize } from '../../lib/format.js';
import { IssueDialog, StatusSelect, ErrorBox, Loading, StatusBadge, Meter, Select, useToast, ConfirmButton, Notice, CheckButton, DueChip, Avatar, ProjectChip, TypeIcon, PriorityIcon, priorityLabel } from '../../components/ui.jsx';
import { CommentThread, FileList } from '../../components/collab.jsx';
import { useProject } from './Workspace.jsx';
import { useDateChange, movedText } from './DateChange.jsx';

const STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED'];

/** A value that turns into an input when clicked (only when editable). Saves on blur / Enter. */
function InlineField({ value, display, type = 'text', canEdit, onSave, label, ...rest }) {
  const [editing, setEditing] = useState(false);
  if (!canEdit) return <span>{display ?? (value || '—')}</span>;
  if (!editing) return <button type="button" className="btn btn-ghost btn-sm px-2 py-1 text-start" onClick={() => setEditing(true)} aria-label={`Change ${label}`}>{display ?? (value || <span className="text-muted">Add</span>)}</button>;
  // A half-typed date reads as "" in the browser: cancel instead of clearing the date.
  const commit = (el) => { setEditing(false); if (type === 'date' && el.validity?.badInput) return; if (el.value !== (value ?? '')) onSave(el.value); };
  return <input autoFocus type={type} aria-label={label} className="form-control form-control-sm" style={{ maxWidth: 220 }} defaultValue={value ?? ''} {...rest}
    onBlur={(e) => commit(e.target)} onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget); if (e.key === 'Escape') setEditing(false); }} />;
}

function TextBlock({ title, value, canEdit, onSave, placeholder }) {
  const [draft, setDraft] = useState(null);
  if (draft !== null) return (
    <div className="mb-3"><h3 className="h-section">{title}</h3>
      <textarea className="form-control mb-2" rows={4} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={title} />
      <div className="d-flex gap-2"><button className="btn btn-sm btn-primary" onClick={async () => { if (await onSave(draft || null)) setDraft(null); }}>Save</button><button className="btn btn-sm btn-light" onClick={() => setDraft(null)}>Cancel</button></div></div>);
  if (!value && !canEdit) return null;
  return (
    <div className="mb-3"><h3 className="h-section d-flex align-items-center gap-2">{title}{canEdit && value && <button className="btn btn-ghost btn-icon p-1" aria-label={`Edit ${title}`} onClick={() => setDraft(value)}><Pencil size={13} /></button>}</h3>
      {value ? <p className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{value}</p> : <button className="btn btn-sm btn-light" onClick={() => setDraft('')}><Plus size={13} /> {placeholder}</button>}</div>);
}

export function WorkItemDrawer({ itemId, onClose }) {
  const { project, can, people, assignable, openItem, reload: reloadProject } = useProject();
  const { isCustomer } = useAuth();
  const toast = useToast();
  const { data: it, error, loading, reload, setData } = useLoad(() => (itemId ? get(`/projects/${project.id}/work-items/${itemId}`) : Promise.resolve(null)), [itemId]);
  const [depFor, setDepFor] = useState('');
  const [sub, setSub] = useState('');
  const [titleDraft, setTitleDraft] = useState(null);
  const [show, setShow] = useState({});
  const all = useLoad(() => (itemId && !isCustomer ? get(`/projects/${project.id}/work-items`, { all: 'true' }) : Promise.resolve(null)), [itemId]);
  useEffect(() => { setTitleDraft(null); setSub(''); setShow({}); }, [itemId]);
  const dates = useDateChange({ project, onChanged: (item) => { if (item) setData((d) => ({ ...d, ...item })); reload(); reloadProject(); } });
  if (!itemId) return null;
  const save = async (changes) => {
    const version = it.version;
    setData((d) => ({ ...d, ...changes })); // show the change immediately; the server response replaces it
    try {
      const r = await patch(`/projects/${project.id}/work-items/${it.id}`, { ...changes, version });
      setData((d) => ({ ...d, ...r }));
      const mv = movedText((r.rescheduled?.moved || []).filter((m) => m.id !== it.id && m.type !== 'MODULE'), project.code);
      toast(mv ? `Saved · ${mv}` : 'Saved', 'success');
      reload(); reloadProject();
      return true;
    } catch (e) { toast(e.status === 409 ? 'Someone else just changed this — showing the latest version.' : e.message, 'error'); reload(); return false; }
  };
  const canEdit = it?.canEdit && !project.readOnly;
  const manager = can('work.editAny');
  const leaf = it && it.type !== 'MODULE' && it.children.length === 0;
  const done = it?.status === 'DONE';
  const assignee = it && people.find((m) => m.id === it.assigneeId);

  const deleteBtn = it && can('work.delete') && !project.readOnly && <ConfirmButton title={`Delete "${it.title}"?`} message="This removes it and anything inside it. Items with logged time can't be deleted — set them to Cancelled instead." confirmLabel="Delete" onConfirm={async () => { await del(`/projects/${project.id}/work-items/${it.id}`); toast('Deleted', 'success'); onClose(); reloadProject(); }}><Trash2 size={14} /> Delete</ConfirmButton>;
  const crumbs = <>
    <Link to={`/projects/${project.id}`} className="d-inline-flex align-items-center gap-1"><ProjectChip code={project.code} size={16} />{project.name}</Link>
    {it?.ancestors?.map((a) => <span key={a.id} className="d-inline-flex align-items-center gap-1"><span className="sep">/</span><button className="btn btn-link btn-sm p-0" onClick={() => openItem(a.id)}>{a.title}</button></span>)}
    {it && <><span className="sep">/</span><span className="d-inline-flex align-items-center gap-1"><TypeIcon type={it.type} /><span className="fw-semibold" style={{ color: 'var(--ink-soft)' }}>{it.key}</span></span></>}
  </>;

  return (
    <IssueDialog onClose={onClose} crumbs={crumbs} label={it ? `${it.key} ${it.title}` : 'Task'}>
      {!it && <div className="p-4"><ErrorBox error={error} />{loading && <Loading rows={5} />}</div>}
      {it && <div className="issue-grid">
        <div className="issue-main">
          <div className="d-flex align-items-start gap-2">
            {leaf && it.type !== 'MILESTONE' && <div style={{ paddingTop: '0.65rem' }}><CheckButton done={done} label={it.title} disabled={!canEdit} onToggle={() => save({ status: done ? 'TODO' : 'DONE' })} /></div>}
            {titleDraft !== null ? <input autoFocus className="form-control fw-semibold mt-1 mb-2" style={{ fontSize: '1.4rem' }} aria-label="Title" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={async () => { if (titleDraft.trim() && titleDraft !== it.title) await save({ title: titleDraft.trim() }); setTitleDraft(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setTitleDraft(null); }} />
              : <h2 className={`title flex-grow-1 ${manager && canEdit ? 'editable' : ''} ${done ? 'text-decoration-line-through text-muted' : ''}`} onClick={() => manager && canEdit && setTitleDraft(it.title)} title={manager && canEdit ? 'Click to rename' : undefined}>{it.title}</h2>}
          </div>
          {!isCustomer && canEdit && <div className="actions">
            {can('work.create') && ['TASK', 'MODULE'].includes(it.type) && <button className="btn btn-light btn-sm" onClick={() => document.getElementById('issue-sub')?.focus()}><Plus size={14} /> {it.type === 'TASK' ? 'Add subtask' : 'Add task'}</button>}
            {it.canSchedule && it.type !== 'MODULE' && <button className="btn btn-light btn-sm" onClick={() => setShow((x) => ({ ...x, links: true }))}><Link2 size={14} /> Link work</button>}
            {it.checklist && <button className="btn btn-light btn-sm" onClick={() => setShow((x) => ({ ...x, checklist: true }))}><ListChecks size={14} /> Checklist</button>}
          </div>}
          {it.scheduleConflicts?.length > 0 && <Notice tone="warn" icon={AlertTriangle}>This starts before a task it waits for is finished. Earliest sensible start: {fmtDate(it.scheduleConflicts[0].earliestStart)}.</Notice>}

          <TextBlock title="Description" value={it.description} canEdit={manager && canEdit} placeholder="Add a description…" onSave={(v) => save({ description: v })} />

          {(it.children.length > 0 || (canEdit && can('work.create') && ['TASK', 'MODULE'].includes(it.type))) && <div className="mb-3">
            <h3 className="h-section d-flex align-items-center gap-2">{it.type === 'MODULE' ? 'Tasks in this work package' : 'Subtasks'} {it.children.length > 0 && <span className="text-muted fw-normal small">{it.children.filter((c) => c.status === 'DONE').length} of {it.children.length} done</span>}</h3>
            {it.children.length > 0 && <div className="mb-2"><Meter value={Math.round((it.children.filter((c) => c.status === 'DONE').length / it.children.length) * 100)} /></div>}
            {it.children.map((c) => <div key={c.id} className={`task-row ${c.status === 'DONE' ? 'done' : ''}`}>
              <CheckButton done={c.status === 'DONE'} label={c.title} disabled={!canEdit || isCustomer} onToggle={async () => { try { const cur = await get(`/projects/${project.id}/work-items/${c.id}`); await patch(`/projects/${project.id}/work-items/${c.id}`, { status: c.status === 'DONE' ? 'TODO' : 'DONE', version: cur.version }); reload(); reloadProject(); } catch (e) { toast(e.message, 'error'); } }} />
              <TypeIcon type={c.type} /><span className="mono" style={{ fontSize: '0.8125rem' }}>{c.key}</span>
              <button className="title" onClick={() => openItem(c.id)}>{c.title}</button><StatusBadge status={c.status} /></div>)}
            {canEdit && can('work.create') && ['TASK', 'MODULE'].includes(it.type) && <form className="quick-add mt-1" onSubmit={async (e) => { e.preventDefault(); if (!sub.trim()) return; try { await post(`/projects/${project.id}/work-items`, { type: it.type === 'TASK' ? 'SUBTASK' : 'TASK', title: sub.trim(), parentId: it.id }); setSub(''); reload(); reloadProject(); } catch (x) { toast(x.message, 'error'); } }}>
              <Plus size={16} className="text-muted" /><input id="issue-sub" placeholder={it.type === 'TASK' ? 'Add a subtask' : 'Add a task to this work package'} aria-label="New subtask" value={sub} onChange={(e) => setSub(e.target.value)} /></form>}
          </div>}

          {!isCustomer && it.checklist && (it.checklist.length > 0 || show.checklist) && <Checklist it={it} canEdit={canEdit} reload={reload} projectId={project.id} />}

          {!isCustomer && <TextBlock title="Definition of done" value={it.acceptanceCriteria} canEdit={manager && canEdit} placeholder="Add what 'done' means" onSave={(v) => save({ acceptanceCriteria: v })} />}

          {!isCustomer && it.dependencies && (it.dependencies.length > 0 || show.links) && <div className="mb-3">
            <h3 className="h-section">Linked work</h3>
            <ul className="list-plain">{it.dependencies.map((d) => <li key={d.id}><span className="small text-muted" style={{ width: 80 }}>{d.direction === 'predecessor' ? 'waits for' : 'blocks'}</span>
              <button className="btn btn-link p-0 text-start flex-grow-1 truncate" onClick={() => openItem(d.item.id)}>{d.item.title}</button><StatusBadge status={d.item.status} />
              {d.type !== 'FS' && <span className="pill pill-outline" title="Saved, but not used when calculating dates">{d.type}</span>}
              {it.canSchedule && <ConfirmButton className="btn btn-sm btn-ghost btn-icon" title="Remove this link?" confirmLabel="Remove" onConfirm={async () => { await del(`/projects/${project.id}/dependencies/${d.id}`); reload(); }}><Trash2 size={14} aria-label="Remove link" /></ConfirmButton>}</li>)}
              {it.dependencies.length === 0 && <li className="text-muted small">This doesn't wait for anything.</li>}</ul>
            {it.canSchedule && !project.readOnly && it.type !== 'MODULE' && <form className="d-flex gap-2 mt-2" onSubmit={async (e) => { e.preventDefault(); if (!depFor) return; try { const r = await post(`/projects/${project.id}/dependencies`, { predecessorId: depFor, successorId: it.id }); { const moved = (r.rescheduled?.moved || []).filter((m) => m.type !== 'MODULE'); toast(moved.some((m) => m.id === it.id) ? `Linked — ${it.title} now starts ${fmtDate(moved.find((m) => m.id === it.id).to.start)}, after that task` : 'Linked', 'success'); if (r.rescheduled?.cycle) toast(r.rescheduled.cycle, 'error'); } setDepFor(''); reload(); reloadProject(); } catch (x) { toast(x.message, 'error'); } }}>
              <Select aria-label="Task this waits for" value={depFor} onChange={(v) => setDepFor(v || '')} placeholder="This waits for…" options={(all.data?.data || []).filter((x) => x.id !== it.id && x.type !== 'MODULE' && !it.dependencies.some((d) => d.item.id === x.id)).map((x) => ({ value: x.id, label: `${x.key} ${x.title}` }))} />
              <button className="btn btn-sm btn-light" disabled={!depFor}><Link2 size={14} /> Link</button></form>}
          </div>}
          {it.tickets?.length > 0 && <><h3 className="h-section">Linked tickets</h3><ul className="list-plain">{it.tickets.map((t) => <li key={t.id}><Link to={`/tickets/${t.id}`} className="flex-grow-1">#{t.number} {t.subject}</Link><StatusBadge status={t.status} /></li>)}</ul></>}

          <h3 className="h-section">Attachments</h3>
          <FileList targetType="workItem" targetId={it.id} compact />

          <h3 className="h-section mt-4">Activity</h3>
          <CommentThread targetType="workItem" targetId={it.id} people={people} />
        </div>

        <aside className="issue-side">
          <div className="status-btn d-flex align-items-center gap-2 flex-wrap">
            {leaf && canEdit ? <StatusSelect value={it.status} options={STATUSES} onChange={(s2) => save({ status: s2 })} />
              : <StatusSelect value={it.status} options={[]} disabled onChange={() => {}} />}
            {it.children.length > 0 && <span className="small text-muted">Follows the items inside</span>}
          </div>
          <div className="details">
            <div className="h">Details</div>
            <dl className="props">
              {!isCustomer && it.type !== 'MILESTONE' && <><dt>Assignee</dt><dd>{manager && canEdit
                ? <Select aria-label="Assigned to" value={it.assigneeId} onChange={(v) => save({ assigneeId: v || null })} placeholder="Unassigned" options={assignable.map((m) => ({ value: m.id, label: m.name }))} />
                : assignee ? <span className="d-inline-flex align-items-center gap-2"><Avatar name={assignee.name} />{assignee.name}</span> : <span className="d-inline-flex align-items-center gap-2"><span className="avatar avatar-empty">?</span>Unassigned</span>}</dd></>}
              {!isCustomer && <><dt>Priority</dt><dd className="gap-1">{<PriorityIcon priority={it.priority} />}{manager && canEdit
                ? <Select aria-label="Priority" value={it.priority} onChange={(v) => v && save({ priority: v })} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: priorityLabel(v) }))} />
                : priorityLabel(it.priority)}</dd></>}
              <dt>Stage</dt><dd>{it.phase?.name || '—'}</dd>
              {it.type !== 'MILESTONE' && <><dt>Start date</dt><dd><InlineField label="start date" type="date" canEdit={manager && canEdit} value={it.plannedStart} display={it.plannedStart ? fmtDate(it.plannedStart) : undefined} onSave={(v) => dates.change(it, { plannedStart: v || null })} /></dd></>}
              <dt>{it.type === 'MILESTONE' ? 'Date' : 'Due date'}</dt><dd><InlineField label="due date" type="date" canEdit={manager && canEdit} value={it.plannedFinish} min={it.plannedStart || undefined} display={it.plannedFinish ? <DueChip date={it.plannedFinish} done={done} /> : undefined}
                onSave={(v) => dates.change(it, { plannedFinish: v || null })} /></dd>
              {!isCustomer && leaf && it.type !== 'MILESTONE' && <><dt>Estimate</dt><dd><InlineField label="estimate in hours" type="number" min="0" step="0.5" canEdit={manager && canEdit} value={it.estimateHours ?? ''} display={it.estimateHours != null ? `${fmtHours(it.estimateHours)} · ${fmtHours(it.actualHours)} logged` : undefined} onSave={(v) => save({ estimateHours: v === '' ? null : Number(v) })} /></dd></>}
              <dt>Progress</dt><dd className="gap-2">{leaf && canEdit && it.type !== 'MILESTONE' && !done ? null : <div className="flex-grow-1" style={{ maxWidth: 160 }}><Meter value={it.progress} /></div>}
                {leaf && canEdit && it.type !== 'MILESTONE' && !done && <select className="form-select form-select-sm" style={{ width: 84 }} aria-label="Percent complete" value={Math.round(it.percentComplete / 25) * 25} onChange={(e) => save({ percentComplete: Number(e.target.value) })}>{[0, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n}%</option>)}</select>}</dd>
              {!isCustomer && <><dt>Labels</dt><dd><InlineField label="labels (comma-separated)" canEdit={manager && canEdit} value={(it.labels || []).join(', ')} display={it.labels?.length ? <span className="d-inline-flex gap-1 flex-wrap">{it.labels.map((l) => <span key={l} className="tag">{l}</span>)}</span> : undefined} onSave={(v) => save({ labels: v.split(',').map((x) => x.trim()).filter(Boolean) })} /></dd></>}
              {!isCustomer && <><dt>Client can see</dt><dd>{manager && canEdit ? (
                <div className="form-check form-switch m-0"><input className="form-check-input" type="checkbox" role="switch" id="dcv" checked={it.customerVisible} disabled={!project.customerVisible} onChange={(e) => save({ customerVisible: e.target.checked })} />
                  <label className="form-check-label small" htmlFor="dcv">{it.customerVisible ? <><Globe size={13} /> Yes</> : <><Lock size={13} /> Team only</>}{!project.customerVisible && <span className="text-muted"> (client access off)</span>}</label></div>
              ) : it.customerVisible ? 'Yes' : 'Team only'}</dd></>}
              {!isCustomer && (it.actualStart || it.actualFinish) && <><dt>Actual dates</dt><dd className="small">{fmtDate(it.actualStart) || '—'} → {fmtDate(it.actualFinish) || '—'}</dd></>}
            </dl>
          </div>
          {!isCustomer && leaf && it.type !== 'MILESTONE' && <div className="details mt-3"><div className="h">Time tracking</div><div className="p-3">
            <div className="d-flex justify-content-between small mb-1"><span>{fmtHours(it.actualHours)} logged</span><span className="text-muted">{it.estimateHours ? `${fmtHours(Math.max(0, it.estimateHours - it.actualHours))} remaining` : 'No estimate'}</span></div>
            <div className="meter mb-2"><span style={{ width: `${it.estimateHours ? Math.min(100, (it.actualHours / it.estimateHours) * 100) : 0}%` }} /></div>
            {!project.readOnly && <LogTime it={it} projectId={project.id} onLogged={() => { reload(); reloadProject(); }} />}
          </div></div>}
          {!isCustomer && <div className="stamp">{it.createdAt && <div>Created {fmtDate(it.createdAt)}</div>}{it.updatedAt && <div>Updated {fmtDate(it.updatedAt)}</div>}</div>}
          {deleteBtn && <div className="mt-3">{deleteBtn}</div>}
        </aside>
      </div>}
      {dates.dialog}
    </IssueDialog>
  );
}

function Checklist({ it, canEdit, reload, projectId }) {
  const [text, setText] = useState('');
  const base = `/projects/${projectId}/work-items/${it.id}/checklist`;
  const done = it.checklist.filter((c) => c.done).length;
  if (!canEdit && it.checklist.length === 0) return null;
  return (
    <div className="mb-3"><h3 className="h-section">Checklist {it.checklist.length > 0 && <span className="text-muted fw-normal">{done}/{it.checklist.length}</span>}</h3>
      <ul className="list-plain">{it.checklist.map((c) => <li key={c.id}><input type="checkbox" className="form-check-input m-0" id={`ck-${c.id}`} checked={c.done} disabled={!canEdit} onChange={async () => { await patch(`${base}/${c.id}`, { done: !c.done }); reload(); }} />
        <label htmlFor={`ck-${c.id}`} className={`flex-grow-1 ${c.done ? 'text-decoration-line-through text-muted' : ''}`}>{c.text}</label>
        {canEdit && <button className="btn btn-sm btn-ghost btn-icon" aria-label="Remove checklist item" onClick={async () => { await del(`${base}/${c.id}`); reload(); }}><Trash2 size={13} /></button>}</li>)}</ul>
      {canEdit && <form className="d-flex gap-2 mt-1" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await post(base, { text }); setText(''); reload(); }}>
        <input className="form-control form-control-sm" placeholder="Add a checklist item" value={text} onChange={(e) => setText(e.target.value)} aria-label="New checklist item" /><button className="btn btn-sm btn-light" disabled={!text.trim()}><Plus size={14} /> Add</button></form>}
    </div>
  );
}

function LogTime({ it, projectId, onLogged }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), hours: '', note: '', billable: true });
  const [busy, setBusy] = useState(false);
  const log = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post('/time/entries', { projectId, workItemId: it.id, date: f.date, hours: Number(f.hours), note: f.note || undefined, billable: f.billable }); toast(`${f.hours}h logged`, 'success'); setF({ ...f, hours: '', note: '' }); setOpen(false); onLogged(); }
    catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  if (!open) return <button className="btn btn-light btn-sm" onClick={() => setOpen(true)}>Log time</button>;
  return (
    <form className="d-flex flex-column gap-2" onSubmit={log}>
      <div className="d-flex gap-2">
        <input type="date" className="form-control form-control-sm" value={f.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Date" />
        <input type="number" min="0.25" max="24" step="0.25" className="form-control form-control-sm" style={{ width: 90 }} placeholder="Hours" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} aria-label="Hours" autoFocus />
      </div>
      <input className="form-control form-control-sm" placeholder="What did you do? (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} aria-label="Note" />
      <div className="d-flex align-items-center gap-2">
        <label className="small d-inline-flex align-items-center gap-1 me-auto"><input type="checkbox" className="form-check-input m-0" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Billable</label>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-sm btn-primary" disabled={busy || !(Number(f.hours) > 0)}>Log</button>
      </div>
    </form>
  );
}
