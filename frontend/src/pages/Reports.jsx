import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Inbox, ShieldCheck, Timer, Smile, CheckCircle2, Clock } from 'lucide-react';
import { get, download } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { fmtDate, fmtHours, fmtMoney, labelize, fmtHoursShort } from '../lib/format.js';
import { Avatar, Card, Empty, ErrorBox, HealthBadge, Loading, Meter, Pill, ProjectDot, Segmented, useToast } from '../components/ui.jsx';
import { BarChart, LineChart, PALETTE } from '../components/BarChart.jsx';
import { Tile } from './Home.jsx';

function SupportReport() {
  const toast = useToast();
  const { data: s, error, loading, reload } = useLoad(() => get('/tickets/stats'), []);
  const dash = useLoad(() => get('/dashboard'), []);
  useLive((e) => e.type.startsWith('ticket'), () => { reload({ silent: true }); dash.reload({ silent: true }); });
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !s) return <Loading rows={6} />;
  const days = s.trend.days.map((x) => new Date(`${x}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  const sla = dash.data?.tickets?.sla;
  return (
    <>
      <div className="d-flex justify-content-end mb-3"><button className="btn btn-light" onClick={() => download('/tickets/export.csv?view=all', 'tickets.csv').catch((e) => toast(e.message, 'error'))}><Download size={15} /> Export all tickets (CSV)</button></div>
      <div className="row g-3 mb-3">
        <div className="col-6 col-xl-2"><Tile tone="blue" icon={Inbox} label="Open now" value={s.open} hint={`${s.unassigned} unassigned`} /></div>
        <div className="col-6 col-xl-2"><Tile tone="green" icon={CheckCircle2} label="Resolved (30d)" value={s.resolved30} /></div>
        <div className="col-6 col-xl-2"><Tile tone="cyan" icon={Timer} label="Avg first reply" value={fmtHoursShort(s.avgFirstResponseHours)} hint="Calendar time" /></div>
        <div className="col-6 col-xl-2"><Tile tone="violet" icon={Clock} label="Avg resolution" value={fmtHoursShort(s.avgResolutionHours)} hint="Calendar time" /></div>
        <div className="col-6 col-xl-2"><Tile tone="green" icon={ShieldCheck} label="SLA met (30d)" value={s.slaCompliance == null ? '—' : `${Math.round(s.slaCompliance * 100)}%`} /></div>
        <div className="col-6 col-xl-2"><Tile tone="orange" icon={Smile} label="CSAT (90d)" value={s.csat.average == null ? '—' : `${s.csat.average.toFixed(1)}/5`} hint={`${s.csat.count} ratings`} /></div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-xl-8"><Card title="Created vs resolved — last 14 days"><LineChart label="Tickets created and resolved per day" labels={days} series={[{ name: 'Created', data: s.trend.created, color: PALETTE.steel }, { name: 'Resolved', data: s.trend.resolved, color: PALETTE.ok }]} height={250} /></Card></div>
        <div className="col-xl-4"><Card title="Open tickets by priority"><BarChart height={250} label="Open tickets by priority" labels={['Urgent', 'High', 'Normal', 'Low']} series={[{ name: 'Open', data: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((k) => s.byPriority[k]), colors: [PALETTE.risk, PALETTE.warn, PALETTE.steel, PALETTE.slate] }]} legend={false} /></Card></div>
      </div>
      <div className="row g-3">
        <div className="col-xl-6"><Card title="Agent performance" bodyClass="p-0">{s.agents.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Agent</th><th className="text-end">Open</th><th className="text-end">Resolved (30d)</th></tr></thead>
          <tbody>{s.agents.map((a) => <tr key={a.id}><td><span className="d-inline-flex align-items-center gap-2"><Avatar sm name={a.name} />{a.name}</span></td><td className="text-end num">{a.open}</td><td className="text-end num">{a.resolved}</td></tr>)}</tbody></table></div> : <Empty title="No assigned tickets yet" />}</Card></div>
        <div className="col-xl-6"><Card title="SLA status of open and recent tickets">
          {sla ? <BarChart height={200} horizontal stacked label="Tickets meeting their response and resolution targets" axisTitle="Tickets" labels={['First reply', 'Resolution']} series={[['MET', PALETTE.ok], ['ON_TRACK', PALETTE.sky], ['AT_RISK', PALETTE.warn], ['BREACHED', PALETTE.risk], ['PAUSED', PALETTE.slate]].map(([k, color]) => ({ name: labelize(k), color, data: [sla.response[k], sla.resolution[k]] }))} /> : <Loading rows={2} />}
          <div className="form-text">{dash.data?.tickets?.slaWindow}. Targets count working hours.</div>
        </Card></div>
      </div>
    </>
  );
}

function DeliveryReport() {
  const toast = useToast();
  const { data: d, error, loading, reload } = useLoad(() => get('/dashboard'), []);
  const wl = useLoad(() => get('/workload'), []);
  if (loading && !d) return <Loading rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const p = d.portfolio || [];
  return (
    <>
      <div className="d-flex justify-content-end mb-3"><button className="btn btn-light" onClick={() => download('/reports/portfolio.csv', 'portfolio.csv').catch((e) => toast(e.message, 'error'))}><Download size={15} /> Portfolio CSV</button></div>
      <Card title="Project portfolio" className="mb-3" bodyClass="p-0">{p.length === 0 ? <Empty title="No active projects" /> : <div className="table-wrap"><table className="table table-hover">
        <thead><tr><th>Project</th><th>Health</th><th style={{ width: 180 }}>Progress</th><th>Finish</th><th title={d.definitions.scheduleVariance}>Schedule</th><th>Hours (planned / spent)</th><th>Budget used</th></tr></thead>
        <tbody>{p.map((x) => <tr key={x.id}>
          <td><Link to={`/projects/${x.id}`} className="fw-semibold text-body d-inline-flex align-items-center gap-2"><ProjectDot code={x.code} />{x.name}</Link><div className="small text-muted">{x.customer || 'Internal'}</div></td>
          <td><HealthBadge health={x.health} /></td><td><Meter value={x.progress} /></td><td className="small">{fmtDate(x.plannedFinish)}</td>
          <td className="small">{x.scheduleVarianceDays == null ? <span className="text-muted" title="Save a baseline on the timeline to track delays">No baseline</span> : x.scheduleVarianceDays > 0 ? <Pill tone="risk">{x.scheduleVarianceDays} days late</Pill> : <Pill tone="ok">On time</Pill>}</td>
          <td className="small num">{fmtHours(x.estimateHours)} / {fmtHours(x.actualHours)}</td>
          <td className="small">{x.budget ? <>{fmtMoney(x.budget.consumed ?? 0, x.budget.currency)} <span className="text-muted">of {fmtMoney(x.budget.amount, x.budget.currency)}</span></> : <span className="text-muted">—</span>}</td></tr>)}</tbody></table></div>}</Card>
      <div className="row g-3">
        <div className="col-xl-5"><Card title="Planned vs spent hours">{p.length ? <BarChart horizontal label="Planned versus spent hours by project" axisTitle="Hours" labels={p.map((x) => x.code)} series={[{ name: 'Planned', data: p.map((x) => x.estimateHours), color: PALETTE.steel }, { name: 'Spent', data: p.map((x) => x.actualHours), color: PALETTE.sky }]} /> : <Empty title="No data yet" />}</Card></div>
        <div className="col-xl-7"><Card title="Team capacity — next two weeks">
          {wl.data?.data.length ? <><BarChart height={Math.max(220, wl.data.data.length * 40)} horizontal label="Planned hours against available hours" axisTitle="Hours" labels={wl.data.data.map((w) => w.name)} series={[{ name: 'Available', data: wl.data.data.map((w) => w.capacityHours), color: PALETTE.pale }, { name: 'Planned', data: wl.data.data.map((w) => w.plannedHours), colors: wl.data.data.map((w) => (w.state === 'OVER' ? PALETTE.risk : PALETTE.steel)) }]} />
            <div className="form-text mt-2">Planned = remaining estimated hours of assigned tasks in this period. Red = more work than time.</div></> : <Loading rows={2} />}
        </Card></div>
      </div>
    </>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('delivery');
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">Reports</h1><div className="sub">Delivery health, team capacity and support performance. Figures update live.</div></div>
        <Segmented label="Report" value={tab} onChange={setTab} options={[['delivery', 'Projects & capacity'], ['support', 'Support desk']]} /></div>
      {tab === 'support' ? <SupportReport /> : <DeliveryReport />}
    </>
  );
}
