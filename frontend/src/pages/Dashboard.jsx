import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BarChart3, CheckCircle2, Clock, FolderKanban, Inbox, LifeBuoy, Sparkles, Timer, TrendingDown, TrendingUp, Users, Flag, CalendarDays, Target, Plus } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { labelize, projectColor } from '../lib/format.js';
import { Avatar, Empty, ErrorBox, Loading, ProjectChip } from '../components/ui.jsx';
import { LineChart } from '../components/BarChart.jsx';
import { PanelCard, RecentActivity } from './Home.jsx';

/* ---------- small SVG visuals (no data invented: every shape is drawn from API numbers) ---------- */

export function Ring({ value, size = 92, stroke = 9, color = '#fff', track = 'rgba(255,255,255,0.18)', children }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-arc" />
      </svg>
      <div className="ring-c">{children}</div>
    </div>
  );
}

function Sparkline({ data, color = '#0a3df0', height = 44, width = 160 }) {
  if (!data?.length) return null;
  const max = Math.max(1, ...data); const step = data.length > 1 ? width / (data.length - 1) : width;
  const pts = data.map((v, i) => [i * step, height - 4 - (v / max) * (height - 8)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const id = `sg${color.replace('#', '')}`;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.28" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MiniBars({ data, color = '#0a3df0', labels }) {
  const max = Math.max(1, ...data);
  return <div className="mini-bars" aria-hidden="true">{data.map((v, i) => <span key={i} title={labels?.[i] ? `${labels[i]}: ${v} h` : `${v}`} style={{ height: `${Math.max(4, (v / max) * 100)}%`, background: i === data.length - 1 ? color : `${color}55` }} />)}</div>;
}

function Delta({ now, before, invert }) {
  if (before == null || (now === 0 && before === 0)) return <span className="delta flat">no change</span>;
  const diff = now - before; const up = diff > 0;
  const good = invert ? !up : up;
  if (diff === 0) return <span className="delta flat">same as last week</span>;
  return <span className={`delta ${good ? 'good' : 'bad'}`}>{up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{up ? '+' : ''}{diff} vs last week</span>;
}

const HEALTH = [['GREEN', 'On track', '#16a34a'], ['AMBER', 'At risk', '#f59e0b'], ['RED', 'Off track', '#e11d48']];
const SCHED = { AHEAD: ['Ahead', '#3b82f6'], ON_TRACK: ['On schedule', '#16a34a'], AT_RISK: ['At risk', '#f59e0b'], DELAYED: ['Running late', '#e11d48'], COMPLETED: ['Completed', '#a1a1aa'] };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function SegDonut({ parts, size = 168, stroke = 22, center, sub }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r; let off = 0;
  return (
    <div className="seg-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map((p) => `${p.name}: ${p.value}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f1f3" strokeWidth={stroke} />
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => { const len = (p.value / total) * c; const gap = parts.filter((x) => x.value > 0).length > 1 ? 3 : 0; const el = <circle key={p.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke} strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />; off += len; return el; })}
      </svg>
      <div className="ring-c"><b>{center}</b><small>{sub}</small></div>
    </div>
  );
}

/* ---------- sections ---------- */

function Hero({ user, ps, stats, myTasks, manager }) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const planned = ps.filter((p) => p.schedule);
  const onSched = planned.filter((p) => ['AHEAD', 'ON_TRACK', 'COMPLETED'].includes(p.schedule.status)).length;
  const active = ps.filter((p) => p.status !== 'DRAFT');
  const avg = active.length ? Math.round(active.reduce((a, p) => a + (p.progress || 0), 0) / active.length) : null;
  const sla = stats?.slaCompliance == null ? null : Math.round(stats.slaCompliance * 100);
  const attention = active.filter((p) => p.health !== 'GREEN').length;
  const overdue = myTasks.filter((t) => t.overdue).length;
  const line = overdue ? `You have ${overdue} overdue task${overdue > 1 ? 's' : ''} — worth a look first.` : attention ? `${attention} of ${active.length} projects need attention today.` : 'Every project is on track. Nice work.';
  return (
    <section className="hero">
      <div className="hero-l">
        <div className="hero-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>{greet}, {user?.name?.split(' ')[0]}</h1>
        <p>{line}</p>
        <div className="hero-chips">
          <span><FolderKanban size={14} /> {active.length} projects in flight</span>
          <span><CheckCircle2 size={14} /> {myTasks.length} open tasks for you</span>
          {stats && <span><Inbox size={14} /> {stats.open} open tickets</span>}
        </div>
        <div className="hero-actions">
          <Link to="/my-tasks" className="btn btn-hero">My tasks</Link>
          {manager ? <Link to="/reports" className="btn btn-hero-ghost"><BarChart3 size={15} /> Open reports</Link> : <Link to="/tickets?new=1" className="btn btn-hero-ghost"><LifeBuoy size={15} /> New ticket</Link>}
        </div>
      </div>
      <div className="hero-r">
        <div className="hero-ring"><Ring value={planned.length ? (onSched / planned.length) * 100 : 0} color="#86efac"><b>{planned.length ? Math.round((onSched / planned.length) * 100) : '—'}<small>%</small></b></Ring><span>On schedule</span><small>{onSched} of {planned.length} approved plans</small></div>
        <div className="hero-ring"><Ring value={avg} color="#93c5fd"><b>{avg ?? '—'}<small>%</small></b></Ring><span>Work done</span><small>Average across projects</small></div>
        <div className="hero-ring"><Ring value={sla} color="#fcd34d"><b>{sla ?? '—'}<small>{sla == null ? '' : '%'}</small></b></Ring><span>SLA met</span><small>Tickets · last 30 days</small></div>
      </div>
    </section>
  );
}

function TrendCards({ stats, time, d, manager }) {
  const created = stats?.trend.created || []; const resolved = stats?.trend.resolved || [];
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const tasks = d.myTasks;
  const byStatus = [['TODO', 'To do', '#a1a1aa'], ['IN_PROGRESS', 'In progress', '#0a3df0'], ['IN_REVIEW', 'In review', '#8b5cf6'], ['BLOCKED', 'Blocked', '#e11d48']].map(([k, n, c]) => [n, tasks.filter((t) => t.status === k).length, c]);
  const weeks = time?.weeks || [];
  const wkHours = weeks.map((w) => Math.round((w.billable + w.nonBillable) * 10) / 10);
  return (
    <div className="trend-grid">
      <Link to="/tickets" className="trend-card">
        <div className="tc-top"><span className="ic-tile sm t-blue"><Inbox size={15} /></span><span className="tc-label">Tickets raised</span><span className="tc-period">14 days</span></div>
        <div className="tc-mid"><div><div className="tc-value">{sum(created)}</div><Delta now={sum(created.slice(7))} before={sum(created.slice(0, 7))} invert /></div><Sparkline data={created} color="#0a3df0" /></div>
      </Link>
      <Link to="/tickets?view=all" className="trend-card">
        <div className="tc-top"><span className="ic-tile sm t-green"><CheckCircle2 size={15} /></span><span className="tc-label">Tickets resolved</span><span className="tc-period">14 days</span></div>
        <div className="tc-mid"><div><div className="tc-value">{sum(resolved)}</div><Delta now={sum(resolved.slice(7))} before={sum(resolved.slice(0, 7))} /></div><Sparkline data={resolved} color="#16a34a" /></div>
      </Link>
      <Link to="/time" className="trend-card">
        <div className="tc-top"><span className="ic-tile sm t-amber"><Timer size={15} /></span><span className="tc-label">{manager ? 'Hours logged' : 'Hours this week'}</span><span className="tc-period">{manager ? '8 weeks' : labelize(d.timesheet.status)}</span></div>
        <div className="tc-mid">{manager && weeks.length ? <><div><div className="tc-value">{Math.round(time.totals.hours).toLocaleString()}<small>h</small></div><span className="delta flat">{Math.round((time.totals.billable / Math.max(1, time.totals.hours)) * 100)}% billable</span></div><MiniBars data={wkHours} color="#d97706" labels={weeks.map((w) => w.week)} /></>
          : <div><div className="tc-value">{Number(d.timesheet.hours || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}<small>h</small></div><span className="delta flat">Timesheet {labelize(d.timesheet.status).toLowerCase()}</span></div>}</div>
      </Link>
      <Link to="/my-tasks" className="trend-card">
        <div className="tc-top"><span className="ic-tile sm t-violet"><Target size={15} /></span><span className="tc-label">My open work</span><span className="tc-period">{d.upcoming.length} due soon</span></div>
        <div className="tc-mid col"><div className="tc-value">{tasks.length}<small>tasks</small></div>
          <div className="stack-bar">{tasks.length ? byStatus.filter((b) => b[1]).map(([n, v, c]) => <span key={n} title={`${n}: ${v}`} style={{ flex: v, background: c }} />) : <span style={{ flex: 1, background: '#f1f1f3' }} />}</div>
          <div className="stack-legend">{byStatus.filter((b) => b[1]).map(([n, v, c]) => <span key={n}><i style={{ background: c }} />{n} {v}</span>)}{!tasks.length && <span className="text-muted">Nothing assigned right now</span>}</div></div>
      </Link>
    </div>
  );
}

function PortfolioTimeline({ ps, manager }) {
  const today = iso(new Date());
  const rows = ps.filter((p) => p.plannedStart && p.plannedFinish).sort((a, b) => a.plannedFinish.localeCompare(b.plannedFinish)).slice(0, 10);
  const from = addDays(today, -28); const to = addDays(today, 84); const span = dayDiff(from, to);
  const x = (dte) => Math.max(0, Math.min(100, (dayDiff(from, dte) / span) * 100));
  const months = []; { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); while (iso(d) < to) { months.push(iso(d)); d.setUTCMonth(d.getUTCMonth() + 1); } }
  return (
    <PanelCard title="Portfolio timeline" tools={<><span className="small text-muted d-none d-md-inline">Bars = plan · fill = work done · ▲ = where the plan expects you today</span>{manager && <Link to="/projects?new=1" className="btn-square" aria-label="New project" title="New project"><Plus size={15} /></Link>}</>}>
      {rows.length === 0 ? <Empty icon={FolderKanban} title="No scheduled projects yet" /> : (
        <div className="ptl">
          <div className="ptl-axis"><div className="ptl-name" /><div className="ptl-track">{months.map((m) => <span key={m} style={{ left: `${x(m)}%` }}>{new Date(`${m}T00:00:00`).toLocaleDateString(undefined, { month: 'short' })}</span>)}<span className="today-lbl" style={{ left: `${x(today)}%` }}>Today</span></div><div className="ptl-pct" /></div>
          {rows.map((p) => {
            const l = x(p.plannedStart); const r = x(p.plannedFinish); const w = Math.max(1.5, r - l);
            const hc = HEALTH.find((h) => h[0] === p.health)?.[2] || '#a1a1aa';
            const color = p.status === 'DRAFT' ? '#a1a1aa' : projectColor(p.code);
            const expected = p.schedule?.plannedPct;
            const s = p.schedule ? SCHED[p.schedule.status] : null;
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="ptl-row" title={`${p.name}: ${Math.round(p.progress || 0)}% done${expected != null ? `, plan expects ${Math.round(expected)}%` : ''}`}>
                <div className="ptl-name"><ProjectChip code={p.code} size={24} /><span className="truncate">{p.name}</span></div>
                <div className="ptl-track">
                  {months.map((m) => <i key={m} className="grid" style={{ left: `${x(m)}%` }} />)}
                  <i className="now" style={{ left: `${x(today)}%` }} />
                  <span className={`ptl-bar ${p.plannedStart < from ? 'cut-l' : ''} ${p.plannedFinish > to ? 'cut-r' : ''}`} style={{ left: `${l}%`, width: `${w}%`, '--c': color }}>
                    <span className="fill" style={{ width: `${Math.min(100, p.progress || 0)}%` }} />
                    {expected != null && p.status !== 'DRAFT' && <span className="exp" style={{ left: `${Math.min(100, expected)}%` }} />}
                  </span>
                </div>
                <div className="ptl-pct"><b>{Math.round(p.progress || 0)}%</b>{p.status === 'DRAFT' ? <small className="text-muted">Planning</small> : s ? <small style={{ color: s[1] }}>{s[0]}</small> : <small style={{ color: hc }}>{labelize(p.health)}</small>}</div>
              </Link>
            );
          })}
        </div>)}
    </PanelCard>
  );
}

function HealthPanel({ ps }) {
  const active = ps.filter((p) => p.status !== 'DRAFT');
  const parts = HEALTH.map(([k, name, color]) => ({ name, color, value: active.filter((p) => p.health === k).length })).concat([{ name: 'In planning', color: '#d4d4d8', value: ps.filter((p) => p.status === 'DRAFT').length }]);
  const sched = Object.entries(SCHED).map(([k, [name, color]]) => ({ name, color, value: ps.filter((p) => p.schedule?.status === k).length })).filter((x) => x.value);
  const late = [...active].filter((p) => p.counts?.overdue).sort((a, b) => b.counts.overdue - a.counts.overdue).slice(0, 3);
  return (
    <PanelCard title="Delivery health" tools={<Link to="/projects" className="btn-square" aria-label="All projects" title="All projects"><ArrowUpRight size={15} /></Link>}>
      <div className="health-wrap">
        <SegDonut parts={parts} center={ps.length} sub="projects" />
        <ul className="legend-list">{parts.map((p) => <li key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span><b>{p.value}</b></li>)}</ul>
      </div>
      {sched.length > 0 && <><div className="mini-h">Against approved plans</div><div className="stack-bar tall">{sched.map((s) => <span key={s.name} title={`${s.name}: ${s.value}`} style={{ flex: s.value, background: s.color }} />)}</div>
        <div className="stack-legend">{sched.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name} {s.value}</span>)}</div></>}
      {late.length > 0 && <><div className="mini-h">Most late tasks</div>{late.map((p) => <Link key={p.id} to={`/projects/${p.id}/list`} className="late-row"><ProjectChip code={p.code} size={22} /><span className="truncate">{p.name}</span><b>{p.counts.overdue} late</b></Link>)}</>}
    </PanelCard>
  );
}

function SupportPulse({ stats }) {
  if (!stats) return <PanelCard title="Support pulse"><Loading rows={4} /></PanelCard>;
  const days = stats.trend.days.map((x) => new Date(`${x}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  const sla = stats.slaCompliance == null ? null : Math.round(stats.slaCompliance * 100);
  return (
    <PanelCard title="Support pulse" tools={<Link to="/tickets" className="btn btn-sm btn-light">Queue</Link>}>
      <div className="pulse-top">
        <Ring value={sla} size={74} stroke={8} color="#16a34a" track="#f1f1f3"><b className="dark">{sla ?? '—'}<small>{sla == null ? '' : '%'}</small></b></Ring>
        <div className="pulse-stats">
          <div><b>{stats.open}</b><small>Open</small></div>
          <div className={stats.breached ? 'bad' : ''}><b>{stats.breached}</b><small>Breached</small></div>
          <div><b>{stats.csat.average == null ? '—' : stats.csat.average.toFixed(1)}</b><small>Client rating</small></div>
        </div>
      </div>
      <LineChart height={170} label="Tickets created and resolved per day, last 14 days" labels={days} series={[{ name: 'Created', data: stats.trend.created, color: '#0a3df0' }, { name: 'Resolved', data: stats.trend.resolved, color: '#16a34a' }]} />
    </PanelCard>
  );
}

function TeamLoad({ wl }) {
  return (
    <PanelCard title="Team load" tools={<><span className="small text-muted">Next 2 weeks</span><Link to="/planner" className="btn btn-sm btn-light">Planner</Link></>}>
      {wl.length ? <div className="load-grid">{wl.slice(0, 8).map((w) => {
        const c = w.pct > 100 ? '#e11d48' : w.pct > 80 ? '#f59e0b' : '#16a34a';
        return <div key={w.userId} className="load-cell" title={`${w.name}: ${Math.round(w.plannedHours)} h planned of ${Math.round(w.capacityHours)} h`}>
          <Ring value={Math.min(100, w.pct)} size={64} stroke={5} color={c} track="#f1f1f3"><Avatar name={w.name} /></Ring>
          <b className="truncate">{w.name.split(' ')[0]}</b><small style={{ color: c }}>{Math.round(w.pct)}% booked</small>
        </div>; })}</div> : <Empty icon={Users} title="No assigned work with estimates yet" />}
      <div className="load-legend"><span><i style={{ background: '#16a34a' }} />Room to spare</span><span><i style={{ background: '#f59e0b' }} />Nearly full</span><span><i style={{ background: '#e11d48' }} />Overbooked</span></div>
    </PanelCard>
  );
}

function NextTwoWeeks({ d, ps }) {
  const today = iso(new Date());
  const days = [...Array(14)].map((_, i) => addDays(today, i));
  const events = [
    ...(d.milestones || []).map((m) => ({ id: m.id, date: m.date, kind: 'ms', title: m.title, sub: ps.find((p) => p.id === m.projectId)?.name || m.projectCode, to: `/projects/${m.projectId}/tasks?item=${m.id}` })),
    ...d.myTasks.filter((t) => t.plannedFinish).map((t) => ({ id: t.id, date: t.plannedFinish, kind: 'task', title: t.title, sub: t.key, to: `/projects/${t.projectId}/tasks?item=${t.id}` })),
  ];
  const overdue = events.filter((e) => e.date < today);
  const upcoming = events.filter((e) => e.date >= today && e.date <= days.at(-1)).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <PanelCard title="Next two weeks" tools={<span className="small text-muted d-inline-flex align-items-center gap-3"><span className="d-inline-flex align-items-center gap-1"><i className="dot-ms" />Milestone</span><span className="d-inline-flex align-items-center gap-1"><i className="dot-task" />My task</span></span>}>
      <div className="day-strip">{days.map((day) => {
        const evs = events.filter((e) => e.date === day); const dt = new Date(`${day}T00:00:00`); const we = [0, 6].includes(dt.getDay());
        return <div key={day} className={`day ${day === today ? 'today' : ''} ${we ? 'we' : ''}`} title={evs.map((e) => e.title).join('\n')}>
          <small>{dt.toLocaleDateString(undefined, { weekday: 'narrow' })}</small><b>{dt.getDate()}</b>
          <span className="pips">{evs.slice(0, 3).map((e) => <i key={e.id} className={e.kind === 'ms' ? 'dot-ms' : 'dot-task'} />)}</span>
        </div>; })}</div>
      {overdue.length > 0 && <div className="overdue-note"><Clock size={13} /> {overdue.length} item{overdue.length > 1 ? 's are' : ' is'} already past due</div>}
      {upcoming.length ? <ul className="row-list">{upcoming.slice(0, 5).map((e) => <li key={`${e.kind}${e.id}`}>
        <span className={`ic-tile sm ${e.kind === 'ms' ? 't-amber' : 't-blue'}`}>{e.kind === 'ms' ? <Flag size={14} /> : <CalendarDays size={14} />}</span>
        <div className="r-main"><Link to={e.to} className="r-title">{e.title}</Link><div className="r-meta">{e.sub}</div></div>
        <span className="small text-muted text-nowrap">{new Date(`${e.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span></li>)}</ul>
        : <Empty icon={Sparkles} title="Nothing due in the next two weeks" />}
    </PanelCard>
  );
}

export default function StaffDashboard() {
  const { user, role } = useAuth();
  const manager = ['ADMIN', 'MANAGER'].includes(role);
  const dash = useLoad(() => get('/dashboard'), []);
  const projects = useLoad(() => get('/projects', { status: 'ACTIVE,ON_HOLD,DRAFT', pageSize: 50, sort: 'plannedFinish', dir: 'asc' }), []);
  const stats = useLoad(() => get('/tickets/stats'), []);
  const time = useLoad(() => (manager ? get('/reports/time-summary', { weeks: 8 }) : Promise.resolve(null)), [manager]);
  useLive((e) => e.type === 'work.changed', () => { dash.reload({ silent: true }); projects.reload({ silent: true }); });
  useLive((e) => e.type.startsWith('ticket'), () => stats.reload({ silent: true }));
  const ps = useMemo(() => projects.data?.data || [], [projects.data]);
  if (dash.error) return <ErrorBox error={dash.error} onRetry={dash.reload} />;
  if (!dash.data || !projects.data) return <Loading rows={8} />;
  const d = dash.data;
  return (
    <div className="dash">
      <Hero user={user} ps={ps} stats={stats.data} myTasks={d.myTasks} manager={manager} />
      <TrendCards stats={stats.data} time={time.data} d={d} manager={manager} />
      <div className="row g-3 mb-3">
        <div className="col-xxl-8 col-xl-7"><PortfolioTimeline ps={ps} manager={manager} /></div>
        <div className="col-xxl-4 col-xl-5"><HealthPanel ps={ps} /></div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-xl-6"><SupportPulse stats={stats.data} /></div>
        <div className="col-xl-6">{manager ? <TeamLoad wl={d.workload || []} /> : <NextTwoWeeks d={d} ps={ps} />}</div>
      </div>
      <div className="row g-3">
        {manager && <div className="col-xl-6"><NextTwoWeeks d={d} ps={ps} /></div>}
        <div className={manager ? 'col-xl-6' : 'col-12'}><RecentActivity limit={6} /></div>
      </div>
    </div>
  );
}
