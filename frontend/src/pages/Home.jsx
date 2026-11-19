import { useState } from 'react';
import StaffDashboard from './Dashboard.jsx';
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


export const PanelCard = ({ title, count, tools, children, flush, foot, className = '' }) => (
  <section className={`panel-card ${className}`}>
    <div className="pc-head"><h2>{title}{count != null && <span className="n">({count})</span>}</h2>{tools && <div className="tools">{tools}</div>}</div>
    <div className={`pc-body ${flush ? 'flush' : ''}`}>{children}</div>
    {foot && <div className="pc-foot">{foot}</div>}
  </section>
);

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

export function RecentActivity({ limit = 7 }) {
  const feed = useLoad(() => get('/activity/recent', { limit }), [limit]);
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
