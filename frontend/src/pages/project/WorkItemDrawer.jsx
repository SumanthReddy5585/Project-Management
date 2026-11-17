import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Trash2, Plus, Lock, Globe, AlertTriangle, ChevronDown, Pencil } from 'lucide-react';
import { get, patch, post, del } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtHours, labelize } from '../../lib/format.js';
import { Drawer, ErrorBox, Loading, StatusBadge, Meter, Select, useToast, ConfirmButton, Notice, CheckButton, DueChip, Avatar, STATUS_TONE } from '../../components/ui.jsx';
import { CommentThread, FileList } from '../../components/collab.jsx';
import { useProject } from './Workspace.jsx';

const STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED'];
const TYPE_NAME = { TASK: 'Task', SUBTASK: 'Subtask', MODULE: 'Group', MILESTONE: 'Milestone', PHASE: 'Phase' };

/** A value that turns into an input when clicked (only when editable). Saves on blur / Enter. */
function InlineField({ value, display, type = 'text', canEdit, onSave, label, ...rest }) {
  const [editing, setEditing] = useState(false);
  if (!canEdit) return <span>{display ?? (value || '—')}</span>;
  if (!editing) return <button type="button" className="btn btn-ghost btn-sm px-2 py-1 text-start" onClick={() => setEditing(true)} aria-label={`Change ${label}`}>{display ?? (value || <span className="text-muted">Add</span>)}</button>;
  const commit = (v) => { setEditing(false); if (v !== (value ?? '')) onSave(v); };
  return <input autoFocus type={type} aria-label={label} className="form-control form-control-sm" style={{ maxWidth: 220 }} defaultValue={value ?? ''} {...rest}
    onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); if (e.key === 'Escape') setEditing(false); }} />;
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
  const all = useLoad(() => (itemId && !isCustomer ? get(`/projects/${project.id}/work-items`, { all: 'true' }) : Promise.resolve(null)), [itemId]);
  useEffect(() => { setTitleDraft(null); setSub(''); }, [itemId]);
  if (!itemId) return null;
  const save = async (changes) => {
    const version = it.version;
    setData((d) => ({ ...d, ...changes })); // show the change immediately; the server response replaces it
    try {
      const r = await patch(`/projects/${project.id}/work-items/${it.id}`, { ...changes, version });
      setData((d) => ({ ...d, ...r }));
      if (r.downstreamConflicts?.length) toast(`${r.downstreamConflicts.length} task(s) that wait for this now start too early. Check the Timeline view.`, 'error');
      else toast('Saved', 'success');
      reload(); reloadProject();
      return true;
    } catch (e) { toast(e.status === 409 ? 'Someone else just changed this — showing the latest version.' : e.message, 'error'); reload(); return false; }
  };
  const canEdit = it?.canEdit && !project.readOnly;
  const manager = can('work.editAny');
  const leaf = it && it.type !== 'MODULE' && it.children.length === 0;
  const done = it?.status === 'DONE';
  const assignee = it && people.find((m) => m.id === it.assigneeId);

  const header = it && <>
    <div className="d-flex align-items-center gap-2 small text-muted mb-1 flex-wrap"><span>{TYPE_NAME[it.type] || labelize(it.type)}</span><span className="mono">{it.key}</span>
      {it.ancestors?.map((a) => <button key={a.id} className="btn btn-link btn-sm p-0" onClick={() => openItem(a.id)}>› {a.title}</button>)}</div>
    <div className="d-flex align-items-start gap-2">
      {leaf && it.type !== 'MILESTONE' && <div className="pt-1"><CheckButton done={done} label={it.title} disabled={!canEdit} onToggle={() => save({ status: done ? 'TODO' : 'DONE' })} /></div>}
      {titleDraft !== null ? <input autoFocus className="form-control fw-bold" aria-label="Title" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={async () => { if (titleDraft.trim() && titleDraft !== it.title) await save({ title: titleDraft.trim() }); setTitleDraft(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setTitleDraft(null); }} />
        : <h2 className={`h5 fw-bold mb-0 ${done ? 'text-decoration-line-through text-muted' : ''}`} onClick={() => manager && canEdit && setTitleDraft(it.title)} style={manager && canEdit ? { cursor: 'text' } : undefined} title={manager && canEdit ? 'Click to rename' : undefined}>{it.title}</h2>}
    </div>
  </>;

  return (
    <Drawer open onClose={onClose} header={header || <span>Loading…</span>}>
      <ErrorBox error={error} />
      {loading && !it && <Loading rows={5} />}
      {it && <>
        {leaf && canEdit ? (
          <div className="status-picker" role="group" aria-label="Status">{STATUSES.map((s) => (
            <button key={s} type="button" className={it.status === s ? `on pill-${STATUS_TONE[s]}` : ''} aria-pressed={it.status === s} onClick={() => it.status !== s && save({ status: s })}>{labelize(s)}</button>))}</div>
        ) : <div className="mb-3 d-flex gap-2 align-items-center"><StatusBadge status={it.status} />{it.children.length > 0 && <span className="small text-muted">Updates automatically from the tasks inside.</span>}</div>}

        {it.scheduleConflicts?.length > 0 && <Notice tone="warn" icon={AlertTriangle}>This starts before a task it waits for is finished. Earliest sensible start: {fmtDate(it.scheduleConflicts[0].earliestStart)}.</Notice>}

        <dl className="props">
          {!isCustomer && it.type !== 'MILESTONE' && <><dt>Assigned to</dt><dd>{manager && canEdit
            ? <Select aria-label="Assigned to" value={it.assigneeId} onChange={(v) => save({ assigneeId: v || null })} placeholder="Nobody yet" options={assignable.map((m) => ({ value: m.id, label: m.name }))} />
            : assignee ? <span className="d-inline-flex align-items-center gap-2"><Avatar sm name={assignee.name} />{assignee.name}</span> : 'Nobody yet'}</dd></>}
          {it.type !== 'MILESTONE' && <><dt>Start</dt><dd><InlineField label="start date" type="date" canEdit={manager && canEdit} value={it.plannedStart} display={it.plannedStart ? fmtDate(it.plannedStart) : undefined} onSave={(v) => save({ plannedStart: v || null })} /></dd></>}
          <dt>{it.type === 'MILESTONE' ? 'Date' : 'Due'}</dt><dd><InlineField label="due date" type="date" canEdit={manager && canEdit} value={it.plannedFinish} min={it.plannedStart || undefined} display={it.plannedFinish ? <DueChip date={it.plannedFinish} done={done} /> : undefined}
            onSave={(v) => save(it.type === 'MILESTONE' ? { plannedStart: v || null, plannedFinish: v || null } : { plannedFinish: v || null })} /></dd>
          {!isCustomer && leaf && it.type !== 'MILESTONE' && <><dt>Estimate</dt><dd><InlineField label="estimate in hours" type="number" min="0" step="0.5" canEdit={manager && canEdit} value={it.estimateHours ?? ''} display={it.estimateHours != null ? `${fmtHours(it.estimateHours)} · ${fmtHours(it.actualHours)} logged` : undefined} onSave={(v) => save({ estimateHours: v === '' ? null : Number(v) })} /></dd></>}
          {!isCustomer && <><dt>Priority</dt><dd>{manager && canEdit
            ? <Select aria-label="Priority" value={it.priority} onChange={(v) => v && save({ priority: v })} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: labelize(v) }))} />
            : labelize(it.priority)}</dd></>}
          {!isCustomer && <><dt>Client can see</dt><dd>{manager && canEdit ? (
            <div className="form-check form-switch m-0"><input className="form-check-input" type="checkbox" role="switch" id="dcv" checked={it.customerVisible} disabled={!project.customerVisible} onChange={(e) => save({ customerVisible: e.target.checked })} />
              <label className="form-check-label" htmlFor="dcv">{it.customerVisible ? <><Globe size={13} /> Yes</> : <><Lock size={13} /> No, team only</>}{!project.customerVisible && <span className="text-muted"> (client access is off)</span>}</label></div>
          ) : it.customerVisible ? 'Yes' : 'No, team only'}</dd></>}
          <dt>Progress</dt><dd className="d-flex align-items-center gap-2"><div className="flex-grow-1" style={{ maxWidth: 220 }}><Meter value={it.progress} /></div>
            {leaf && canEdit && it.type !== 'MILESTONE' && !done && <select className="form-select form-select-sm" style={{ width: 90 }} aria-label="Percent complete" value={Math.round(it.percentComplete / 25) * 25} onChange={(e) => save({ percentComplete: Number(e.target.value) })}>{[0, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n}%</option>)}</select>}</dd>
        </dl>

        <TextBlock title="Notes" value={it.description} canEdit={manager && canEdit} placeholder="Add notes" onSave={(v) => save({ description: v })} />

        {(it.children.length > 0 || (canEdit && can('work.create') && ['TASK', 'MODULE'].includes(it.type))) && <div className="mb-3">
          <h3 className="h-section">{it.type === 'MODULE' ? 'Tasks in this group' : 'Subtasks'} {it.children.length > 0 && <span className="text-muted fw-normal">{it.children.filter((c) => c.status === 'DONE').length}/{it.children.length}</span>}</h3>
          {it.children.map((c) => <div key={c.id} className={`task-row ${c.status === 'DONE' ? 'done' : ''}`}>
            <CheckButton done={c.status === 'DONE'} label={c.title} disabled={!canEdit || isCustomer} onToggle={async () => { try { const cur = await get(`/projects/${project.id}/work-items/${c.id}`); await patch(`/projects/${project.id}/work-items/${c.id}`, { status: c.status === 'DONE' ? 'TODO' : 'DONE', version: cur.version }); reload(); reloadProject(); } catch (e) { toast(e.message, 'error'); } }} />
            <button className="title" onClick={() => openItem(c.id)}>{c.title}</button>{c.status !== 'DONE' && c.status !== 'TODO' && <StatusBadge status={c.status} />}</div>)}
          {canEdit && can('work.create') && ['TASK', 'MODULE'].includes(it.type) && <form className="quick-add mt-1" onSubmit={async (e) => { e.preventDefault(); if (!sub.trim()) return; try { await post(`/projects/${project.id}/work-items`, { type: it.type === 'TASK' ? 'SUBTASK' : 'TASK', title: sub.trim(), parentId: it.id }); setSub(''); reload(); reloadProject(); } catch (x) { toast(x.message, 'error'); } }}>
            <Plus size={16} className="text-muted" /><input placeholder={it.type === 'TASK' ? 'Add a subtask' : 'Add a task to this group'} aria-label="New subtask" value={sub} onChange={(e) => setSub(e.target.value)} /></form>}
        </div>}

        {!isCustomer && it.checklist && <Checklist it={it} canEdit={canEdit} reload={reload} projectId={project.id} />}

        <h3 className="h-section mt-3">Files</h3>
        <FileList targetType="workItem" targetId={it.id} compact />

        {!isCustomer && <details className="more mt-3">
          <summary><ChevronDown size={15} /> More details</summary>
          <TextBlock title="Definition of done" value={it.acceptanceCriteria} canEdit={manager && canEdit} placeholder="Add what 'done' means" onSave={(v) => save({ acceptanceCriteria: v })} />
          <dl className="props">
            <dt>Phase</dt><dd>{it.phase?.name || '—'}</dd>
            <dt>Actually started</dt><dd>{fmtDate(it.actualStart) || '—'}</dd>
            <dt>Actually finished</dt><dd>{fmtDate(it.actualFinish) || '—'}</dd>
            <dt>Labels</dt><dd><InlineField label="labels (comma-separated)" canEdit={manager && canEdit} value={(it.labels || []).join(', ')} display={it.labels?.length ? <span className="d-inline-flex gap-1 flex-wrap">{it.labels.map((l) => <span key={l} className="pill pill-outline">{l}</span>)}</span> : undefined} onSave={(v) => save({ labels: v.split(',').map((s) => s.trim()).filter(Boolean) })} /></dd>
          </dl>
          {it.dependencies && <>
            <h3 className="h-section">Waits for / blocks</h3>
            <ul className="list-plain">{it.dependencies.map((d) => <li key={d.id}><span className="small text-muted" style={{ width: 80 }}>{d.direction === 'predecessor' ? 'Waits for' : 'Blocks'}</span>
              <button className="btn btn-link p-0 text-start flex-grow-1 truncate" onClick={() => openItem(d.item.id)}>{d.item.title}</button><StatusBadge status={d.item.status} />
              {d.type !== 'FS' && <span className="pill pill-outline" title="Saved, but not used when calculating dates">{d.type}</span>}
              {it.canSchedule && <ConfirmButton className="btn btn-sm btn-ghost btn-icon" title="Remove this link?" confirmLabel="Remove" onConfirm={async () => { await del(`/projects/${project.id}/dependencies/${d.id}`); reload(); }}><Trash2 size={14} aria-label="Remove link" /></ConfirmButton>}</li>)}
              {it.dependencies.length === 0 && <li className="text-muted small">This doesn't wait for anything.</li>}</ul>
            {it.canSchedule && !project.readOnly && it.type !== 'MODULE' && <form className="d-flex gap-2 mt-2" onSubmit={async (e) => { e.preventDefault(); if (!depFor) return; try { const r = await post(`/projects/${project.id}/dependencies`, { predecessorId: depFor, successorId: it.id }); toast(r.conflict ? 'Linked — but this now starts before that task finishes' : 'Linked', r.conflict ? 'error' : 'success'); setDepFor(''); reload(); } catch (x) { toast(x.message, 'error'); } }}>
              <Select aria-label="Task this waits for" value={depFor} onChange={(v) => setDepFor(v || '')} placeholder="This waits for…" options={(all.data?.data || []).filter((x) => x.id !== it.id && x.type !== 'MODULE' && !it.dependencies.some((d) => d.item.id === x.id)).map((x) => ({ value: x.id, label: x.title }))} />
              <button className="btn btn-sm btn-light" disabled={!depFor}><Link2 size={14} /> Link</button></form>}
          </>}
          {it.tickets?.length > 0 && <><h3 className="h-section mt-3">Linked requests</h3><ul className="list-plain">{it.tickets.map((t) => <li key={t.id}><Link to={`/tickets/${t.id}`} className="flex-grow-1">#{t.number} {t.subject}</Link><StatusBadge status={t.status} /></li>)}</ul></>}
          {can('work.delete') && !project.readOnly && <div className="mt-3"><ConfirmButton title={`Delete "${it.title}"?`} message="This removes it and anything inside it. Items with logged time can't be deleted — set them to Cancelled instead." confirmLabel="Delete" onConfirm={async () => { await del(`/projects/${project.id}/work-items/${it.id}`); onClose(); reloadProject(); toast('Deleted', 'success'); }}><Trash2 size={14} /> Delete</ConfirmButton></div>}
        </details>}

        <h3 className="h-section mt-4">Comments</h3>
        <CommentThread targetType="workItem" targetId={it.id} people={people} />
      </>}
    </Drawer>
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
