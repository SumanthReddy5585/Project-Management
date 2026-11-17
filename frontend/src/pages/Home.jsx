import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileCheck2, Flag, LifeBuoy, Sparkles, AlertTriangle, Clock } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtDate, fmtHours, fmtRelative, projectColor, labelize } from '../lib/format.js';
import { setDone } from '../lib/tasks.js';
import { Card, CheckButton, DueChip, Empty, ErrorBox, HealthBadge, Loading, Meter, ProjectChip, ProjectDot, StatusBadge, useToast } from '../components/ui.jsx';

const Tile = ({ tone, label, value, hint, to }) => {
  const inner = <div className={`tile ${tone}`}><div className="label">{label}</div><div className="value">{value}</div>{hint && <div className="hint">{hint}</div>}</div>;
  return to ? <Link to={to} className="d-block text-decoration-none">{inner}</Link> : inner;
};

export function ProjectCard({ p }) {
  return (
    <Link to={`/projects/${p.id}`} className="project-card" style={{ '--pc': projectColor(p.code) }}>
      <div className="d-flex align-items-center gap-2">
        <ProjectChip code={p.code} />
        <div className="min-w-0 flex-grow-1"><div className="fw-bold truncate">{p.name}</div><div className="small text-muted truncate">{p.customerName || p.customer || 'Internal project'}</div></div>
        {p.health && <HealthBadge health={p.health} />}
      </div>
      <div><div className="d-flex justify-content-between small mb-1"><span className="text-muted">Progress</span><span className="fw-bold">{p.progress == null ? '—' : `${Math.round(p.progress)}%`}</span></div><div className="meter" style={{ '--pc': projectColor(p.code) }}><span style={{ width: `${p.progress || 0}%` }} /></div></div>
      <div className="d-flex justify-content-between small text-muted"><span>Due {fmtDate(p.plannedFinish)}</span>{p.milestones && <span><Flag size={12} /> {p.milestones.done}/{p.milestones.total} milestones</span>}</div>
    </Link>
  );
}

function TaskList({ tasks, onDone, limit = 7 }) {
  if (!tasks.length) return <Empty icon={Sparkles} title="Nothing on your plate">New tasks assigned to you show up here.</Empty>;
  return <>{tasks.slice(0, limit).map((t) => (
    <div key={t.id} className="task-row">
      <CheckButton done={false} label={t.title} onToggle={() => onDone(t)} />
      <Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="title">{t.title}</Link>
      <span className="d-none d-md-inline-flex align-items-center gap-1 small text-muted"><ProjectDot code={t.key.split('-')[0]} />{t.key.split('-')[0]}</span>
      {t.status !== 'TODO' && <StatusBadge status={t.status} />}
      <DueChip date={t.plannedFinish} />
    </div>))}
    {tasks.length > limit && <Link to="/my-tasks" className="small fw-semibold d-inline-flex align-items-center gap-1 mt-1">See all {tasks.length} tasks <ArrowRight size={14} /></Link>}
  </>;
}

export default function Home() {
  const { user, role, isCustomer } = useAuth();
  const toast = useToast();
  const { data: d, error, loading, reload, setData } = useLoad(() => get('/dashboard'), []);
  const [busy, setBusy] = useState(null);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const complete = async (t) => {
    if (busy) return; setBusy(t.id);
    setData((x) => ({ ...x, myTasks: x.myTasks.filter((m) => m.id !== t.id) }));
    try { await setDone(t.projectId, t.id, true); toast(`Done: ${t.title}`, 'success'); } catch (e) { toast(e.message, 'error'); reload(); } finally { setBusy(null); }
  };
  if (loading && !d) return <Loading rows={6} />;
  const first = user?.name?.split(' ')[0];
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  if (d.kind === 'customer') {
    return (
      <>
        <div className="page-header"><div><h1 className="h-page">{greet}, {first}</h1><div className="sub">Here's where your projects stand.</div></div><Link to="/tickets?new=1" className="btn btn-primary"><LifeBuoy size={16} /> New request</Link></div>
        <div className="row g-3 mb-4">
          <div className="col-6 col-lg-3"><Tile tone="blue" label="Your projects" value={d.projects.length} /></div>
          <div className="col-6 col-lg-3"><Tile tone="orange" label="Waiting for your review" value={d.deliverablesAwaitingReview.length} /></div>
          <div className="col-6 col-lg-3"><Tile tone="violet" label="Upcoming milestones" value={d.milestones.length} /></div>
          <div className="col-6 col-lg-3"><Tile tone="green" label="Open requests" value={d.tickets.filter((t) => t.status !== 'RESOLVED').length} to="/tickets" /></div>
        </div>
        {d.deliverablesAwaitingReview.length > 0 && <Card title="Please review" className="mb-4">{d.deliverablesAwaitingReview.map((x) => <div key={x.id} className="task-row"><FileCheck2 size={18} className="text-warning" /><Link to={`/projects/${x.projectId}/approvals`} className="title">{x.name}</Link><span className="small text-muted">{x.projectCode}</span><Link to={`/projects/${x.projectId}/approvals`} className="btn btn-sm btn-primary">Review</Link></div>)}</Card>}
        <h2 className="h-section">Your projects</h2>
        {d.projects.length ? <div className="project-grid mb-4">{d.projects.map((p) => <ProjectCard key={p.id} p={p} />)}</div> : <Card><Empty title="No shared projects yet">Your project team will share projects with you here.</Empty></Card>}
        <div className="row g-3">
          <div className="col-lg-6"><Card title="Latest updates">{d.updates.length ? <ul className="list-plain">{d.updates.map((u) => <li key={u.id}><span className={`dot dot-${u.health}`} /><Link to={`/projects/${u.projectId}/updates`} className="flex-grow-1 truncate fw-semibold text-body">{u.title}</Link><span className="small text-muted">{fmtRelative(u.createdAt)}</span></li>)}</ul> : <div className="small text-muted">No updates yet.</div>}</Card></div>
          <div className="col-lg-6"><Card title="Your requests" actions={<Link to="/tickets" className="small fw-semibold">See all</Link>}>{d.tickets.length ? <ul className="list-plain">{d.tickets.map((t) => <li key={t.id}><Link to={`/tickets/${t.id}`} className="flex-grow-1 truncate fw-semibold text-body">{t.subject}</Link><StatusBadge status={t.status} /></li>)}</ul> : <div className="small text-muted">No open requests.</div>}</Card></div>
        </div>
      </>
    );
  }

  const overdue = d.myTasks.filter((t) => t.overdue).length;
  const week = d.upcoming.length;
  const mgmt = d.kind === 'management';
  const attention = mgmt ? [
    ...d.milestones.filter((m) => m.overdue).map((m) => ({ id: m.id, icon: Flag, tone: 'text-danger', text: `Milestone overdue: ${m.title}`, sub: m.projectCode, to: `/projects/${m.projectId}/tasks?item=${m.id}` })),
    ...d.portfolio.filter((p) => p.health === 'RED').map((p) => ({ id: p.id, icon: AlertTriangle, tone: 'text-danger', text: `${p.name} is off track`, sub: p.code, to: `/projects/${p.id}` })),
    ...(d.tickets.sla.response.BREACHED + d.tickets.sla.resolution.BREACHED > 0 ? [{ id: 'sla', icon: LifeBuoy, tone: 'text-warning', text: `${d.tickets.sla.response.BREACHED + d.tickets.sla.resolution.BREACHED} request(s) past their target time`, to: '/tickets?sla=BREACHED' }] : []),
    ...d.workload.filter((w) => w.state === 'OVER').map((w) => ({ id: w.userId, icon: Clock, tone: 'text-warning', text: `${w.name} has more work than time in the next two weeks`, to: '/reports' })),
  ] : [];
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">{greet}, {first}</h1><div className="sub">{overdue ? `You have ${overdue} overdue task${overdue > 1 ? 's' : ''}.` : week ? `${week} task${week > 1 ? 's' : ''} due this week.` : 'Nothing urgent today.'}</div></div>
        {['ADMIN', 'MANAGER'].includes(role) && <Link to="/projects?new=1" className="btn btn-primary">New project</Link>}</div>
      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3"><Tile tone="blue" label="My open tasks" value={d.myTasks.length} to="/my-tasks" /></div>
        <div className="col-6 col-lg-3"><Tile tone="orange" label="Due this week" value={week} to="/my-tasks" /></div>
        <div className="col-6 col-lg-3"><Tile tone={overdue ? 'red' : 'green'} label="Overdue" value={overdue} hint={overdue ? 'Needs attention' : 'All on time'} to="/my-tasks" /></div>
        <div className="col-6 col-lg-3"><Tile tone="violet" label="Hours this week" value={fmtHours(d.timesheet.hours)} hint={labelize(d.timesheet.status)} to="/time" /></div>
      </div>
      <div className="row g-4">
        <div className={mgmt ? 'col-xl-7' : 'col-xl-8'}>
          <h2 className="h-section d-flex align-items-center gap-2"><CheckCircle2 size={18} className="text-success" /> Your tasks</h2>
          <TaskList tasks={d.myTasks} onDone={complete} />
          {d.myTickets.length > 0 && <><h2 className="h-section mt-4 d-flex align-items-center gap-2"><LifeBuoy size={18} className="text-primary" /> Requests assigned to you</h2>
            {d.myTickets.map((t) => <div key={t.id} className="task-row"><span className="small text-muted">#{t.number}</span><Link to={`/tickets/${t.id}`} className="title">{t.subject}</Link><StatusBadge status={t.status} /></div>)}</>}
        </div>
        <div className={mgmt ? 'col-xl-5' : 'col-xl-4'}>
          {mgmt && <Card title="Needs your attention" className="mb-4">{attention.length ? attention.slice(0, 6).map((a) => <Link key={a.id} to={a.to} className="d-flex gap-2 align-items-start py-2 text-decoration-none text-body border-bottom"><a.icon size={17} className={`${a.tone} mt-1 flex-shrink-0`} /><span className="flex-grow-1 fw-semibold small">{a.text}{a.sub && <span className="d-block text-muted fw-normal">{a.sub}</span>}</span></Link>)
            : <div className="d-flex gap-2 align-items-center small text-muted"><Sparkles size={16} className="text-success" /> Everything looks on track.</div>}</Card>}
          {mgmt && <><div className="d-flex justify-content-between align-items-center mb-2"><h2 className="h-section m-0">Projects</h2><Link to="/projects" className="small fw-semibold">See all</Link></div>
            <div className="d-flex flex-column gap-3">{d.portfolio.slice(0, 4).map((p) => <ProjectCard key={p.id} p={{ ...p, customerName: p.customer }} />)}</div></>}
          {!mgmt && <Card title="Coming up">{d.upcoming.length ? d.upcoming.map((t) => <div key={t.id} className="d-flex align-items-center gap-2 py-2 border-bottom"><ProjectDot code={t.key.split('-')[0]} /><Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="flex-grow-1 truncate text-body fw-semibold small">{t.title}</Link><DueChip date={t.plannedFinish} /></div>) : <div className="small text-muted">Nothing due in the next 7 days.</div>}</Card>}
        </div>
      </div>
    </>
  );
}
