import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, CheckCircle2, AlertTriangle, XCircle, Plus, Flag, ClipboardCheck, GanttChart, Info, ArrowRight } from 'lucide-react';
import { get, post } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useLive, emitLocal } from '../../lib/live.js';
import { fmtDate, fmtMoney } from '../../lib/format.js';
import { Avatar, Card, ErrorBox, Field, Loading, Modal, Notice, useToast, fieldErrors, Empty } from '../../components/ui.jsx';
import { TaskVarChip, DaysVar, diffText, verdict, TASK_GROUPS } from '../../lib/schedule.jsx';
import { TaskGrid } from './Grid.jsx';
import { useProject } from './Workspace.jsx';

/** Plan tab: build the plan → approve & lock it as the ORIGINAL plan → track the working plan against it. */
export function PlanTab() {
  const { project } = useProject();
  const plan = useLoad(() => get(`/projects/${project.id}/plan`), [project.id, project.version]);
  useLive((e) => e.type === 'work.changed' && e.projectId === project.id, () => plan.reload({ silent: true }), [project.id]);
  if (plan.loading && !plan.data) return <Loading rows={8} />;
  if (plan.error) return <ErrorBox error={plan.error} onRetry={plan.reload} />;
  return plan.data.approved ? <PlanVsOriginal plan={plan.data} reload={plan.reload} /> : <BuildPlan plan={plan.data} reload={plan.reload} />;
}

// ---------------------------------------------------------------- Draft: build + approve
function Steps({ approved }) {
  const steps = [['Project details', true], ['Team', true], ['Build the plan', approved], ['Approve & lock original plan', approved]];
  return (
    <div className="plan-steps">{steps.map(([l, done], i) => {
      const current = !done && steps.slice(0, i).every((s) => s[1]);
      return <div key={l} className={`ps ${done ? 'done' : current ? 'cur' : ''}`}><span className="n">{done ? <CheckCircle2 size={16} /> : i + 1}</span>{l}</div>;
    })}</div>
  );
}

function QuickAdd({ onAdded }) {
  const { project, people } = useProject();
  const toast = useToast();
  const assignable = people.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role));
  // The next row starts on the working day after the previous one ends (Mon–Fri).
  const nextDay = (iso) => { if (!iso) return ''; const d = new Date(`${iso}T00:00:00Z`); do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10); };
  const blank = (keep = {}) => ({ type: 'TASK', title: '', phaseId: keep.phaseId ?? project.phases[0]?.id ?? '', assigneeId: keep.assigneeId ?? '', plannedStart: nextDay(keep.plannedFinish), plannedFinish: '', estimateHours: '' });
  const [f, setF] = useState(blank());
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const ms = f.type === 'MILESTONE';
  const add = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      await post(`/projects/${project.id}/work-items`, { type: f.type, title: f.title, phaseId: f.phaseId || null, assigneeId: ms ? null : f.assigneeId || null,
        plannedStart: (ms ? f.plannedFinish : f.plannedStart) || null, plannedFinish: f.plannedFinish || null, estimateHours: ms || f.estimateHours === '' ? null : Number(f.estimateHours) });
      toast(`Added: ${f.title}`, 'success');
      setF(blank(f)); onAdded();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const fe = fieldErrors(err);
  return (
    <form className="plan-qa" onSubmit={add}>
      <div className="qa-grid">
        <select className="form-select form-select-sm" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Type"><option value="TASK">Task</option><option value="MILESTONE">Milestone</option></select>
        <input className={`form-control form-control-sm qa-title ${fe.title ? 'is-invalid' : ''}`} placeholder={ms ? 'Milestone, e.g. Design signed off' : 'Task name, e.g. Build checkout API'} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Title" required />
        <select className="form-select form-select-sm" value={f.phaseId} onChange={(e) => setF({ ...f, phaseId: e.target.value })} aria-label="Phase"><option value="">No phase</option>{project.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="form-select form-select-sm" value={f.assigneeId} disabled={ms} onChange={(e) => setF({ ...f, assigneeId: e.target.value })} aria-label="Assignee"><option value="">{ms ? '—' : 'Assign to…'}</option>{assignable.map((m) => <option key={m.id} value={m.id}>{m.name}{m.title ? ` · ${m.title}` : ''}</option>)}</select>
        {!ms && <input type="date" className="form-control form-control-sm" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} aria-label="Start date" title="Start" />}
        <input type="date" className={`form-control form-control-sm ${fe.plannedFinish ? 'is-invalid' : ''}`} value={f.plannedFinish} min={ms ? undefined : f.plannedStart || undefined} onChange={(e) => setF({ ...f, plannedFinish: e.target.value })} aria-label={ms ? 'Date' : 'Due date'} title={ms ? 'Date' : 'Due'} />
        {!ms && <input type="number" min="0" step="0.5" className="form-control form-control-sm" placeholder="Hours" value={f.estimateHours} onChange={(e) => setF({ ...f, estimateHours: e.target.value })} aria-label="Estimate in hours" />}
        <button className="btn btn-sm btn-primary qa-btn" disabled={busy || !f.title.trim()}><Plus size={14} /> Add {ms ? 'milestone' : 'task'}</button>
      </div>
      {err && <div className="small text-danger mt-1">{err.message}</div>}
      <div className="form-text">Press Enter to add. Phase and person are kept, and the next task starts the working day after this one ends, so you can enter the plan row after row. Edit anything in the table below, link tasks on the <Link to="../tasks">Gantt</Link>, or import a CSV.</div>
    </form>
  );
}

function BuildPlan({ plan, reload }) {
  const { project, reload: reloadProject } = useProject();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [activate, setActivate] = useState(project.status === 'DRAFT');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const { checks, blockers, warnings, ready } = plan.readiness;
  const approve = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post(`/projects/${project.id}/plan/approve`, { note: note || undefined, activate });
      toast(`Original plan locked — ${r.items} items`, 'success'); setConfirm(false);
      reloadProject(); reload(); emitLocal({ type: 'work.changed', projectId: project.id });
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <>
      <Steps approved={false} />
      <div className="row g-3 mb-3">
        <div className="col-xl-8">
          <Card title={<span className="d-inline-flex align-items-center gap-2"><Plus size={16} /> Add tasks and milestones</span>}>
            {plan.canApprove ? <QuickAdd onAdded={() => { reload({ silent: true }); emitLocal({ type: 'work.changed', projectId: project.id }); }} /> : <div className="small text-muted">Only the project manager can build the plan.</div>}
          </Card>
        </div>
        <div className="col-xl-4">
          <Card title={<span className="d-inline-flex align-items-center gap-2"><ClipboardCheck size={16} /> Ready to approve?</span>}>
            <ul className="list-plain readiness">
              <li><span>Tasks</span><b>{checks.tasks}</b></li>
              <li><span>Milestones</span><b>{checks.milestones}</b></li>
              <li><span>People on the team</span><b>{checks.team}</b></li>
              <li className={checks.undated ? 'bad' : ''}><span>Without dates</span><b>{checks.undated}</b></li>
              <li className={checks.unassigned ? 'warn' : ''}><span>Nobody assigned</span><b>{checks.unassigned}</b></li>
              <li className={checks.unestimated ? 'warn' : ''}><span>No estimate</span><b>{checks.unestimated}</b></li>
            </ul>
            {blockers.map((b) => <div key={b} className="small text-danger d-flex gap-1 mt-1"><XCircle size={14} className="flex-shrink-0 mt-1" />{b}</div>)}
            {warnings.map((w) => <div key={w} className="small text-warning-emphasis d-flex gap-1 mt-1"><AlertTriangle size={14} className="flex-shrink-0 mt-1" />{w}</div>)}
            {plan.canApprove && <button className="btn btn-primary w-100 mt-3" disabled={!ready} onClick={() => setConfirm(true)}><Lock size={15} /> Approve &amp; lock original plan</button>}
            <div className="form-text">Once approved, today's dates, effort and owners are frozen as the <b>original plan</b>. You keep working on the plan; every change is compared with the original.</div>
          </Card>
        </div>
      </div>
      <h2 className="h6 mb-2">Plan ({checks.tasks + checks.milestones} items)</h2>
      <TaskGrid />
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Approve and lock the original plan" footer={<><button className="btn btn-light" onClick={() => setConfirm(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={approve}><Lock size={14} /> {busy ? 'Locking…' : 'Approve & lock'}</button></>}>
        <ErrorBox error={err} />
        <p className="mb-2">This saves a permanent copy of the plan: <b>{checks.tasks} tasks and {checks.milestones} milestones</b> with their start and due dates, effort and assigned people.</p>
        <ul className="small mb-3">
          <li>The original plan <b>can never be edited or deleted</b>, not even by an administrator.</li>
          <li>You keep updating tasks, dates and people as the project runs; that is the working plan.</li>
          <li>The Plan tab, Gantt, project list and status report then show every task and the project as on time, ahead or delayed against the original.</li>
        </ul>
        {warnings.length > 0 && <Notice tone="warn">{warnings.join(' ')}</Notice>}
        <Field label="Approval note (optional)">{(id) => <textarea id={id} className="form-control" rows={2} placeholder="e.g. Agreed with the client in the kick-off meeting" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {project.status === 'DRAFT' && <div className="form-check"><input className="form-check-input" type="checkbox" id="act" checked={activate} onChange={(e) => setActivate(e.target.checked)} /><label className="form-check-label" htmlFor="act">Also start the project (status Active)</label></div>}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- Shared: status banner
const BANNER_ICON = { ok: CheckCircle2, blue: CheckCircle2, warn: AlertTriangle, risk: XCircle, neutral: Info };

/** The one place that answers "are we on time?" — used on Overview and on the Plan tab. */
export function StatusBanner({ project: p, plan, burn, link = false }) {
  const s = plan?.approved ? plan.summary : null;
  const v = verdict(p, s, fmtDate);
  const Icon = BANNER_ICON[v.tone] || Info;
  const c = s?.counts || {};
  const late = (c.OVERDUE || 0) + (c.DELAYED || 0);
  const progress = p.progress == null ? null : Math.round(p.progress);
  const expected = s && s.status !== 'COMPLETED' && s.plannedPct != null ? Math.round(s.plannedPct) : null;
  const behind = expected != null && progress != null && s.spi != null && s.plannedPct >= 10 && s.spi < 0.95; // same rule as the status
  const b = burn?.budget; const h = burn?.hours;
  const over = b?.consumed != null && b.consumed > b.amount;
  return (
    <div className={`status-banner tone-${v.tone}`}>
      <div className="sb-head">
        <Icon size={26} className="sb-icon" />
        <div className="flex-grow-1 min-w-0"><div className="sb-title">{v.title}</div><div className="sb-text">{v.text}</div></div>
        {link && p.status !== 'CANCELLED' && <Link to="plan" className="btn btn-sm btn-light text-nowrap">{p.planApprovedAt ? 'Plan vs original' : 'Finish the plan'} <ArrowRight size={14} /></Link>}
      </div>
      <div className="sb-facts">
        <div className="sb-fact">
          <div className="k">Work done</div>
          <div className="v">{progress == null ? '—' : `${progress}%`}</div>
          <div className="bar"><span style={{ width: `${progress || 0}%` }} className={behind ? 'behind' : ''} />{expected != null && <i style={{ left: `${Math.min(100, expected)}%` }} title={`The approved plan expected ${expected}% by today`} />}</div>
          <div className={`sub ${behind ? 'text-danger fw-semibold' : ''}`}>{expected != null ? `Plan expected ${expected}% by today` : s?.status === 'COMPLETED' ? 'All work finished' : 'Of all planned work'}</div>
        </div>
        <div className="sb-fact">
          <div className="k">{s ? 'Planned end date' : 'Target end date'}</div>
          <div className="v sm">{fmtDate(s?.originalFinish || p.plannedFinish)}</div>
          {s && <div className={`sub ${s.finishVariance > 0 ? 'text-danger fw-semibold' : ''}`}>{s.status === 'COMPLETED' ? 'Finished' : 'Expected'}: {fmtDate(s.forecastFinish)}{s.finishVariance ? ` (${diffText(s.finishVariance)})` : ''}</div>}
          {!s && p.workFinish && p.workFinish > p.plannedFinish && <div className="sub text-danger fw-semibold">The tasks currently end on {fmtDate(p.workFinish)} — after this date</div>}
          {!s && p.workFinish && p.workFinish <= p.plannedFinish && <div className="sub">The tasks currently end on {fmtDate(p.workFinish)}</div>}
        </div>
        <div className="sb-fact">
          {s ? <>
            <div className="k">Late tasks</div>
            <div className={`v ${late ? 'text-danger' : ''}`}>{late}</div>
            <div className="sub">{late ? `${c.OVERDUE || 0} past due · ${c.DELAYED || 0} will finish late` : 'Every task is on time'}</div>
          </> : <>
            <div className="k">Open tasks</div>
            <div className="v">{p.counts.open}</div>
            <div className="sub">{p.counts.overdue ? `${p.counts.overdue} past their due date` : 'None past their due date'}</div>
          </>}
        </div>
        <div className="sb-fact">
          {b?.consumed != null ? <>
            <div className="k">Budget</div>
            <div className={`v sm ${over ? 'text-danger' : ''}`}>{fmtMoney(b.consumed, b.currency)} <span className="of">of {fmtMoney(b.amount, b.currency)}</span></div>
            <div className="bar"><span style={{ width: `${Math.min(100, (b.consumed / b.amount) * 100)}%` }} className={over ? 'behind' : ''} /></div>
            <div className={`sub ${over ? 'text-danger fw-semibold' : ''}`}>{over ? `Over budget by ${fmtMoney(b.consumed - b.amount, b.currency)}` : `${Math.round((b.consumed / b.amount) * 100)}% used · ${fmtMoney(b.amount - b.consumed, b.currency)} left`}</div>
          </> : h ? <>
            <div className="k">Hours</div>
            <div className="v sm">{h.logged}h <span className="of">of {h.estimate}h estimated</span></div>
            <div className="bar"><span style={{ width: `${h.estimate ? Math.min(100, (h.logged / h.estimate) * 100) : 0}%` }} /></div>
            <div className="sub">{h.estimate ? `${Math.round((h.logged / h.estimate) * 100)}% of the estimate used` : 'No estimates yet'}</div>
          </> : <><div className="k">Budget</div><div className="v sm text-muted">—</div><div className="sub">No budget set</div></>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Approved: plan vs what is happening
/** Two bars per row: grey = approved plan, coloured = now (expected or actual). */
function PlanTimeline({ plan }) {
  const s = plan.summary;
  const rows = [{ id: 'all', name: 'Whole project', os: s.originalStart, of: s.originalFinish, cs: s.currentStart, cf: s.forecastFinish, v: s.finishVariance, done: s.status === 'COMPLETED', total: true },
    ...plan.phases.filter((ph) => ph.originalFinish || ph.forecastFinish).map((ph) => ({ id: ph.id || 'none', name: ph.name, os: ph.originalStart, of: ph.originalFinish, cs: ph.currentStart, cf: ph.forecastFinish, v: ph.finishVariance, done: ph.done }))];
  const today = new Date().toISOString().slice(0, 10);
  const all = rows.flatMap((r) => [r.os, r.of, r.cs, r.cf]).filter(Boolean).concat(today).sort();
  const t0 = new Date(`${all[0]}T00:00:00Z`).getTime(); const t1 = new Date(`${all.at(-1)}T00:00:00Z`).getTime() + 864e5;
  const x = (d) => (d ? ((new Date(`${d}T00:00:00Z`).getTime() - t0) / (t1 - t0)) * 100 : null);
  const months = []; { const m = new Date(t0); m.setUTCDate(1); m.setUTCMonth(m.getUTCMonth() + 1); while (m.getTime() < t1) { months.push(new Date(m)); m.setUTCMonth(m.getUTCMonth() + 1); } }
  const tone = (r) => (r.v == null ? 'none' : r.v > 0 ? 'late' : r.v < 0 ? 'early' : 'ontime');
  return (
    <div className="ptl">
      <div className="ptl-legend"><span><i className="sw plan" /> Approved plan</span><span><i className="sw ontime" /> Now — on time</span><span><i className="sw late" /> Now — late</span><span><i className="sw early" /> Now — early</span><span><i className="sw today" /> Today</span></div>
      <div className="ptl-grid">
        <div className="ptl-axis"><div />{<div className="ptl-track">{months.map((m) => <span key={m.toISOString()} style={{ left: `${x(m.toISOString().slice(0, 10))}%` }}>{m.toLocaleDateString(undefined, { month: 'short', year: m.getUTCMonth() === 0 ? '2-digit' : undefined })}</span>)}</div>}<div /></div>
        {rows.map((r) => (
          <div key={r.id} className={`ptl-row ${r.total ? 'total' : ''}`}>
            <div className="ptl-name">{r.name}</div>
            <div className="ptl-track">
              {months.map((m) => <em key={m.toISOString()} style={{ left: `${x(m.toISOString().slice(0, 10))}%` }} />)}
              <b className="today" style={{ left: `${x(today)}%` }} />
              {r.of && <span className="bar plan" style={{ left: `${x(r.os || r.of)}%`, width: `${Math.max(0.8, x(r.of) - x(r.os || r.of) + 100 / ((t1 - t0) / 864e5))}%` }} title={`Approved plan: ${fmtDate(r.os)} – ${fmtDate(r.of)}`} />}
              {r.cf && <span className={`bar now ${tone(r)}`} style={{ left: `${x(r.cs || r.cf)}%`, width: `${Math.max(0.8, x(r.cf) - x(r.cs || r.cf) + 100 / ((t1 - t0) / 864e5))}%` }} title={`${r.done ? 'Actual' : 'Now'}: ${fmtDate(r.cs)} – ${fmtDate(r.cf)}`} />}
            </div>
            <div className="ptl-diff">{r.done && (r.v ?? 0) <= 0 ? <span className="text-success fw-semibold">Done{r.v < 0 ? ', early' : ''}</span> : r.done ? <span className="text-warning-emphasis fw-semibold">Done, {diffText(r.v)}</span> : <DaysVar days={r.v} />}</div>
          </div>))}
      </div>
    </div>
  );
}

function PlanVsOriginal({ plan }) {
  const { project, people, openItem } = useProject();
  const burn = useLoad(() => get(`/projects/${project.id}/burnup`), [project.id, project.version]);
  const c = plan.summary.counts;
  const count = (g) => g[2].reduce((t, k) => t + (c[k] || 0), 0);
  const [tab, setTab] = useState(() => (TASK_GROUPS.find((g) => count(g) > 0) || TASK_GROUPS[0])[0]);
  const group = TASK_GROUPS.find((g) => g[0] === tab);
  const name = (id) => people.find((m) => m.id === id)?.name;
  const phaseName = new Map(project.phases.map((p) => [p.id, p.name]));
  const rows = plan.items.filter((r) => group[2].includes(r.status))
    .sort((a, b) => (tab === 'late' ? (b.finishVariance ?? -1) - (a.finishVariance ?? -1) : 0) || (a.originalFinish || a.currentFinish || '9').localeCompare(b.originalFinish || b.currentFinish || '9'));
  return (
    <>
      <div className="locked-bar"><Lock size={15} /><span>Plan approved on <b>{fmtDate(plan.approvedAt)}</b> by <b>{plan.approvedBy?.name || '—'}</b>{plan.baseline.note ? <> — “{plan.baseline.note}”</> : null}. This approved plan is locked and can't be changed. Everything below compares it with what is happening now.</span></div>
      <StatusBanner project={project} plan={plan} burn={burn.data} />
      <Card title="Timeline: approved plan vs now" className="mb-3">
        <PlanTimeline plan={plan} />
      </Card>
      <Card title="Tasks compared with the approved plan" actions={<Link to="../tasks" className="small fw-semibold d-inline-flex align-items-center gap-1"><GanttChart size={14} /> Open the Gantt chart</Link>}>
        <div className="seg-tabs mb-2" role="tablist">{TASK_GROUPS.map((g) => <button key={g[0]} role="tab" aria-selected={tab === g[0]} className={`${tab === g[0] ? 'on' : ''} ${g[0] === 'late' && count(g) ? 'alert' : ''}`} onClick={() => setTab(g[0])}>{g[1]} <span className="n">{count(g)}</span></button>)}</div>
        <div className="small text-muted mb-2">{group[3]}</div>
        {rows.length === 0 ? <Empty icon={CheckCircle2} title={tab === 'late' ? 'No late tasks — everything is on plan' : 'Nothing here'} /> : (
          <div className="table-wrap"><table className="table align-middle cmp-table">
            <thead><tr><th>Task</th><th>Owner</th><th>Planned finish</th><th>{tab === 'done' ? 'Finished on' : 'Expected finish'}</th><th>Difference</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} className={r.status === 'REMOVED' ? 'removed' : ''}>
              <td style={{ minWidth: 220 }}>{r.workStatus === 'DELETED' ? <span className="fw-medium">{r.title}</span> : <button className="btn btn-link p-0 text-start text-body fw-semibold" onClick={() => openItem(r.id)}>{r.type === 'MILESTONE' && <Flag size={13} className="text-warning me-1" />}{r.title}</button>}
                <div className="small text-muted">{r.number ? `${project.code}-${r.number}` : ''}{phaseName.get(r.phaseId) ? ` · ${phaseName.get(r.phaseId)}` : ''}{r.type === 'MILESTONE' ? ' · milestone' : ''}</div>
                {r.lateStart && <div className="small text-danger">Should have started on {fmtDate(r.originalStart)}</div>}</td>
              <td className="small">{r.assigneeId ? <span className="d-inline-flex align-items-center gap-1"><Avatar sm name={name(r.assigneeId)} />{name(r.assigneeId)}</span> : <span className="text-muted">{r.type === 'MILESTONE' ? '—' : 'Not assigned'}</span>}
                {r.originalAssigneeId && r.originalAssigneeId !== r.assigneeId && <div className="small text-muted">Planned: {name(r.originalAssigneeId) || 'someone else'}</div>}</td>
              <td className="text-nowrap">{r.originalFinish ? fmtDate(r.originalFinish) : <span className="text-muted small">{r.status === 'ADDED' ? 'Not in the plan' : 'No date'}</span>}</td>
              <td className="text-nowrap">{r.status === 'REMOVED' ? <span className="text-muted small">Removed</span> : r.workStatus === 'DONE' ? fmtDate(r.actualFinish || r.currentFinish) : r.forecastFinish ? fmtDate(r.forecastFinish) : '—'}
                {r.status === 'OVERDUE' && r.type !== 'MILESTONE' && <div className="small text-muted">{r.percentComplete ? `${Math.round(r.percentComplete)}% done` : 'Not started'}</div>}</td>
              <td>{['ADDED', 'REMOVED', 'NOT_SCHEDULED'].includes(r.status) ? <span className="text-muted">—</span> : <DaysVar days={r.finishVariance} />}</td>
              <td><TaskVarChip status={r.status} /></td></tr>)}</tbody></table></div>)}
      </Card>
      <details className="mt-3 small text-muted explain"><summary><Info size={13} /> How is this worked out?</summary>
        <ul className="mt-2 mb-0">
          <li><b>Approved plan</b> = the dates, effort and people saved when the plan was approved. It never changes.</li>
          <li><b>Expected finish</b> = the date a task is planned to finish now. If a task is unfinished and its date has passed, we expect it no earlier than today.</li>
          <li><b>Difference</b> is counted in working days (weekends and holidays are skipped).</li>
          <li><b>Plan expected X% by today</b> = how much of the approved work should be done today if everything had gone to plan (weighted by estimated hours).</li>
          <li>Project status: <b>Running late</b> if the end date is more than 5 days late or the work done is well behind the plan; <b>At risk</b> if the end date moves at all, a task is late, or work done is a little behind; <b>Ahead of schedule</b> if it will finish early. New tasks added later don't count, so they can't hide a delay.</li>
        </ul></details>
    </>
  );
}
