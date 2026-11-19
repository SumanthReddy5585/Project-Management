import { Link } from 'react-router-dom';
import { Flag, Target, Users, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { get } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { useLive } from '../../lib/live.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtRelative, projectColor, labelize } from '../../lib/format.js';
import { Card, ErrorBox, Loading, StatusBadge, DueChip, Avatar } from '../../components/ui.jsx';
import { TaskVarChip, DaysVar } from '../../lib/schedule.jsx';
import { useProject } from './Workspace.jsx';
import { StatusBanner } from './Plan.jsx';

const today = () => new Date().toISOString().slice(0, 10);

function LatestUpdate({ p }) {
  const ups = useLoad(() => get(`/projects/${p.id}/updates`), [p.id]);
  const u = ups.data?.data?.[0];
  return (
    <Card title="Latest update from the manager" actions={<Link to="updates" className="small fw-semibold">All updates</Link>}>
      {ups.loading && !ups.data ? <Loading rows={2} /> : u ? <>
        <div className="fw-semibold mb-1">{u.title}</div>
        <p className="small mb-1" style={{ whiteSpace: 'pre-wrap' }}>{u.body}</p>
        <div className="small text-muted">{u.author?.name} · {fmtRelative(u.createdAt)}</div>
      </> : <div className="small text-muted">No updates yet.</div>}
    </Card>
  );
}

function PhasesCard({ p, plan }) {
  const t = today();
  const byId = new Map((plan?.approved ? plan.phases : []).map((ph) => [ph.id, ph]));
  const current = p.phases.find((ph) => ph.plannedStart && ph.plannedStart <= t && (!ph.plannedFinish || ph.plannedFinish >= t));
  return (
    <Card title="Phases">
      {p.phases.length === 0 ? <div className="small text-muted">This project has no phases.</div> : (
        <table className="table align-middle mb-0 ov-table">
          <thead><tr><th>Phase</th><th>Planned dates</th><th style={{ width: '28%' }}>Work done</th>{plan?.approved && <th>Against the plan</th>}</tr></thead>
          <tbody>{p.phases.map((ph) => {
            const v = byId.get(ph.id);
            const done = ph.progress >= 100;
            return (
              <tr key={ph.id}>
                <td className="fw-semibold">{ph.name}{ph.id === current?.id && !done && <span className="pill pill-dark ms-2">Current</span>}</td>
                <td className="small text-nowrap">{fmtDate(ph.plannedStart)} – {fmtDate(ph.plannedFinish)}</td>
                <td><div className="d-flex align-items-center gap-2"><div className="meter flex-grow-1"><span style={{ width: `${ph.progress || 0}%`, background: done ? 'var(--green)' : undefined }} /></div><span className="small fw-semibold num" style={{ width: 38, textAlign: 'right' }}>{ph.progress == null ? '—' : `${Math.round(ph.progress)}%`}</span></div></td>
                {plan?.approved && <td className="small">{!v ? <span className="text-muted">—</span> : v.done ? (v.finishVariance > 0 ? <span className="text-warning-emphasis fw-semibold">Done, <DaysVar days={v.finishVariance} className="text-warning-emphasis" /></span> : <span className="text-success fw-semibold">Done on time</span>) : <DaysVar days={v.finishVariance} />}</td>}
              </tr>);
          })}</tbody>
        </table>)}
    </Card>
  );
}

function KeyDates({ p, plan, openItem }) {
  const ms = useLoad(() => (plan?.approved ? Promise.resolve(null) : get(`/projects/${p.id}/work-items`, { type: 'MILESTONE', all: 'true', sort: 'plannedFinish', dir: 'asc' })), [p.id, plan?.approved]);
  const rows = plan?.approved
    ? plan.items.filter((r) => r.type === 'MILESTONE' && r.status !== 'REMOVED').sort((a, b) => (a.originalFinish || a.forecastFinish || '9').localeCompare(b.originalFinish || b.forecastFinish || '9'))
    : (ms.data?.data || []).map((m) => ({ id: m.id, title: m.title, originalFinish: m.plannedFinish, workStatus: m.status, raw: m }));
  return (
    <Card title={<span className="d-inline-flex align-items-center gap-2"><Flag size={16} /> Key dates (milestones)</span>}>
      <ErrorBox error={ms.error} />
      {!plan?.approved && ms.loading && !ms.data ? <Loading rows={3} /> : rows.length === 0 ? <div className="small text-muted">No milestones yet.</div> : (
        <table className="table align-middle mb-0 ov-table">
          <thead><tr><th>Milestone</th><th>Planned</th>{plan?.approved && <th>Expected / reached</th>}<th>Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><button className="btn btn-link p-0 text-start text-body fw-semibold" onClick={() => openItem(r.id)}>{r.title}</button></td>
              <td className="small text-nowrap">{fmtDate(r.originalFinish)}</td>
              {plan?.approved && <td className="small text-nowrap">{r.workStatus === 'DONE' ? fmtDate(r.actualFinish || r.currentFinish) : fmtDate(r.forecastFinish)}</td>}
              <td>{plan?.approved ? <TaskVarChip status={r.status} /> : r.workStatus === 'DONE' ? <StatusBadge status="DONE" /> : <DueChip date={r.originalFinish} />}</td>
            </tr>))}</tbody>
        </table>)}
    </Card>
  );
}

function NeedsAttention({ plan, openItem, people }) {
  if (!plan?.approved) return null;
  const late = plan.items.filter((r) => ['OVERDUE', 'DELAYED'].includes(r.status)).sort((a, b) => (b.finishVariance ?? 0) - (a.finishVariance ?? 0));
  const name = (id) => people.find((m) => m.id === id)?.name;
  return (
    <Card title={<span className="d-inline-flex align-items-center gap-2">{late.length ? <AlertTriangle size={16} className="text-danger" /> : <CheckCircle2 size={16} className="text-success" />} Needs attention</span>}
      actions={late.length > 5 && <Link to="plan" className="small fw-semibold">See all {late.length} late tasks</Link>}>
      {late.length === 0 ? <div className="small text-muted">Nothing is late. Every open task is on or ahead of the approved plan.</div> : (
        <table className="table align-middle mb-0 ov-table">
          <thead><tr><th>Late task</th><th>Owner</th><th>Planned finish</th><th>How late</th></tr></thead>
          <tbody>{late.slice(0, 5).map((r) => (
            <tr key={r.id}>
              <td><button className="btn btn-link p-0 text-start text-body fw-semibold" onClick={() => openItem(r.id)}>{r.title}</button><div className="small"><TaskVarChip status={r.status} /></div></td>
              <td className="small">{r.assigneeId ? <span className="d-inline-flex align-items-center gap-1"><Avatar sm name={name(r.assigneeId)} />{name(r.assigneeId)}</span> : <span className="text-muted">{r.type === 'MILESTONE' ? 'Milestone' : 'Not assigned'}</span>}</td>
              <td className="small text-nowrap">{fmtDate(r.originalFinish)}</td>
              <td><DaysVar days={r.finishVariance} /></td>
            </tr>))}</tbody>
        </table>)}
    </Card>
  );
}

function TeamCard({ p }) {
  return (
    <Card title={<span className="d-inline-flex align-items-center gap-2"><Users size={16} /> Team</span>} actions={<Link to="team" className="small fw-semibold">Manage</Link>}>
      {p.members.filter((m) => m.role !== 'CUSTOMER').sort((a, b) => (b.id === p.directorId) - (a.id === p.directorId) || (b.id === p.managerId) - (a.id === p.managerId)).map((m) => <div key={m.id} className="d-flex align-items-center gap-2 py-1"><Avatar sm name={m.name} /><span className="flex-grow-1 min-w-0"><span className="small fw-semibold d-block truncate">{m.name}</span><span className="small text-muted truncate d-block">{m.title || labelize(m.role)}</span></span>{m.id === p.directorId ? <span className="role-pill director">Director</span> : m.id === p.managerId ? <span className="role-pill pm">Manager</span> : m.role === 'VIEWER' && <span className="pill pill-outline">Viewer</span>}</div>)}
    </Card>
  );
}

function AboutCard({ p, burn }) {
  if (!p.objectives && !p.description && !burn?.hours) return null;
  const h = burn?.hours;
  return (
    <Card title={<span className="d-inline-flex align-items-center gap-2"><Target size={16} /> About this project</span>}>
      {p.objectives && <><div className="small-caps text-muted">Goal</div><p className="mb-2" style={{ whiteSpace: 'pre-wrap' }}>{p.objectives}</p></>}
      {p.description && <p className="small mb-2" style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p>}
      {h && <div className="small d-flex align-items-center gap-2 text-muted"><Clock size={14} /> {h.logged}h logged of {h.estimate}h estimated{h.billable ? ` (${h.billable}h billable)` : ''}</div>}
    </Card>
  );
}

function StaffOverview() {
  const { project: p, openItem, people } = useProject();
  const plan = useLoad(() => get(`/projects/${p.id}/plan`), [p.id, p.version]);
  const burn = useLoad(() => get(`/projects/${p.id}/burnup`), [p.id, p.version]);
  useLive((e) => e.type === 'work.changed' && e.projectId === p.id, () => { plan.reload({ silent: true }); burn.reload({ silent: true }); }, [p.id]);
  return (
    <div style={{ '--pc': projectColor(p.code) }}>
      <ErrorBox error={plan.error} onRetry={plan.reload} />
      {plan.loading && !plan.data ? <Loading rows={3} /> : <StatusBanner project={p} plan={plan.data} burn={burn.data} link />}
      <div className="row g-4">
        <div className="col-xl-8 d-flex flex-column gap-4">
          <NeedsAttention plan={plan.data} openItem={openItem} people={people} />
          <PhasesCard p={p} plan={plan.data} />
          <KeyDates p={p} plan={plan.data} openItem={openItem} />
        </div>
        <div className="col-xl-4 d-flex flex-column gap-4">
          <LatestUpdate p={p} />
          <AboutCard p={p} burn={burn.data} />
          <TeamCard p={p} />
        </div>
      </div>
    </div>
  );
}

/** Client view: progress, phases, key dates and the latest update — nothing internal. */
function ClientOverview() {
  const { project: p, openItem } = useProject();
  return (
    <div className="row g-4" style={{ '--pc': projectColor(p.code) }}>
      <div className="col-xl-8 d-flex flex-column gap-4">
        <div className="row g-3">
          <div className="col-4"><div className="tile violet"><div className="label">Work done</div><div className="value">{p.progress == null ? '—' : `${Math.round(p.progress)}%`}</div></div></div>
          <div className="col-4"><div className="tile blue"><div className="label">Target end date</div><div className="value sm">{fmtDate(p.plannedFinish)}</div></div></div>
          <div className="col-4"><div className="tile orange"><div className="label">Milestones reached</div><div className="value">{p.milestones.done} of {p.milestones.total}</div></div></div>
        </div>
        {p.objectives && <Card title={<span className="d-inline-flex align-items-center gap-2"><Target size={17} /> Goal</span>}><p className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{p.objectives}</p></Card>}
        <PhasesCard p={p} plan={null} />
      </div>
      <div className="col-xl-4 d-flex flex-column gap-4">
        <LatestUpdate p={p} />
        <KeyDates p={p} plan={null} openItem={openItem} />
      </div>
    </div>
  );
}

export function Overview() {
  const { isCustomer } = useAuth();
  return isCustomer ? <ClientOverview /> : <StaffOverview />;
}
