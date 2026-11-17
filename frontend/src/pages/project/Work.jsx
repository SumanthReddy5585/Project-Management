import { useMemo, useState } from 'react';
import { Plus, ChevronRight, ChevronDown, Download, AlertTriangle, Link2, Lock } from 'lucide-react';
import { get, post, patch, download } from '../../api/client.js';
import { useLoad, useDebounced } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, labelize, todayISO } from '../../lib/format.js';
import { Empty, ErrorBox, Field, Loading, Meter, Modal, PriorityBadge, Select, StatusBadge, TypeTag, fieldErrors, useToast } from '../../components/ui.jsx';
import { useProject } from './Workspace.jsx';

const STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED'];
const CHILD_TYPES = { root: ['MODULE', 'TASK', 'MILESTONE'], MODULE: ['TASK', 'MILESTONE'], TASK: ['SUBTASK'] };

export function NewItemModal({ open, onClose, parent, defaultPhaseId, onCreated }) {
  const { project, can, assignable } = useProject();
  const { user } = useAuth();
  const types = CHILD_TYPES[parent?.type ?? 'root'] || [];
  const [f, setF] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const v = { type: types[0], title: '', phaseId: parent ? null : defaultPhaseId || project.phases[0]?.id || '', assigneeId: can('work.editAny') ? '' : user.id, plannedStart: '', plannedFinish: '', estimateHours: '', priority: 'MEDIUM', customerVisible: parent?.customerVisible ?? false, description: '', ...f };
  const set = (k) => (x) => setF((o) => ({ ...o, [k]: x }));
  const fe = fieldErrors(err);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const body = { type: v.type, title: v.title, parentId: parent?.id ?? null, phaseId: parent ? undefined : v.phaseId || null, assigneeId: v.assigneeId || null, priority: v.priority, description: v.description || null,
        plannedStart: v.plannedStart || null, plannedFinish: (v.type === 'MILESTONE' ? v.plannedStart : v.plannedFinish) || null, estimateHours: v.estimateHours === '' || v.type === 'MILESTONE' ? null : Number(v.estimateHours),
        ...(can('work.editAny') && { customerVisible: v.customerVisible }) };
      const r = await post(`/projects/${project.id}/work-items`, body);
      setF({}); onCreated?.(r); onClose();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={parent ? `Add under ${parent.key} ${parent.title}` : 'New work item'} size="lg"
      footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="new-item" disabled={busy || !v.title.trim()}>{busy ? 'Creating…' : 'Create'}</button></>}>
      <ErrorBox error={err} />
      <form id="new-item" onSubmit={submit} className="row">
        <div className="col-md-3"><Field label="Type">{(id) => <Select id={id} value={v.type} onChange={set('type')} options={types.map((t) => ({ value: t, label: labelize(t) }))} />}</Field></div>
        <div className="col-md-9"><Field label="Title" error={fe.title}>{(id) => <input id={id} className="form-control" value={v.title} onChange={(e) => set('title')(e.target.value)} autoFocus />}</Field></div>
        {!parent && <div className="col-md-6"><Field label="Phase">{(id) => <Select id={id} value={v.phaseId} onChange={set('phaseId')} placeholder="No phase" options={project.phases.map((p) => ({ value: p.id, label: p.name }))} />}</Field></div>}
        {v.type !== 'MILESTONE' && <div className="col-md-6"><Field label="Assignee" hint={!can('work.editAny') ? 'Members can assign new work only to themselves.' : undefined}>{(id) => <Select id={id} value={v.assigneeId} onChange={set('assigneeId')} disabled={!can('work.editAny')} placeholder="Unassigned" options={assignable.map((m) => ({ value: m.id, label: m.name }))} />}</Field></div>}
        <div className="col-md-3"><Field label={v.type === 'MILESTONE' ? 'Date' : 'Planned start'}>{(id) => <input id={id} type="date" className="form-control" value={v.plannedStart} onChange={(e) => set('plannedStart')(e.target.value)} />}</Field></div>
        {v.type !== 'MILESTONE' && <div className="col-md-3"><Field label="Planned finish" error={fe.plannedFinish}>{(id) => <input id={id} type="date" className="form-control" value={v.plannedFinish} min={v.plannedStart || undefined} onChange={(e) => set('plannedFinish')(e.target.value)} />}</Field></div>}
        {!['MILESTONE', 'MODULE'].includes(v.type) && <div className="col-md-3"><Field label="Estimate (h)">{(id) => <input id={id} type="number" min="0" step="0.5" className="form-control" value={v.estimateHours} onChange={(e) => set('estimateHours')(e.target.value)} />}</Field></div>}
        <div className="col-md-3"><Field label="Priority">{(id) => <Select id={id} value={v.priority} onChange={set('priority')} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((x) => ({ value: x, label: labelize(x) }))} />}</Field></div>
        <div className="col-12"><Field label="Description">{(id) => <textarea id={id} rows={3} className="form-control" value={v.description} onChange={(e) => set('description')(e.target.value)} />}</Field></div>
        {can('work.editAny') && <div className="col-12"><div className="form-check form-switch"><input className="form-check-input" type="checkbox" role="switch" id="ni-cv" checked={v.customerVisible} disabled={!project.customerVisible} onChange={(e) => set('customerVisible')(e.target.checked)} /><label className="form-check-label" htmlFor="ni-cv">Visible to customer</label></div></div>}
      </form>
    </Modal>
  );
}

export function WorkList() {
  const { project, can, people, openItem } = useProject();
  const { isCustomer } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [phase, setPhase] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sel, setSel] = useState(() => new Set());
  const [creating, setCreating] = useState(null);
  const dq = useDebounced(q);
  const filtered = Boolean(dq || status || assignee || phase);
  const { data, error, loading, reload } = useLoad(() => get(`/projects/${project.id}/work-items`, { all: 'true', q: dq || undefined, status: status || undefined, assigneeId: assignee || undefined, phaseId: phase || undefined }), [project.id, dq, status, assignee, phase]);
  const rows = useMemo(() => {
    const items = data?.data || [];
    if (filtered) return items.map((i) => ({ ...i, depth: 0 }));
    const kids = new Map(); const ids = new Set(items.map((i) => i.id));
    for (const i of items) { const p = ids.has(i.parentId) ? i.parentId : 'root'; kids.set(p, [...(kids.get(p) || []), i]); }
    const order = (xs) => [...xs].sort((a, b) => (project.phases.findIndex((p) => p.id === a.phaseId) - project.phases.findIndex((p) => p.id === b.phaseId)) || (a.type === 'MILESTONE') - (b.type === 'MILESTONE') || a.sortOrder - b.sortOrder || a.number - b.number);
    const out = []; const walk = (id, depth) => { for (const i of order(kids.get(id) || [])) { out.push({ ...i, depth, hasKids: (kids.get(i.id) || []).length > 0 }); if (!collapsed.has(i.id)) walk(i.id, depth + 1); } };
    walk('root', 0);
    return out;
  }, [data, filtered, collapsed, project.phases]);
  const names = new Map(people.map((m) => [m.id, m.name]));
  const phaseName = new Map(project.phases.map((p) => [p.id, p.name]));
  const bulk = async (patchBody) => {
    try { const r = await post(`/projects/${project.id}/work-items/bulk`, { ids: [...sel], patch: patchBody }); toast(`${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped (open children)` : ''}`, r.skipped.length ? 'error' : 'success'); setSel(new Set()); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const today = todayISO();
  const canCreate = can('work.create') && !project.readOnly;
  return (
    <>
      <div className="filters">
        <input className="form-control form-control-sm" style={{ maxWidth: 240 }} placeholder="Search title or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search work items" />
        <Select aria-label="Status" value={status} onChange={(v) => setStatus(v || '')} placeholder="Any status" options={STATUSES.map((s) => ({ value: s, label: labelize(s) }))} />
        <Select aria-label="Phase" value={phase} onChange={(v) => setPhase(v || '')} placeholder="Any phase" options={project.phases.map((p) => ({ value: p.id, label: p.name }))} />
        {!isCustomer && <Select aria-label="Assignee" value={assignee} onChange={(v) => setAssignee(v || '')} placeholder="Anyone" options={[{ value: 'me', label: 'Assigned to me' }, { value: 'none', label: 'Unassigned' }, ...people.filter((m) => m.role !== 'CUSTOMER').map((m) => ({ value: m.id, label: m.name }))]} />}
        <div className="ms-auto d-flex gap-2">
          {!isCustomer && can('export.csv') && <button className="btn btn-sm btn-light" onClick={() => download(`/projects/${project.id}/export/work-items.csv`, `${project.code}-work-items.csv`)}><Download size={14} /> CSV</button>}
          {canCreate && <button className="btn btn-sm btn-primary" onClick={() => setCreating({})}><Plus size={14} /> New item</button>}
        </div>
      </div>
      {sel.size > 0 && can('work.editAny') && (
        <div className="notice info mb-2 align-items-center flex-wrap" role="region" aria-label="Bulk actions"><strong>{sel.size} selected</strong>
          <Select aria-label="Set status" value="" onChange={(v) => v && bulk({ status: v })} placeholder="Set status…" options={STATUSES.map((s) => ({ value: s, label: labelize(s) }))} />
          <Select aria-label="Set assignee" value="" onChange={(v) => v && bulk({ assigneeId: v === 'none' ? null : v })} placeholder="Assign to…" options={[{ value: 'none', label: 'Unassigned' }, ...people.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role)).map((m) => ({ value: m.id, label: m.name }))]} />
          <Select aria-label="Set priority" value="" onChange={(v) => v && bulk({ priority: v })} placeholder="Priority…" options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => ({ value: s, label: labelize(s) }))} />
          {project.customerVisible && <><button className="btn btn-sm btn-light" onClick={() => bulk({ customerVisible: true })}>Share with customer</button><button className="btn btn-sm btn-light" onClick={() => bulk({ customerVisible: false })}>Make internal</button></>}
          <button className="btn btn-sm btn-link" onClick={() => setSel(new Set())}>Clear</button>
        </div>)}
      <ErrorBox error={error} onRetry={reload} />
      <div className="card">
        {loading && !data ? <div className="p-3"><Loading /></div> : rows.length === 0 ? <Empty title={filtered ? 'No matching work items' : 'No work items yet'} action={canCreate && !filtered && <button className="btn btn-sm btn-primary" onClick={() => setCreating({})}>Add the first item</button>}>{isCustomer && !filtered ? 'Your project team has not shared any work items yet.' : ''}</Empty> : (
          <div className="table-wrap"><table className="table table-hover">
            <thead><tr>{can('work.editAny') && <th style={{ width: 32 }}><input type="checkbox" className="form-check-input" aria-label="Select all" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
              <th>Item</th><th>Status</th>{!isCustomer && <th>Assignee</th>}<th>Finish</th>{!isCustomer && <th>Est.</th>}<th style={{ width: 130 }}>Progress</th>{canCreate && <th />}</tr></thead>
            <tbody>{rows.map((r) => {
              const late = r.plannedFinish && r.plannedFinish < today && !['DONE', 'CANCELLED'].includes(r.status);
              return (
                <tr key={r.id}>
                  {can('work.editAny') && <td><input type="checkbox" className="form-check-input" aria-label={`Select ${r.key}`} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} /></td>}
                  <td className="min-w-0" style={{ maxWidth: 520 }}><div className="d-flex align-items-center gap-1">
                    {[...Array(r.depth)].map((_, i) => <span key={i} className="tree-indent" />)}
                    {r.hasKids ? <button className="btn btn-ghost btn-icon p-0" aria-label={collapsed.has(r.id) ? 'Expand' : 'Collapse'} aria-expanded={!collapsed.has(r.id)} onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}>{collapsed.has(r.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button> : <span className="tree-indent" />}
                    <span className="mono text-muted me-1">{r.key}</span>
                    <button className={`btn btn-link p-0 text-start truncate ${r.type === 'MODULE' ? 'fw-semibold text-body' : 'text-body'}`} onClick={() => openItem(r.id)}>{r.title}</button>
                    <TypeTag type={r.type === 'TASK' ? '' : r.type} />
                    {!isCustomer && !r.customerVisible && project.customerVisible && <Lock size={11} className="text-muted flex-shrink-0" aria-label="Internal only" />}
                    {r.scheduleConflict && <AlertTriangle size={13} className="text-warning flex-shrink-0" aria-label="Schedule conflict" title={`Starts before predecessor; earliest ${r.scheduleConflict.earliestStart}`} />}
                    {r.predecessorCount > 0 && <Link2 size={12} className="text-muted flex-shrink-0" aria-label={`${r.predecessorCount} predecessor(s)`} />}
                  </div>{filtered && r.phaseId && <div className="small text-muted ps-4">{phaseName.get(r.phaseId)}</div>}</td>
                  <td><StatusBadge status={r.status} /></td>
                  {!isCustomer && <td className="small">{names.get(r.assigneeId) || <span className="text-muted">—</span>}</td>}
                  <td className={`small text-nowrap ${late ? 'text-danger fw-semibold' : ''}`}>{fmtDate(r.plannedFinish)}</td>
                  {!isCustomer && <td className="small">{r.estimateHours ?? '—'}</td>}
                  <td>{r.type === 'MILESTONE' ? <span className="small text-muted">{r.status === 'DONE' ? 'Reached' : 'Pending'}</span> : <Meter value={r.progress} />}</td>
                  {canCreate && <td>{CHILD_TYPES[r.type] && <button className="btn btn-sm btn-ghost btn-icon" aria-label={`Add child to ${r.key}`} title="Add child item" onClick={() => setCreating({ parent: r })}><Plus size={14} /></button>}</td>}
                </tr>);
            })}</tbody>
          </table></div>)}
      </div>
      <NewItemModal open={Boolean(creating)} parent={creating?.parent} onClose={() => setCreating(null)} onCreated={(r) => { toast(`${r.key} created`, 'success'); reload(); }} />
    </>
  );
}

export function Board() {
  const { project, can, people, openItem } = useProject();
  const toast = useToast();
  const [over, setOver] = useState(null);
  const [assignee, setAssignee] = useState('');
  const { data, error, loading, reload, setData } = useLoad(() => get(`/projects/${project.id}/work-items`, { all: 'true', type: 'TASK,SUBTASK', assigneeId: assignee || undefined }), [project.id, assignee]);
  const names = new Map(people.map((m) => [m.id, m.name]));
  const move = async (id, status) => {
    const it = data.data.find((x) => x.id === id);
    if (!it || it.status === status) return;
    setData((d) => ({ ...d, data: d.data.map((x) => (x.id === id ? { ...x, status } : x)) }));
    try { await patch(`/projects/${project.id}/work-items/${id}`, { status, version: it.version }); reload(); }
    catch (e) { toast(e.status === 403 ? 'You can only move work assigned to you' : e.message, 'error'); reload(); }
  };
  const today = todayISO();
  return (
    <>
      <div className="filters"><Select aria-label="Assignee" value={assignee} onChange={(v) => setAssignee(v || '')} placeholder="Everyone" options={[{ value: 'me', label: 'My work' }, ...people.filter((m) => m.role !== 'CUSTOMER').map((m) => ({ value: m.id, label: m.name }))]} />
        <span className="small text-muted">Drag a card to change its status, or open it and use the status menu (keyboard friendly).</span></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <div className="board">{STATUSES.map((s) => {
          const items = (data?.data || []).filter((i) => i.status === s);
          return (
            <section key={s} className={`board-col ${over === s ? 'drop' : ''}`} aria-label={labelize(s)} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); move(e.dataTransfer.getData('text/plain'), s); }}>
              <h3><span>{labelize(s)}</span><span>{items.length}</span></h3>
              {items.map((i) => (
                <article key={i.id} className="board-card" draggable={!project.readOnly} onDragStart={(e) => e.dataTransfer.setData('text/plain', i.id)}>
                  <div className="d-flex justify-content-between small"><span className="mono text-muted">{i.key}</span><PriorityBadge priority={i.priority} /></div>
                  <button className="title btn btn-link p-0 text-start text-decoration-none d-block" onClick={() => openItem(i.id)}>{i.title}</button>
                  <div className="d-flex justify-content-between align-items-center small text-muted"><span>{names.get(i.assigneeId) || 'Unassigned'}</span><span className={i.plannedFinish && i.plannedFinish < today && s !== 'DONE' ? 'text-danger fw-semibold' : ''}>{i.plannedFinish ? fmtDate(i.plannedFinish) : ''}</span></div>
                  {i.progress > 0 && s !== 'DONE' && <div className="mt-1"><Meter value={i.progress} /></div>}
                </article>))}
            </section>);
        })}</div>)}
      {!can('work.editAny') && <div className="form-text mt-2">You can move cards assigned to you or where you are a collaborator.</div>}
    </>
  );
}
