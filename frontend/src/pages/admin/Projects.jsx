import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Trash2, ExternalLink, AlertTriangle, FolderKanban } from 'lucide-react';
import { get, del } from '../../api/client.js';
import { useLoad, useDebounced } from '../../lib/hooks.js';
import { fmtDate, labelize } from '../../lib/format.js';
import { Empty, ErrorBox, Loading, Modal, Notice, Pagination, ProjectChip, StatusBadge, useToast } from '../../components/ui.jsx';

const ALL = 'DRAFT,ACTIVE,ON_HOLD,COMPLETED,CANCELLED,ARCHIVED';
const planState = (p) => (p.planApprovedAt ? ['Approved', 'ok'] : p.planSubmittedAt ? ['With the director', 'warn'] : ['Being built', 'neutral']);

/** Settings → Projects: every project in the workspace, for administrators. Only administrators can delete one. */
export function AdminProjects() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useLoad(() => get('/projects', { status: status || ALL, q: dq || undefined, page, pageSize: 50, sort: 'name', dir: 'asc' }), [dq, status, page]);
  const [doomed, setDoomed] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = list.data?.data || [];
  const counts = useMemo(() => rows.reduce((m, p) => ({ ...m, [p.status]: (m[p.status] || 0) + 1 }), {}), [rows]);
  const remove = async () => {
    setBusy(true);
    try { await del(`/projects/${doomed.id}`, { confirmCode: typed }); toast(`${doomed.code} · ${doomed.name} was deleted`, 'success'); setDoomed(null); list.reload(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="page-header"><div><h2 className="h-page">Projects</h2><div className="sub">Every project in the workspace. Only administrators can delete a project.</div></div>
        <Link to="/projects?new=1" className="btn btn-primary">New project</Link></div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="queue-toolbar">
          <div className="search-in"><Search size={15} /><input className="form-control form-control-sm" placeholder="Search name or code" aria-label="Search projects" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <select className="form-select form-select-sm" style={{ width: 'auto' }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
            <option value="">All statuses</option>{ALL.split(',').map((s) => <option key={s} value={s}>{labelize(s)}</option>)}</select>
          <span className="ms-auto small text-muted">{list.data?.meta?.total ?? 0} projects{Object.keys(counts).length > 0 && !status ? ` · ${Object.entries(counts).map(([k, n]) => `${n} ${labelize(k).toLowerCase()}`).join(', ')}` : ''}</span>
        </div>
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? <div className="p-3"><Loading /></div> : rows.length === 0 ? <Empty icon={FolderKanban} title="No projects match" /> : (
          <div className="table-wrap"><table className="table table-hover mb-0">
            <thead><tr><th>Project</th><th>Client</th><th>Director</th><th>Manager</th><th>Plan</th><th>Status</th><th>Dates</th><th className="text-end">Team</th><th /></tr></thead>
            <tbody>{rows.map((p) => { const [plan, tone] = planState(p); return (
              <tr key={p.id}>
                <td><Link to={`/projects/${p.id}`} className="d-flex align-items-center gap-2 text-body text-decoration-none"><ProjectChip code={p.code} size={26} /><span><span className="fw-semibold d-block">{p.name}</span><span className="small text-muted mono">{p.code}</span></span></Link></td>
                <td className="small">{p.customerName || <span className="text-muted">Internal</span>}</td>
                <td className="small text-nowrap">{p.directorName || <span className="text-warning-emphasis">Not chosen</span>}</td>
                <td className="small text-nowrap">{p.managerName || '—'}</td>
                <td><span className={`pill pill-${tone}`}>{plan}</span></td>
                <td><StatusBadge status={p.status} /></td>
                <td className="small text-nowrap">{fmtDate(p.plannedStart)} → {fmtDate(p.plannedFinish)}</td>
                <td className="text-end num">{p.teamSize ?? '—'}</td>
                <td className="text-end text-nowrap">
                  <Link to={`/projects/${p.id}`} className="btn btn-sm btn-ghost" title="Open"><ExternalLink size={14} /></Link>
                  <button className="btn btn-sm btn-ghost text-danger" onClick={() => { setDoomed(p); setTyped(''); }} aria-label={`Delete ${p.code}`} title="Delete project"><Trash2 size={14} /></button>
                </td>
              </tr>); })}</tbody></table></div>)}
        <div className="px-3 pb-2"><Pagination meta={list.data?.meta} onPage={setPage} /></div>
      </div>
      {doomed && <Modal open onClose={() => setDoomed(null)} title={`Delete ${doomed.code} · ${doomed.name}?`}
        footer={<><button className="btn btn-light" onClick={() => setDoomed(null)}>Cancel</button><button className="btn btn-danger" disabled={busy || typed.trim().toUpperCase() !== doomed.code} onClick={remove}>{busy ? 'Deleting…' : 'Delete for ever'}</button></>}>
        <Notice tone="warn" icon={AlertTriangle}>This removes the project with its plan (including the approved original), tasks, time entries, documents, updates and risks. It cannot be undone. Tickets linked to it stay, without a project.</Notice>
        <p className="small mt-3 mb-1">To keep the history instead, cancel and archive the project (Actions on the project page).</p>
        <label className="form-label small mt-2" htmlFor="del-code">Type the project code <b className="mono">{doomed.code}</b> to confirm</label>
        <input id="del-code" className="form-control mono text-uppercase" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Modal>}
    </>
  );
}
