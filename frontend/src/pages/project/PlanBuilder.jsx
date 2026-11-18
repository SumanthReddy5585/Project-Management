import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Flag, Pin, PinOff, ChevronDown, CalendarDays, Check, ListTodo, Pencil } from 'lucide-react';
import { get, post, patch, del } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useLive, emitLocal } from '../../lib/live.js';
import { fmtDate } from '../../lib/format.js';
import { ConfirmButton, ErrorBox, Loading, StatusBadge, useToast } from '../../components/ui.jsx';
import { useProject } from './Workspace.jsx';
import { DateCell, movedText } from './DateChange.jsx';

// The simple plan editor. Each row is: what · who · how many working days · what it waits for.
// Dates are calculated by the server: tasks that wait for nothing run in parallel from the project start,
// a task that waits for others starts the working day after the last of them ends, and when a task gets
// longer or moves, everything that waits for it moves too.

const dayMs = 86400000;
const dnum = (iso) => Date.parse(`${iso}T00:00:00Z`) / dayMs;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Put children straight after their parent, keep the server's order otherwise. */
function orderTree(rows) {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map();
  for (const r of rows) if (r.parentId && ids.has(r.parentId)) kids.set(r.parentId, [...(kids.get(r.parentId) || []), r]);
  const out = [];
  const walk = (r, depth) => { out.push({ ...r, depth }); for (const k of kids.get(r.id) || []) walk(k, depth + 1); };
  for (const r of rows) if (!r.parentId || !ids.has(r.parentId)) walk(r, 0);
  return out;
}

export function PlanBuilder({ compact = false }) {
  const { project, people, reload: reloadProject } = useProject();
  const toast = useToast();
  const plan = useLoad(() => get(`/projects/${project.id}/plan-items`), [project.id]);
  useLive((e) => e.type === 'work.changed' && e.projectId === project.id, () => plan.reload({ silent: true }), [project.id]);
  const assignable = people.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role));
  const d = plan.data;

  const groups = useMemo(() => {
    if (!d) return [];
    const byPhase = new Map(d.phases.map((ph) => [ph.id, []]));
    const loose = [];
    for (const r of d.rows) (r.phaseId && byPhase.has(r.phaseId) ? byPhase.get(r.phaseId) : loose).push(r);
    const gs = d.phases.map((ph) => ({ id: ph.id, phase: ph, name: ph.name, rows: orderTree(byPhase.get(ph.id)) }));
    if (loose.length || !gs.length) gs.push({ id: null, name: gs.length ? 'Not in a stage' : 'Tasks', rows: orderTree(loose) });
    return gs;
  }, [d]);
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const byId = useMemo(() => new Map(flat.map((r) => [r.id, r])), [flat]);

  if (plan.loading && !d) return <Loading rows={6} />;
  if (plan.error) return <ErrorBox error={plan.error} onRetry={plan.reload} />;
  const canEdit = d.canEdit;
  const span = { from: d.calculatedStart || d.projectStart, to: d.calculatedFinish || d.projectFinish };
  const spanDays = Math.max(1, dnum(span.to) - dnum(span.from) + 1);

  const after = (res, what) => {
    const moved = (res?.rescheduled?.moved || []).filter((m) => m.type !== 'MODULE' && m.id !== res?.item?.id);
    const t = movedText(moved, project.code);
    if (t || what) toast([what, t].filter(Boolean).join(' · '), 'success');
    if (res?.rescheduled?.cycle) toast(res.rescheduled.cycle, 'error');
    plan.reload({ silent: true }); reloadProject();
    emitLocal({ type: 'work.changed', projectId: project.id, self: true });
  };
  const fail = (e) => { toast(e.status === 409 ? 'Someone else just changed this — showing the latest plan.' : e.message, 'error'); plan.reload({ silent: true }); };
  const update = async (row, changes, what) => {
    try { after(await patch(`/projects/${project.id}/plan-items/${row.id}`, { ...changes, version: row.version }), what); return true; } catch (e) { fail(e); return false; }
  };
  const remove = async (row) => {
    try { after(await del(`/projects/${project.id}/plan-items/${row.id}`), `Removed ${row.title}`); } catch (e) { fail(e); }
  };
  const add = async (body) => {
    try { const r = await post(`/projects/${project.id}/plan-items`, body); after(r, null); return r.item; } catch (e) { fail(e); return null; }
  };
  const addStage = async (name) => {
    try { await post(`/projects/${project.id}/phases`, { name }); plan.reload({ silent: true }); reloadProject(); return true; } catch (e) { fail(e); return false; }
  };
  const renameStage = async (ph, name) => {
    try { await patch(`/projects/${project.id}/phases/${ph.id}`, { name, version: ph.version }); plan.reload({ silent: true }); reloadProject(); } catch (e) { fail(e); }
  };

  const tasks = d.rows.filter((r) => r.type !== 'MILESTONE' && r.type !== 'MODULE').length;
  const milestones = d.rows.filter((r) => r.type === 'MILESTONE').length;
  return (
    <div className={`pb ${compact ? 'pb-compact' : ''}`}>
      {!compact && <div className="pb-how">
        <div><span className="n">1</span><b>List the work</b> — task name, who does it, and how many working days it takes.</div>
        <div><span className="n">2</span><b>Say what it waits for</b> — “After previous task”, or pick the tasks. Tasks that wait for nothing run <b>in parallel</b>.</div>
        <div><span className="n">3</span><b>Dates are worked out for you</b> — change a length or a link and every task after it moves.</div>
      </div>}
      <div className="pb-summary">
        <div className="pb-sum-item"><span className="lbl">Project starts</span>
          {canEdit && !d.approved ? <ProjectStart project={project} onDone={() => { plan.reload({ silent: true }); reloadProject(); }} /> : <b>{fmtDate(d.projectStart)}</b>}</div>
        <div className="pb-sum-item"><span className="lbl">{d.approved ? 'Work now ends' : 'Plan ends'}</span><b className="big">{d.calculatedFinish ? fmtDate(d.calculatedFinish) : '—'}</b>
          {d.calculatedFinish && <span className="text-muted small">{plural(d.workingDays, 'working day')}</span>}</div>
        {d.approved && <div className="pb-sum-item"><span className="lbl">Original end</span><b>{fmtDate(d.projectFinish)}</b></div>}
        <div className="pb-sum-item"><span className="lbl">In the plan</span><b>{plural(tasks, 'task')} · {plural(milestones, 'milestone')}</b></div>
      </div>

      {groups.map((g, gi) => (
        <section className="pb-stage" key={g.id ?? 'none'}>
          <StageHead group={g} index={gi} canEdit={canEdit && Boolean(g.phase)} onRename={(name) => renameStage(g.phase, name)} />
          <div className="table-responsive">
            <table className="table pb-table align-middle mb-0">
              <thead><tr><th className="c-num">#</th><th>Task</th><th className="c-owner">Who</th><th className="c-days">Days</th><th className="c-after">Starts after</th><th className="c-date">Start</th><th className="c-date">Finish</th><th className="c-bar"><span className="visually-hidden">Timeline</span></th><th className="c-act" /></tr></thead>
              <tbody>
                {g.rows.map((r) => <Row key={r.id} r={r} flat={flat} byId={byId} people={assignable} canEdit={canEdit} span={span} spanDays={spanDays} code={project.code}
                  onUpdate={update} onRemove={remove} />)}
                {canEdit && <AddRow group={g} flat={flat} groups={groups} people={assignable} onAdd={add} />}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {canEdit && <AddStage onAdd={addStage} />}
    </div>
  );
}

function ProjectStart({ project, onDone }) {
  const toast = useToast();
  const commit = async (v) => {
    try { await patch(`/projects/${project.id}`, { plannedStart: v, version: project.version }); toast(`Project start moved to ${fmtDate(v)} — the plan moved with it`, 'success'); onDone(); }
    catch (e) { toast(e.message, 'error'); onDone(); }
  };
  return <DateCell value={project.plannedStart} onCommit={commit} label="Project start date" />;
}

function StageHead({ group: g, index, canEdit, onRename }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(g.name);
  useEffect(() => setName(g.name), [g.name]);
  const rows = g.rows.filter((r) => r.start);
  const s = rows.map((r) => r.start).sort()[0]; const f = rows.map((r) => r.finish).sort().at(-1);
  const save = () => { setEdit(false); if (name.trim() && name.trim() !== g.name) onRename(name.trim()); else setName(g.name); };
  return (
    <div className="pb-stage-head">
      <span className="pb-stage-n">{g.phase ? index + 1 : '·'}</span>
      {edit ? <input className="form-control form-control-sm pb-stage-input" autoFocus value={name} aria-label="Stage name" onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setName(g.name); setEdit(false); } }} />
        : <h3 className="pb-stage-name">{g.name}{canEdit && <button className="btn btn-ghost btn-icon btn-sm ms-1" title="Rename stage" aria-label={`Rename ${g.name}`} onClick={() => setEdit(true)}><Pencil size={13} /></button>}</h3>}
      <span className="text-muted small ms-auto">{s ? <>{fmtDate(s)} → {fmtDate(f)} · </> : null}{plural(g.rows.length, 'item')}</span>
    </div>
  );
}

/** Inline text that saves on Enter or when you leave the field. */
function EditText({ value, onSave, disabled, label, className = '' }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { const t = v.trim(); if (!t) { setV(value); return; } if (t !== value) onSave(t); };
  if (disabled) return <span className={className}>{value}</span>;
  return <input className={`form-control form-control-sm pb-input ${className}`} value={v} aria-label={label} onChange={(e) => setV(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(value); e.currentTarget.blur(); } }} />;
}

function EditDays({ value, onSave, disabled, label }) {
  const [v, setV] = useState(String(value ?? ''));
  useEffect(() => setV(String(value ?? '')), [value]);
  const commit = () => { const n = Math.round(Number(v)); if (!n || n < 1 || n > 1000) { setV(String(value ?? '')); return; } if (n !== value) onSave(n); };
  if (disabled) return <span>{value ?? '—'}</span>;
  return <input type="number" min="1" max="1000" className="form-control form-control-sm pb-input pb-days" value={v} aria-label={label} onChange={(e) => setV(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />;
}

/**
 * "Starts after" picker. Quick choices plus a checklist of the tasks it can wait for.
 * onPick({ mode, ids }) where mode is start | prev | parallel | custom.
 */
function AfterPicker({ ids, mode, prev, options, onPick, disabled, label, code }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(ids);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const btn = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => { if (open) { setSel(ids); setQ(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    // fixed position, so the table's scroll container cannot clip it; opens upwards near the bottom of the screen
    const place = () => { const r = btn.current.getBoundingClientRect(); const left = Math.max(8, Math.min(r.left, window.innerWidth - 340));
      setPos(window.innerHeight - r.bottom < 400 && r.top > 400 ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 }); };
    place();
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    const scroll = (e) => { if (!ref.current?.contains(e.target)) place(); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    window.addEventListener('scroll', scroll, true); window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', place); };
  }, [open]);
  const byId = new Map(options.map((o) => [o.id, o]));
  const text = mode === 'start' || !ids.length ? 'Project start'
    : mode === 'parallel' ? `With #${prev?.number} (parallel)`
      : ids.length === 1 ? `#${byId.get(ids[0])?.number ?? '?'} ${byId.get(ids[0])?.title ?? ''}` : ids.map((x) => `#${byId.get(x)?.number ?? '?'}`).join(', ');
  const pick = (m, x) => { onPick({ mode: m, ids: x }); setOpen(false); };
  const shown = options.filter((o) => !q || `${o.number} ${o.title}`.toLowerCase().includes(q.toLowerCase()));
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  if (disabled) return <span className={`pb-after-text ${ids.length ? '' : 'text-muted'}`}>{text}</span>;
  return (
    <div className="pb-after" ref={ref}>
      <button ref={btn} type="button" className={`pb-after-btn ${ids.length ? '' : 'none'}`} aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} title={text}>
        <span className="truncate">{text}</span><ChevronDown size={14} />
      </button>
      {open && <div className="pb-pop" style={pos || { visibility: 'hidden' }} role="dialog" aria-label="What does this task wait for?">
        <div className="pb-pop-title">This task can start…</div>
        <button type="button" className={`pb-opt ${!ids.length && mode !== 'parallel' ? 'on' : ''}`} onClick={() => pick('start', [])}><b>At the project start</b><span>Doesn’t wait for anything</span></button>
        {prev && <button type="button" className={`pb-opt ${mode === 'prev' || (mode !== 'parallel' && same(ids, [prev.id])) ? 'on' : ''}`} onClick={() => pick('prev', [prev.id])}><b>After the previous task</b><span>#{prev.number} {prev.title}</span></button>}
        {prev && <button type="button" className={`pb-opt ${mode === 'parallel' ? 'on' : ''}`} onClick={() => pick('parallel', prev.after || [])}><b>At the same time as the previous task</b><span>In parallel with #{prev.number} {prev.title}</span></button>}
        <div className="pb-pop-title mt-2">…or after these tasks are finished:</div>
        {options.length > 8 && <input className="form-control form-control-sm mb-1" placeholder="Find a task" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a task" />}
        <div className="pb-checks">
          {shown.map((o) => <label key={o.id} className="pb-check"><input type="checkbox" className="form-check-input" checked={sel.includes(o.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))} />
            <span className="mono">{code}-{o.number}</span><span className="truncate">{o.title}</span>{o.type === 'MILESTONE' && <Flag size={12} className="text-muted flex-shrink-0" />}</label>)}
          {!shown.length && <div className="small text-muted p-1">No other tasks yet.</div>}
        </div>
        <div className="d-flex justify-content-end gap-2 mt-2">
          <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => pick(sel.length ? 'custom' : 'start', sel)}><Check size={14} /> Use {sel.length ? plural(sel.length, 'task') : 'project start'}</button>
        </div>
      </div>}
    </div>
  );
}

/** Items a row may wait for: not itself, not its own sub-items, not work packages. */
function waitOptions(flat, row) {
  const isUnder = (x) => { for (let p = x.parentId; p; p = flat.find((y) => y.id === p)?.parentId) if (p === row?.id) return true; return false; };
  return flat.filter((x) => x.id !== row?.id && x.type !== 'MODULE' && !isUnder(x));
}

function Bar({ r, span, spanDays }) {
  if (!r.start || !r.finish) return null;
  const left = ((dnum(r.start) - dnum(span.from)) / spanDays) * 100;
  const width = Math.max(1.2, ((dnum(r.finish) - dnum(r.start) + 1) / spanDays) * 100);
  if (r.type === 'MILESTONE') return <div className="pb-bar-track"><span className="pb-diamond" style={{ left: `calc(${left + ((1 / spanDays) * 100) / 2}% - 5px)` }} /></div>;
  return <div className="pb-bar-track"><span className={`pb-bar ${r.isParent ? 'parent' : ''} ${r.status === 'DONE' ? 'done' : ''}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} /></div>;
}

function Row({ r, flat, byId, people, canEdit, span, spanDays, code, onUpdate, onRemove }) {
  const [fixing, setFixing] = useState(false);
  const ms = r.type === 'MILESTONE';
  const done = r.status === 'DONE';
  const started = ['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'].includes(r.status);
  const editable = canEdit && !r.isParent && r.type !== 'MODULE' && !done;
  const idx = flat.findIndex((x) => x.id === r.id);
  const prev = flat.slice(0, idx).reverse().find((x) => x.type !== 'MODULE' && !x.isParent && x.parentId === r.parentId) || null;
  const mode = r.after.length === 0 ? 'start' : prev && r.after.length === 1 && r.after[0] === prev.id ? 'prev' : 'custom';
  const owner = people.find((p) => p.id === r.assigneeId);
  return (
    <tr className={`${r.isParent ? 'pb-parent' : ''} ${ms ? 'pb-ms' : ''}`}>
      <td className="c-num mono">{code}-{r.number}</td>
      <td style={{ paddingLeft: `${0.5 + r.depth * 1.1}rem` }}>
        <div className="d-flex align-items-center gap-1">
          {ms && <Flag size={14} className="text-warning flex-shrink-0" aria-label="Milestone" />}
          {r.isParent && <ListTodo size={14} className="text-muted flex-shrink-0" />}
          <EditText value={r.title} disabled={!canEdit || r.type === 'MODULE'} label={`Name of ${code}-${r.number}`} className={r.isParent ? 'fw-semibold' : ''} onSave={(title) => onUpdate(r, { title })} />
          {(done || started) && <StatusBadge status={r.status} />}
        </div>
      </td>
      <td className="c-owner">{ms || r.isParent ? <span className="text-muted small">—</span> : editable
        ? <select className="form-select form-select-sm pb-input" value={r.assigneeId || ''} aria-label={`Who does ${code}-${r.number}`} onChange={(e) => onUpdate(r, { assigneeId: e.target.value || null })}>
          <option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        : <span className="small">{owner?.name || '—'}</span>}</td>
      <td className="c-days">{ms ? <span className="pb-ms-tag">Milestone</span> : r.isParent ? <span className="text-muted small" title="From the items inside it">{r.durationDays ?? '—'}</span>
        : <EditDays value={r.durationDays} disabled={!editable} label={`Working days for ${code}-${r.number}`} onSave={(durationDays) => onUpdate(r, { durationDays })} />}</td>
      <td className="c-after">{r.isParent ? <span className="text-muted small">From its sub-tasks</span>
        : <AfterPicker ids={r.after} mode={mode} prev={prev} options={waitOptions(flat, r)} disabled={!editable || started} code={code} label={`What ${code}-${r.number} waits for`}
          onPick={({ ids }) => onUpdate(r, { after: ids })} />}</td>
      <td className="c-date">
        {fixing && editable ? <DateCell value={r.start} label={`Fixed start for ${code}-${r.number}`} onCommit={async (v) => { setFixing(false); await onUpdate(r, { fixedStart: v }, `${r.title} will not start before ${fmtDate(v)}`); }} />
          : <span className="d-inline-flex align-items-center gap-1">
            <span className={r.fixedStart ? 'fw-semibold' : ''}>{r.start ? fmtDate(r.start) : '—'}</span>
            {r.fixedStart && !r.isParent && <span className="pb-pin" title={`Fixed: not before ${fmtDate(r.fixedStart)}`}><Pin size={12} /></span>}
            {editable && !started && (r.fixedStart
              ? <button className="btn btn-ghost btn-icon btn-sm pb-hover" title="Let it start automatically" aria-label={`Unfix the start of ${code}-${r.number}`} onClick={() => onUpdate(r, { fixedStart: null }, `${r.title} now starts as soon as it can`)}><PinOff size={13} /></button>
              : <button className="btn btn-ghost btn-icon btn-sm pb-hover" title="Fix a start date (not before)" aria-label={`Fix the start of ${code}-${r.number}`} onClick={() => setFixing(true)}><CalendarDays size={13} /></button>)}
          </span>}
      </td>
      <td className="c-date">{ms ? <span className="text-muted small">—</span> : r.finish ? fmtDate(r.finish) : '—'}</td>
      <td className="c-bar"><Bar r={r} span={span} spanDays={spanDays} /></td>
      <td className="c-act text-nowrap">{editable && !r.isParent && <>
        <button className="btn btn-ghost btn-icon btn-sm pb-hover" title={ms ? 'Make it a task' : 'Make it a milestone'} aria-label={ms ? `Make ${code}-${r.number} a task` : `Make ${code}-${r.number} a milestone`} onClick={() => onUpdate(r, { type: ms ? 'TASK' : 'MILESTONE' })}><Flag size={13} /></button>
        <ConfirmButton className="btn btn-ghost btn-icon btn-sm pb-hover" title={`Remove “${r.title}”?`} message="Tasks that waited for it will wait for what it waited for instead." confirmLabel="Remove" onConfirm={() => onRemove(r)}><Trash2 size={13} aria-label={`Remove ${code}-${r.number}`} /></ConfirmButton>
      </>}</td>
    </tr>
  );
}

function AddRow({ group, flat, groups, people, onAdd }) {
  // "previous task" = the last task in this stage, or the last task of the stages before it
  const gi = groups.indexOf(group);
  const before = groups.slice(0, gi + 1).flatMap((g) => g.rows).filter((x) => x.type !== 'MODULE' && !x.isParent);
  const prev = before.at(-1) || null;
  const [f, setF] = useState({ title: '', type: 'TASK', assigneeId: '', durationDays: '5', mode: 'prev', ids: [] });
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const ms = f.type === 'MILESTONE';
  const ids = f.mode === 'prev' ? (prev ? [prev.id] : []) : f.mode === 'parallel' ? (prev?.after || []) : f.mode === 'start' ? [] : f.ids;
  const mode = f.mode === 'prev' && !prev ? 'start' : f.mode;
  const submit = async (e) => {
    e?.preventDefault();
    if (!f.title.trim() || busy) return;
    setBusy(true);
    const sent = f;
    // clear the row straight away so the next task can be typed while this one is saved
    setF((x) => ({ ...x, title: '', type: 'TASK', mode: 'prev', ids: [] }));
    const item = await onAdd({ title: sent.title.trim(), type: sent.type, phaseId: group.id, assigneeId: ms ? null : sent.assigneeId || null, durationDays: ms ? 1 : Math.max(1, Math.round(Number(sent.durationDays) || 1)), after: ids });
    setBusy(false);
    if (item) input.current?.focus();
    else setF((x) => (x.title ? x : { ...sent }));
  };
  const onKey = (e) => { if (e.key === 'Enter') submit(e); };
  return (
    <tr className="pb-add">
      <td className="c-num"><Plus size={14} className="text-muted" /></td>
      <td>
        <div className="d-flex gap-1">
          <input ref={input} className="form-control form-control-sm" placeholder={ms ? 'Milestone, e.g. Design signed off' : `Add a task to ${group.name}…`} value={f.title} aria-label={`New task in ${group.name}`} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={onKey} />
          <div className="btn-group btn-group-sm pb-type" role="group" aria-label="Task or milestone">
            <button type="button" className={`btn ${ms ? 'btn-light' : 'btn-secondary'}`} onClick={() => setF({ ...f, type: 'TASK' })}>Task</button>
            <button type="button" className={`btn ${ms ? 'btn-secondary' : 'btn-light'}`} onClick={() => setF({ ...f, type: 'MILESTONE' })} title="Milestone: a key date, e.g. sign-off or go-live" aria-label="Milestone"><Flag size={12} /></button>
          </div>
        </div>
      </td>
      <td className="c-owner">{ms ? <span className="text-muted small">—</span> : <select className="form-select form-select-sm" value={f.assigneeId} aria-label="Who does the new task" onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
        <option value="">Who?</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</td>
      <td className="c-days">{ms ? <span className="pb-ms-tag">Milestone</span> : <input type="number" min="1" max="1000" className="form-control form-control-sm pb-days" value={f.durationDays} aria-label="Working days for the new task" onChange={(e) => setF({ ...f, durationDays: e.target.value })} onKeyDown={onKey} />}</td>
      <td className="c-after"><AfterPicker ids={ids} mode={mode} prev={prev} options={waitOptions(flat, null)} code="" label="What the new task waits for" onPick={({ mode: m, ids: x }) => setF({ ...f, mode: m, ids: x })} /></td>
      <td className="c-date" colSpan={2}><span className="small text-muted">Calculated</span></td>
      <td className="c-bar" />
      <td className="c-act"><button className="btn btn-sm btn-primary" disabled={busy || !f.title.trim()} onClick={submit}>{busy ? 'Adding…' : 'Add'}</button></td>
    </tr>
  );
}

function AddStage({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = async (e) => { e.preventDefault(); if (!name.trim()) return; if (await onAdd(name.trim())) { setName(''); setOpen(false); } };
  if (!open) return <button className="btn btn-light btn-sm mt-1" onClick={() => setOpen(true)}><Plus size={14} /> Add a stage</button>;
  return (
    <form className="d-flex gap-2 mt-1" style={{ maxWidth: 420 }} onSubmit={save}>
      <input className="form-control form-control-sm" autoFocus placeholder="Stage name, e.g. Training" value={name} aria-label="New stage name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <button className="btn btn-sm btn-primary" disabled={!name.trim()}>Add stage</button>
      <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
