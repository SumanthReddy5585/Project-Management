import { useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Plus, ChevronRight, ChevronDown, Download, Lock, AlertTriangle, Flag, ListChecks, X, Upload } from 'lucide-react';
import { get, post, patch, download } from '../../api/client.js';
import { useLive } from '../../lib/live.js';
import { useLoad, useDebounced } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { labelize, todayISO } from '../../lib/format.js';
import { setDone } from '../../lib/tasks.js';
import { Avatar, CheckButton, DueChip, Empty, ErrorBox, Field, Loading, Meter, Modal, PriorityBadge, PriorityIcon, TypeIcon, Segmented, Select, StatusBadge, fieldErrors, useToast, Card } from '../../components/ui.jsx';
import { useProject } from './Workspace.jsx';
import { Timeline, CalendarView } from './Schedule.jsx';
import { TaskGrid } from './Grid.jsx';

const STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED'];
const CHILD_TYPES = { root: ['TASK', 'MODULE', 'MILESTONE'], MODULE: ['TASK', 'MILESTONE'], TASK: ['SUBTASK'] };
const TYPE_LABEL = { TASK: 'Task', MODULE: 'Group of tasks', MILESTONE: 'Milestone', SUBTASK: 'Subtask' };

/** Full "new item" dialog for when you want to set details up front. Quick-add covers the common case. */
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
    <Modal open={open} onClose={onClose} title={parent ? `Add to "${parent.title}"` : 'New item'} size="lg"
      footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="new-item" disabled={busy || !v.title.trim()}>{busy ? 'Adding…' : 'Add'}</button></>}>
      <ErrorBox error={err} />
      <form id="new-item" onSubmit={submit}>
        {types.length > 1 && <div className="mb-3"><Segmented label="What are you adding?" value={v.type} onChange={set('type')} options={types.map((t) => [t, TYPE_LABEL[t]])} /></div>}
        <Field label="Title" error={fe.title}>{(id) => <input id={id} className="form-control" value={v.title} onChange={(e) => set('title')(e.target.value)} autoFocus placeholder={v.type === 'MILESTONE' ? 'Design approved' : 'Write the welcome email'} />}</Field>
        <div className="row">
          {!parent && <div className="col-md-6"><Field label="Phase">{(id) => <Select id={id} value={v.phaseId} onChange={set('phaseId')} placeholder="No phase" options={project.phases.map((p) => ({ value: p.id, label: p.name }))} />}</Field></div>}
          {v.type !== 'MILESTONE' && <div className="col-md-6"><Field label="Assigned to" hint={!can('work.editAny') ? 'You can add tasks for yourself.' : undefined}>{(id) => <Select id={id} value={v.assigneeId} onChange={set('assigneeId')} disabled={!can('work.editAny')} placeholder="Nobody yet" options={assignable.map((m) => ({ value: m.id, label: m.name }))} />}</Field></div>}
          <div className="col-6 col-md-3"><Field label={v.type === 'MILESTONE' ? 'Date' : 'Start'}>{(id) => <input id={id} type="date" className="form-control" value={v.plannedStart} onChange={(e) => set('plannedStart')(e.target.value)} />}</Field></div>
          {v.type !== 'MILESTONE' && <div className="col-6 col-md-3"><Field label="Due" error={fe.plannedFinish}>{(id) => <input id={id} type="date" className="form-control" value={v.plannedFinish} min={v.plannedStart || undefined} onChange={(e) => set('plannedFinish')(e.target.value)} />}</Field></div>}
          {!['MILESTONE', 'MODULE'].includes(v.type) && <div className="col-6 col-md-3"><Field label="Estimate (hours)">{(id) => <input id={id} type="number" min="0" step="0.5" className="form-control" value={v.estimateHours} onChange={(e) => set('estimateHours')(e.target.value)} />}</Field></div>}
        </div>
        <Field label="Notes">{(id) => <textarea id={id} rows={3} className="form-control" value={v.description} onChange={(e) => set('description')(e.target.value)} />}</Field>
        {can('work.editAny') && <div className="form-check form-switch"><input className="form-check-input" type="checkbox" role="switch" id="ni-cv" checked={v.customerVisible} disabled={!project.customerVisible} onChange={(e) => set('customerVisible')(e.target.checked)} /><label className="form-check-label" htmlFor="ni-cv">Show to client {!project.customerVisible && <span className="text-muted">(turn on client access in project settings first)</span>}</label></div>}
      </form>
    </Modal>
  );
}

function currentPhase(phases) {
  const t = todayISO();
  return phases.find((p) => p.plannedStart <= t && p.plannedFinish >= t && p.status !== 'DONE') || phases.find((p) => p.status !== 'DONE') || phases[0];
}

function QuickAdd({ phases, onAdded, defaultPhase }) {
  const { project, can } = useProject();
  const { user } = useAuth();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [phaseId, setPhaseId] = useState(defaultPhase?.id || '');
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const r = await post(`/projects/${project.id}/work-items`, { type: 'TASK', title: title.trim(), phaseId: phaseId || null, ...(can('work.editAny') ? {} : { assigneeId: user.id }) });
      setTitle(''); onAdded(r);
    } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <form className="quick-add" onSubmit={add}>
      <Plus size={18} className="text-muted flex-shrink-0" />
      <label htmlFor="qa" className="visually-hidden">New task title</label>
      <input id="qa" placeholder="Add a task and press Enter" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      {phases.length > 0 && <select className="form-select form-select-sm" style={{ width: 'auto', maxWidth: 200 }} value={phaseId} onChange={(e) => setPhaseId(e.target.value)} aria-label="Phase for the new task">
        <option value="">No phase</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
    </form>
  );
}

function TaskList() {
  const { project, can, people, openItem, reload: reloadProject } = useProject();
  const { isCustomer, user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [who, setWho] = useState('all');
  const [show, setShow] = useState('open');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [creating, setCreating] = useState(null);
  const dq = useDebounced(q);
  const { data, error, loading, reload, setData } = useLoad(() => get(`/projects/${project.id}/work-items`, { all: 'true', q: dq || undefined }), [project.id, dq]);
  useLive((e) => e.type === 'work.changed' && e.projectId === project.id && !e.self, () => reload({ silent: true }), [project.id]);
  const names = new Map(people.map((m) => [m.id, m.name]));
  const visible = (i) => (show === 'open' ? !['DONE', 'CANCELLED'].includes(i.status) : show === 'done' ? i.status === 'DONE' : true) && (who === 'all' || i.assigneeId === user.id);
  const groups = useMemo(() => {
    const items = data?.data || [];
    const ids = new Set(items.map((i) => i.id));
    const kids = new Map();
    for (const i of items) if (ids.has(i.parentId)) kids.set(i.parentId, [...(kids.get(i.parentId) || []), i]);
    const sort = (xs) => [...xs].sort((a, b) => (a.type === 'MILESTONE') - (b.type === 'MILESTONE') || (a.plannedFinish || '9').localeCompare(b.plannedFinish || '9') || a.number - b.number);
    const flatten = (list, depth) => sort(list).flatMap((i) => {
      const children = kids.get(i.id) || [];
      const shownKids = collapsed.has(i.id) ? [] : flatten(children, depth + 1);
      const self = visible(i) || shownKids.length ? [{ ...i, depth, kidCount: children.length }] : [];
      return [...self, ...shownKids];
    });
    const roots = items.filter((i) => !ids.has(i.parentId));
    const out = project.phases.map((ph) => ({ id: ph.id, name: ph.name, rows: flatten(roots.filter((i) => i.phaseId === ph.id), 0) }));
    out.push({ id: 'none', name: 'No phase', rows: flatten(roots.filter((i) => !i.phaseId || !project.phases.some((p) => p.id === i.phaseId)), 0) });
    return out.filter((g) => g.rows.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, collapsed, show, who, project.phases]);
  const toggleDone = async (r) => {
    const done = r.status !== 'DONE';
    setData((d) => ({ ...d, data: d.data.map((x) => (x.id === r.id ? { ...x, status: done ? 'DONE' : 'TODO', progress: done ? 100 : 0 } : x)) }));
    try { await setDone(project.id, r.id, done); if (done) toast(`Nice — "${r.title}" is done`, 'success'); reload(); reloadProject(); } catch (e) { toast(e.status === 403 ? 'Only the assigned person or a manager can change this task.' : e.message, 'error'); reload(); }
  };
  const bulk = async (patchBody) => {
    try { const r = await post(`/projects/${project.id}/work-items/bulk`, { ids: [...sel], patch: patchBody }); toast(`${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`, 'success'); setSel(new Set()); reload(); reloadProject(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const today = todayISO();
  const canCreate = can('work.create') && !project.readOnly;
  const total = groups.reduce((a, g) => a + g.rows.length, 0);
  return (
    <>
      <div className="filters">
        <input className="form-control" style={{ maxWidth: 240 }} placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" />
        <Segmented label="Which tasks" value={show} onChange={setShow} options={[['open', 'Open'], ['done', 'Done'], ['all', 'All']]} />
        {!isCustomer && <Segmented label="Whose tasks" value={who} onChange={setWho} options={[['all', 'Everyone'], ['me', 'Mine']]} />}
        <div className="ms-auto d-flex gap-2">
          {can('work.editAny') && !project.readOnly && <button className={`btn btn-sm ${selecting ? 'btn-outline-primary' : 'btn-light'}`} onClick={() => { setSelecting(!selecting); setSel(new Set()); }}><ListChecks size={15} /> {selecting ? 'Done selecting' : 'Select'}</button>}
          {!isCustomer && can('export.csv') && <button className="btn btn-sm btn-light" onClick={() => download(`/projects/${project.id}/export/work-items.csv`, `${project.code}-tasks.csv`)} title="Download as CSV" aria-label="Download tasks as CSV"><Download size={15} /></button>}
          {canCreate && <button className="btn btn-sm btn-primary" onClick={() => setCreating({})}><Plus size={15} /> New</button>}
        </div>
      </div>
      {selecting && sel.size > 0 && (
        <div className="notice info mb-3 align-items-center flex-wrap"><strong>{sel.size} selected</strong>
          <Select aria-label="Set status" value="" onChange={(v) => v && bulk({ status: v })} placeholder="Change status…" options={STATUSES.map((s) => ({ value: s, label: labelize(s) }))} />
          <Select aria-label="Assign to" value="" onChange={(v) => v && bulk({ assigneeId: v === 'none' ? null : v })} placeholder="Assign to…" options={[{ value: 'none', label: 'Nobody' }, ...people.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role)).map((m) => ({ value: m.id, label: m.name }))]} />
          {project.customerVisible && <><button className="btn btn-sm btn-light" onClick={() => bulk({ customerVisible: true })}>Show to client</button><button className="btn btn-sm btn-light" onClick={() => bulk({ customerVisible: false })}>Hide from client</button></>}
          <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}><X size={14} /> Clear</button>
        </div>)}
      {canCreate && <QuickAdd phases={project.phases} defaultPhase={currentPhase(project.phases)} onAdded={(r) => { toast(`Added "${r.title}"`, 'success'); reload(); reloadProject(); }} />}
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : total === 0 ? (
        <Card><Empty title={q ? 'No matching tasks' : show === 'done' ? 'Nothing finished yet' : isCustomer ? 'Nothing shared yet' : 'No open tasks'}>{q ? 'Try another word.' : isCustomer ? 'Your project team will share tasks with you here.' : canCreate && show !== 'done' ? 'Type a task above and press Enter.' : ''}</Empty></Card>
      ) : groups.map((g) => (
        <section key={g.id}>
          <button className="group-head" onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(`g:${g.id}`) ? n.delete(`g:${g.id}`) : n.add(`g:${g.id}`); return n; })} aria-expanded={!collapsed.has(`g:${g.id}`)}>
            {collapsed.has(`g:${g.id}`) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}{g.name}<span className="n">{g.rows.length}</span></button>
          {!collapsed.has(`g:${g.id}`) && g.rows.map((r) => {
            const done = r.status === 'DONE';
            const late = r.plannedFinish && r.plannedFinish < today && !done && r.status !== 'CANCELLED';
            return (
              <div key={r.id} className={`task-row ${done ? 'done' : ''}`} style={{ marginLeft: r.depth * 26 }}>
                {selecting && <input type="checkbox" className="form-check-input m-0" aria-label={`Select ${r.title}`} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} />}
                {r.type === 'MODULE' ? <button className="btn btn-ghost btn-icon p-0" aria-label={collapsed.has(r.id) ? 'Show tasks in group' : 'Hide tasks in group'} onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}>{collapsed.has(r.id) ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</button>
                  : r.type === 'MILESTONE' ? <Flag size={19} className={done ? 'text-success' : 'text-warning'} aria-label="Milestone" />
                  : <CheckButton done={done} label={r.title} onToggle={() => toggleDone(r)} disabled={isCustomer || project.readOnly || r.kidCount > 0} />}
                <TypeIcon type={r.type} />
                <span className="mono" style={{ minWidth: 64, color: 'var(--muted)', fontSize: '0.8125rem' }}>{r.key}</span>
                <button className="title" onClick={() => openItem(r.id)} style={r.type === 'MODULE' ? { fontWeight: 600 } : undefined}>{r.title}</button>
                {r.kidCount > 0 && <span className="small text-muted">{Math.round(r.progress ?? 0)}%</span>}
                {!isCustomer && !r.customerVisible && project.customerVisible && <Lock size={13} className="text-muted flex-shrink-0" aria-label="Hidden from client" title="Hidden from client" />}
                {r.scheduleConflict && <AlertTriangle size={14} className="text-warning flex-shrink-0" aria-label="Starts before the task it waits for finishes" title="Starts before the task it waits for finishes" />}
                <StatusBadge status={r.status} />
                {!isCustomer && r.priority && <PriorityIcon priority={r.priority} />}
                {r.plannedFinish && <span className={late ? '' : ''}><DueChip date={r.plannedFinish} done={done} /></span>}
                {!isCustomer && (r.assigneeId ? <Avatar sm name={names.get(r.assigneeId)} /> : r.type !== 'MILESTONE' && r.type !== 'MODULE' && <span className="avatar sm" style={{ background: 'var(--surface-soft)', color: 'var(--muted)' }} title="Not assigned">?</span>)}
                {canCreate && CHILD_TYPES[r.type] && <button className="btn btn-ghost btn-icon p-1" aria-label={`Add inside ${r.title}`} title={r.type === 'TASK' ? 'Add a subtask' : 'Add a task to this group'} onClick={() => setCreating({ parent: r })}><Plus size={15} /></button>}
              </div>);
          })}
        </section>))}
      <NewItemModal open={Boolean(creating)} parent={creating?.parent} defaultPhaseId={currentPhase(project.phases)?.id} onClose={() => setCreating(null)} onCreated={(r) => { toast(`Added "${r.title}"`, 'success'); reload(); reloadProject(); }} />
    </>
  );
}

export function Board() {
  const { project, can, people, openItem } = useProject();
  const { user, isCustomer } = useAuth();
  const toast = useToast();
  const [over, setOver] = useState(null);
  const [q, setQ] = useState('');
  const [who, setWho] = useState(() => new Set());
  const { data, error, loading, reload, setData } = useLoad(() => get(`/projects/${project.id}/work-items`, { all: 'true', type: 'TASK,SUBTASK' }), [project.id]);
  useLive((e) => e.type === 'work.changed' && e.projectId === project.id && !e.self, () => reload({ silent: true }), [project.id]);
  const names = new Map(people.map((m) => [m.id, m.name]));
  const phase = new Map(project.phases.map((ph) => [ph.id, ph.name]));
  const move = async (id, status) => {
    const it = data.data.find((x) => x.id === id);
    if (!it || it.status === status) return;
    setData((d) => ({ ...d, data: d.data.map((x) => (x.id === id ? { ...x, status } : x)) }));
    try { await patch(`/projects/${project.id}/work-items/${id}`, { status, version: it.version }); reload(); }
    catch (e) { toast(e.status === 403 ? 'You can only move tasks assigned to you' : e.message, 'error'); reload(); }
  };
  const items = (data?.data || []).filter((i) => (!q || `${i.key} ${i.title}`.toLowerCase().includes(q.toLowerCase())) && (!who.size || who.has(i.assigneeId || 'none')));
  const cols = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', ...(items.some((i) => i.status === 'BLOCKED') ? ['BLOCKED'] : [])];
  const today = todayISO();
  const assignees = people.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role));
  const toggleWho = (id) => setWho((w) => { const n = new Set(w); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <>
      <div className="filters">
        <div className="position-relative" style={{ width: 200 }}><input className="form-control" placeholder="Search board" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search board" /></div>
        {!isCustomer && <div className="avatar-stack ms-2" role="group" aria-label="Filter by person">{assignees.slice(0, 8).map((m) => (
          <button key={m.id} type="button" className="btn p-0 border-0" style={{ borderRadius: '50%', marginLeft: -4, boxShadow: who.has(m.id) ? '0 0 0 2px var(--brand)' : 'none', zIndex: who.has(m.id) ? 2 : 1 }}
            aria-pressed={who.has(m.id)} title={m.name} aria-label={`Show ${m.name}'s tasks`} onClick={() => toggleWho(m.id)}><Avatar name={m.name} /></button>))}</div>}
        {!isCustomer && <button className={`btn btn-sm ${who.size === 1 && who.has(user.id) ? 'btn-outline-primary' : 'btn-light'}`} onClick={() => setWho(who.size === 1 && who.has(user.id) ? new Set() : new Set([user.id]))}>Only my tasks</button>}
        {(who.size > 0 || q) && <button className="btn btn-sm btn-ghost" onClick={() => { setWho(new Set()); setQ(''); }}>Clear filters</button>}
        <span className="small text-muted ms-auto">Drag cards between columns to change their status.</span>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <div className="board">{cols.map((s) => {
          const list = items.filter((i) => i.status === s);
          return (
            <section key={s} className={`board-col ${over === s ? 'drop' : ''}`} aria-label={labelize(s)} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); move(e.dataTransfer.getData('text/plain'), s); }}>
              <h3><StatusBadge status={s} /><span className="n">{list.length}</span></h3>
              {list.map((i) => {
                const done = i.status === 'DONE';
                return (
                  <article key={i.id} className={`board-card ${done ? 'done' : ''}`} draggable={!project.readOnly} onDragStart={(e) => e.dataTransfer.setData('text/plain', i.id)} onClick={() => openItem(i.id)}>
                    <button className="title" onClick={(e) => { e.stopPropagation(); openItem(i.id); }}>{i.title}</button>
                    {(i.phaseId && phase.get(i.phaseId)) && <div className="chips"><span className="epic" title="Stage">{phase.get(i.phaseId)}</span></div>}
                    <div className="foot">
                      <TypeIcon type={i.type} />
                      <span className="key">{i.key}</span>
                      {i.plannedFinish && !done && <DueChip date={i.plannedFinish} done={done} />}
                      <span className="ms-auto d-inline-flex align-items-center gap-1">
                        {!isCustomer && i.priority && <PriorityIcon priority={i.priority} />}
                        {!isCustomer && (i.assigneeId ? <Avatar name={names.get(i.assigneeId)} title={names.get(i.assigneeId)} /> : <span className="avatar avatar-empty" title="Unassigned">?</span>)}
                      </span>
                    </div>
                    {i.plannedFinish && i.plannedFinish < today && !done && <span className="visually-hidden">Overdue</span>}
                  </article>);
              })}
            </section>);
        })}</div>)}
      {!can('work.editAny') && <div className="form-text mt-2">You can move tasks assigned to you.</div>}
    </>
  );
}

/** Backlog: every task grouped by stage (quick add, bulk edit, sub-tasks). */
/** Clients get the simple task list; the team's "Tasks" tab opens on the List view (the old backlog is gone). */
export function TasksTab() {
  const { isCustomer } = useAuth();
  const loc = useLocation();
  if (!isCustomer) return <Navigate to={`../list${loc.search}`} relative="path" replace />;
  return <TaskList />;
}
/** Jira-style board: drag cards between status columns. */
export function BoardTab() { return <Board />; }
/** Spreadsheet list: inline editing of names, owners, dates and estimates. */
export function ListTab() { return <TaskGrid />; }
export function TimelineTab() { return <Timeline />; }
export function CalendarTab() { return <CalendarView />; }
