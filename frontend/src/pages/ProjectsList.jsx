import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FolderKanban } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtDate } from '../lib/format.js';
import { Empty, ErrorBox, HealthBadge, Loading, Meter, PageHeader, Pagination, SortHeader, StatusBadge, Select } from '../components/ui.jsx';

export default function ProjectsList() {
  const { can, isCustomer } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ field: 'updatedAt', dir: 'desc' });
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useLoad(() => get('/projects', { q: dq || undefined, status: status || undefined, page, sort: sort.field, dir: sort.dir }), [dq, status, page, sort]);
  const onSort = (field) => setSort((s) => ({ field, dir: s.field === field && s.dir === 'asc' ? 'desc' : 'asc' }));
  return (
    <>
      <PageHeader title="Projects" sub={isCustomer ? 'Projects your delivery team has shared with you.' : 'Projects you manage or belong to.'}
        actions={can('project.create') && <Link className="btn btn-primary" to="/projects/new"><Plus size={16} /> New project</Link>} />
      <div className="filters">
        <input className="form-control form-control-sm" style={{ maxWidth: 260 }} placeholder="Search name or code" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search projects" />
        {!isCustomer && <Select aria-label="Status" value={status} onChange={(v) => { setStatus(v || ''); setPage(1); }} placeholder="All except archived"
          options={['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED'].map((s) => ({ value: s, label: s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} />}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="card">
        {loading && !data ? <div className="p-3"><Loading /></div> : data?.data.length === 0 ? <Empty icon={FolderKanban} title="No projects found" action={can('project.create') && <Link className="btn btn-primary btn-sm" to="/projects/new">Create the first project</Link>}>{q ? 'Try a different search.' : ''}</Empty> : (
          <div className="table-wrap"><table className="table table-hover">
            <thead><tr><SortHeader field="code" sort={sort} onSort={onSort}>Code</SortHeader><SortHeader field="name" sort={sort} onSort={onSort}>Project</SortHeader><th>Customer</th><SortHeader field="status" sort={sort} onSort={onSort}>Status</SortHeader><th>Health</th><th style={{ width: 170 }}>Progress</th><SortHeader field="plannedFinish" sort={sort} onSort={onSort}>Finish</SortHeader>{!isCustomer && <th>Manager</th>}</tr></thead>
            <tbody>{data?.data.map((p) => (
              <tr key={p.id} className="row-link" onClick={() => nav(`/projects/${p.id}`)}>
                <td className="mono fw-semibold"><Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.code}</Link></td><td className="fw-medium text-body">{p.name}</td><td className="small">{p.customerName || <span className="text-muted">Internal</span>}</td>
                <td><StatusBadge status={p.status} /></td><td><HealthBadge health={p.health} /></td><td><Meter value={p.progress} /></td><td className="small">{fmtDate(p.plannedFinish)}</td>{!isCustomer && <td className="small">{p.managerName}</td>}
              </tr>))}</tbody>
          </table></div>)}
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
    </>
  );
}
