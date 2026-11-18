import { useMemo, useState } from 'react';
import { Plus, ChevronRight, ChevronDown, List, Columns3, GanttChart, CalendarDays, Download, Lock, AlertTriangle, Flag, ListChecks, X, Table2, Upload } from 'lucide-react';
import { get, post, patch, download } from '../../api/client.js';
import { useLive } from '../../lib/live.js';
import { useLoad, useDebounced } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { labelize, todayISO } from '../../lib/format.js';
import { setDone } from '../../lib/tasks.js';
import { Avatar, CheckButton, DueChip, Empty, ErrorBox, Field, Loading, Meter, Modal, PriorityBadge, Segmented, Select, StatusBadge, fieldErrors, useToast, Card } from '../../components/ui.jsx';
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
                <button className="title" onClick={() => openItem(r.id)} style={r.type === 'MODULE' ? { fontWeight: 800 } : undefined}>{r.title}</button>
                {r.kidCount > 0 && <span className="small text-muted">{Math.round(r.progress ?? 0)}%</span>}
                {!isCustomer && !r.customerVisible && project.customerVisible && <Lock size={13} className="text-muted flex-shrink-0" aria-label="Hidden from client" title="Hidden from client" />}
                {r.scheduleConflict && <AlertTriangle size={14} className="text-warning flex-shrink-0" aria-label="Starts before the task it waits for finishes" title="Starts before the task it waits for finishes" />}
                {!['TODO', 'DONE'].includes(r.status) && <StatusBadge status={r.status} />}
                {r.priority && ['HIGH', 'CRITICAL'].includes(r.priority) && !done && <PriorityBadge priority={r.priority} />}
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
  const toast = useToast();
  const [over, setOver] = useState(null);
  const [mine, setMine] = useState('all');
  const { data, error, loading, reload, setData } = useLoad(() => get(`/projects/${project.id}/work-items`, { all: 'true', type: 'TASK,SUBTASK', assigneeId: mine === 'me' ? 'me' : undefined }), [project.id, mine]);
  useLive((e) => e.type === 'work.changed' && e.projectId === project.id && !e.self, () => reload({ silent: true }), [project.id]);
  const names = new Map(people.map((m) => [m.id, m.name]));
  const move = async (id, status) => {
    const it = data.data.find((x) => x.id === id);
    if (!it || it.status === status) return;
    setData((d) => ({ ...d, data: d.data.map((x) => (x.id === id ? { ...x, status } : x)) }));
    try { await patch(`/projects/${project.id}/work-items/${id}`, { status, version: it.version }); reload(); }
    catch (e) { toast(e.status === 403 ? 'You can only move tasks assigned to you' : e.message, 'error'); reload(); }
  };
  const cols = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', ...((data?.data || []).some((i) => i.status === 'BLOCKED') ? ['BLOCKED'] : [])];
  return (
    <>
      <div className="filters"><Segmented label="Whose tasks" value={mine} onChange={setMine} options={[['all', 'Everyone'], ['me', 'Mine']]} /><span className="small text-muted">Drag cards between columns to update them.</span></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <div className="board">{cols.map((s) => {
          const items = (data?.data || []).filter((i) => i.status === s);
          return (
            <section key={s} className={`board-col ${over === s ? 'drop' : ''}`} aria-label={labelize(s)} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); move(e.dataTransfer.getData('text/plain'), s); }}>
              <h3><StatusBadge status={s} /><span className="text-muted">{items.length}</span></h3>
              {items.map((i) => (
                <article key={i.id} className="board-card" draggable={!project.readOnly} onDragStart={(e) => e.dataTransfer.setData('text/plain', i.id)}>
                  <button className="title btn btn-link p-0 text-start text-decoration-none d-block" onClick={() => openItem(i.id)}>{i.title}</button>
                  <div className="d-flex justify-content-between align-items-center">{i.assigneeId ? <Avatar sm name={names.get(i.assigneeId)} /> : <span className="small text-muted">Unassigned</span>}<DueChip date={i.plannedFinish} done={s === 'DONE'} /></div>
                  {i.progress > 0 && s !== 'DONE' && <div className="mt-2"><Meter value={i.progress} /></div>}
                </article>))}
            </section>);
        })}</div>)}
      {!can('work.editAny') && <div className="form-text mt-2">You can move tasks assigned to you.</div>}
    </>
  );
}

export function TasksTab() {
  const { isCustomer } = useAuth();
  const [view, setView] = useState(() => { try { return localStorage.getItem('meridian.taskView') || 'list'; } catch { return 'list'; } });
  const choose = (v) => { setView(v); try { localStorage.setItem('meridian.taskView', v); } catch { /* private mode */ } };
  const options = [['list', 'List', List], ...(isCustomer ? [] : [['grid', 'Table', Table2], ['board', 'Board', Columns3], ['timeline', 'Gantt', GanttChart]]), ['calendar', 'Calendar', CalendarDays]];
  const current = options.some((o) => o[0] === view) ? view : 'list';
  return (
    <>
      <div className="mb-3"><Segmented label="View" value={current} onChange={choose} options={options} /></div>
      {current === 'list' && <TaskList />}
      {current === 'grid' && <TaskGrid />}
      {current === 'board' && <Board />}
      {current === 'timeline' && <Timeline />}
      {current === 'calendar' && <CalendarView />}
    </>
  );
}
