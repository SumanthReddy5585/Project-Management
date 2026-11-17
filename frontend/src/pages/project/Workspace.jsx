import { createContext, useContext } from 'react';
import { NavLink, Outlet, useParams, useSearchParams } from 'react-router-dom';
import { get } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth, projectCan } from '../../auth/AuthContext.jsx';
import { fmtDate, labelize } from '../../lib/format.js';
import { ErrorBox, HealthBadge, Loading, Meter, StatusBadge, Notice } from '../../components/ui.jsx';
import { WorkItemDrawer } from './WorkItemDrawer.jsx';

const Ctx = createContext(null);
export const useProject = () => useContext(Ctx);

export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const { me, isCustomer } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data: p, error, loading, reload } = useLoad(() => get(`/projects/${projectId}`), [projectId]);
  if (loading && !p) return <Loading rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const can = (cap) => projectCan(me, p.role, cap) && (!p.readOnly || ['project.view', 'project.viewInternal', 'register.view', 'export.csv'].includes(cap));
  const people = p.members.filter((m) => m.role !== 'VIEWER');
  const assignable = p.members.filter((m) => ['MANAGER', 'MEMBER'].includes(m.role));
  const itemId = params.get('item');
  const openItem = (id) => setParams((prev) => { const n = new URLSearchParams(prev); if (id) n.set('item', id); else n.delete('item'); return n; });
  const tabs = [
    ['', 'Overview'], ['work', 'Work'], ...(isCustomer ? [] : [['board', 'Board'], ['timeline', 'Timeline']]), ['calendar', 'Calendar'], ['milestones', 'Milestones'],
    ['deliverables', 'Deliverables'], ['updates', 'Updates'], ['discussions', 'Discussions'], ['files', 'Files'],
    ...(can('register.view') ? [['registers', 'Risks & changes']] : []), ...(isCustomer ? [] : [['team', 'Team']]), ...(can('project.edit') ? [['settings', 'Settings']] : []),
  ];
  return (
    <Ctx.Provider value={{ project: p, reload, can, people, assignable, openItem }}>
      <div className="page-header mb-2">
        <div className="min-w-0">
          <div className="small-caps mb-1">{p.customerName || 'Internal project'} · <span className="mono">{p.code}</span></div>
          <h1 className="h-page d-flex align-items-center gap-2 flex-wrap">{p.name} <StatusBadge status={p.status} /></h1>
          <div className="d-flex gap-3 mt-2 small text-muted flex-wrap align-items-center">
            <HealthBadge health={p.health} /><span>{fmtDate(p.plannedStart)} → {fmtDate(p.plannedFinish)}</span>
            {!isCustomer && <span>{p.counts.open} open · {p.counts.overdue} overdue · {p.counts.blocked} blocked</span>}
            {!isCustomer && <span>{p.customerVisible ? 'Shared with customer' : 'Not shared with customer'}</span>}
          </div>
        </div>
        <div style={{ width: 220 }}><div className="small-caps mb-1">Progress {p.progressMethod === 'count' && <span title="No estimates yet: progress counts items equally">(by count)</span>}</div><Meter value={p.progress} label="Project progress" /></div>
      </div>
      {p.readOnly && <Notice tone="warn">This project is {labelize(p.status).toLowerCase()} and read-only.</Notice>}
      <nav className="tabs mt-2" aria-label="Project sections">{tabs.map(([to, label]) => <NavLink key={to} to={to} end={to === ''}>{label}</NavLink>)}</nav>
      <Outlet />
      <WorkItemDrawer itemId={itemId} onClose={() => openItem(null)} />
    </Ctx.Provider>
  );
}
