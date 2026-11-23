import { useMemo, useState } from 'react';
import { Search, Flag, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Upload } from 'lucide-react';
import { ImportTasksDialog } from './Import.jsx';
import { DateCell, useDateChange, movedText } from './DateChange.jsx';
import { get, patch, post } from '../../api/client.js';
import { useLoad, useDebounced } from '../../lib/hooks.js';
import { useLive } from '../../lib/live.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { labelize, todayISO } from '../../lib/format.js';
import { Avatar, ErrorBox, Loading, Empty, useToast, priorityLabel } from '../../components/ui.jsx';
import { useProject } from './Workspace.jsx';

const STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED'];
const PRIS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const PRI_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const STATUS_COLOR = { TODO: '#64748b', IN_PROGRESS: '#2563eb', IN_REVIEW: '#7c3aed', BLOCKED: '#dc2626', DONE: '#16a34a', CANCELLED: '#94a3b8' };

/** Spreadsheet-style task table: inline edits, grouping, filters, sorting and totals. */
export function TaskGrid() {
  const { project, can, people, openItem, reload: reloadProject } = useProject();
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState('phase');
  const [who, setWho] = useState('');
  const [show, setShow] = useState('open');
  const [prio, setPrio] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const [sort, setSort] = useState({ k: 'plannedFinish', dir: 1 });
  const [closed, setClosed] = useState(() => new Set());
  const [sel, setSel] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const dq = useDebounced(q);
  const { data, error, loading, reload, setData } = useLoad(() => get(`/projects/${project.id}/work-items`, { all: 'true', q: dq || undefined }), [project.id, dq]);
  useLive((e) => e.type === 'work.changed' && e.projectId === project.id && !e.self, () => reload({ silent: true }), [project.id]);
  const editAny = can('work.editAny') && !project.readOnly;
  const today = todayISO();
  const names = new Map(people.map((m) => [m.id, m.name]));
  const assignable = people.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role));
  const phaseName = new Map(project.phases.map((p) => [p.id, p.name]));
  const all = data?.data || [];
  const keyOf = new Map(all.map((i) => [i.id, i.key]));
  const rows = useMemo(() => {
    let r = all.filter((i) => i.type !== 'MODULE' && i.type !== 'MILESTONE'); // milestones are key dates (Timeline, Calendar, Plan), not tasks
    if (show === 'open') r = r.filter((i) => !['DONE', 'CANCELLED'].includes(i.status));
    if (show === 'done') r = r.filter((i) => i.status === 'DONE');
    if (who) r = r.filter((i) => (who === 'none' ? !i.assigneeId : i.assigneeId === who));
    if (prio) r = r.filter((i) => i.priority === prio);
    if (lateOnly) r = r.filter((i) => i.plannedFinish && i.plannedFinish < today && !['DONE', 'CANCELLED'].includes(i.status));
    const val = (i) => (sort.k === 'priority' ? PRI_ORDER[i.priority] ?? 9 : sort.k === 'assignee' ? names.get(i.assigneeId) || '~' : sort.k === 'status' ? STATUSES.indexOf(i.status) : i[sort.k] ?? (typeof i[sort.k] === 'number' ? 0 : '~'));
    return [...r].sort((a, b) => { const x = val(a); const y = val(b); return (x < y ? -1 : x > y ? 1 : a.number - b.number) * sort.dir; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, show, who, prio, lateOnly, sort]);
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: 'All tasks', rows }];
    const keyFn = { phase: (i) => i.phaseId || 'none', assignee: (i) => i.assigneeId || 'none', status: (i) => i.status, priority: (i) => i.priority || 'MEDIUM' }[groupBy];
    const order = groupBy === 'phase' ? [...project.phases.map((p) => p.id), 'none'] : groupBy === 'status' ? STATUSES : groupBy === 'priority' ? PRIS : [...assignable.map((m) => m.id), 'none'];
    const label = (k) => (groupBy === 'phase' ? phaseName.get(k) || 'No phase' : groupBy === 'assignee' ? names.get(k) || 'Unassigned' : groupBy === 'priority' ? priorityLabel(k) : labelize(k));
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); m.set(k, [...(m.get(k) || []), r]); }
    return [...new Set([...order, ...m.keys()])].filter((k) => m.has(k)).map((k) => ({ key: k, label: label(k), rows: m.get(k) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupBy, project.phases, people]);

  const dates = useDateChange({ project, onChanged: (item) => {
    if (item) setData((d) => ({ ...d, data: d.data.map((x) => (x.id === item.id ? { ...x, ...item } : x)) })); // new version + dates right away
    reload({ silent: true }); reloadProject();
  } });
  const save = async (i, changes) => {
    setData((d) => ({ ...d, data: d.data.map((x) => (x.id === i.id ? { ...x, ...changes } : x)) }));
    try {
      const r = await patch(`/projects/${project.id}/work-items/${i.id}`, { ...changes, version: i.version });
      setData((d) => ({ ...d, data: d.data.map((x) => (x.id === i.id ? { ...x, ...changes, version: r.version ?? x.version + 1 } : x)) }));
      if (r.rescheduled?.moved?.length) { const t = movedText(r.rescheduled.moved.filter((m) => m.id !== i.id && m.type !== 'MODULE'), project.code); if (t) toast(`${i.title}: ${t}`, 'success'); reload({ silent: true }); }
      reloadProject();
    } catch (e) { toast(e.status === 409 ? 'Someone else changed this task — refreshed.' : e.status === 403 ? 'You can only update tasks assigned to you' : e.message, 'error'); reload({ silent: true }); }
  };
  const bulk = async (patchBody, label) => {
    try { const r = await post(`/projects/${project.id}/work-items/bulk`, { ids: [...sel], patch: patchBody }); toast(`${label}: ${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`, 'success'); setSel(new Set()); reload({ silent: true }); reloadProject(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const Th = ({ k, children, className = '', style }) => <th className={className} style={style}><button className="sort" onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : 1 }))}>{children}{sort.k === k && (sort.dir > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>;
  const sum = (rs, k) => rs.reduce((s, i) => s + (Number(i[k]) || 0), 0);
  const fmtH = (n) => (n ? `${Math.round(n * 10) / 10}h` : '—');
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const canRow = (i) => editAny || (i.assigneeId === user.id && !project.readOnly);
  const cols = 12 - (groupBy === 'phase' ? 1 : 0);
  return (
    <>
      <div className="filters">
        <div className="position-relative" style={{ maxWidth: 220 }}><Search size={14} className="position-absolute text-muted" style={{ left: 9, top: 10 }} /><input className="form-control form-control-sm ps-4" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" /></div>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Group by"><option value="phase">Group: Phase</option><option value="assignee">Group: Assignee</option><option value="status">Group: Status</option><option value="priority">Group: Priority</option><option value="none">No grouping</option></select>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={show} onChange={(e) => setShow(e.target.value)} aria-label="Status filter"><option value="open">Open tasks</option><option value="done">Done</option><option value="all">All tasks</option></select>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assignee filter"><option value="">Everyone</option><option value={user.id}>Me</option><option value="none">Unassigned</option>{assignable.filter((m) => m.id !== user.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Priority filter"><option value="">Any priority</option>{PRIS.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}</select>
        <label className="small d-inline-flex align-items-center gap-1"><input type="checkbox" className="form-check-input m-0" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} /> Overdue only</label>
        {editAny && <button className="btn btn-sm btn-light" onClick={() => setImporting(true)}><Upload size={14} /> Import CSV</button>}
        <span className="ms-auto small text-muted">{rows.length} tasks · {fmtH(sum(rows, 'estimateHours'))} estimated · {fmtH(sum(rows, 'loggedHours'))} logged</span>
      </div>
      {sel.size > 0 && editAny && <div className="bulkbar rounded mb-2">
        <strong>{sel.size} selected</strong>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && bulk({ status: e.target.value }, 'Status')} aria-label="Set status"><option value="">Status…</option>{STATUSES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}</select>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && bulk({ assigneeId: e.target.value === '-' ? null : e.target.value }, 'Assigned')} aria-label="Assign"><option value="">Assign to…</option><option value="-">Nobody</option>{assignable.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && bulk({ priority: e.target.value }, 'Priority')} aria-label="Priority"><option value="">Priority…</option>{PRIS.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}</select>
        <button className="btn btn-sm btn-ghost ms-auto" onClick={() => setSel(new Set())}>Clear</button>
      </div>}
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading rows={8} /> : rows.length === 0 ? <div className="card"><Empty title="No tasks match these filters" /></div> : (
        <div className="card grid-card"><div className="table-wrap"><table className="table grid-table mb-0">
          <thead><tr>
            {editAny && <th style={{ width: 34 }}><input type="checkbox" className="form-check-input" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" /></th>}
            <Th k="number" style={{ width: 84 }}>Key</Th><Th k="title" style={{ minWidth: 240 }}>Task</Th>{groupBy !== 'phase' && <th>Phase</th>}<Th k="status" style={{ width: 140 }}>Status</Th><Th k="assignee" style={{ width: 170 }}>Assignee</Th><Th k="priority" style={{ width: 120 }}>Priority</Th>
            <Th k="plannedStart" style={{ width: 140 }}>Start</Th><Th k="plannedFinish" style={{ width: 140 }}>Due</Th><Th k="estimateHours" className="text-end" style={{ width: 76 }}>Est.</Th><Th k="loggedHours" className="text-end" style={{ width: 76 }}>Logged</Th><Th k="progress" style={{ width: 120 }}>Progress</Th>
          </tr></thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              {groupBy !== 'none' && <tr className="grid-group"><td colSpan={cols + (editAny ? 1 : 0)}>
                <button className="btn btn-link p-0 text-body fw-semibold d-inline-flex align-items-center gap-1" onClick={() => setClosed((c) => { const n = new Set(c); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}>{closed.has(g.key) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}{groupBy === 'assignee' && g.key !== 'none' && <Avatar sm name={g.label} />}{g.label}</button>
                <span className="small text-muted ms-2">{g.rows.length} · {fmtH(sum(g.rows, 'estimateHours'))} est. · {fmtH(sum(g.rows, 'loggedHours'))} logged</span></td></tr>}
              {!closed.has(g.key) && g.rows.map((i) => {
                const late = i.plannedFinish && i.plannedFinish < today && !['DONE', 'CANCELLED'].includes(i.status);
                const ms = i.type === 'MILESTONE'; const edit = canRow(i);
                return (
                  <tr key={i.id} className={i.status === 'DONE' ? 'is-done' : ''}>
                    {editAny && <td><input type="checkbox" className="form-check-input" checked={sel.has(i.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; })} aria-label={`Select ${i.title}`} /></td>}
                    <td className="mono">{i.key}</td>
                    <td style={{ maxWidth: 320 }}><button className="btn btn-link p-0 text-start text-body fw-semibold grid-title" onClick={() => openItem(i.id)} title={i.title}>{ms && <Flag size={13} className="text-warning me-1" />}{i.title}</button>
                      {i.parentId && keyOf.get(i.parentId) && <div className="small text-muted">in {keyOf.get(i.parentId)}</div>}</td>
                    {groupBy !== 'phase' && <td className="small text-muted text-nowrap">{phaseName.get(i.phaseId) || '—'}</td>}
                    <td><select className="cell-select fw-semibold" style={{ color: STATUS_COLOR[i.status] }} value={i.status} disabled={!edit} onChange={(e) => save(i, { status: e.target.value })} aria-label={`Status of ${i.title}`}>{STATUSES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}</select></td>
                    <td>{ms ? <span className="small text-muted">—</span> : <select className="cell-select" value={i.assigneeId || ''} disabled={!editAny} onChange={(e) => save(i, { assigneeId: e.target.value || null })} aria-label={`Assignee of ${i.title}`}><option value="">Unassigned</option>{assignable.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}</td>
                    <td><select className={`cell-select prio-${i.priority}`} value={i.priority || 'MEDIUM'} disabled={!editAny} onChange={(e) => save(i, { priority: e.target.value })} aria-label={`Priority of ${i.title}`}>{PRIS.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}</select></td>
                    <td><DateCell value={i.plannedStart} disabled={!editAny} label={`${ms ? 'Date' : 'Start'} of ${i.title}`} onCommit={(v) => dates.change(i, ms ? { plannedFinish: v } : { plannedStart: v })} /></td>
                    <td>{ms ? <span className="small text-muted ps-2">same day</span> : <DateCell value={i.plannedFinish} className={late ? 'late' : ''} min={i.plannedStart || undefined} disabled={!editAny} label={`Due date of ${i.title}`} onCommit={(v) => dates.change(i, { plannedFinish: v })} />}</td>
                    <td className="text-end">{ms ? '—' : <input type="number" min="0" step="0.5" className="cell-input text-end" style={{ width: 58 }} defaultValue={i.estimateHours ?? ''} key={`${i.id}-${i.estimateHours}`} disabled={!editAny} onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (i.estimateHours ?? null)) save(i, { estimateHours: v }); }} aria-label={`Estimate of ${i.title}`} />}</td>
                    <td className={`text-end small num ${i.estimateHours && i.loggedHours > i.estimateHours ? 'text-danger fw-semibold' : ''}`}>{fmtH(i.loggedHours)}</td>
                    <td><div className="d-flex align-items-center gap-1"><div className="meter flex-grow-1"><span style={{ width: `${i.progress || 0}%`, background: i.status === 'DONE' ? 'var(--green)' : undefined }} /></div><span className="small num" style={{ width: 32 }}>{Math.round(i.progress || 0)}%</span></div></td>
                  </tr>);
              })}
            </tbody>))}
          <tfoot><tr><td colSpan={(editAny ? 1 : 0) + (groupBy !== 'phase' ? 9 : 8)} className="small text-muted">Totals</td><td className="text-end small fw-semibold num">{fmtH(sum(rows, 'estimateHours'))}</td><td className="text-end small fw-semibold num">{fmtH(sum(rows, 'loggedHours'))}</td><td /></tr></tfoot>
        </table></div></div>)}
      {dates.dialog}
      {importing && <ImportTasksDialog project={project} onClose={() => setImporting(false)} onDone={() => { reload({ silent: true }); reloadProject(); }} />}
      {!editAny && <div className="form-text mt-2">You can change the status of tasks assigned to you. Managers can edit everything.</div>}
    </>
  );
}
