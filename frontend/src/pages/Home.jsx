import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileCheck2, Flag, LifeBuoy, Sparkles, AlertTriangle, Clock, Inbox, UserX, Timer, Smile, ShieldCheck, Plus, BookOpen, Search, MessageSquare, FolderKanban } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtDate, fmtHours, fmtRelative, projectColor, labelize, fmtHoursShort } from '../lib/format.js';
import { setDone } from '../lib/tasks.js';
import { Avatar, Card, CheckButton, DueChip, Empty, ErrorBox, HealthBadge, Loading, ProjectChip, ProjectDot, StatusBadge, PriorityBadge, SlaTimer, useToast } from '../components/ui.jsx';
import { LineChart, Donut } from '../components/BarChart.jsx';

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

const PRIO_COLORS = { CRITICAL: '#dc2626', HIGH: '#d97706', MEDIUM: '#2563eb', LOW: '#94a3b8' };
const PRIO_NAMES = { CRITICAL: 'Urgent', HIGH: 'High', MEDIUM: 'Normal', LOW: 'Low' };

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
  const stats = useLoad(() => get('/tickets/stats'), []);
  const dash = useLoad(() => get('/dashboard'), []);
  const mine = useLoad(() => get('/tickets', { view: 'mine', pageSize: 6, sort: 'resolutionDueAt', dir: 'asc' }), []);
  const hot = useLoad(() => get('/tickets', { view: 'overdue', pageSize: 6, sort: 'resolutionDueAt', dir: 'asc' }), []);
  const unassigned = useLoad(() => get('/tickets', { view: 'unassigned', pageSize: 6, sort: 'createdAt', dir: 'asc' }), []);
  useLive((e) => e.type.startsWith('ticket'), () => { stats.reload({ silent: true }); mine.reload({ silent: true }); hot.reload({ silent: true }); unassigned.reload({ silent: true }); });
  useLive((e) => e.type === 'work.changed', () => dash.reload({ silent: true }));
  const [tab, setTab] = useState('attention');
  const s = stats.data;
  const d = dash.data;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const manager = ['ADMIN', 'MANAGER'].includes(role);
  const complete = async (t) => {
    dash.setData((x) => ({ ...x, myTasks: x.myTasks.filter((m) => m.id !== t.id) }));
    try { await setDone(t.projectId, t.id, true); toast(`Done: ${t.title}`, 'success'); } catch (e) { toast(e.message, 'error'); dash.reload(); }
  };
  if (stats.error) return <ErrorBox error={stats.error} onRetry={stats.reload} />;
  if (!s || !d) return <Loading rows={8} />;
  const attentionRows = [...(hot.data?.data || []), ...(unassigned.data?.data || []).filter((t) => !(hot.data?.data || []).some((h) => h.id === t.id))].slice(0, 7);
  const shortDays = s.trend.days.map((x) => new Date(`${x}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  return (
    <>
      <div className="page-header">
        <div><div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1 className="h-page">{greet}, {user?.name?.split(' ')[0]}</h1>
          <div className="sub">{s.breached ? <span className="text-danger fw-semibold">{s.breached} ticket{s.breached > 1 ? 's have' : ' has'} missed the SLA target.</span> : s.unassigned ? `${s.unassigned} ticket${s.unassigned > 1 ? 's are' : ' is'} waiting for an owner.` : 'The queue is under control.'}</div></div>
        <div className="d-flex gap-2"><Link to="/tickets?view=unassigned" className="btn btn-light"><Inbox size={15} /> Pick up tickets</Link><Link to="/tickets?new=1" className="btn btn-primary"><Plus size={15} /> New ticket</Link></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="blue" icon={Inbox} label="Open tickets" value={s.open} hint={`${s.createdToday} new today`} to="/tickets?view=open" /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="orange" icon={UserX} label="Unassigned" value={s.unassigned} hint="Need an owner" to="/tickets?view=unassigned" /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="red" icon={AlertTriangle} label="SLA breached" value={s.breached} hint={s.atRisk ? `${s.atRisk} more at risk` : 'None at risk'} to="/tickets?view=overdue" alert={s.breached > 0} /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="cyan" icon={Timer} label="Avg first reply" value={fmtHoursShort(s.avgFirstResponseHours)} hint="Last 30 days" /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="green" icon={ShieldCheck} label="SLA met" value={s.slaCompliance == null ? '—' : `${Math.round(s.slaCompliance * 100)}%`} hint={`${s.resolved30} resolved in 30 days`} /></div>
        <div className="col-6 col-lg-4 col-xxl-2"><Tile tone="violet" icon={Smile} label="Customer rating" value={s.csat.average == null ? '—' : `${s.csat.average.toFixed(1)}/5`} hint={`${s.csat.count} rating${s.csat.count === 1 ? '' : 's'}, 90 days`} /></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-8"><Card title="Ticket volume — last 14 days" actions={<span className="small text-muted">Created vs resolved</span>}>
          <LineChart label="Tickets created and resolved per day" labels={shortDays} series={[{ name: 'Created', data: s.trend.created, color: '#2563eb' }, { name: 'Resolved', data: s.trend.resolved, color: '#16a34a' }]} height={230} />
        </Card></div>
        <div className="col-xl-4"><Card title="Open by priority">
          <Donut label="Open tickets by priority" centerLabel="open" items={Object.entries(s.byPriority).map(([k, v]) => ({ name: PRIO_NAMES[k], value: v, color: PRIO_COLORS[k] }))} />
          <hr className="my-3" />
          <div className="small text-muted mb-2">By status</div>
          <div className="bar-stack mb-2">{[['NEW', '#7c3aed'], ['OPEN', '#2563eb'], ['IN_PROGRESS', '#0891b2'], ['WAITING_ON_CUSTOMER', '#d97706']].map(([k, c]) => <span key={k} style={{ width: `${s.open ? (s.byStatus[k] / s.open) * 100 : 0}%`, background: c }} title={`${labelize(k)}: ${s.byStatus[k]}`} />)}</div>
          <div className="d-flex flex-wrap gap-3 small">{[['NEW', '#7c3aed'], ['OPEN', '#2563eb'], ['IN_PROGRESS', '#0891b2'], ['WAITING_ON_CUSTOMER', '#d97706']].map(([k, c]) => <span key={k} className="d-inline-flex align-items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />{labelize(k)} <strong className="num">{s.byStatus[k]}</strong></span>)}</div>
        </Card></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-xl-8"><Card bodyClass="p-0" title={<div className="segmented" role="tablist">
          <button className={tab === 'attention' ? 'active' : ''} onClick={() => setTab('attention')} role="tab" aria-selected={tab === 'attention'}><AlertTriangle size={14} /> Needs attention {attentionRows.length > 0 && <span className="pill pill-risk ms-1 py-0">{attentionRows.length}</span>}</button>
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')} role="tab" aria-selected={tab === 'mine'}><Inbox size={14} /> My queue {mine.data?.meta?.total > 0 && <span className="pill pill-blue ms-1 py-0">{mine.data.meta.total}</span>}</button>
        </div>} actions={<Link to={tab === 'mine' ? '/tickets?view=mine' : '/tickets?view=overdue'} className="small fw-semibold d-inline-flex align-items-center gap-1">Open queue <ArrowRight size={14} /></Link>}>
          {tab === 'attention' ? <TicketMiniTable rows={attentionRows} empty="Nothing overdue or unassigned" showAssignee /> : <TicketMiniTable rows={mine.data?.data || []} empty="No open tickets assigned to you" />}
        </Card></div>
        <div className="col-xl-4"><Card title="Team workload" actions={<span className="small text-muted">Open · resolved 30d</span>}>
          {s.agents.length ? s.agents.map((a) => {
            const max = Math.max(...s.agents.map((x) => x.open), 1);
            return <div key={a.id} className="hbar"><Avatar sm name={a.name} /><span className="lbl">{a.name}</span><span className="track"><span style={{ width: `${(a.open / max) * 100}%`, background: a.open >= 5 ? 'var(--amber)' : 'var(--brand)' }} /></span><span className="v">{a.open}</span><span className="small text-muted num" style={{ width: 28, textAlign: 'right' }}>{a.resolved}</span></div>;
          }) : <div className="small text-muted">No assigned tickets yet.</div>}
          {s.customers.length > 0 && <><hr className="my-3" /><div className="small text-muted mb-2">Open tickets by client</div>
            {s.customers.map((c) => <div key={c.name} className="d-flex justify-content-between small py-1"><span>{c.name}</span><strong className="num">{c.open}</strong></div>)}</>}
        </Card></div>
      </div>

      <div className="row g-3">
        <div className="col-xl-6"><Card title={<><CheckCircle2 size={16} className="text-success" /> My tasks</>} actions={<Link to="/my-tasks" className="small fw-semibold">All tasks</Link>}>
          {d.myTasks.length ? d.myTasks.slice(0, 6).map((t) => (
            <div key={t.id} className="task-row"><CheckButton done={false} label={t.title} onToggle={() => complete(t)} />
              <Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="title">{t.title}</Link>
              <span className="d-none d-md-inline-flex align-items-center gap-1 small text-muted"><ProjectDot code={t.key.split('-')[0]} />{t.key}</span><DueChip date={t.plannedFinish} /></div>))
            : <Empty icon={Sparkles} title="No open tasks">Delivery tasks assigned to you show up here.</Empty>}
          <div className="d-flex justify-content-between small text-muted mt-2"><span><Clock size={13} /> {fmtHours(d.timesheet.hours)} logged this week · {labelize(d.timesheet.status)}</span><Link to="/time">Timesheet</Link></div>
        </Card></div>
        <div className="col-xl-6"><Card title={<><FolderKanban size={16} className="text-primary" /> Projects</>} actions={<Link to="/projects" className="small fw-semibold">All projects</Link>}>
          {manager && d.portfolio ? (d.portfolio.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Project</th><th>Health</th><th style={{ width: 160 }}>Progress</th><th>Due</th></tr></thead><tbody>
            {d.portfolio.slice(0, 6).map((p) => <tr key={p.id}><td><Link to={`/projects/${p.id}`} className="d-inline-flex align-items-center gap-2 fw-semibold text-body"><ProjectDot code={p.code} />{p.name}</Link><div className="tk-meta">{p.customer || 'Internal'}</div></td><td><HealthBadge health={p.health} /></td>
              <td><div className="d-flex align-items-center gap-2"><div className="meter flex-grow-1" style={{ '--pc': projectColor(p.code) }}><span style={{ width: `${p.progress || 0}%` }} /></div><span className="small num">{Math.round(p.progress || 0)}%</span></div></td><td className="small">{fmtDate(p.plannedFinish)}</td></tr>)}
          </tbody></table></div> : <Empty title="No active projects" />)
            : d.upcoming?.length ? d.upcoming.map((t) => <div key={t.id} className="d-flex align-items-center gap-2 py-2 border-bottom"><ProjectDot code={t.key.split('-')[0]} /><Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="flex-grow-1 truncate text-body small fw-semibold">{t.title}</Link><DueChip date={t.plannedFinish} /></div>) : <div className="small text-muted">Nothing due in the next 7 days.</div>}
        </Card></div>
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
        <h1>Hi {user?.name?.split(' ')[0]}, how can we help?</h1>
        <p>Search the help center, raise a ticket, or follow your projects.</p>
        <form className="position-relative d-flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); nav(`/kb?q=${encodeURIComponent(q)}`); }} style={{ zIndex: 1 }}>
          <div className="position-relative flex-grow-1" style={{ maxWidth: 560 }}><Search size={17} className="position-absolute text-muted" style={{ left: 13, top: 14 }} /><input className="form-control" placeholder="Search help articles…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search help articles" /></div>
          <Link to="/tickets?new=1" className="btn btn-primary" style={{ height: 44 }}><LifeBuoy size={16} /> Raise a ticket</Link>
        </form>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><Tile tone="blue" icon={Inbox} label="Open tickets" value={views.data?.open ?? '—'} to="/tickets" /></div>
        <div className="col-6 col-lg-3"><Tile tone="orange" icon={MessageSquare} label="Waiting for your reply" value={views.data?.waiting ?? '—'} to="/tickets?view=waiting" alert={views.data?.waiting > 0} /></div>
        <div className="col-6 col-lg-3"><Tile tone="green" icon={CheckCircle2} label="Resolved" value={views.data?.resolved ?? '—'} to="/tickets?view=resolved" /></div>
        <div className="col-6 col-lg-3"><Tile tone="violet" icon={FileCheck2} label="Awaiting your approval" value={d.deliverablesAwaitingReview.length} /></div>
      </div>
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
      {d.projects.length > 0 && <><h2 className="h-section mt-2">Your projects</h2><div className="project-grid">{d.projects.map((p) => <ProjectCard key={p.id} p={p} />)}</div></>}
    </>
  );
}

export default function Home() {
  const { isCustomer } = useAuth();
  return isCustomer ? <ClientHome /> : <StaffDashboard />;
}
