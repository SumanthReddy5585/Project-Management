import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, FileCheck2, LifeBuoy, Flag } from 'lucide-react';
import { get, download } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtDate, fmtHours, fmtMoney, fmtRelative, labelize } from '../lib/format.js';
import { Card, Empty, ErrorBox, HealthBadge, Loading, Meter, PageHeader, Stat, StatusBadge, PriorityBadge } from '../components/ui.jsx';
import { BarChart, PALETTE } from '../components/BarChart.jsx';

const WorkRow = ({ w }) => (
  <li><Link to={`/projects/${w.projectId}/work?item=${w.id}`} className="d-flex gap-2 align-items-center text-decoration-none flex-grow-1 min-w-0"><span className="mono text-muted">{w.key}</span><span className="truncate text-body">{w.title}</span></Link>
    <StatusBadge status={w.status} /><span className={`small ${w.overdue ? 'text-danger fw-semibold' : 'text-muted'}`} style={{ minWidth: 92, textAlign: 'right' }}>{w.plannedFinish ? fmtDate(w.plannedFinish) : 'No date'}</span></li>
);

function EmployeePanels({ d }) {
  return (
    <div className="row g-3">
      <div className="col-lg-8"><Card title="My open work" actions={<span className="small text-muted">{d.myTasks.length} items</span>}>
        {d.myTasks.length ? <ul className="list-plain">{d.myTasks.slice(0, 12).map((w) => <WorkRow key={w.id} w={w} />)}</ul> : <Empty icon={CheckCircle2} title="Nothing assigned">New assignments will appear here.</Empty>}
      </Card></div>
      <div className="col-lg-4 d-flex flex-column gap-3">
        <Card title="This week's timesheet" actions={<Link to="/time" className="small">Open</Link>}>
          <div className="d-flex justify-content-between align-items-center"><div><div className="stat p-0"><div className="value">{fmtHours(d.timesheet.hours)}</div></div><div className="small text-muted">Week of {fmtDate(d.timesheet.weekStart)}</div></div><StatusBadge status={d.timesheet.status} /></div>
        </Card>
        <Card title="Blocked" actions={<AlertTriangle size={15} className="text-danger" />}>{d.blocked.length ? <ul className="list-plain">{d.blocked.map((w) => <WorkRow key={w.id} w={w} />)}</ul> : <div className="small text-muted">No blocked work.</div>}</Card>
        <Card title="Assigned tickets">{d.myTickets.length ? <ul className="list-plain">{d.myTickets.map((t) => <li key={t.id}><Link to={`/tickets/${t.id}`} className="truncate flex-grow-1">#{t.number} {t.subject}</Link><PriorityBadge priority={t.priority} /></li>)}</ul> : <div className="small text-muted">No open tickets assigned to you.</div>}</Card>
      </div>
    </div>
  );
}

function Management({ d }) {
  const active = d.portfolio;
  const red = active.filter((p) => p.health === 'RED').length;
  const overdueMs = d.milestones.filter((m) => m.overdue).length;
  const open = ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'].reduce((a, s) => a + (d.tickets.byStatus[s] || 0), 0);
  const breached = d.tickets.sla.resolution.BREACHED + d.tickets.sla.response.BREACHED;
  return (
    <>
      <div className="row g-3 mb-3">
        <div className="col-6 col-xl-3"><Stat label="Active projects" value={active.length} hint={`${red} at red health`} tone={red ? 'risk' : undefined} /></div>
        <div className="col-6 col-xl-3"><Stat label="Milestones · next 14 days" value={d.milestones.length} hint={`${overdueMs} overdue`} tone={overdueMs ? 'risk' : undefined} /></div>
        <div className="col-6 col-xl-3"><Stat label="Open tickets" value={open} hint={`${d.tickets.sla.resolution.AT_RISK + d.tickets.sla.response.AT_RISK} SLA clocks at risk`} /></div>
        <div className="col-6 col-xl-3"><Stat label="SLA breaches" value={breached} hint={d.tickets.slaWindow} tone={breached ? 'risk' : 'ok'} /></div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-xl-8">
          <Card title="Portfolio" actions={<button className="btn btn-sm btn-light" onClick={() => download('/reports/portfolio.csv', 'portfolio.csv')}>Export CSV</button>} bodyClass="p-0">
            {active.length === 0 ? <Empty title="No active projects you can access" /> : (
              <div className="table-wrap"><table className="table table-hover">
                <thead><tr><th>Project</th><th>Health</th><th style={{ width: 160 }}>Progress</th><th>Finish</th><th title={d.definitions.scheduleVariance}>Variance</th><th>Effort (est / actual)</th><th>Budget</th></tr></thead>
                <tbody>{active.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`/projects/${p.id}`} className="fw-semibold">{p.code}</Link> <span className="text-muted">{p.name}</span><div className="small text-muted">{p.customer || 'Internal'} · {labelize(p.status)}</div></td>
                    <td><HealthBadge health={p.health} /></td>
                    <td><Meter value={p.progress} /></td>
                    <td className="small">{fmtDate(p.plannedFinish)}</td>
                    <td className="small">{p.scheduleVarianceDays == null ? <span className="text-muted" title="No baseline saved">—</span> : <span className={p.scheduleVarianceDays > 0 ? 'text-danger fw-semibold' : 'text-success'}>{p.scheduleVarianceDays > 0 ? '+' : ''}{p.scheduleVarianceDays} d</span>}</td>
                    <td className="small">{fmtHours(p.estimateHours)} / {fmtHours(p.actualHours)}</td>
                    <td className="small">{p.budget ? <>{fmtMoney(p.budget.consumed ?? 0, p.budget.currency)} <span className="text-muted">of {fmtMoney(p.budget.amount, p.budget.currency)}</span></> : <span className="text-muted">—</span>}</td>
                  </tr>))}</tbody>
              </table></div>)}
          </Card>
        </div>
        <div className="col-xl-4">
          <Card title="Upcoming & overdue milestones">{d.milestones.length ? <ul className="list-plain">{d.milestones.slice(0, 10).map((m) => (
            <li key={m.id}><Flag size={14} className={m.overdue ? 'text-danger' : 'text-muted'} /><Link to={`/projects/${m.projectId}/milestones`} className="truncate flex-grow-1"><span className="mono text-muted">{m.projectCode}</span> {m.title}</Link><span className={`small ${m.overdue ? 'text-danger fw-semibold' : 'text-muted'}`}>{fmtDate(m.date)}</span></li>))}</ul>
            : <div className="small text-muted">No milestones due in the next two weeks.</div>}</Card>
        </div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-lg-6"><Card title="Planned vs actual effort (hours)">
          {active.length ? <BarChart horizontal label="Planned versus actual effort by project" axisTitle="Hours" labels={active.map((p) => p.code)} series={[{ name: 'Estimated', data: active.map((p) => p.estimateHours), color: PALETTE.steel }, { name: 'Logged', data: active.map((p) => p.actualHours), color: PALETTE.sky }]} /> : <Empty title="No data yet" />}
        </Card></div>
        <div className="col-lg-6"><Card title="Workload · next two weeks" actions={<Link to="/workload" className="small">Details</Link>}>
          {d.workload.length ? <BarChart label="Planned hours versus capacity by person" axisTitle="Hours" labels={d.workload.map((w) => w.name.split(' ')[0])} series={[{ name: 'Capacity', data: d.workload.map((w) => w.capacityHours), color: PALETTE.pale }, { name: 'Planned', data: d.workload.map((w) => w.plannedHours), colors: d.workload.map((w) => (w.state === 'OVER' ? PALETTE.risk : PALETTE.steel)) }]} /> : <Empty title="No people to show" />}
        </Card></div>
      </div>
      <div className="row g-3 mb-4">
        <div className="col-lg-6"><Card title="Ticket backlog by status">
          <BarChart height={220} label="Ticket backlog by status" axisTitle="Tickets" labels={['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'].map(labelize)} series={[{ name: 'Tickets', data: ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'].map((s) => d.tickets.byStatus[s] || 0), color: PALETTE.steel }]} />
        </Card></div>
        <div className="col-lg-6"><Card title="SLA performance">
          <BarChart height={220} horizontal stacked label="SLA performance for response and resolution" axisTitle="Tickets" labels={['Response', 'Resolution']} series={[['MET', PALETTE.ok], ['ON_TRACK', PALETTE.sky], ['AT_RISK', PALETTE.warn], ['BREACHED', PALETTE.risk], ['PAUSED', PALETTE.slate]].map(([s, color]) => ({ name: labelize(s), color, data: [d.tickets.sla.response[s], d.tickets.sla.resolution[s]] }))} />
          <div className="small text-muted">{d.tickets.slaWindow}. Business hours per the organization's SLA calendar.</div>
        </Card></div>
      </div>
      <h2 className="h-section">My work</h2>
      <EmployeePanels d={d} />
    </>
  );
}

function CustomerDash({ d }) {
  return (
    <div className="row g-3">
      <div className="col-lg-8 d-flex flex-column gap-3">
        <Card title="Your projects" bodyClass="p-0">{d.projects.length ? <div className="table-wrap"><table className="table">
          <thead><tr><th>Project</th><th>Status</th><th style={{ width: 200 }}>Progress</th><th>Target finish</th></tr></thead>
          <tbody>{d.projects.map((p) => <tr key={p.id}><td><Link to={`/projects/${p.id}`} className="fw-semibold">{p.name}</Link><div className="small text-muted">{p.code}</div></td><td><HealthBadge health={p.health} /></td><td><Meter value={p.progress} /></td><td className="small">{fmtDate(p.plannedFinish)}</td></tr>)}</tbody>
        </table></div> : <Empty title="No shared projects yet">Your project team will share projects with you here.</Empty>}</Card>
        <Card title="Latest status updates">{d.updates.length ? <ul className="list-plain">{d.updates.map((u) => <li key={u.id}><span className={`dot dot-${u.health}`} /><Link to={`/projects/${u.projectId}/updates`} className="flex-grow-1 truncate">{u.title}</Link><span className="small text-muted">{u.projectCode} · {fmtRelative(u.createdAt)}</span></li>)}</ul> : <div className="small text-muted">No updates published yet.</div>}</Card>
      </div>
      <div className="col-lg-4 d-flex flex-column gap-3">
        <Card title="Awaiting your review" actions={<FileCheck2 size={15} className="text-muted" />}>{d.deliverablesAwaitingReview.length ? <ul className="list-plain">{d.deliverablesAwaitingReview.map((x) => <li key={x.id}><Link to={`/projects/${x.projectId}/deliverables`} className="flex-grow-1 truncate">{x.name}</Link><span className="small text-muted">{x.projectCode}</span></li>)}</ul> : <div className="small text-muted">Nothing needs your review.</div>}</Card>
        <Card title="Upcoming milestones" actions={<CalendarClock size={15} className="text-muted" />}>{d.milestones.length ? <ul className="list-plain">{d.milestones.map((m) => <li key={m.id}><Flag size={13} className="text-muted" /><span className="flex-grow-1 truncate">{m.title}</span><span className="small text-muted">{fmtDate(m.date)}</span></li>)}</ul> : <div className="small text-muted">No upcoming milestones.</div>}</Card>
        <Card title="Your tickets" actions={<Link to="/tickets" className="small">All tickets</Link>}>{d.tickets.length ? <ul className="list-plain">{d.tickets.map((t) => <li key={t.id}><LifeBuoy size={13} className="text-muted" /><Link to={`/tickets/${t.id}`} className="flex-grow-1 truncate">#{t.number} {t.subject}</Link><StatusBadge status={t.status} /></li>)}</ul> : <div className="small text-muted">No open tickets.</div>}</Card>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, isCustomer } = useAuth();
  const { data, error, loading, reload } = useLoad(() => get('/dashboard'), []);
  const greet = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <PageHeader title={`${greet}, ${user?.name?.split(' ')[0]}`} sub={isCustomer ? 'Here is where your projects stand.' : data?.kind === 'management' ? 'Portfolio, delivery and service at a glance.' : 'Your work for the days ahead.'}
        actions={data && !isCustomer && <><span className="d-inline-flex align-items-center gap-1 small text-muted"><Clock size={14} /> {data.unreadNotifications} unread · {data.unreadMentions} mentions</span></>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Loading rows={6} />}
      {data?.kind === 'management' && <Management d={data} />}
      {data?.kind === 'employee' && <EmployeePanels d={data} />}
      {data?.kind === 'customer' && <CustomerDash d={data} />}
    </>
  );
}
