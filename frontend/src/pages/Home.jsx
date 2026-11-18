import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileCheck2, Flag, LifeBuoy, Sparkles, AlertTriangle, Clock, Inbox, Timer, Plus, BookOpen, Search, MessageSquare, FolderKanban, Users } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtDate, fmtHours, fmtRelative, projectColor, labelize, fmtHoursShort } from '../lib/format.js';
import { setDone } from '../lib/tasks.js';
import { Avatar, Card, CheckButton, DueChip, Empty, ErrorBox, HealthBadge, Loading, ProjectChip, ProjectDot, StatusBadge, PriorityBadge, SlaTimer, useToast } from '../components/ui.jsx';

export const Tile = ({ tone, icon: Icon, label, value, hint, to, alert }) => {
  const body = <><div className="label">{Icon && <span className="ic"><Icon size={15} /></span>}{label}</div><div className="value">{value}</div>{hint && <div className="hint">{hint}</div>}</>;
  return to ? <Link to={to} className={`tile ${tone} ${alert ? 'alert' : ''}`}>{body}</Link> : <div className={`tile ${tone} ${alert ? 'alert' : ''}`}>{body}</div>;
};

export function ProjectCard({ p }) {
  return (
    <Link to={`/projects/${p.id}`} className="project-card" style={{ '--pc': projectColor(p.code) }}>
      <div className="d-flex align-items-center gap-2">
        <ProjectChip code={p.code} />
        <div className="min-w-0 flex-grow-1"><div className="fw-semibold truncate">{p.name}</div><div className="small text-muted truncate">{p.customerName || p.customer || 'Internal project'}</div></div>
        {p.health && <HealthBadge health={p.health} />}
      </div>
      <div><div className="d-flex justify-content-between small mb-1"><span className="text-muted">Progress</span><span className="fw-semibold num">{p.progress == null ? '—' : `${Math.round(p.progress)}%`}</span></div><div className="meter" style={{ '--pc': projectColor(p.code) }}><span style={{ width: `${p.progress || 0}%` }} /></div></div>
      <div className="d-flex justify-content-between small text-muted"><span>Due {fmtDate(p.plannedFinish)}</span>{p.milestones && <span><Flag size={12} /> {p.milestones.done}/{p.milestones.total} milestones</span>}</div>
    </Link>
  );
}


function TicketMiniTable({ rows, empty, showAssignee }) {
  const nav = useNavigate();
  if (!rows.length) return <Empty icon={Sparkles} title={empty} />;
  return (
    <div className="table-wrap"><table className="table table-hover">
      <thead><tr><th>Ticket</th><th>Priority</th><th>Status</th>{showAssignee && <th>Owner</th>}<th className="text-end">SLA</th></tr></thead>
      <tbody>{rows.map((t) => (
        <tr key={t.id} className="row-link" onClick={() => nav(`/tickets/${t.id}`)}>
          <td style={{ maxWidth: 300 }}><Link to={`/tickets/${t.id}`} className="tk-subject" onClick={(e) => e.stopPropagation()}>{t.subject}</Link><div className="tk-meta">#{t.number} · {t.customerName || 'Internal'} · {fmtRelative(t.updatedAt)}</div></td>
          <td><PriorityBadge priority={t.priority} /></td>
          <td><StatusBadge status={t.status} /></td>
          {showAssignee && <td>{t.assigneeName ? <span title={t.assigneeName}><Avatar sm name={t.assigneeName} /></span> : <span className="pill pill-outline">None</span>}</td>}
          <td className="text-end nowrap"><SlaTimer ticket={t} /></td>
        </tr>))}</tbody>
    </table></div>
  );
}

function StaffDashboard() {
  const { user, role } = useAuth();
  const toast = useToast();
  const manager = ['ADMIN', 'MANAGER'].includes(role);
  const dash = useLoad(() => get('/dashboard'), []);
  const projects = useLoad(() => get('/projects', { status: 'ACTIVE,ON_HOLD,DRAFT', pageSize: 50, sort: 'plannedFinish', dir: 'asc' }), []);
  const stats = useLoad(() => get('/tickets/stats'), []);
  const mine = useLoad(() => get('/tickets', { view: 'mine', pageSize: 5, sort: 'resolutionDueAt', dir: 'asc' }), []);
  const wl = useLoad(() => (manager ? get('/workload') : Promise.resolve(null)), []);
  useLive((e) => e.type === 'work.changed', () => { dash.reload({ silent: true }); projects.reload({ silent: true }); });
  useLive((e) => e.type.startsWith('ticket'), () => { stats.reload({ silent: true }); mine.reload({ silent: true }); });
  const d = dash.data;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const complete = async (t) => {
    dash.setData((x) => ({ ...x, myTasks: x.myTasks.filter((m) => m.id !== t.id) }));
    try { await setDone(t.projectId, t.id, true); toast(`Done: ${t.title}`, 'success'); } catch (e) { toast(e.message, 'error'); dash.reload(); }
  };
  if (dash.error) return <ErrorBox error={dash.error} onRetry={dash.reload} />;
  if (!d || !projects.data) return <Loading rows={8} />;
  const ps = projects.data.data;
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const milestones = (d.milestones || []).filter((m) => m.date <= in14).slice(0, 8);
  const myOverdue = d.myTasks.filter((t) => t.overdue).length;
  const atRisk = ps.filter((p) => p.health !== 'GREEN').length;
  const s = stats.data;
  return (
    <>
      <div className="page-header">
        <div><div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1 className="h-page">{greet}, {user?.name?.split(' ')[0]}</h1>
          <div className="sub">{myOverdue ? <span className="text-danger fw-semibold">You have {myOverdue} overdue task{myOverdue > 1 ? 's' : ''}.</span> : atRisk ? `${atRisk} project${atRisk > 1 ? 's need' : ' needs'} attention.` : 'All projects are on track.'}</div></div>
        <div className="d-flex gap-2"><Link to="/my-tasks" className="btn btn-light"><CheckCircle2 size={15} /> My tasks</Link>{manager && <Link to="/projects?new=1" className="btn btn-primary"><Plus size={15} /> New project</Link>}</div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="blue" icon={FolderKanban} label={manager ? 'Active projects' : 'My projects'} value={ps.length} hint={`${ps.filter((p) => p.status === 'ACTIVE').length} in progress`} to="/projects" /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="red" icon={AlertTriangle} label="Projects at risk" value={atRisk} hint={atRisk ? 'Check health below' : 'All on track'} to="/projects" alert={ps.some((p) => p.health === 'RED')} /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="violet" icon={CheckCircle2} label="My open tasks" value={d.myTasks.length} hint={`${d.upcoming.length} due this week`} to="/my-tasks" /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="orange" icon={Clock} label="Overdue tasks" value={myOverdue} hint={myOverdue ? 'Needs attention' : 'Nothing late'} to="/my-tasks" alert={myOverdue > 0} /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="green" icon={Flag} label="Milestones · 14d" value={milestones.length} hint={`${milestones.filter((m) => m.overdue).length} overdue`} /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="cyan" icon={Timer} label="Hours this week" value={fmtHours(d.timesheet.hours)} hint={`Timesheet: ${labelize(d.timesheet.status)}`} to="/time" /></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-8"><Card bodyClass="p-0" title={<><FolderKanban size={16} className="text-primary" /> {manager ? 'Project portfolio' : 'My projects'}</>} actions={<Link to="/projects" className="small fw-semibold">All projects</Link>}>
          {ps.length ? <div className="table-wrap"><table className="table table-hover mb-0"><thead><tr><th>Project</th><th>Health</th><th style={{ width: 160 }}>Progress</th><th>Tasks</th><th>Finish</th></tr></thead><tbody>
            {ps.slice(0, 8).map((p) => <tr key={p.id}><td><Link to={`/projects/${p.id}`} className="d-inline-flex align-items-center gap-2 fw-semibold text-body"><ProjectDot code={p.code} />{p.name}</Link><div className="tk-meta">{p.customerName || 'Internal'}{p.managerName ? ` · ${p.managerName}` : ''}</div></td><td><HealthBadge health={p.health} /></td>
              <td><div className="d-flex align-items-center gap-2"><div className="meter flex-grow-1" style={{ '--pc': projectColor(p.code) }}><span style={{ width: `${p.progress || 0}%` }} /></div><span className="small num">{Math.round(p.progress || 0)}%</span></div></td>
              <td className="small text-nowrap">{p.counts?.open ?? 0} open{p.counts?.overdue ? <span className="text-danger fw-semibold"> · {p.counts.overdue} late</span> : ''}</td><td className="small text-nowrap">{fmtDate(p.plannedFinish)}</td></tr>)}
          </tbody></table></div> : <Empty icon={FolderKanban} title="No active projects" action={manager && <Link to="/projects?new=1" className="btn btn-sm btn-primary">Create a project</Link>} />}
        </Card></div>
        <div className="col-xl-4"><Card title={<><Flag size={16} className="text-success" /> Upcoming milestones</>}>
          {milestones.length ? <ul className="list-plain">{milestones.map((m) => <li key={m.id}><Flag size={14} className={m.overdue ? 'text-danger' : 'text-muted'} /><Link to={`/projects/${m.projectId}/tasks?item=${m.id}`} className="flex-grow-1 min-w-0 text-body small"><span className="d-block truncate fw-semibold">{m.title}</span><span className="text-muted">{m.projectCode}</span></Link><DueChip date={m.date} /></li>)}</ul>
            : <div className="small text-muted">No milestones in the next two weeks.</div>}
        </Card></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-6"><Card title={<><CheckCircle2 size={16} className="text-success" /> My tasks</>} actions={<Link to="/my-tasks" className="small fw-semibold">All tasks</Link>}>
          {d.myTasks.length ? d.myTasks.slice(0, 7).map((t) => (
            <div key={t.id} className="task-row"><CheckButton done={false} label={t.title} onToggle={() => complete(t)} />
              <Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="title">{t.title}</Link>
              <span className="d-none d-md-inline-flex align-items-center gap-1 small text-muted"><ProjectDot code={t.key.split('-')[0]} />{t.key}</span>{t.status !== 'TODO' && <StatusBadge status={t.status} />}<DueChip date={t.plannedFinish} /></div>))
            : <Empty icon={Sparkles} title="No open tasks">Tasks assigned to you across all projects show up here.</Empty>}
        </Card></div>
        <div className="col-xl-6">{manager ? <Card title={<><Users size={16} className="text-primary" /> Team capacity — next 2 weeks</>} actions={<Link to="/reports" className="small fw-semibold">Reports</Link>}>
          {wl.data?.data.length ? wl.data.data.slice(0, 8).map((w) => <div key={w.userId} className="hbar"><Avatar sm name={w.name} /><span className="lbl" title={w.title || ''}>{w.name}</span><span className="track"><span style={{ width: `${Math.min(100, w.pct)}%`, background: w.pct > 100 ? 'var(--red)' : w.pct > 80 ? 'var(--amber)' : 'var(--green)' }} /></span><span className="v">{Math.round(w.pct)}%</span></div>)
            : <div className="small text-muted">No assigned work with estimates yet.</div>}
          <div className="form-text mt-2">Planned hours of assigned tasks vs each person's weekly hours.</div>
        </Card> : <Card title="Coming up this week">{d.upcoming.length ? d.upcoming.map((t) => <div key={t.id} className="d-flex align-items-center gap-2 py-2 border-bottom"><ProjectDot code={t.key.split('-')[0]} /><Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="flex-grow-1 truncate text-body small fw-semibold">{t.title}</Link><DueChip date={t.plannedFinish} /></div>) : <div className="small text-muted">Nothing due in the next 7 days.</div>}</Card>}</div>
      </div>

      <Card bodyClass="p-0" title={<><Inbox size={16} className="text-primary" /> Support desk</>} actions={<Link to="/tickets" className="small fw-semibold d-inline-flex align-items-center gap-1">Open ticket queue <ArrowRight size={14} /></Link>}>
        {s && <div className="d-flex flex-wrap gap-4 px-3 py-2 border-bottom small">
          <Link to="/tickets?view=open" className="text-body"><strong className="num fs-6">{s.open}</strong> open</Link>
          <Link to="/tickets?view=unassigned" className="text-body"><strong className="num fs-6">{s.unassigned}</strong> unassigned</Link>
          <Link to="/tickets?view=overdue" className={s.breached ? 'text-danger' : 'text-body'}><strong className="num fs-6">{s.breached}</strong> SLA breached</Link>
          <span><strong className="num fs-6">{s.slaCompliance == null ? '—' : `${Math.round(s.slaCompliance * 100)}%`}</strong> SLA met (30d)</span>
          <span><strong className="num fs-6">{s.csat.average == null ? '—' : s.csat.average.toFixed(1)}</strong> / 5 client rating</span>
        </div>}
        <TicketMiniTable rows={mine.data?.data || []} empty="No open tickets assigned to you" />
      </Card>
    </>
  );
}

function ClientHome() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { data: d, error, loading, reload } = useLoad(() => get('/dashboard'), []);
  const tickets = useLoad(() => get('/tickets', { pageSize: 6, sort: 'updatedAt', dir: 'desc' }), []);
  const views = useLoad(() => get('/tickets/views'), []);
  const kb = useLoad(() => get('/kb/articles'), []);
  useLive((e) => e.type.startsWith('ticket'), () => { tickets.reload({ silent: true }); views.reload({ silent: true }); });
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !d) return <Loading rows={6} />;
  return (
    <>
      <div className="kb-hero">
        <h1>Hi {user?.name?.split(' ')[0]}, welcome back</h1>
        <p>Follow your projects, approve deliverables, raise tickets or search the help center.</p>
        <form className="position-relative d-flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); nav(`/kb?q=${encodeURIComponent(q)}`); }} style={{ zIndex: 1 }}>
          <div className="position-relative flex-grow-1" style={{ maxWidth: 560 }}><Search size={17} className="position-absolute text-muted" style={{ left: 13, top: 14 }} /><input className="form-control" placeholder="Search help articles…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search help articles" /></div>
          <Link to="/tickets?new=1" className="btn btn-primary" style={{ height: 44 }}><LifeBuoy size={16} /> Raise a ticket</Link>
        </form>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><Tile tone="blue" icon={FolderKanban} label="Your projects" value={d.projects.length} to="/projects" /></div>
        <div className="col-6 col-lg-3"><Tile tone="green" icon={Inbox} label="Open tickets" value={views.data?.open ?? '—'} to="/tickets" /></div>
        <div className="col-6 col-lg-3"><Tile tone="orange" icon={MessageSquare} label="Waiting for your reply" value={views.data?.waiting ?? '—'} to="/tickets?view=waiting" alert={views.data?.waiting > 0} /></div>
        <div className="col-6 col-lg-3"><Tile tone="violet" icon={FileCheck2} label="Awaiting your approval" value={d.deliverablesAwaitingReview.length} /></div>
      </div>
      {d.projects.length > 0 && <><h2 className="h-section mt-2">Your projects</h2><div className="project-grid mb-3">{d.projects.map((p) => <ProjectCard key={p.id} p={p} />)}</div></>}
      <div className="row g-3 mb-3">
        <div className="col-xl-8"><Card title="Your recent tickets" bodyClass="p-0" actions={<Link to="/tickets" className="small fw-semibold">View all</Link>}>
          {tickets.data?.data.length ? <div className="table-wrap"><table className="table table-hover"><thead><tr><th>Ticket</th><th>Status</th><th className="text-end">Updated</th></tr></thead><tbody>
            {tickets.data.data.map((t) => <tr key={t.id} className="row-link" onClick={() => nav(`/tickets/${t.id}`)}><td><Link to={`/tickets/${t.id}`} className="tk-subject" onClick={(e) => e.stopPropagation()}>{t.subject}</Link><div className="tk-meta">#{t.number} · raised by {t.requesterName}</div></td><td><StatusBadge status={t.status} /></td><td className="text-end small text-muted">{fmtRelative(t.updatedAt)}</td></tr>)}
          </tbody></table></div> : <Empty icon={Inbox} title="No tickets yet" action={<Link to="/tickets?new=1" className="btn btn-sm btn-primary">Raise your first ticket</Link>} />}
        </Card></div>
        <div className="col-xl-4"><Card title={<><BookOpen size={16} className="text-primary" /> Popular help articles</>} actions={<Link to="/kb" className="small fw-semibold">Help center</Link>}>
          {kb.data?.data.length ? <ul className="list-plain">{kb.data.data.slice(0, 6).map((a) => <li key={a.id}><BookOpen size={15} className="text-muted flex-shrink-0" /><Link to={`/kb/${a.id}`} className="flex-grow-1 truncate text-body">{a.title}</Link></li>)}</ul> : <div className="small text-muted">No articles yet.</div>}
        </Card></div>
      </div>
      {d.deliverablesAwaitingReview.length > 0 && <Card title="Waiting for your approval" className="mb-3">{d.deliverablesAwaitingReview.map((x) => <div key={x.id} className="task-row"><FileCheck2 size={18} className="text-warning" /><Link to={`/projects/${x.projectId}/approvals`} className="title">{x.name}</Link><span className="small text-muted">{x.projectCode}</span><Link to={`/projects/${x.projectId}/approvals`} className="btn btn-sm btn-primary">Review</Link></div>)}</Card>}
    </>
  );
}

export default function Home() {
  const { isCustomer } = useAuth();
  return isCustomer ? <ClientHome /> : <StaffDashboard />;
}
