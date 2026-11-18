import { createContext, useContext, useState } from 'react';
import { useLive } from '../../lib/live.js';
import { ProjectActions } from './Actions.jsx';
import { Link, NavLink, Outlet, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Settings, Globe, Lock, LayoutDashboard, ListChecks, Columns3, Table2, GanttChart, CalendarDays, ClipboardCheck, ChevronDown, FileText, MessagesSquare, ShieldAlert, Users, History, FolderOpen, Rows3 } from 'lucide-react';
import { rememberProject } from '../../components/Layout.jsx';
import { get } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth, projectCan } from '../../auth/AuthContext.jsx';
import { fmtDate, labelize, projectColor } from '../../lib/format.js';
import { ScheduleChip } from '../../lib/schedule.jsx';
import { ErrorBox, HealthBadge, Loading, Notice, ProjectChip, Avatar, StatusBadge } from '../../components/ui.jsx';
import { WorkItemDrawer } from './WorkItemDrawer.jsx';

const Ctx = createContext(null);
export const useProject = () => useContext(Ctx);

export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const { me, isCustomer } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data: p, error, loading, reload } = useLoad(() => get(`/projects/${projectId}`), [projectId]);
  useLive((e) => e.type === 'work.changed' && e.projectId === projectId && !e.self, () => reload({ silent: true }), [projectId]);
  if (loading && !p) return <Loading rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const can = (cap) => projectCan(me, p.role, cap) && (!p.readOnly || ['project.view', 'project.viewInternal', 'register.view', 'export.csv'].includes(cap));
  const people = p.members.filter((m) => m.role !== 'VIEWER');
  const assignable = p.members.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role));
  const itemId = params.get('item');
  const openItem = (id) => setParams((prev) => { const n = new URLSearchParams(prev); if (id) n.set('item', id); else n.delete('item'); return n; });
  const base = `/projects/${p.id}`;
  const team = p.members.filter((m) => m.role !== 'CUSTOMER');
  const sc = !isCustomer ? p.schedule : null;
  return (
    <Ctx.Provider value={{ project: p, reload, can, people, assignable, openItem }}>
      <Remember project={p} />
      <nav className="crumbs no-print" aria-label="Breadcrumb"><Link to="/projects">Projects</Link><span className="sep">/</span><span>{p.name}</span></nav>
      <div className="proj-head no-print" style={{ '--pc': projectColor(p.code) }}>
        <ProjectChip code={p.code} size={32} />
        <h1 className="h-page">{p.name}</h1>
        {p.status !== 'ACTIVE' && <StatusBadge status={p.status} />}
        {sc ? <NavLink to={`${base}/plan`} className="text-decoration-none" title="Automatic: compared with the approved plan"><ScheduleChip status={sc.status} /></NavLink>
          : !isCustomer && p.planApprovedAt === null && p.status !== 'CANCELLED' ? <NavLink to={`${base}/plan`} className="pill pill-neutral text-decoration-none">Plan not approved</NavLink> : isCustomer ? <HealthBadge health={p.health} /> : null}
        <div className="ms-auto d-flex align-items-center gap-2">
          <div className="avatar-stack d-none d-md-inline-flex" aria-label={`${team.length} team members`}>{team.slice(0, 5).map((m) => <Avatar key={m.id} name={m.name} title={`${m.name} (${labelize(m.role)})`} />)}{team.length > 5 && <span className="avatar avatar-empty">+{team.length - 5}</span>}</div>
          {!isCustomer && can('project.edit') && <NavLink to={`${base}/settings`} className="btn btn-light btn-icon" aria-label="Project settings" title="Project settings"><Settings size={16} /></NavLink>}
          {!isCustomer && <ProjectActions project={p} can={can} reload={reload} />}
        </div>
      </div>
      <div className="proj-head no-print" style={{ marginTop: '-0.35rem' }}>
        <div className="meta">
          <span>{p.customerName || 'Internal project'}</span>
          {sc ? <span>Planned end {fmtDate(sc.originalFinish)}{sc.status !== 'COMPLETED' && sc.finishVariance ? <span className={sc.finishVariance > 0 ? 'text-danger fw-semibold' : 'text-primary fw-semibold'}> · expected {fmtDate(sc.forecastFinish)}</span> : null}</span> : <span>Due {fmtDate(p.plannedFinish)}</span>}
          <span className="d-inline-flex align-items-center gap-2">Progress <span className="meter" style={{ width: 90, display: 'inline-block' }}><span style={{ width: `${p.progress || 0}%` }} /></span><strong>{p.progress == null ? '—' : `${Math.round(p.progress)}%`}</strong></span>
          {!isCustomer && p.customerName && (p.customerVisible ? <span className="d-inline-flex gap-1 align-items-center"><Globe size={13} /> Client can follow</span> : <span className="d-inline-flex gap-1 align-items-center"><Lock size={13} /> Hidden from client</span>)}
        </div>
      </div>
      <ProjectTabs base={base} p={p} can={can} isCustomer={isCustomer} />
      {p.readOnly && <Notice tone="warn">This project is {labelize(p.status).toLowerCase()}. You can look around but not make changes.</Notice>}
      <Outlet />
      <WorkItemDrawer itemId={itemId} onClose={() => openItem(null)} />
    </Ctx.Provider>
  );
}

function Remember({ project }) {
  useEffect(() => { rememberProject(project); }, [project.id, project.name]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Jira-style project navigation: the main views as tabs, the rest under "More". */
function ProjectTabs({ base, p, can, isCustomer }) {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const main = isCustomer
    ? [['', 'Summary', LayoutDashboard], ['tasks', 'Tasks', Rows3], ['calendar', 'Calendar', CalendarDays], ['approvals', 'Approvals', ClipboardCheck], ['updates', 'Updates', MessagesSquare], ['files', 'Files', FolderOpen]]
    : [['', 'Summary', LayoutDashboard], ['plan', p.planApprovedAt ? 'Plan vs original' : 'Plan (not approved)', ListChecks], ['tasks', 'Backlog', Rows3], ['board', 'Board', Columns3], ['list', 'List', Table2], ['timeline', 'Timeline', GanttChart], ['calendar', 'Calendar', CalendarDays], ['approvals', 'Approvals', ClipboardCheck]];
  const more = isCustomer ? [] : [['files', 'Files', FolderOpen], ['updates', 'Updates', MessagesSquare], ...(can('register.view') ? [['risks', 'Risks & issues', ShieldAlert]] : []),
    ['team', `Team (${p.members.filter((m) => m.role !== 'CUSTOMER').length})`, Users], ['activity', 'Activity', History], ['report', 'Status report', FileText]];
  const path = (to) => (to ? `${base}/${to}` : base);
  const inMore = more.find(([to]) => to && loc.pathname.startsWith(path(to)));
  return (
    <nav className="proj-tabs tabs no-print" aria-label="Project sections">
      {main.map(([to, label, Icon]) => <NavLink key={to} to={path(to)} end={!to}><Icon size={16} aria-hidden="true" />{label}</NavLink>)}
      {more.length > 0 && <span className="more-wrap" ref={ref}>
        <button type="button" className={inMore ? 'active' : ''} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} style={inMore ? { color: 'var(--brand)', borderBottomColor: 'var(--brand)' } : undefined}>
          {inMore ? inMore[1] : 'More'}<ChevronDown size={14} /></button>
        {open && <div className="menu-pop" role="menu" style={{ position: 'fixed', marginTop: 4 }}>{more.map(([to, label, Icon]) => <Link key={to} role="menuitem" to={path(to)}><Icon size={16} />{label}</Link>)}</div>}
      </span>}
    </nav>
  );
}
