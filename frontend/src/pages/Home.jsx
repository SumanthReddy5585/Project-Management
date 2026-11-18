import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileCheck2, Flag, LifeBuoy, Sparkles, AlertTriangle, Clock, Inbox, Timer, Plus, BookOpen, Search, MessageSquare, FolderKanban, Users, FolderPlus, UserPlus, CalendarRange, FilePlus2, ArrowUpRight, CalendarDays, Eye, CheckCheck, ArrowRightLeft, Pencil, Lock, Star, ShieldCheck, Megaphone, Camera, Link2, Activity, BarChart3 } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtDate, fmtHours, fmtRelative, projectColor, labelize, fmtHoursShort } from '../lib/format.js';
import { setDone } from '../lib/tasks.js';
import { Avatar, Card, CheckButton, DueChip, Empty, ErrorBox, HealthBadge, Loading, Pill, ProjectChip, ProjectDot, StatusBadge, PriorityBadge, SlaTimer, useToast } from '../components/ui.jsx';

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


const dueText = (d) => {
  if (!d) return { text: 'No due date', tone: '' };
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (diff < 0) return { text: `${-diff} day${diff === -1 ? '' : 's'} overdue`, tone: 'late' };
  if (diff === 0) return { text: 'Due today', tone: 'soon' };
  if (diff === 1) return { text: 'Due tomorrow', tone: 'soon' };
  if (diff < 7) return { text: `Due in ${diff} days`, tone: diff <= 2 ? 'soon' : '' };
  return { text: `Due ${new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, tone: '' };
};

function QuickActions({ manager, admin }) {
  const items = [
    manager ? ['/projects?new=1', FolderPlus, 't-green', 'Create project', 'Stages, team and a plan'] : ['/my-tasks', CheckCircle2, 't-green', 'My tasks', 'Everything assigned to you'],
    ['/tickets?new=1', LifeBuoy, 't-blue', 'New ticket', 'Log a request or an issue'],
    admin ? ['/settings/users', UserPlus, 't-pink', 'Invite to team', 'Add people and set roles'] : ['/people', Users, 't-pink', 'Team directory', 'Find people and skills'],
    ['/time', Timer, 't-amber', 'Log time', "Fill in this week's timesheet"],
    manager ? ['/planner', CalendarRange, 't-violet', 'Plan resources', 'Who is free, who is booked'] : ['/kb?new=1', FilePlus2, 't-violet', 'Write an article', 'Share know-how with the team'],
  ];
  return <div className="qa-grid">{items.map(([to, Icon, tone, title, sub]) => <Link key={title} to={to} className="qa"><span className={`ic-tile ${tone}`}><Icon size={18} /></span><div><b>{title}</b><small>{sub}</small></div></Link>)}</div>;
}

const Kpi = ({ icon: Icon, label, value, unit, hint, to, alert }) => {
  const body = <><div className="k-label">{Icon && <Icon size={14} />}{label}</div><div className="k-value">{value}{unit && <small>{unit}</small>}</div>{hint && <div className="k-hint">{hint}</div>}</>;
  return to ? <Link to={to} className={`kpi ${alert ? 'is-alert' : ''}`}>{body}</Link> : <div className={`kpi ${alert ? 'is-alert' : ''}`}>{body}</div>;
};

export const PanelCard = ({ title, count, tools, children, flush, foot, className = '' }) => (
  <section className={`panel-card ${className}`}>
    <div className="pc-head"><h2>{title}{count != null && <span className="n">({count})</span>}</h2>{tools && <div className="tools">{tools}</div>}</div>
    <div className={`pc-body ${flush ? 'flush' : ''}`}>{children}</div>
    {foot && <div className="pc-foot">{foot}</div>}
  </section>
);

function AssignedTasks({ tasks, projectsById, onDone }) {
  const [sort, setSort] = useState('due');
  const rows = [...tasks].sort((x, y) => (sort === 'project' ? x.key.localeCompare(y.key, undefined, { numeric: true })
    : sort === 'status' ? (y.status === 'IN_PROGRESS') - (x.status === 'IN_PROGRESS') || (x.plannedFinish || '9').localeCompare(y.plannedFinish || '9')
      : (x.plannedFinish || '9999').localeCompare(y.plannedFinish || '9999')));
  return (
    <PanelCard title="Assigned tasks" count={tasks.length}
      tools={<><select className="form-select mini-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort assigned tasks"><option value="due">Nearest due date</option><option value="status">In progress first</option><option value="project">By project</option></select>
        <Link to="/my-tasks" className="btn-square" aria-label="All my tasks" title="All my tasks"><ArrowUpRight size={15} /></Link></>}>
      {rows.length ? <ul className="row-list">{rows.slice(0, 6).map((t) => {
        const due = dueText(t.plannedFinish);
        const proj = projectsById.get(t.projectId);
        return <li key={t.id}>
          <CheckButton done={false} label={t.title} onToggle={() => onDone(t)} />
          <div className="r-main"><Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="r-title">{t.title}</Link>
            <div className="r-meta"><ProjectDot code={t.key.split('-')[0]} /><span className="truncate">{proj?.name || t.key.split('-')[0]}</span><span className="dotsep" /><CalendarDays size={12} /><span className={due.tone}>{due.text}</span>{t.status !== 'TODO' && <><span className="dotsep" /><span>{labelize(t.status)}</span></>}</div></div>
          <Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="btn-square" aria-label={`Open ${t.title}`} title="Open task"><Eye size={15} /></Link>
        </li>;
      })}</ul> : <Empty icon={Sparkles} title="You're all clear">Tasks assigned to you across all projects show up here.</Empty>}
    </PanelCard>
  );
}

function ProjectsPanel({ projects, manager }) {
  const [scope, setScope] = useState('active');
  const list = projects.filter((p) => (scope === 'risk' ? p.health !== 'GREEN' : scope === 'draft' ? p.status === 'DRAFT' : true)).slice(0, 6);
  return (
    <PanelCard title="Projects" count={projects.length}
      tools={<><select className="form-select mini-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Which projects"><option value="active">All open</option><option value="risk">Needs attention</option><option value="draft">Plan not approved</option></select>
        {manager ? <Link to="/projects?new=1" className="btn-square" aria-label="New project" title="New project"><Plus size={15} /></Link> : <Link to="/projects" className="btn-square" aria-label="All projects" title="All projects"><ArrowUpRight size={15} /></Link>}</>}>
      {list.length ? <div className="proj-grid">{list.map((p) => (
        <Link key={p.id} to={`/projects/${p.id}`} className="proj-tile">
          <div className="pt-top"><ProjectChip code={p.code} size={32} />{p.status === 'DRAFT' ? <Pill tone="neutral">Draft</Pill> : <HealthBadge health={p.health} />}</div>
          <b>{p.name}</b>
          <small>{p.counts?.overdue ? <span className="text-danger fw-medium">{p.counts.overdue} late · </span> : null}{p.counts?.open ?? 0} open task{p.counts?.open === 1 ? '' : 's'} · due {new Date(`${p.plannedFinish}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>
          <div className="meter" style={{ '--pc': projectColor(p.code) }}><span style={{ width: `${p.progress || 0}%` }} /></div>
        </Link>))}</div> : <Empty icon={FolderKanban} title="Nothing here" action={manager && <Link to="/projects?new=1" className="btn btn-sm btn-primary">Create a project</Link>} />}
    </PanelCard>
  );
}

const STATUS_WORDS = { DONE: 'Done', IN_PROGRESS: 'In progress', IN_REVIEW: 'In review', TODO: 'To do', BLOCKED: 'Blocked' };
function feedLine(e) {
  const m = e.metadata || {};
  const T = e.target ? <Link to={e.target.link}>{e.target.label}</Link> : null;
  const P = e.project ? <Link to={`/projects/${e.project.id}`}>{e.project.name}</Link> : null;
  switch (e.action) {
    case 'work_item.created': return [<>added {T}{P && <> to {P}</>}</>, Plus];
    case 'work_item.updated': return m.changes?.status ? [<>moved {T} to <strong>{STATUS_WORDS[m.changes.status.to] || labelize(m.changes.status.to)}</strong></>, m.changes.status.to === 'DONE' ? CheckCheck : ArrowRightLeft] : [<>updated {T}</>, Pencil];
    case 'work_item.dates_changed': return [<>rescheduled {T}{m.to?.finish && <> to finish <strong>{new Date(`${m.to.finish}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</strong></>}</>, CalendarDays];
    case 'ticket.created': return [<>raised {T}</>, LifeBuoy];
    case 'ticket.replied': return [<>replied on {T}</>, MessageSquare];
    case 'ticket.internal_note': return [<>added a team note on {T}</>, Lock];
    case 'ticket.status_changed': return [<>set {T} to <strong>{labelize(m.to)}</strong></>, m.to === 'RESOLVED' || m.to === 'CLOSED' ? CheckCheck : ArrowRightLeft];
    case 'ticket.updated': return [<>{m.changes?.assigneeId ? 'reassigned' : 'updated'} {T}</>, Pencil];
    case 'ticket.rated': return [<>rated {T} <strong>{'★'.repeat(m.rating || 0)}</strong></>, Star];
    case 'project.created': return [<>created the project {P}</>, FolderPlus];
    case 'project.updated': return [<>updated {P}</>, Pencil];
    case 'plan.approved': return [<>approved and locked the plan for {P}</>, ShieldCheck];
    case 'status_update.published': return [<>posted a status update on {P}</>, Megaphone];
    case 'baseline.created': return [<>saved a plan snapshot for {P}</>, Camera];
    case 'comment.created': return [<>commented on {T || P}</>, MessageSquare];
    case 'dependency.created': return [<>linked tasks in {P}</>, Link2];
    case 'time.logged': return [<>logged time on {P}</>, Timer];
    default: {
      const [ent, verb] = e.action.split('.');
      return [<>{labelize(verb || '').toLowerCase()} a {ent.replace(/_/g, ' ')} {T || P ? <>in {T || P}</> : null}</>, Activity];
    }
  }
}

function RecentActivity() {
  const feed = useLoad(() => get('/activity/recent', { limit: 7 }), []);
  useLive((e) => e.type === 'work.changed' || e.type.startsWith('ticket'), () => feed.reload({ silent: true }));
  return (
    <PanelCard title="Recent activity" tools={<Link to="/notifications" className="btn btn-sm btn-light">View all</Link>}>
      {feed.error ? <ErrorBox error={feed.error} onRetry={feed.reload} /> : !feed.data ? <Loading rows={4} /> : feed.data.data.length === 0 ? <Empty icon={Activity} title="No activity yet" /> : (
        <ul className="feed">{feed.data.data.map((e) => {
          const [line, Icon] = feedLine(e);
          const person = e.snippet || e.action.endsWith('.created') && e.entityType === 'Ticket';
          return <li key={e.id}>
            {person ? <span className="f-ic f-av"><Avatar name={e.actorName} /></span> : <span className="f-ic"><Icon size={15} /></span>}
            <div className="f-body">
              <div className="f-line"><strong>{e.actorName}</strong> {line} <span className="f-time">· {fmtRelative(e.createdAt)}</span></div>
              {e.snippet && <div className={`f-snip ${e.snippet.internal ? 'internal' : ''}`}>{e.snippet.body}</div>}
              {e.snippet?.internal && <div className="f-chips"><span className="chip"><Lock size={12} /> Team only</span></div>}
            </div>
          </li>;
        })}</ul>)}
    </PanelCard>
  );
}

function PeoplePanel({ admin }) {
  const [who, setWho] = useState('all');
  const ppl = useLoad(() => get('/org/members', { pageSize: 100 }), []);
  const all = (ppl.data?.data || []).filter((m) => m.role !== 'CUSTOMER' && m.status !== 'DISABLED');
  const list = all.filter((m) => (who === 'busy' ? m.activeProjects > 0 : who === 'managers' ? ['ADMIN', 'MANAGER'].includes(m.role) : true))
    .sort((x, y) => (who === 'busy' ? y.activeProjects - x.activeProjects : 0)).slice(0, 6);
  return (
    <PanelCard title="People" count={all.length}
      tools={<><select className="form-select mini-select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Which people"><option value="all">Everyone</option><option value="busy">Most active</option><option value="managers">Managers</option></select>
        {admin ? <Link to="/settings/users" className="btn btn-primary btn-sm btn-icon" aria-label="Add people" title="Add people"><Plus size={15} /></Link> : <Link to="/people" className="btn-square" aria-label="Team directory" title="Team directory"><ArrowUpRight size={15} /></Link>}</>}>
      {ppl.error ? <ErrorBox error={ppl.error} /> : !ppl.data ? <Loading rows={3} /> : (
        <div className="people-grid">{list.map((m) => <Link key={m.userId} to="/people" className="person"><Avatar name={m.name} /><b>{m.name}</b><small>{m.email}</small><span className="role"><Pill tone={m.role === 'ADMIN' ? 'dark' : m.role === 'MANAGER' ? 'blue' : 'neutral'}>{m.title || labelize(m.role)}</Pill></span></Link>)}</div>)}
    </PanelCard>
  );
}

function StaffDashboard() {
  const { user, role } = useAuth();
  const toast = useToast();
  const manager = ['ADMIN', 'MANAGER'].includes(role);
  const dash = useLoad(() => get('/dashboard'), []);
  const projects = useLoad(() => get('/projects', { status: 'ACTIVE,ON_HOLD,DRAFT', pageSize: 50, sort: 'plannedFinish', dir: 'asc' }), []);
  const stats = useLoad(() => get('/tickets/stats'), []);
  const mine = useLoad(() => get('/tickets', { view: 'mine', pageSize: 4, sort: 'resolutionDueAt', dir: 'asc' }), []);
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
  const byId = new Map(ps.map((p) => [p.id, p]));
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const milestones = (d.milestones || []).filter((m) => m.date <= in14).slice(0, 5);
  const myOverdue = d.myTasks.filter((t) => t.overdue).length;
  const atRisk = ps.filter((p) => p.status !== 'DRAFT' && p.health !== 'GREEN').length;
  const s = stats.data;
  const wl = d.workload || [];
  return (
    <>
      <div className="page-header">
        <div><div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1 className="h-page">{greet}, {user?.name?.split(' ')[0]}</h1>
          <div className="sub">{myOverdue ? <span className="text-danger fw-medium">You have {myOverdue} overdue task{myOverdue > 1 ? 's' : ''}.</span> : atRisk ? `${atRisk} project${atRisk > 1 ? 's need' : ' needs'} attention today.` : 'Everything is on track. Nice work.'}</div></div>
        <div className="d-flex gap-2"><Link to="/my-tasks" className="btn btn-light"><CheckCircle2 size={15} /> My tasks</Link>{manager && <Link to="/reports" className="btn btn-light"><BarChart3 size={15} /> Reports</Link>}</div>
      </div>

      <QuickActions manager={manager} admin={role === 'ADMIN'} />

      <div className="kpi-strip">
        <Kpi icon={FolderKanban} label={manager ? 'Active projects' : 'My projects'} value={ps.length} hint={`${ps.filter((p) => p.status === 'ACTIVE').length} in progress · ${ps.filter((p) => p.status === 'DRAFT').length} in planning`} to="/projects" />
        <Kpi icon={AlertTriangle} label="Need attention" value={atRisk} hint={atRisk ? `${ps.filter((p) => p.health === 'RED').length} off track` : 'All on track'} to="/projects" alert={ps.some((p) => p.health === 'RED')} />
        <Kpi icon={CheckCircle2} label="My open tasks" value={d.myTasks.length} hint={myOverdue ? <span className="down">{myOverdue} overdue</span> : `${d.upcoming.length} due this week`} to="/my-tasks" />
        <Kpi icon={Inbox} label="Open tickets" value={s ? s.open : '—'} hint={s ? `${s.unassigned} unassigned · ${s.breached} breached` : ' '} to="/tickets" alert={s?.breached > 0} />
        <Kpi icon={ShieldCheck} label="SLA met · 30d" value={s?.slaCompliance == null ? '—' : Math.round(s.slaCompliance * 100)} unit={s?.slaCompliance == null ? '' : '%'} hint={s?.csat?.average == null ? 'No ratings yet' : <>Client rating <span className="up">{s.csat.average.toFixed(1)}/5</span></>} to={manager ? '/reports' : undefined} />
        <Kpi icon={Timer} label="Hours this week" value={Number(d.timesheet.hours || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} unit="h" hint={`Timesheet: ${labelize(d.timesheet.status)}`} to="/time" />
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-6"><AssignedTasks tasks={d.myTasks} projectsById={byId} onDone={complete} /></div>
        <div className="col-xl-6"><ProjectsPanel projects={ps} manager={manager} /></div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-xl-6"><RecentActivity /></div>
        <div className="col-xl-6"><PeoplePanel admin={role === 'ADMIN'} /></div>
      </div>
      <div className="row g-3">
        <div className="col-xl-4"><PanelCard title="Upcoming milestones" count={manager ? milestones.length : undefined} tools={<Link to="/projects" className="btn-square" aria-label="Projects" title="Projects"><ArrowUpRight size={15} /></Link>}>
          {manager ? (milestones.length ? <ul className="row-list">{milestones.map((m) => <li key={m.id}><span className={`ms-date ${m.overdue ? 'late' : ''}`}><span>{new Date(`${m.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short' })}</span><b>{new Date(`${m.date}T00:00:00`).getDate()}</b></span>
            <div className="r-main"><Link to={`/projects/${m.projectId}/tasks?item=${m.id}`} className="r-title">{m.title}</Link><div className="r-meta"><ProjectDot code={m.projectCode} />{byId.get(m.projectId)?.name || m.projectCode}</div></div><DueChip date={m.date} /></li>)}</ul>
            : <Empty icon={Flag} title="No milestones in the next two weeks" />)
            : (d.upcoming.length ? <ul className="row-list">{d.upcoming.slice(0, 5).map((t) => <li key={t.id}><span className="ic-tile sm t-amber"><CalendarDays size={14} /></span><div className="r-main"><Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="r-title">{t.title}</Link><div className="r-meta">{t.key}</div></div><DueChip date={t.plannedFinish} /></li>)}</ul> : <Empty icon={Flag} title="Nothing due this week" />)}
        </PanelCard></div>
        <div className="col-xl-4">{manager ? <PanelCard title="Team capacity" tools={<Link to="/planner" className="btn btn-sm btn-light">Planner</Link>} foot="Planned hours of assigned tasks vs weekly hours, next 2 weeks.">
          {wl.length ? wl.slice(0, 6).map((w) => <div key={w.userId} className="cap-row"><span className="who"><Avatar sm name={w.name} /><span>{w.name}</span></span><span className="track"><span style={{ width: `${Math.min(100, w.pct)}%`, background: w.pct > 100 ? 'var(--red)' : w.pct > 80 ? 'var(--amber)' : 'var(--green)' }} /></span><span className="v">{Math.round(w.pct)}%</span></div>)
            : <Empty icon={Users} title="No assigned work with estimates yet" />}
        </PanelCard> : <PanelCard title="Blocked work" count={d.blocked.length}>{d.blocked.length ? <ul className="row-list">{d.blocked.slice(0, 5).map((t) => <li key={t.id}><span className="ic-tile sm t-red"><AlertTriangle size={14} /></span><div className="r-main"><Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="r-title">{t.title}</Link><div className="r-meta">{t.key}</div></div></li>)}</ul> : <Empty icon={Sparkles} title="Nothing blocked" />}</PanelCard>}</div>
        <div className="col-xl-4"><PanelCard title="Support desk" flush tools={<Link to="/tickets" className="btn btn-sm btn-light">Open queue</Link>}>
          {s && <div className="stat-inline">
            <Link to="/tickets?view=open"><b>{s.open}</b><small>Open</small></Link>
            <Link to="/tickets?view=unassigned"><b>{s.unassigned}</b><small>Unassigned</small></Link>
            <Link to="/tickets?view=overdue" className={s.breached ? 'bad' : ''}><b>{s.breached}</b><small>Breached</small></Link>
          </div>}
          <div className="px-3 pb-2">{mine.data?.data.length ? <ul className="row-list">{mine.data.data.map((t) => <li key={t.id}><div className="r-main"><Link to={`/tickets/${t.id}`} className="r-title">{t.subject}</Link><div className="r-meta">#{t.number}<span className="dotsep" />{t.customerName || 'Internal'}<span className="dotsep" /><PriorityBadge priority={t.priority} /></div></div><SlaTimer ticket={t} /></li>)}</ul>
            : <div className="py-3"><Empty icon={Sparkles} title="No open tickets assigned to you" /></div>}</div>
        </PanelCard></div>
      </div>
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
