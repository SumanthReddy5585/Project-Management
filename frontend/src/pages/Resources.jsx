import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api/client.js';
import { useLoad, useDebounced } from '../lib/hooks.js';
import { addDaysISO, fmtHours, fmtRelative, mondayOf, todayISO, labelize } from '../lib/format.js';
import { Card, Empty, ErrorBox, Loading, Notice, PageHeader, Pagination, Pill, Avatar } from '../components/ui.jsx';
import { BarChart, PALETTE } from '../components/BarChart.jsx';

export function Workload() {
  const [from, setFrom] = useState(mondayOf(todayISO()));
  const [to, setTo] = useState(addDaysISO(mondayOf(todayISO()), 13));
  const { data, error, loading } = useLoad(() => get('/workload', { from, to }), [from, to]);
  return (
    <>
      <PageHeader title="Workload & capacity" sub={data?.method} />
      <div className="filters"><label className="small fw-semibold" htmlFor="wf">From</label><input id="wf" type="date" className="form-control form-control-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label className="small fw-semibold" htmlFor="wt">To</label><input id="wt" type="date" className="form-control form-control-sm" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && <>
        <Card title="Planned vs capacity" className="mb-3">{data.data.length ? <BarChart horizontal height={Math.max(220, data.data.length * 40)} label="Planned hours against capacity per person" axisTitle="Hours" labels={data.data.map((w) => w.name)} series={[{ name: 'Capacity', data: data.data.map((w) => w.capacityHours), color: PALETTE.pale }, { name: 'Planned (remaining estimate)', data: data.data.map((w) => w.plannedHours), colors: data.data.map((w) => (w.state === 'OVER' ? PALETTE.risk : PALETTE.steel)) }, { name: 'Logged', data: data.data.map((w) => w.loggedHours), color: PALETTE.ok }]} /> : <Empty title="No people" />}</Card>
        <div className="card"><table className="table"><thead><tr><th>Person</th><th className="text-end">Capacity</th><th className="text-end">Planned</th><th className="text-end">Utilization</th><th className="text-end">Logged</th><th>Unestimated</th></tr></thead>
          <tbody>{data.data.map((w) => <tr key={w.userId}><td><div className="fw-medium">{w.name}</div><div className="small text-muted">{w.title}</div></td><td className="text-end">{fmtHours(w.capacityHours)}</td><td className="text-end">{fmtHours(w.plannedHours)}</td>
            <td className="text-end"><Pill tone={w.state === 'OVER' ? 'risk' : w.state === 'FULL' ? 'warn' : w.state === 'IDLE' ? 'outline' : 'ok'}>{Number.isFinite(w.pct) ? `${w.pct}%` : 'No capacity'}</Pill></td><td className="text-end">{fmtHours(w.loggedHours)}</td>
            <td className="small">{w.unestimatedTasks ? `${w.unestimatedTasks} task(s) without estimates — not counted` : ''}</td></tr>)}</tbody></table></div>
      </>}
    </>
  );
}

export function People() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, error, loading } = useLoad(() => get('/org/members', { q: dq || undefined, page, pageSize: 30 }), [dq, page]);
  const teams = useLoad(() => get('/org/teams'), []);
  return (
    <>
      <PageHeader title="People" sub="Directory of your organization's members, teams and skills." />
      <div className="row g-3">
        <div className="col-lg-8"><div className="filters"><input className="form-control form-control-sm" style={{ maxWidth: 280 }} placeholder="Search by name or email" aria-label="Search people" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <ErrorBox error={error} />
          <div className="card">{loading && !data ? <div className="p-3"><Loading /></div> : <table className="table"><thead><tr><th>Name</th><th>Role</th><th>Teams</th><th>Skills</th><th className="text-end">Hours / week</th></tr></thead>
            <tbody>{data?.data.map((m) => <tr key={m.userId}><td><div className="d-flex gap-2 align-items-center"><Avatar name={m.name} /><div><div className="fw-medium">{m.name}</div><div className="small text-muted">{m.title || m.email}</div></div></div></td>
              <td><Pill>{labelize(m.role)}</Pill>{m.customerCompany && <div className="small text-muted">{m.customerCompany.name}</div>}</td><td className="small">{m.teams.map((t) => t.name).join(', ')}</td>
              <td className="small">{m.skills.map((s) => <span key={s} className="pill pill-outline me-1">{s}</span>)}</td><td className="text-end">{m.role === 'CUSTOMER' ? '—' : m.weeklyCapacityHours}</td></tr>)}</tbody></table>}
            <Pagination meta={data?.meta} onPage={setPage} /></div></div>
        <div className="col-lg-4"><Card title="Teams">{teams.data?.data.length === 0 ? <div className="small text-muted">No teams yet.</div> : <ul className="list-plain">{teams.data?.data.map((t) => <li key={t.id} className="d-block"><div className="fw-semibold">{t.name}</div><div className="small text-muted">{t.members.map((m) => m.name).join(', ') || 'No members'}</div></li>)}</ul>}</Card></div>
      </div>
    </>
  );
}

export function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => get('/notifications', { page, unread: unread ? 'true' : undefined }), [page, unread]);
  return (
    <>
      <PageHeader title="Notifications" actions={<button className="btn btn-light" onClick={async () => { await post('/notifications/read-all'); reload(); }}>Mark all read</button>} />
      <Notice tone="warn">Email delivery is not configured for this installation. Notifications are stored and shown in the app only.</Notice>
      <div className="form-check my-3"><input className="form-check-input" type="checkbox" id="un" checked={unread} onChange={(e) => { setUnread(e.target.checked); setPage(1); }} /><label className="form-check-label" htmlFor="un">Unread only</label></div>
      <ErrorBox error={error} />
      <div className="card">{loading && !data ? <div className="p-3"><Loading /></div> : data?.data.length === 0 ? <Empty title="No notifications" /> : <ul className="list-plain px-3">{data.data.map((n) => (
        <li key={n.id}><span className={`dot ${n.readAt ? '' : 'dot-GREEN'}`} style={{ background: n.readAt ? 'var(--slate-200)' : 'var(--steel-500)' }} />
          <button className="btn btn-link p-0 text-start flex-grow-1 text-body" onClick={async () => { if (!n.readAt) await post(`/notifications/${n.id}/read`); if (n.link) nav(n.link.replace(/\/work\/([0-9a-f-]{36})$/, '/work?item=$1')); else reload(); }}>
            <div className={n.readAt ? '' : 'fw-semibold'}>{n.title}</div>{n.body && <div className="small text-muted">{n.body}</div>}</button><span className="small text-muted text-nowrap">{fmtRelative(n.createdAt)}</span></li>))}</ul>}
        <Pagination meta={data?.meta} onPage={setPage} /></div>
    </>
  );
}
