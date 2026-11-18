import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Inbox, ShieldCheck, Timer, Smile, CheckCircle2, Clock, FolderKanban, CalendarClock, Gauge, Wallet, Users, TrendingUp, AlertTriangle, Flag, Activity, LifeBuoy, Briefcase } from 'lucide-react';
import { get, download } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { fmtDate, fmtMoney, labelize, fmtHoursShort, projectColor } from '../lib/format.js';
import { Avatar, Empty, ErrorBox, HealthBadge, Loading, Meter, Pill, ProjectChip, ProjectDot, DueChip, useToast } from '../components/ui.jsx';
import { BarChart, LineChart, Donut } from '../components/BarChart.jsx';
import { PanelCard } from './Home.jsx';

// One calm palette for every report chart.
const C = { brand: '#0a3df0', blue: '#3b82f6', sky: '#93c5fd', pale: '#e4e9fb', green: '#16a34a', mint: '#86efac', amber: '#f59e0b', red: '#e11d48', violet: '#8b5cf6', slate: '#a1a1aa', teal: '#14b8a6' };
const SCHEDULE = { AHEAD: ['Ahead', 'blue', C.blue], ON_TRACK: ['On schedule', 'ok', C.green], AT_RISK: ['At risk', 'warn', C.amber], DELAYED: ['Running late', 'risk', C.red], COMPLETED: ['Completed', 'neutral', C.slate] };
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const fmtH = (h) => `${Number(h || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;

const Kpi = ({ icon: Icon, label, value, unit, hint, tone }) => (
  <div className={`kpi ${tone === 'bad' ? 'is-alert' : ''}`}><div className="k-label">{Icon && <Icon size={14} />}{label}</div><div className="k-value">{value}{unit && <small>{unit}</small>}</div>{hint && <div className="k-hint">{hint}</div>}</div>
);
const Legend = ({ items }) => <div className="d-flex flex-wrap gap-3 small text-muted mb-2">{items.map(([name, color]) => <span key={name} className="d-inline-flex align-items-center gap-1"><span className="legend-dot" style={{ background: color }} />{name}</span>)}</div>;
const HealthBar = ({ parts }) => { const total = parts.reduce((s, p) => s + p[1], 0) || 1; return <div className="health-bar">{parts.filter((p) => p[1] > 0).map(([n, v, c]) => <span key={n} title={`${n}: ${v}`} style={{ width: `${(v / total) * 100}%`, background: c }} />)}</div>; };
const SchedulePill = ({ s }) => (s ? <Pill tone={SCHEDULE[s]?.[1] || 'neutral'}>{SCHEDULE[s]?.[0] || labelize(s)}</Pill> : <span className="small text-muted">Plan not approved</span>);

function useReportData() {
  const dash = useLoad(() => get('/dashboard'), []);
  const stats = useLoad(() => get('/tickets/stats'), []);
  const time = useLoad(() => get('/reports/time-summary', { weeks: 8 }), []);
  useLive((e) => e.type.startsWith('ticket'), () => { stats.reload({ silent: true }); dash.reload({ silent: true }); });
  useLive((e) => e.type === 'work.changed', () => dash.reload({ silent: true }));
  return { dash, stats, time };
}

function Overview({ d, s, t }) {
  const p = d.portfolio || [];
  const active = p.filter((x) => x.status !== 'DRAFT');
  const health = [['On track', p.filter((x) => x.status !== 'DRAFT' && x.health === 'GREEN').length, C.green], ['At risk', p.filter((x) => x.status !== 'DRAFT' && x.health === 'AMBER').length, C.amber], ['Off track', p.filter((x) => x.status !== 'DRAFT' && x.health === 'RED').length, C.red], ['In planning', p.filter((x) => x.status === 'DRAFT').length, C.slate]];
  const sched = ['AHEAD', 'ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETED'].map((k) => [SCHEDULE[k][0], p.filter((x) => x.schedule === k).length, SCHEDULE[k][2]]).concat([['No approved plan', p.filter((x) => !x.schedule).length, '#e4e4e7']]).filter((x) => x[1] > 0);
  const onSchedule = p.filter((x) => ['AHEAD', 'ON_TRACK', 'COMPLETED'].includes(x.schedule)).length;
  const withPlan = p.filter((x) => x.schedule).length;
  const avgProgress = active.length ? Math.round(active.reduce((a, x) => a + (x.progress || 0), 0) / active.length) : 0;
  const est = p.reduce((a, x) => a + (x.estimateHours || 0), 0); const act = p.reduce((a, x) => a + (x.actualHours || 0), 0);
  const ticketStatus = Object.entries(s.byStatus || {}).map(([k, v], i) => [labelize(k), v, [C.brand, C.blue, C.sky, C.amber, C.violet, C.teal][i % 6]]);
  const days = s.trend.days.map((x) => new Date(`${x}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  const weekLabels = t.weeks.map((w) => new Date(`${w.week}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  const wl = d.workload || [];
  const late = p.filter((x) => x.schedule === 'DELAYED' || x.health === 'RED');
  return (
    <>
      <div className="kpi-strip">
        <Kpi icon={FolderKanban} label="Projects in flight" value={active.length} hint={`${p.length - active.length} in planning · ${p.filter((x) => x.status === 'ON_HOLD').length} on hold`} />
        <Kpi icon={CalendarClock} label="On schedule" value={withPlan ? pct(onSchedule, withPlan) : '—'} unit={withPlan ? '%' : ''} hint={`${onSchedule} of ${withPlan} approved plans`} tone={withPlan && onSchedule / withPlan < 0.6 ? 'bad' : ''} />
        <Kpi icon={Gauge} label="Average progress" value={avgProgress} unit="%" hint="Work done, weighted by effort" />
        <Kpi icon={Clock} label="Hours spent" value={fmtH(act)} unit="h" hint={`${pct(act, est) ?? 0}% of ${fmtH(est)} h estimated`} />
        <Kpi icon={Inbox} label="Open tickets" value={s.open} hint={`${s.breached} breached · ${s.unassigned} unassigned`} tone={s.breached ? 'bad' : ''} />
        <Kpi icon={ShieldCheck} label="SLA met · 30d" value={s.slaCompliance == null ? '—' : Math.round(s.slaCompliance * 100)} unit={s.slaCompliance == null ? '' : '%'} hint={s.csat.average == null ? 'No client ratings yet' : `Client rating ${s.csat.average.toFixed(1)} / 5`} />
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-4"><PanelCard title="Portfolio health"><Donut label="Projects by health" centerLabel="projects" height={150} items={health.filter((h) => h[1] > 0).map(([name, value, color]) => ({ name, value, color }))} /></PanelCard></div>
        <div className="col-xl-4"><PanelCard title="Schedule against approved plans"><Donut label="Projects by schedule status" centerLabel="projects" height={150} items={sched.map(([name, value, color]) => ({ name, value, color }))} /></PanelCard></div>
        <div className="col-xl-4"><PanelCard title="Open tickets by status"><Donut label="Open tickets by status" centerLabel="open" height={150} items={ticketStatus.filter((x) => x[1] > 0).map(([name, value, color]) => ({ name, value, color }))} /></PanelCard></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-8"><PanelCard title="Logged hours per week" tools={<span className="small text-muted">Last 8 weeks · {fmtH(t.totals.hours)} h · {pct(t.totals.billable, t.totals.hours) ?? 0}% billable</span>}>
          <BarChart stacked height={300} label="Logged hours per week, billable and non-billable" axisTitle="Hours" labels={weekLabels} series={[{ name: 'Billable', data: t.weeks.map((w) => w.billable), color: C.brand }, { name: 'Non-billable', data: t.weeks.map((w) => w.nonBillable), color: C.sky }]} />
        </PanelCard></div>
        <div className="col-xl-4"><PanelCard title="Where the time went" tools={<span className="small text-muted">8 weeks</span>}>
          {t.byProject.length ? <ul className="row-list">{t.byProject.slice(0, 6).map((x, i) => <li key={x.id}><span className="rank">{i + 1}</span><div className="r-main"><span className="r-title">{x.name}</span><div className="meter mt-1" style={{ '--pc': projectColor(x.code || '') }}><span style={{ width: `${pct(x.hours, t.byProject[0].hours)}%` }} /></div></div><span className="small fw-semibold num">{fmtH(x.hours)} h</span></li>)}</ul> : <Empty icon={Clock} title="No time logged yet" />}
        </PanelCard></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-8"><PanelCard title="Tickets created vs resolved" tools={<span className="small text-muted">Last 14 days</span>}>
          <LineChart label="Tickets created and resolved per day" labels={days} series={[{ name: 'Created', data: s.trend.created, color: C.brand }, { name: 'Resolved', data: s.trend.resolved, color: C.green }]} height={240} />
        </PanelCard></div>
        <div className="col-xl-4"><PanelCard title="Team utilisation" tools={<span className="small text-muted">Next 2 weeks</span>}>
          {wl.length ? wl.slice(0, 7).map((w) => <div key={w.userId} className="cap-row"><span className="who"><Avatar sm name={w.name} /><span>{w.name}</span></span><span className="track"><span style={{ width: `${Math.min(100, w.pct)}%`, background: w.pct > 100 ? C.red : w.pct > 80 ? C.amber : C.green }} /></span><span className="v">{Math.round(w.pct)}%</span></div>) : <Empty icon={Users} title="No assigned work yet" />}
        </PanelCard></div>
      </div>

      <PanelCard title="Projects that need attention" count={late.length} flush>
        {late.length ? <div className="table-wrap"><table className="table table-hover"><thead><tr><th>Project</th><th>Health</th><th>Schedule</th><th>Finish vs plan</th><th style={{ width: 200 }}>Progress</th><th>Planned finish</th></tr></thead><tbody>
          {late.map((x) => <tr key={x.id}><td><Link to={`/projects/${x.id}`} className="d-inline-flex align-items-center gap-2 fw-medium text-body"><ProjectChip code={x.code} size={26} />{x.name}</Link></td><td><HealthBadge health={x.health} /></td><td><SchedulePill s={x.schedule} /></td>
            <td className="small">{x.scheduleVarianceDays > 0 ? <span className="text-danger fw-medium">{x.scheduleVarianceDays} working days late</span> : x.scheduleVarianceDays < 0 ? <span className="text-success">{-x.scheduleVarianceDays} days early</span> : 'On the planned date'}</td>
            <td><Meter value={x.progress} /></td><td className="small">{fmtDate(x.plannedFinish)}</td></tr>)}
        </tbody></table></div> : <div className="p-3"><Empty icon={CheckCircle2} title="Every project is on track" /></div>}
      </PanelCard>
    </>
  );
}

function Delivery({ d }) {
  const toast = useToast();
  const p = d.portfolio || [];
  const ms = d.milestones || [];
  const budgets = p.filter((x) => x.budget);
  const est = p.reduce((a, x) => a + (x.estimateHours || 0), 0); const act = p.reduce((a, x) => a + (x.actualHours || 0), 0);
  const msTotal = p.reduce((a, x) => a + (x.milestones?.total || 0), 0); const msDone = p.reduce((a, x) => a + (x.milestones?.done || 0), 0);
  const lateDays = p.filter((x) => x.scheduleVarianceDays > 0);
  return (
    <>
      <div className="kpi-strip">
        <Kpi icon={FolderKanban} label="Projects" value={p.length} hint={`${p.filter((x) => x.status === 'ACTIVE').length} active`} />
        <Kpi icon={Flag} label="Milestones reached" value={msDone} unit={`/ ${msTotal}`} hint={`${ms.filter((m) => m.overdue).length} overdue now`} tone={ms.some((m) => m.overdue) ? 'bad' : ''} />
        <Kpi icon={AlertTriangle} label="Running late" value={lateDays.length} hint={lateDays.length ? `Up to ${Math.max(...lateDays.map((x) => x.scheduleVarianceDays))} working days` : 'No slips'} tone={lateDays.length ? 'bad' : ''} />
        <Kpi icon={Clock} label="Estimated effort" value={fmtH(est)} unit="h" hint="Across all open plans" />
        <Kpi icon={Activity} label="Hours spent" value={fmtH(act)} unit="h" hint={`${pct(act, est) ?? 0}% of estimate used`} />
        <Kpi icon={Wallet} label="Tracked budgets" value={budgets.length} hint={budgets.length ? `${budgets.filter((b) => b.budget.consumed > b.budget.amount).length} over budget` : 'None configured'} />
      </div>

      <PanelCard title="Project portfolio" count={p.length} className="mb-3" flush tools={<button className="btn btn-sm btn-light" onClick={() => download('/reports/portfolio.csv', 'portfolio.csv').catch((e) => toast(e.message, 'error'))}><Download size={14} /> Export CSV</button>}>
        {p.length === 0 ? <div className="p-3"><Empty title="No active projects" /></div> : <div className="table-wrap"><table className="table table-hover">
          <thead><tr><th>Project</th><th>Health</th><th>Schedule</th><th style={{ width: 170 }}>Progress</th><th>Milestones</th><th>Planned finish</th><th title={d.definitions.scheduleVariance}>Variance</th><th>Hours (spent / planned)</th><th>Budget used</th></tr></thead>
          <tbody>{p.map((x) => {
            const used = x.budget?.consumed != null && x.budget.amount ? pct(x.budget.consumed, x.budget.amount) : null;
            return <tr key={x.id}>
              <td style={{ minWidth: 250 }}><Link to={`/projects/${x.id}`} className="d-inline-flex align-items-center gap-2 text-body text-nowrap"><ProjectChip code={x.code} size={28} /><span><span className="fw-medium d-block">{x.name}</span><span className="small text-muted">{x.customer || 'Internal'}{x.status !== 'ACTIVE' ? ` · ${labelize(x.status)}` : ''}</span></span></Link></td>
              <td>{x.status === 'DRAFT' ? <Pill tone="neutral">Draft</Pill> : <HealthBadge health={x.health} />}</td>
              <td><SchedulePill s={x.schedule} /></td>
              <td><Meter value={x.progress} /></td>
              <td className="small num">{x.milestones ? `${x.milestones.done} / ${x.milestones.total}` : '—'}</td>
              <td className="small text-nowrap">{fmtDate(x.plannedFinish)}</td>
              <td className="small text-nowrap">{x.scheduleVarianceDays == null ? <span className="text-muted">—</span> : x.scheduleVarianceDays > 0 ? <span className="text-danger fw-medium">+{x.scheduleVarianceDays} d</span> : x.scheduleVarianceDays < 0 ? <span className="text-success fw-medium">{x.scheduleVarianceDays} d</span> : <span className="text-muted">0 d</span>}</td>
              <td className="small num text-nowrap"><span className="d-inline-flex align-items-center gap-2"><span className="meter" style={{ width: 60, '--pc': x.actualHours > x.estimateHours ? C.red : C.brand }}><span style={{ width: `${Math.min(100, pct(x.actualHours, x.estimateHours) || 0)}%` }} /></span>{fmtH(x.actualHours)} / {fmtH(x.estimateHours)}</span></td>
              <td className="small text-nowrap">{x.budget ? <span title={`${fmtMoney(x.budget.consumed ?? 0, x.budget.currency)} of ${fmtMoney(x.budget.amount, x.budget.currency)}`}><span className={`fw-semibold ${used > 100 ? 'text-danger' : ''}`}>{used == null ? '—' : `${used}%`}</span> <span className="text-muted">of {fmtMoney(x.budget.amount, x.budget.currency)}</span></span> : <span className="text-muted">—</span>}</td>
            </tr>;
          })}</tbody></table></div>}
      </PanelCard>

      <div className="row g-3 mb-3">
        <div className="col-xl-7"><PanelCard title="Planned vs spent hours" tools={<span className="small text-muted">By project</span>}>
          {p.length ? <BarChart horizontal height={Math.max(240, p.length * 34)} label="Planned versus spent hours by project" axisTitle="Hours" labels={p.map((x) => x.name)} series={[{ name: 'Planned', data: p.map((x) => x.estimateHours), color: C.pale }, { name: 'Spent', data: p.map((x) => x.actualHours), colors: p.map((x) => (x.actualHours > x.estimateHours ? C.red : C.brand)) }]} /> : <Empty title="No data yet" />}
        </PanelCard></div>
        <div className="col-xl-5"><PanelCard title="Progress by project" tools={<span className="small text-muted">Work done</span>}>
          {p.length ? <BarChart horizontal height={Math.max(240, p.length * 34)} max={100} label="Progress percentage by project" axisTitle="% done" legend={false} labels={p.map((x) => x.code)} series={[{ name: 'Progress', data: p.map((x) => Math.round(x.progress || 0)), colors: p.map((x) => projectColor(x.code)) }]} /> : <Empty title="No data yet" />}
        </PanelCard></div>
      </div>

      <div className="row g-3">
        <div className="col-xl-6"><PanelCard title="Milestones in the next two weeks" count={ms.length}>
          {ms.length ? <ul className="row-list">{ms.slice(0, 8).map((m) => <li key={m.id}><span className={`ms-date ${m.overdue ? 'late' : ''}`}><span>{new Date(`${m.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short' })}</span><b>{new Date(`${m.date}T00:00:00`).getDate()}</b></span>
            <div className="r-main"><Link to={`/projects/${m.projectId}/tasks?item=${m.id}`} className="r-title">{m.title}</Link><div className="r-meta"><ProjectDot code={m.projectCode} />{p.find((x) => x.id === m.projectId)?.name || m.projectCode}</div></div><DueChip date={m.date} /></li>)}</ul> : <Empty icon={Flag} title="No milestones due soon" />}
        </PanelCard></div>
        <div className="col-xl-6"><PanelCard title="Budget burn" count={budgets.length} foot={d.definitions.budgetConsumed}>
          {budgets.length ? <ul className="row-list">{budgets.map((x) => { const used = x.budget.consumed != null ? pct(x.budget.consumed, x.budget.amount) : null; return <li key={x.id}><ProjectChip code={x.code} size={30} /><div className="r-main"><span className="r-title">{x.name}</span>
            <div className="d-flex align-items-center gap-2 mt-1"><div className="meter flex-grow-1" style={{ '--pc': used > 100 ? C.red : used > 80 ? C.amber : C.green }}><span style={{ width: `${Math.min(100, used || 0)}%` }} /></div><span className="small text-muted text-nowrap">{fmtMoney(x.budget.consumed ?? 0, x.budget.currency)} of {fmtMoney(x.budget.amount, x.budget.currency)}</span></div></div>
            <span className={`small fw-semibold num ${used > 100 ? 'text-danger' : ''}`}>{used == null ? '—' : `${used}%`}</span></li>; })}</ul> : <Empty icon={Wallet} title="No budgets tracked" >Add a budget and hourly rate in a project's settings.</Empty>}
        </PanelCard></div>
      </div>
    </>
  );
}

function TeamTime({ d, t }) {
  const toast = useToast();
  const wl = d.workload || [];
  const over = wl.filter((w) => w.pct > 100);
  const cap = wl.reduce((a, w) => a + w.capacityHours, 0); const planned = wl.reduce((a, w) => a + w.plannedHours, 0);
  const weekLabels = t.weeks.map((w) => new Date(`${w.week}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  const avgWeek = t.weeks.length ? t.totals.hours / t.weeks.length : 0;
  const palette = [C.brand, C.blue, C.violet, C.teal, C.amber, C.sky, C.green, C.slate];
  const range = () => { const x = t.weeks[0]?.week; return { from: x, to: t.to }; };
  return (
    <>
      <div className="kpi-strip">
        <Kpi icon={Users} label="People with work" value={wl.length} hint={`${over.length} overbooked`} tone={over.length ? 'bad' : ''} />
        <Kpi icon={Gauge} label="Planned load · 2 wks" value={pct(planned, cap) ?? 0} unit="%" hint={`${fmtH(planned)} of ${fmtH(cap)} h available`} />
        <Kpi icon={Clock} label="Logged · 8 wks" value={fmtH(t.totals.hours)} unit="h" hint={`About ${fmtH(avgWeek)} h a week`} />
        <Kpi icon={Briefcase} label="Billable share" value={pct(t.totals.billable, t.totals.hours) ?? 0} unit="%" hint={`${fmtH(t.totals.billable)} h billable`} />
        <Kpi icon={FolderKanban} label="Projects booked" value={t.totals.projects} hint={`${t.totals.people} people logged time`} />
        <Kpi icon={TrendingUp} label="This week" value={fmtH((t.weeks.at(-1)?.billable || 0) + (t.weeks.at(-1)?.nonBillable || 0))} unit="h" hint="Logged so far" />
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-7"><PanelCard title="Capacity — next two weeks" tools={<Link to="/planner" className="btn btn-sm btn-light">Open planner</Link>} foot="Planned = remaining estimate of assigned tasks in this period. Red = more work than time.">
          {wl.length ? <BarChart height={Math.max(240, wl.length * 38)} horizontal label="Planned hours against available hours" axisTitle="Hours" labels={wl.map((w) => w.name)} series={[{ name: 'Available', data: wl.map((w) => w.capacityHours), color: C.pale }, { name: 'Planned', data: wl.map((w) => w.plannedHours), colors: wl.map((w) => (w.state === 'OVER' ? C.red : C.brand)) }, { name: 'Logged', data: wl.map((w) => w.loggedHours), color: C.green }]} /> : <Empty icon={Users} title="No people yet" />}
        </PanelCard></div>
        <div className="col-xl-5"><PanelCard title="Hours by project" tools={<span className="small text-muted">8 weeks</span>}>
          {t.byProject.length ? <Donut label="Logged hours by project" centerLabel="hours" height={170} items={t.byProject.slice(0, 7).map((x, i) => ({ name: x.name, value: Math.round(x.hours), color: palette[i % palette.length] }))} /> : <Empty icon={Clock} title="No time logged yet" />}
        </PanelCard></div>
      </div>

      <PanelCard title="Weekly time trend" className="mb-3" tools={<span className="small text-muted">Billable vs non-billable</span>}>
        <LineChart height={230} label="Logged hours per week" labels={weekLabels} series={[{ name: 'Billable', data: t.weeks.map((w) => w.billable), color: C.brand }, { name: 'Non-billable', data: t.weeks.map((w) => w.nonBillable), color: C.amber }]} />
      </PanelCard>

      <PanelCard title="Time by person" count={t.byPerson.length} flush tools={<button className="btn btn-sm btn-light" onClick={() => { const r = range(); download(`/reports/time.csv?from=${r.from}&to=${r.to}`, 'time.csv').catch((e) => toast(e.message, 'error')); }}><Download size={14} /> Export CSV</button>}>
        {t.byPerson.length ? <div className="table-wrap"><table className="table table-hover"><thead><tr><th>Person</th><th className="text-end">Logged</th><th className="text-end">Billable</th><th>Billable share</th><th className="text-end">Projects</th><th>Utilisation (8 wks)</th><th>Next 2 weeks</th></tr></thead><tbody>
          {t.byPerson.map((x) => { const w = wl.find((y) => y.userId === x.id); return <tr key={x.id}>
            <td><span className="d-inline-flex align-items-center gap-2"><Avatar name={x.name} /><span><span className="fw-medium d-block">{x.name}</span><span className="small text-muted">{x.title || '—'}</span></span></span></td>
            <td className="text-end num fw-medium">{fmtH(x.hours)} h</td><td className="text-end num">{fmtH(x.billable)} h</td>
            <td><span className="util"><span className="meter"><span style={{ width: `${pct(x.billable, x.hours) || 0}%` }} /></span><span className="small num">{pct(x.billable, x.hours) ?? 0}%</span></span></td>
            <td className="text-end num">{x.projects}</td>
            <td><span className="util"><span className="meter" style={{ '--pc': x.pct > 100 ? C.red : C.green }}><span style={{ width: `${Math.min(100, x.pct || 0)}%` }} /></span><span className="small num">{x.pct == null ? '—' : `${x.pct}%`}</span></span></td>
            <td>{w ? <Pill tone={w.pct > 100 ? 'risk' : w.pct > 80 ? 'warn' : 'ok'}>{Math.round(w.pct)}% booked</Pill> : <span className="small text-muted">—</span>}</td>
          </tr>; })}
        </tbody></table></div> : <div className="p-3"><Empty icon={Clock} title="No time logged in the last 8 weeks" /></div>}
      </PanelCard>
      <div className="report-note">{t.method}</div>
    </>
  );
}

function Support({ d, s }) {
  const toast = useToast();
  const days = s.trend.days.map((x) => new Date(`${x}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  const sla = d.tickets?.sla;
  const created14 = s.trend.created.reduce((a, b) => a + b, 0); const resolved14 = s.trend.resolved.reduce((a, b) => a + b, 0);
  const maxAgent = Math.max(1, ...s.agents.map((a) => a.open + a.resolved));
  const pri = [['CRITICAL', 'Urgent', C.red], ['HIGH', 'High', C.amber], ['MEDIUM', 'Normal', C.brand], ['LOW', 'Low', C.slate]];
  return (
    <>
      <div className="kpi-strip">
        <Kpi icon={Inbox} label="Open now" value={s.open} hint={`${s.unassigned} unassigned · ${s.createdToday ?? 0} new today`} />
        <Kpi icon={CheckCircle2} label="Resolved · 30d" value={s.resolved30} hint={`${created14} created, ${resolved14} resolved in 14 days`} />
        <Kpi icon={Timer} label="Avg first reply" value={fmtHoursShort(s.avgFirstResponseHours)} hint="Calendar time" />
        <Kpi icon={Clock} label="Avg resolution" value={fmtHoursShort(s.avgResolutionHours)} hint="Calendar time" />
        <Kpi icon={ShieldCheck} label="SLA met · 30d" value={s.slaCompliance == null ? '—' : Math.round(s.slaCompliance * 100)} unit={s.slaCompliance == null ? '' : '%'} hint={`${s.breached} breached · ${s.atRisk ?? 0} at risk`} tone={s.breached ? 'bad' : ''} />
        <Kpi icon={Smile} label="Client rating · 90d" value={s.csat.average == null ? '—' : s.csat.average.toFixed(1)} unit={s.csat.average == null ? '' : '/ 5'} hint={`${s.csat.count} ratings`} />
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-8"><PanelCard title="Created vs resolved" tools={<><span className="small text-muted">Last 14 days</span><button className="btn btn-sm btn-light" onClick={() => download('/tickets/export.csv?view=all', 'tickets.csv').catch((e) => toast(e.message, 'error'))}><Download size={14} /> Export</button></>}>
          <LineChart label="Tickets created and resolved per day" labels={days} series={[{ name: 'Created', data: s.trend.created, color: C.brand }, { name: 'Resolved', data: s.trend.resolved, color: C.green }]} height={250} />
        </PanelCard></div>
        <div className="col-xl-4"><PanelCard title="Open tickets by priority">
          <Donut label="Open tickets by priority" centerLabel="open" height={150} items={pri.map(([k, name, color]) => ({ name, value: s.byPriority[k] || 0, color })).filter((x) => x.value > 0)} />
          <div className="mt-3"><HealthBar parts={pri.map(([k, name, color]) => [name, s.byPriority[k] || 0, color])} /></div>
        </PanelCard></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-7"><PanelCard title="SLA status" foot={`${d.tickets?.slaWindow}. Targets count working hours.`}>
          {sla ? <><Legend items={[['Met', C.green], ['On track', C.sky], ['At risk', C.amber], ['Breached', C.red], ['Paused', C.slate]]} />
            {[['First reply', sla.response], ['Resolution', sla.resolution]].map(([name, v]) => { const total = ['MET', 'ON_TRACK', 'AT_RISK', 'BREACHED', 'PAUSED'].reduce((a, k) => a + v[k], 0); return <div key={name} className="mb-3">
              <div className="d-flex justify-content-between small mb-1"><span className="fw-medium">{name}</span><span className="text-muted">{v.MET} of {total} met · {v.BREACHED} breached</span></div>
              <HealthBar parts={[['Met', v.MET, C.green], ['On track', v.ON_TRACK, C.sky], ['At risk', v.AT_RISK, C.amber], ['Breached', v.BREACHED, C.red], ['Paused', v.PAUSED, C.slate]]} /></div>; })}</> : <Loading rows={2} />}
        </PanelCard></div>
        <div className="col-xl-5"><PanelCard title="Open tickets by client">
          {s.customers?.length ? <ul className="row-list">{s.customers.map((c) => <li key={c.name}><span className="ic-tile sm t-blue"><LifeBuoy size={14} /></span><div className="r-main"><span className="r-title">{c.name}</span><div className="meter mt-1"><span style={{ width: `${pct(c.open, s.open) || 0}%` }} /></div></div><span className="small fw-semibold num">{c.open}</span></li>)}</ul> : <Empty icon={LifeBuoy} title="No open client tickets" />}
        </PanelCard></div>
      </div>

      <PanelCard title="Agent performance" count={s.agents.length} flush>
        {s.agents.length ? <div className="table-wrap"><table className="table table-hover"><thead><tr><th>Agent</th><th className="text-end">Open</th><th className="text-end">Resolved · 30d</th><th style={{ width: "40%" }}>Workload <span className="fw-normal">(resolved · open)</span></th></tr></thead>
          <tbody>{s.agents.map((a) => <tr key={a.id}><td><span className="d-inline-flex align-items-center gap-2"><Avatar name={a.name} /><span className="fw-medium">{a.name}</span></span></td><td className="text-end num">{a.open}</td><td className="text-end num">{a.resolved}</td>
            <td><div className="health-bar" style={{ width: `${((a.open + a.resolved) / maxAgent) * 100}%` }}><span style={{ width: `${pct(a.resolved, a.open + a.resolved)}%`, background: C.green }} /><span style={{ width: `${pct(a.open, a.open + a.resolved)}%`, background: C.brand }} /></div></td></tr>)}</tbody></table></div> : <div className="p-3"><Empty title="No assigned tickets yet" /></div>}
      </PanelCard>
    </>
  );
}

const TABS = [['overview', 'Overview'], ['delivery', 'Delivery'], ['team', 'Team & time'], ['support', 'Support desk']];

export default function Reports() {
  const [tab, setTab] = useState('overview');
  const { dash, stats, time } = useReportData();
  const err = dash.error || stats.error || time.error;
  const ready = dash.data && stats.data && time.data;
  return (
    <>
      <div className="page-header">
        <div><div className="eyebrow">Updated live · {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</div><h1 className="h-page">Reports</h1><div className="sub">Delivery health, schedule, effort, team capacity and support performance in one place.</div></div>
      </div>
      <nav className="tabs" role="tablist" aria-label="Report">{TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>)}</nav>
      {err ? <ErrorBox error={err} onRetry={() => { dash.reload(); stats.reload(); time.reload(); }} /> : !ready ? <Loading rows={8} />
        : tab === 'delivery' ? <Delivery d={dash.data} /> : tab === 'team' ? <TeamTime d={dash.data} t={time.data} /> : tab === 'support' ? <Support d={dash.data} s={stats.data} /> : <Overview d={dash.data} s={stats.data} t={time.data} />}
    </>
  );
}
