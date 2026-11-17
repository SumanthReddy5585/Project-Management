import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { get, download } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { fmtDate, fmtHours, fmtMoney, labelize } from '../lib/format.js';
import { Card, Empty, ErrorBox, HealthBadge, Loading, Meter, Pill, ProjectDot, useToast } from '../components/ui.jsx';
import { BarChart, PALETTE } from '../components/BarChart.jsx';

export default function Reports() {
  const toast = useToast();
  const { data: d, error, loading, reload } = useLoad(() => get('/dashboard'), []);
  const wl = useLoad(() => get('/workload'), []);
  if (loading && !d) return <Loading rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const p = d.portfolio || [];
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">Reports</h1><div className="sub">How projects, people and requests are doing.</div></div>
        <button className="btn btn-light" onClick={() => download('/reports/portfolio.csv', 'portfolio.csv').catch((e) => toast(e.message, 'error'))}><Download size={15} /> Download CSV</button></div>
      <Card title="Projects" className="mb-4" bodyClass="p-0">{p.length === 0 ? <Empty title="No active projects" /> : <div className="table-wrap"><table className="table table-hover">
        <thead><tr><th>Project</th><th>Status</th><th style={{ width: 180 }}>Progress</th><th>Finish</th><th title={d.definitions.scheduleVariance}>Delay</th><th>Hours (planned / spent)</th><th>Budget used</th></tr></thead>
        <tbody>{p.map((x) => <tr key={x.id}>
          <td><Link to={`/projects/${x.id}`} className="fw-bold text-body d-inline-flex align-items-center gap-2"><ProjectDot code={x.code} />{x.name}</Link><div className="small text-muted">{x.customer || 'Internal'}</div></td>
          <td><HealthBadge health={x.health} /></td><td><Meter value={x.progress} /></td><td className="small">{fmtDate(x.plannedFinish)}</td>
          <td className="small">{x.scheduleVarianceDays == null ? <span className="text-muted" title="Save a baseline on the timeline to track delays">—</span> : x.scheduleVarianceDays > 0 ? <Pill tone="risk">{x.scheduleVarianceDays} days late</Pill> : <Pill tone="ok">On time</Pill>}</td>
          <td className="small">{fmtHours(x.estimateHours)} / {fmtHours(x.actualHours)}</td>
          <td className="small">{x.budget ? <>{fmtMoney(x.budget.consumed ?? 0, x.budget.currency)} <span className="text-muted">of {fmtMoney(x.budget.amount, x.budget.currency)}</span></> : <span className="text-muted">—</span>}</td></tr>)}</tbody></table></div>}</Card>
      <div className="row g-4 mb-4">
        <div className="col-lg-6"><Card title="Planned vs spent hours">{p.length ? <BarChart horizontal label="Planned versus spent hours by project" axisTitle="Hours" labels={p.map((x) => x.code)} series={[{ name: 'Planned', data: p.map((x) => x.estimateHours), color: PALETTE.steel }, { name: 'Spent', data: p.map((x) => x.actualHours), color: PALETTE.sky }]} /> : <Empty title="No data yet" />}</Card></div>
        <div className="col-lg-6"><Card title="Requests by status"><BarChart height={260} label="Requests by status" axisTitle="Requests" labels={['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'].map(labelize)} series={[{ name: 'Requests', data: ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'].map((s) => d.tickets.byStatus[s] || 0), color: PALETTE.steel }]} /></Card></div>
      </div>
      <Card title="Team workload · next two weeks" className="mb-4">
        {wl.data?.data.length ? <><BarChart height={Math.max(220, wl.data.data.length * 40)} horizontal label="Planned hours against available hours" axisTitle="Hours" labels={wl.data.data.map((w) => w.name)} series={[{ name: 'Available', data: wl.data.data.map((w) => w.capacityHours), color: PALETTE.pale }, { name: 'Planned', data: wl.data.data.map((w) => w.plannedHours), colors: wl.data.data.map((w) => (w.state === 'OVER' ? PALETTE.risk : PALETTE.steel)) }]} />
          <div className="form-text mt-2">Planned = remaining estimated hours of assigned tasks in this period. Tasks without an estimate aren't counted.</div></> : <Loading rows={2} />}
      </Card>
      <Card title="Request response times">
        <BarChart height={200} horizontal stacked label="Requests meeting their response and resolution targets" axisTitle="Requests" labels={['First reply', 'Resolution']} series={[['MET', PALETTE.ok], ['ON_TRACK', PALETTE.sky], ['AT_RISK', PALETTE.warn], ['BREACHED', PALETTE.risk], ['PAUSED', PALETTE.slate]].map(([s, color]) => ({ name: labelize(s), color, data: [d.tickets.sla.response[s], d.tickets.sla.resolution[s]] }))} />
        <div className="form-text">{d.tickets.slaWindow}. Measured in working hours.</div>
      </Card>
    </>
  );
}
