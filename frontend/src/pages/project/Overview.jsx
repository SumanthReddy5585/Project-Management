import { Link } from 'react-router-dom';
import { Flag, Target, TrendingUp, Users, Wallet } from 'lucide-react';
import { LineChart } from '../../components/BarChart.jsx';
import { get } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtRelative, projectColor, fmtMoney, labelize } from '../../lib/format.js';
import { Card, ErrorBox, Loading, StatusBadge, DueChip, Avatar, Meter } from '../../components/ui.jsx';
import { useProject } from './Workspace.jsx';

export function Overview() {
  const { project: p, openItem } = useProject();
  const { isCustomer } = useAuth();
  const ms = useLoad(() => get(`/projects/${p.id}/work-items`, { type: 'MILESTONE', all: 'true', sort: 'plannedFinish', dir: 'asc' }), [p.id]);
  const ups = useLoad(() => get(`/projects/${p.id}/updates`), [p.id]);
  const burn = useLoad(() => get(`/projects/${p.id}/burnup`), [p.id, p.version, p.progress]);
  const color = projectColor(p.code);
  const today = new Date().toISOString().slice(0, 10);
  const current = p.phases.find((ph) => ph.plannedStart && ph.plannedStart <= today && (!ph.plannedFinish || ph.plannedFinish >= today));
  return (
    <div className="row g-4" style={{ '--pc': color }}>
      <div className="col-xl-8 d-flex flex-column gap-4">
        <div className="row g-3">
          <div className="col-6 col-md-3"><div className="tile violet"><div className="label">Progress</div><div className="value">{p.progress == null ? '—' : `${Math.round(p.progress)}%`}</div></div></div>
          <div className="col-6 col-md-3"><Link to="tasks" className="d-block text-decoration-none"><div className="tile blue"><div className="label">Open tasks</div><div className="value">{p.counts.open}</div></div></Link></div>
          <div className="col-6 col-md-3"><div className={`tile ${p.counts.overdue ? 'red' : 'green'}`}><div className="label">Overdue</div><div className="value">{p.counts.overdue}</div></div></div>
          <div className="col-6 col-md-3"><div className="tile orange"><div className="label">Milestones</div><div className="value">{p.milestones.done}/{p.milestones.total}</div></div></div>
        </div>
        {p.objectives && <Card title={<span className="d-inline-flex align-items-center gap-2"><Target size={17} /> Goal</span>}><p className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{p.objectives}</p></Card>}
        <Card title="Phases" actions={current && <span className="small text-muted">Now: <strong className="text-body">{current.name}</strong></span>}>
          {p.phases.length === 0 && <div className="small text-muted">This project has no phases.</div>}
          {p.phases.map((ph) => (
            <div key={ph.id} className="d-flex align-items-center gap-3 py-2 border-bottom">
              <div className="min-w-0" style={{ flex: '0 0 42%' }}><div className={`fw-semibold truncate ${ph.id === current?.id ? '' : 'text-body'}`}>{ph.id === current?.id && <span className="pill pill-dark me-2">Now</span>}{ph.name}</div><div className="small text-muted">{fmtDate(ph.plannedStart)} – {fmtDate(ph.plannedFinish)}</div></div>
              <div className="flex-grow-1"><div className="meter"><span style={{ width: `${ph.progress || 0}%` }} /></div></div>
              <span className="small fw-bold" style={{ width: 40, textAlign: 'right' }}>{ph.progress == null ? '—' : `${Math.round(ph.progress)}%`}</span>
            </div>))}
        </Card>
        <Card title={<span className="d-inline-flex align-items-center gap-2"><TrendingUp size={17} /> Burn-up</span>} actions={burn.data && <span className="small text-muted">{burn.data.done} of {burn.data.total} tasks done</span>}>
          {burn.data?.series.length > 1 ? <LineChart height={220} label="Tasks in scope, completed and planned to be complete, by week" labels={burn.data.series.map((x) => new Date(`${x.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}
            series={[{ name: 'Completed', data: burn.data.series.map((x) => x.done), color: '#16a34a' }, { name: 'Planned to be done', data: burn.data.series.map((x) => x.planned), color: '#94a3b8' }, { name: 'Total scope', data: burn.data.series.map((x) => x.scope), color: '#2563eb' }]} />
            : <div className="small text-muted">The chart fills in as the project runs and tasks are completed.</div>}
          <div className="form-text">Green rising toward blue = finishing scope. Green below grey = behind plan.</div>
        </Card>
      </div>
      <div className="col-xl-4 d-flex flex-column gap-4">
        <Card title="Latest update" actions={<Link to="updates" className="small fw-semibold">All updates</Link>}>
          {ups.loading && !ups.data ? <Loading rows={2} /> : ups.data?.data[0] ? <><div className="d-flex gap-2 align-items-center mb-1"><span className={`dot dot-${ups.data.data[0].health}`} /><strong>{ups.data.data[0].title}</strong></div><p className="small mb-1" style={{ whiteSpace: 'pre-wrap' }}>{ups.data.data[0].body}</p><div className="small text-muted">{ups.data.data[0].author?.name} · {fmtRelative(ups.data.data[0].createdAt)}</div></> : <div className="small text-muted">No updates yet.</div>}
        </Card>
        <Card title="Milestones">
          <ErrorBox error={ms.error} />
          {ms.loading && !ms.data ? <Loading rows={3} /> : (ms.data?.data || []).length === 0 ? <div className="small text-muted">No milestones.</div> : (ms.data.data).slice(0, 8).map((m) => (
            <button key={m.id} className="d-flex align-items-center gap-2 py-2 border-0 border-bottom bg-transparent w-100 text-start" onClick={() => openItem(m.id)}>
              <Flag size={15} className={m.status === 'DONE' ? 'text-success' : m.plannedFinish < today ? 'text-danger' : 'text-muted'} />
              <span className={`flex-grow-1 truncate fw-semibold small ${m.status === 'DONE' ? 'text-muted text-decoration-line-through' : ''}`}>{m.title}</span>
              {m.status === 'DONE' ? <StatusBadge status="DONE" /> : <DueChip date={m.plannedFinish} />}
            </button>))}
        </Card>
        {!isCustomer && <Card title={<span className="d-inline-flex align-items-center gap-2"><Users size={16} /> Team</span>} actions={<Link to="team" className="small fw-semibold">Manage</Link>}>
          {p.members.filter((m) => m.role !== 'CUSTOMER').map((m) => <div key={m.id} className="d-flex align-items-center gap-2 py-1"><Avatar sm name={m.name} /><span className="flex-grow-1 min-w-0"><span className="small fw-semibold d-block truncate">{m.name}</span><span className="small text-muted truncate d-block">{m.title || labelize(m.role)}</span></span>{m.id === p.managerId ? <span className="pill pill-dark">PM</span> : m.role === 'VIEWER' && <span className="pill pill-outline">Viewer</span>}</div>)}
        </Card>}
        {!isCustomer && burn.data?.hours && <Card title={<span className="d-inline-flex align-items-center gap-2"><Wallet size={16} /> Effort & budget</span>}>
          <div className="d-flex justify-content-between small mb-1"><span className="text-muted">Hours logged vs estimated</span><strong className="num">{burn.data.hours.logged}h / {burn.data.hours.estimate}h</strong></div>
          <Meter value={burn.data.hours.estimate ? (burn.data.hours.logged / burn.data.hours.estimate) * 100 : null} label="Hours used" />
          {burn.data.budget && <>
            <div className="d-flex justify-content-between small mb-1 mt-3"><span className="text-muted">Budget used</span><strong className="num">{burn.data.budget.consumed == null ? '—' : fmtMoney(burn.data.budget.consumed, burn.data.budget.currency)} / {fmtMoney(burn.data.budget.amount, burn.data.budget.currency)}</strong></div>
            {burn.data.budget.consumed != null ? <Meter value={(burn.data.budget.consumed / burn.data.budget.amount) * 100} label="Budget used" /> : <div className="small text-muted">Set an hourly rate in Settings to track spend.</div>}</>}
          <div className="form-text mt-2">{burn.data.hours.billable}h billable. Spend = billable hours × hourly rate.</div>
        </Card>}
        {!isCustomer && p.description && <Card title="About"><p className="small mb-0" style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p></Card>}
      </div>
    </div>
  );
}
