import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, CheckCircle2, AlertTriangle, XCircle, Plus, Flag, ClipboardCheck, GanttChart, Info } from 'lucide-react';
import { get, post } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useLive, emitLocal } from '../../lib/live.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { Avatar, Card, ErrorBox, Field, Loading, Modal, Notice, useToast, fieldErrors, Empty } from '../../components/ui.jsx';
import { LineChart } from '../../components/BarChart.jsx';
import { ScheduleChip, TaskVarChip, DaysVar, scheduleSentence, TASK_VAR } from '../../lib/schedule.jsx';
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
  const blank = (keep = {}) => ({ type: 'TASK', title: '', phaseId: keep.phaseId ?? project.phases[0]?.id ?? '', assigneeId: keep.assigneeId ?? '', plannedStart: keep.plannedFinish ?? '', plannedFinish: '', estimateHours: '' });
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
      <div className="form-text">Press Enter to add. Phase, person and the next start date are kept so you can enter the plan row after row. Edit anything in the table below, link tasks on the <Link to="../tasks">Gantt</Link>, or import a CSV.</div>
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

// ---------------------------------------------------------------- Approved: working plan vs original
const FILTERS = [['attention', 'Needs attention', ['OVERDUE', 'DELAYED', 'NOT_SCHEDULED']], ['all', 'All', null], ['OVERDUE', 'Overdue'], ['DELAYED', 'Delayed'], ['DONE_LATE', 'Done late'], ['ON_TRACK', 'On track'], ['AHEAD', 'Ahead'], ['DONE_ON_TIME', 'Done on time'], ['ADDED', 'Added'], ['REMOVED', 'Removed']];

function PlanVsOriginal({ plan }) {
  const { project, people, openItem } = useProject();
  const [filter, setFilter] = useState('attention');
  const s = plan.summary;
  const name = (id) => people.find((m) => m.id === id)?.name;
  const phaseName = new Map(project.phases.map((p) => [p.id, p.name]));
  const f = FILTERS.find((x) => x[0] === filter);
  const set = f[2] === undefined ? [filter] : f[2];
  const rows = plan.items.filter((r) => !set || set.includes(r.status))
    .sort((a, b) => (b.finishVariance ?? -999) - (a.finishVariance ?? -999) || (a.originalFinish || '9').localeCompare(b.originalFinish || '9'));
  const c = s.counts;
  const behind = (c.OVERDUE || 0) + (c.DELAYED || 0);
  const lbl = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return (
    <>
      <div className="locked-bar"><Lock size={15} /><span><b>Original plan locked</b> on {fmtDateTime(plan.approvedAt)} by {plan.approvedBy?.name || '—'}{plan.baseline.note ? <> · “{plan.baseline.note}”</> : null}. It can't be changed; the working plan below is compared with it.</span></div>
      <div className={`sched-hero ${s.status}`}>
        <div><div className="small-caps">Schedule vs original plan</div><div className="d-flex align-items-center gap-2 mt-1"><ScheduleChip status={s.status} /><span className="fw-semibold">{scheduleSentence(s, fmtDate)}</span></div>
          {s.status !== 'COMPLETED' && s.plannedPct != null && <div className="small text-muted mt-1">By today the original plan expected <b>{s.plannedPct}%</b> of the work done; <b>{s.actualPct}%</b> is done{s.spi != null ? ` (schedule performance ${s.spi})` : ''}.</div>}</div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-2"><div className="tile"><div className="label">Original finish</div><div className="value sm">{fmtDate(s.originalFinish)}</div></div></div>
        <div className="col-6 col-lg-2"><div className={`tile ${s.finishVariance > 0 ? 'red' : 'green'}`}><div className="label">Forecast finish</div><div className="value sm">{fmtDate(s.forecastFinish)}</div><div className="small"><DaysVar days={s.finishVariance} /> vs original</div></div></div>
        <div className="col-6 col-lg-2"><div className={`tile ${s.actualPct < s.plannedPct - 5 ? 'orange' : 'green'}`}><div className="label">Planned vs done</div><div className="value sm">{s.plannedPct ?? '—'}% / {s.actualPct ?? '—'}%</div></div></div>
        <div className="col-6 col-lg-2"><div className={`tile ${behind ? 'red' : 'green'}`}><div className="label">Behind the original</div><div className="value">{behind}</div><div className="small">{c.OVERDUE || 0} overdue · {c.DELAYED || 0} delayed</div></div></div>
        <div className="col-6 col-lg-2"><div className="tile green"><div className="label">Finished</div><div className="value">{(c.DONE_ON_TIME || 0) + (c.DONE_LATE || 0)}</div><div className="small">{c.DONE_ON_TIME || 0} on time · {c.DONE_LATE || 0} late</div></div></div>
        <div className="col-6 col-lg-2"><div className="tile violet"><div className="label">Scope change</div><div className="value">+{c.ADDED || 0} / −{c.REMOVED || 0}</div><div className="small">added / removed tasks</div></div></div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-xl-5"><Card title="Progress: original plan vs actual">
          {plan.curve.length > 1 ? <LineChart height={230} label="Percent of original work planned vs completed by week" labels={plan.curve.map((p) => lbl(p.date))}
            series={[{ name: 'Planned (original)', data: plan.curve.map((p) => p.planned), color: '#94a3b8' }, { name: 'Completed', data: plan.curve.map((p) => p.actual ?? null), color: '#16a34a' }]} />
            : <div className="small text-muted">The chart fills in as weeks pass.</div>}
          <div className="form-text">Grey = how much of the original work should be finished by each week. Green = how much was really finished. Green below grey means behind plan.</div>
        </Card></div>
        <div className="col-xl-7"><Card title="Phases">
          <table className="table table-sm mb-0"><thead><tr><th>Phase</th><th>Original</th><th>Forecast</th><th className="text-end">Var.</th><th /></tr></thead>
            <tbody>{plan.phases.map((p) => <tr key={p.id || 'none'}><td className="small fw-medium">{p.name}<div className="meter mt-1" title={`Planned ${p.plannedPct ?? 0}% · done ${p.actualPct ?? 0}%`}><span style={{ width: `${p.actualPct || 0}%` }} /><i style={{ left: `${Math.min(100, p.plannedPct || 0)}%` }} /></div></td>
              <td className="small text-nowrap">{fmtDate(p.originalFinish)}</td><td className="small text-nowrap">{fmtDate(p.forecastFinish)}</td><td className="text-end small"><DaysVar days={p.finishVariance} /></td><td><ScheduleChip status={p.status} /></td></tr>)}</tbody></table>
          <div className="form-text">Bar = work done; the tick marks where the original plan expected it to be today.</div>
        </Card></div>
      </div>
      <Card title="Tasks against the original plan" actions={<Link to="../tasks" className="small fw-semibold d-inline-flex align-items-center gap-1"><GanttChart size={14} /> Gantt with original bars</Link>}>
        <div className="d-flex gap-1 flex-wrap mb-2">{FILTERS.map(([k, l, grp]) => { const n = k === 'all' ? plan.items.length : (grp || [k]).reduce((t, x) => t + (c[x] || 0), 0);
          return <button key={k} className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-light'}`} onClick={() => setFilter(k)} disabled={!n && k !== 'all' && k !== 'attention'}>{l} <span className="opacity-75">{n}</span></button>; })}</div>
        {rows.length === 0 ? <Empty icon={CheckCircle2} title={filter === 'attention' ? 'Nothing is behind the original plan' : 'No tasks in this group'} /> : (
          <div className="table-wrap"><table className="table table-sm align-middle var-table">
            <thead><tr><th>Key</th><th>Task</th><th>Owner</th><th>Original dates</th><th>Now / actual</th><th className="text-end">Finish var.</th><th>Done</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} className={r.status === 'REMOVED' ? 'text-muted' : ''}>
              <td className="mono text-muted small">{r.number ? `${project.code}-${r.number}` : '—'}</td>
              <td style={{ maxWidth: 300 }}>{r.status === 'REMOVED' && !r.number ? <span className="text-decoration-line-through">{r.title}</span> : <button className="btn btn-link p-0 text-start text-body fw-medium" onClick={() => r.workStatus !== 'DELETED' && openItem(r.id)}>{r.type === 'MILESTONE' && <Flag size={12} className="text-warning me-1" />}{r.title}</button>}
                <div className="small text-muted">{phaseName.get(r.phaseId) || ''}{r.lateStart ? <span className="text-danger ms-1">· should have started {fmtDate(r.originalStart)}</span> : null}</div></td>
              <td className="small">{r.assigneeId ? <span className="d-inline-flex align-items-center gap-1"><Avatar sm name={name(r.assigneeId)} />{name(r.assigneeId)}</span> : '—'}
                {r.originalAssigneeId && r.originalAssigneeId !== r.assigneeId && <div className="text-muted">was {name(r.originalAssigneeId) || 'someone else'}</div>}</td>
              <td className="small text-nowrap">{r.originalFinish ? <>{r.type !== 'MILESTONE' && <>{fmtDate(r.originalStart)} → </>}{fmtDate(r.originalFinish)}</> : <span className="text-muted">{r.status === 'ADDED' ? 'not in original' : 'no dates'}</span>}</td>
              <td className="small text-nowrap">{r.workStatus === 'DONE' ? <span>done {fmtDate(r.actualFinish || r.currentFinish)}</span> : r.currentFinish ? <>{r.type !== 'MILESTONE' && <>{fmtDate(r.currentStart)} → </>}{fmtDate(r.currentFinish)}</> : '—'}</td>
              <td className="text-end"><DaysVar days={r.finishVariance} /></td>
              <td className="small num">{r.status === 'REMOVED' ? '—' : `${Math.round(r.percentComplete)}%`}</td>
              <td><TaskVarChip status={r.status} /></td></tr>)}</tbody></table></div>)}
      </Card>
      <details className="mt-3 small text-muted"><summary className="d-inline-flex align-items-center gap-1"><Info size={13} /> How this is calculated</summary>
        <ul className="mt-2">
          <li>Variance is counted in <b>working days</b> on the project calendar: + means later than the original plan, − earlier.</li>
          <li>Unfinished work that is already past its due date is forecast to finish no earlier than today.</li>
          <li><b>Planned %</b> = share of the original effort (by estimate hours) the original plan expected to be finished today; <b>Done %</b> = the same work weighted by its actual % complete. Tasks added later don't count toward either, so they can't hide delays.</li>
          <li>Project status: <b>Delayed</b> if the end date is more than 5 working days late or done % is under 80% of planned; <b>At risk</b> if the end date is later, a task is overdue or slipped, or done % is under 95% of planned; <b>Ahead</b> if it will finish earlier.</li>
          <li>{Object.entries(TASK_VAR).map(([k, [l, , h]]) => `${l}: ${h}`).join(' · ')}.</li>
        </ul></details>
    </>
  );
}

export function PlanStatusCard() {
  const { project } = useProject();
  if (project.planApprovedAt === undefined) return null;
  const s = project.schedule;
  return (
    <Card title={<span className="d-inline-flex align-items-center gap-2"><Lock size={16} /> Schedule vs original plan</span>} actions={<Link to="plan" className="small fw-semibold">{s ? 'Details' : 'Build plan'}</Link>}>
      {!project.planApprovedAt ? <><div className="small mb-2">The plan isn't approved yet, so there is nothing to compare against.</div><Link to="plan" className="btn btn-sm btn-primary">Build &amp; approve the plan</Link></>
        : s ? <><div className="d-flex align-items-center gap-2 mb-1"><ScheduleChip status={s.status} /><span className="small fw-semibold"><DaysVar days={s.finishVariance} /> on the end date</span></div>
          <div className="small">{scheduleSentence(s, fmtDate)}</div>
          {s.plannedPct != null && <div className="small text-muted mt-1">Planned {s.plannedPct}% · done {s.actualPct}%{s.delayed ? ` · ${s.delayed} task(s) behind` : ''}</div>}</> : null}
    </Card>
  );
}
