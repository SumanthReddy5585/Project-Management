import { Link } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { get } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { addDaysISO, fmtDate, fmtMoney, labelize, todayISO } from '../../lib/format.js';
import { ErrorBox, Loading } from '../../components/ui.jsx';
import { LineChart } from '../../components/BarChart.jsx';
import { useProject } from './Workspace.jsx';
import { ScheduleChip, DaysVar, TaskVarChip, scheduleSentence } from '../../lib/schedule.jsx';

/** One-page project status report, designed to print to PDF for steering committees / clients. */
export function StatusReport() {
  const { project: p, people, can } = useProject();
  const { me } = useAuth();
  const today = todayISO(); const back = addDaysISO(today, -14); const ahead = addDaysISO(today, 14);
  const items = useLoad(() => get(`/projects/${p.id}/work-items`, { all: 'true' }), [p.id]);
  const burn = useLoad(() => get(`/projects/${p.id}/burnup`), [p.id]);
  const an = useLoad(() => get(`/projects/${p.id}/schedule/analysis`), [p.id]);
  const risks = useLoad(() => (can('register.view') ? get(`/projects/${p.id}/registers/risks`) : Promise.resolve({ data: [] })), [p.id]);
  const issues = useLoad(() => (can('register.view') ? get(`/projects/${p.id}/registers/issues`) : Promise.resolve({ data: [] })), [p.id]);
  const ups = useLoad(() => get(`/projects/${p.id}/updates`), [p.id]);
  const plan = useLoad(() => (p.planApprovedAt ? get(`/projects/${p.id}/plan`) : Promise.resolve(null)), [p.id, p.planApprovedAt]);
  if (items.loading && !items.data) return <Loading rows={8} />;
  const all = (items.data?.data || []).filter((i) => i.type !== 'MODULE');
  const name = (id) => people.find((m) => m.id === id)?.name || '—';
  const done = all.filter((i) => i.status === 'DONE' && i.actualFinish && i.actualFinish >= back).sort((a, b) => b.actualFinish.localeCompare(a.actualFinish));
  const next = all.filter((i) => !['DONE', 'CANCELLED'].includes(i.status) && i.plannedFinish && i.plannedFinish >= today && i.plannedFinish <= ahead).sort((a, b) => a.plannedFinish.localeCompare(b.plannedFinish));
  const late = all.filter((i) => !['DONE', 'CANCELLED'].includes(i.status) && i.plannedFinish && i.plannedFinish < today).sort((a, b) => a.plannedFinish.localeCompare(b.plannedFinish));
  const blocked = all.filter((i) => i.status === 'BLOCKED');
  const ms = all.filter((i) => i.type === 'MILESTONE').sort((a, b) => (a.plannedFinish || '9').localeCompare(b.plannedFinish || '9'));
  const openRisks = (risks.data?.data || []).filter((r) => r.status !== 'CLOSED').sort((a, b) => b.probability * b.impact - a.probability * a.impact).slice(0, 6);
  const openIssues = (issues.data?.data || []).filter((r) => r.status !== 'CLOSED').sort((a, b) => b.severity - a.severity).slice(0, 6);
  const latest = ups.data?.data?.[0];
  const h = burn.data?.hours; const b = burn.data?.budget;
  const T = ({ rows, empty, cols }) => (rows.length === 0 ? <div className="small text-muted">{empty}</div> : <table className="table table-sm"><tbody>{rows.map((r) => <tr key={r.id}>{cols(r).map((c, i) => <td key={i} className={i === 0 ? 'mono text-muted text-nowrap' : ''}>{c}</td>)}</tr>)}</tbody></table>);
  return (
    <div className="report-page">
      <div className="d-flex gap-2 mb-3 no-print"><Link to={`/projects/${p.id}`} className="btn btn-light btn-sm"><ArrowLeft size={14} /> Back to project</Link>
        <button className="btn btn-primary btn-sm ms-auto" onClick={() => window.print()}><Printer size={14} /> Print / save as PDF</button></div>
      <ErrorBox error={items.error || burn.error} />
      <div className="card"><div className="card-body p-4">
        <div className="rp-head d-flex align-items-end gap-3 flex-wrap">
          <div className="flex-grow-1"><div className="small-caps text-muted">Project status report · {me?.organization?.name}</div><h1 className="h3 mb-1">{p.name} <span className="text-muted fw-normal">({p.code})</span></h1>
            <div className="small text-muted">{p.customerName || 'Internal project'} · Project manager: {name(p.managerId)} · {fmtDate(p.plannedStart)} → {fmtDate(p.plannedFinish)}</div></div>
          <div className="text-end"><div className="small text-muted">Report date</div><div className="fw-semibold">{fmtDate(today)}</div><span className={`rag ${p.health} mt-1`}>● {labelize(p.health)}</span></div>
        </div>
        <div className="rp-kpis">
          <div><b>{p.progress == null ? '—' : `${Math.round(p.progress)}%`}</b><span>Complete</span></div>
          <div><b>{p.counts.open}</b><span>Open tasks</span></div>
          <div><b className={p.counts.overdue ? 'text-danger' : ''}>{p.counts.overdue}</b><span>Overdue</span></div>
          <div><b>{p.milestones.done}/{p.milestones.total}</b><span>Milestones met</span></div>
          <div><b>{h ? `${h.logged}h` : '—'}</b><span>{h ? `of ${h.estimate}h estimated` : 'Hours'}</span></div>
        </div>
        <h2>Schedule vs original plan</h2>
        {!p.planApprovedAt ? <div className="small text-muted">The project plan has not been approved yet, so there is no original plan to compare against.</div>
          : plan.data && <>
            <div className="d-flex align-items-center gap-2 mb-1"><ScheduleChip status={plan.data.summary.status} /><span className="fw-semibold">{scheduleSentence(plan.data.summary, fmtDate)}</span></div>
            <div className="small text-muted mb-2">Original plan approved {fmtDate(plan.data.approvedAt)} by {plan.data.approvedBy?.name}. By today it expected {plan.data.summary.plannedPct ?? 0}% of the work done; {plan.data.summary.actualPct ?? 0}% is done.
              {' '}{plan.data.summary.counts.OVERDUE || 0} overdue · {plan.data.summary.counts.DELAYED || 0} delayed · {plan.data.summary.counts.DONE_LATE || 0} finished late · {plan.data.summary.counts.ADDED || 0} added after approval.</div>
            <table className="table table-sm"><thead><tr><th>Phase</th><th>Original finish</th><th>Forecast</th><th className="text-end">Variance</th><th>Status</th></tr></thead>
              <tbody>{plan.data.phases.map((ph) => <tr key={ph.id || 'none'}><td>{ph.name}</td><td>{fmtDate(ph.originalFinish)}</td><td>{fmtDate(ph.forecastFinish)}</td><td className="text-end"><DaysVar days={ph.finishVariance} /></td><td><ScheduleChip status={ph.status} /></td></tr>)}</tbody></table>
            {(() => { const late = plan.data.items.filter((r) => ['OVERDUE', 'DELAYED'].includes(r.status)).sort((a, b) => (b.finishVariance ?? 0) - (a.finishVariance ?? 0)).slice(0, 8);
              return late.length > 0 && <><div className="small fw-semibold mt-2">Biggest slips against the original plan</div><table className="table table-sm"><tbody>{late.map((r) => <tr key={r.id}><td className="mono text-muted">{p.code}-{r.number}</td><td>{r.title}</td><td>{fmtDate(r.originalFinish)} → {fmtDate(r.forecastFinish)}</td><td className="text-end"><DaysVar days={r.finishVariance} /></td><td><TaskVarChip status={r.status} /></td></tr>)}</tbody></table></>; })()}
          </>}
        {latest && <><h2>Summary from the project manager</h2><p className="mb-1 fw-semibold">{latest.title}</p><p className="small mb-0" style={{ whiteSpace: 'pre-wrap' }}>{latest.body}</p><div className="small text-muted">{latest.author?.name} · {fmtDate(latest.createdAt)}</div></>}
        <div className="row g-4">
          <div className="col-md-6"><h2>Phases</h2>{p.phases.map((ph) => <div key={ph.id} className="d-flex align-items-center gap-2 py-1"><span className="small flex-grow-1">{ph.name}<span className="text-muted"> · {fmtDate(ph.plannedFinish)}</span></span><div className="meter" style={{ width: 120 }}><span style={{ width: `${ph.progress || 0}%` }} /></div><span className="small fw-semibold num" style={{ width: 36, textAlign: 'right' }}>{Math.round(ph.progress || 0)}%</span></div>)}</div>
          <div className="col-md-6"><h2>Milestones</h2><T rows={ms.slice(0, 8)} empty="No milestones." cols={(m) => [m.key, m.title, fmtDate(m.plannedFinish), m.status === 'DONE' ? <span className="text-success fw-semibold">Met</span> : m.plannedFinish < today ? <span className="text-danger fw-semibold">Late</span> : 'Planned']} /></div>
        </div>
        {burn.data?.series?.length > 1 && <><h2>Progress over time</h2><LineChart height={190} label="Burn-up" labels={burn.data.series.map((x) => new Date(`${x.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}
          series={[{ name: 'Completed', data: burn.data.series.map((x) => x.done), color: '#16a34a' }, { name: 'Planned', data: burn.data.series.map((x) => x.planned), color: '#94a3b8' }, { name: 'Scope', data: burn.data.series.map((x) => x.scope), color: '#2563eb' }]} /></>}
        <div className="row g-4">
          <div className="col-md-6"><h2>Completed in the last 2 weeks ({done.length})</h2><T rows={done.slice(0, 10)} empty="Nothing completed in this period." cols={(i) => [i.key, i.title, fmtDate(i.actualFinish)]} /></div>
          <div className="col-md-6"><h2>Due in the next 2 weeks ({next.length})</h2><T rows={next.slice(0, 10)} empty="Nothing due in this period." cols={(i) => [i.key, i.title, name(i.assigneeId), fmtDate(i.plannedFinish)]} /></div>
        </div>
        {(late.length > 0 || blocked.length > 0) && <><h2>Needs attention</h2><T rows={[...blocked, ...late.filter((l) => l.status !== 'BLOCKED')].slice(0, 10)} empty="" cols={(i) => [i.key, i.title, name(i.assigneeId), i.status === 'BLOCKED' ? <span className="text-danger fw-semibold">Blocked</span> : <span className="text-danger">Due {fmtDate(i.plannedFinish)}</span>]} /></>}
        {an.data?.conflicts?.length > 0 && <div className="small text-warning-emphasis">⚠ {an.data.conflicts.length} task(s) are scheduled to start before the work they depend on finishes.</div>}
        {can('register.view') && <div className="row g-4">
          <div className="col-md-6"><h2>Top risks</h2><T rows={openRisks} empty="No open risks." cols={(r) => [`${r.probability * r.impact}`, r.title, r.mitigation ? <span className="small text-muted">{r.mitigation}</span> : name(r.ownerId)]} /></div>
          <div className="col-md-6"><h2>Open issues</h2><T rows={openIssues} empty="No open issues." cols={(r) => [`S${r.severity}`, r.title, fmtDate(r.targetDate)]} /></div>
        </div>}
        {h && <><h2>Effort{b ? ' & budget' : ''}</h2><div className="small">{h.logged}h logged of {h.estimate}h estimated ({h.estimate ? Math.round((h.logged / h.estimate) * 100) : 0}%), {h.billable}h billable.{b && <> Budget {fmtMoney(b.amount, b.currency)}{b.consumed != null && <>, spent {fmtMoney(b.consumed, b.currency)} ({Math.round((b.consumed / b.amount) * 100)}%)</>}.</>}</div></>}
        <div className="small text-muted mt-4 pt-2 border-top">Generated by O2 Support Hub on {new Date().toLocaleString()}. Figures are live from the project plan.</div>
      </div></div>
    </div>
  );
}
