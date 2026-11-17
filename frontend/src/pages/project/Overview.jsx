import { Link } from 'react-router-dom';
import { Flag } from 'lucide-react';
import { get } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtMoney, fmtRelative, labelize } from '../../lib/format.js';
import { Card, ErrorBox, Loading, Meter, StatusBadge, HealthBadge } from '../../components/ui.jsx';
import { BarChart } from '../../components/BarChart.jsx';
import { useProject } from './Workspace.jsx';

export function Overview() {
  const { project: p } = useProject();
  const { isCustomer } = useAuth();
  const prog = useLoad(() => get(`/projects/${p.id}/progress`), [p.id, p.version]);
  const ms = useLoad(() => get(`/projects/${p.id}/work-items`, { type: 'MILESTONE', all: 'true', sort: 'plannedFinish', dir: 'asc' }), [p.id]);
  const ups = useLoad(() => get(`/projects/${p.id}/updates`), [p.id]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="row g-3">
      <div className="col-xl-8 d-flex flex-column gap-3">
        <Card title="Phases">
          <ErrorBox error={prog.error} />
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Phase</th><th>Dates</th><th>Status</th><th style={{ width: 200 }}>Progress</th></tr></thead>
            <tbody>{p.phases.map((ph) => <tr key={ph.id}><td className="fw-medium">{ph.name}{ph.completionCriteria && <div className="small text-muted">{ph.completionCriteria}</div>}</td>
              <td className="small text-nowrap">{fmtDate(ph.plannedStart)} → {fmtDate(ph.plannedFinish)}</td><td><StatusBadge status={ph.status} /></td><td><Meter value={ph.progress} /></td></tr>)}</tbody>
          </table></div>
          <div className="form-text">Progress is effort-weighted across leaf tasks; cancelled work and milestones carry no effort weight.</div>
        </Card>
        {prog.data && prog.data.modules.length > 0 && <Card title="Modules">
          <BarChart horizontal height={Math.max(160, prog.data.modules.length * 34)} label="Progress by module" axisTitle="% complete" max={100} labels={prog.data.modules.map((m) => m.title)} series={[{ name: 'Progress', data: prog.data.modules.map((m) => m.percent ?? 0) }]} />
        </Card>}
      </div>
      <div className="col-xl-4 d-flex flex-column gap-3">
        <Card title="Summary"><dl className="kv">
          <dt>Health</dt><dd><HealthBadge health={p.health} /></dd>
          <dt>Manager</dt><dd>{p.members.find((m) => m.role === 'MANAGER')?.name}</dd>
          {!isCustomer && <><dt>Priority</dt><dd>{labelize(p.priority)}</dd><dt>Calendar</dt><dd>{p.calendarName || 'Default'}</dd></>}
          <dt>Milestones</dt><dd>{p.milestones.done} of {p.milestones.total} reached</dd>
          {p.budgetAmount != null && <><dt>Budget</dt><dd>{fmtMoney(p.budgetAmount, p.budgetCurrency)}{p.billingEnabled && p.hourlyRate ? ` · ${fmtMoney(p.hourlyRate, p.budgetCurrency)}/h` : ''}</dd></>}
        </dl>{p.objectives && <><h3 className="h-section mt-3">Objectives</h3><p className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{p.objectives}</p></>}</Card>
        <Card title="Milestones" actions={<Link to="../milestones" className="small">All</Link>}>
          {ms.loading && !ms.data ? <Loading rows={3} /> : <ul className="list-plain">{(ms.data?.data || []).slice(0, 8).map((m) => (
            <li key={m.id}><Flag size={13} className={m.status === 'DONE' ? 'text-success' : m.plannedFinish < today ? 'text-danger' : 'text-muted'} /><span className="flex-grow-1 truncate">{m.title}</span><span className={`small ${m.status !== 'DONE' && m.plannedFinish < today ? 'text-danger' : 'text-muted'}`}>{fmtDate(m.plannedFinish)}</span></li>))}
            {ms.data?.data.length === 0 && <li className="small text-muted">No milestones.</li>}</ul>}
        </Card>
        <Card title="Latest update" actions={<Link to="../updates" className="small">All updates</Link>}>
          {ups.data?.data[0] ? <><div className="d-flex gap-2 align-items-center mb-1"><span className={`dot dot-${ups.data.data[0].health}`} /><strong>{ups.data.data[0].title}</strong></div><p className="small mb-1" style={{ whiteSpace: 'pre-wrap' }}>{ups.data.data[0].body}</p><div className="small text-muted">{ups.data.data[0].author?.name} · {fmtRelative(ups.data.data[0].createdAt)}</div></> : <div className="small text-muted">No status updates yet.</div>}
        </Card>
      </div>
    </div>
  );
}
