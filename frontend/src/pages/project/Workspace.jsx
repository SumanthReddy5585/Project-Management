import { createContext, useContext, useState } from 'react';
import { useLive } from '../../lib/live.js';
import { ProjectActions } from './Actions.jsx';
import { NavLink, Outlet, useParams, useSearchParams } from 'react-router-dom';
import { Settings, Globe, Lock } from 'lucide-react';
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
  const tabs = [['', 'Overview'], ...(!isCustomer ? [['plan', p.planApprovedAt ? 'Plan vs original' : 'Plan (not approved)']] : []), ['tasks', 'Tasks'], ...(!isCustomer ? [['team', `Team (${p.members.filter((m) => m.role !== 'CUSTOMER').length})`]] : []), ['approvals', 'Approvals'], ['files', 'Files'], ['updates', 'Updates'],
    ...(can('register.view') ? [['risks', 'Risks & issues']] : []), ...(!isCustomer ? [['activity', 'Activity']] : [])];
  const team = p.members.filter((m) => m.role !== 'CUSTOMER');
  return (
    <Ctx.Provider value={{ project: p, reload, can, people, assignable, openItem }}>
      <div className="d-flex align-items-start gap-3 mb-3 mt-2 flex-wrap no-print" style={{ '--pc': projectColor(p.code) }}>
        <ProjectChip code={p.code} size={52} />
        <div className="min-w-0 flex-grow-1">
          <h1 className="h-page d-flex align-items-center gap-2 flex-wrap">{p.name}{p.status !== 'ACTIVE' && <StatusBadge status={p.status} />}</h1>
          <div className="d-flex gap-3 mt-1 small text-muted flex-wrap align-items-center">
            <span>{p.customerName || 'Internal project'}</span>
            {(() => { const sc = !isCustomer ? p.schedule : null;
              if (sc) return <>
                <span>Planned end {fmtDate(sc.originalFinish)}{sc.status !== 'COMPLETED' && sc.finishVariance ? <span className={sc.finishVariance > 0 ? 'text-danger fw-semibold' : 'text-primary fw-semibold'}> · expected {fmtDate(sc.forecastFinish)}</span> : null}</span>
                <NavLink to={`${base}/plan`} className="text-decoration-none" title="Automatic: compared with the approved plan"><ScheduleChip status={sc.status} /></NavLink></>;
              return <><span>Due {fmtDate(p.plannedFinish)}</span>{isCustomer ? <HealthBadge health={p.health} /> : p.planApprovedAt === null && p.status !== 'CANCELLED' && <NavLink to={`${base}/plan`} className="pill pill-neutral text-decoration-none">Plan not approved yet</NavLink>}</>; })()}
            {!isCustomer && p.customerName && (p.customerVisible ? <span className="d-inline-flex gap-1 align-items-center"><Globe size={13} /> Client can follow</span> : <span className="d-inline-flex gap-1 align-items-center"><Lock size={13} /> Hidden from client</span>)}
          </div>
        </div>
        <div className="d-flex align-items-center gap-3">
          <div className="d-none d-md-flex" aria-label={`${team.length} team members`}>{team.slice(0, 5).map((m, i) => <span key={m.id} style={{ marginLeft: i ? -8 : 0, border: '2px solid var(--canvas)', borderRadius: '50%' }}><Avatar name={m.name} title={`${m.name} (${labelize(m.role)})`} /></span>)}</div>
          <div style={{ width: 150 }}><div className="d-flex justify-content-between small"><span className="text-muted fw-semibold">Progress</span><strong>{p.progress == null ? '—' : `${Math.round(p.progress)}%`}</strong></div><div className="meter mt-1"><span style={{ width: `${p.progress || 0}%` }} /></div></div>
          {can('project.edit') && <NavLink to={`${base}/settings`} className="btn btn-light btn-sm"><Settings size={15} /> Settings</NavLink>}
          {!isCustomer && <ProjectActions project={p} can={can} reload={reload} />}
        </div>
      </div>
      {p.readOnly && <Notice tone="warn">This project is {labelize(p.status).toLowerCase()}. You can look around but not make changes.</Notice>}
      <nav className="tabs mt-3 no-print" aria-label="Project sections">{tabs.map(([to, label]) => <NavLink key={to} to={to ? `${base}/${to}` : base} end={!to}>{label}</NavLink>)}</nav>
      <Outlet />
      <WorkItemDrawer itemId={itemId} onClose={() => openItem(null)} />
    </Ctx.Provider>
  );
}
