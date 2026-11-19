import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, ArrowUpRight, BarChart3, CalendarDays, CheckCircle2, Clock, Flag, FolderKanban, Gauge, Inbox, LifeBuoy, Plus, ShieldCheck, Sparkles, Star, Target, Timer, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { labelize, projectColor } from '../lib/format.js';
import { Avatar, Empty, ErrorBox, Loading, ProjectChip } from '../components/ui.jsx';
import { PanelCard, RecentActivity } from './Home.jsx';

/* ======================================================================================
   Chart primitives — hand-drawn SVG so every chart on the dashboard shares one look.
   Nothing is invented: every shape is drawn from API numbers.
   ====================================================================================== */

const fmt1 = (n) => Math.round(n * 10) / 10;
const dayLbl = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Smooth monotone curve through points (no overshoot below zero). */
function curve(p) {
  const n = p.length;
  if (n === 0) return '';
  if (n === 1) return `M${p[0][0]},${p[0][1]}`;
  const dx = []; const m = [];
  for (let i = 0; i < n - 1; i += 1) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / (dx[i] || 1); }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i += 1) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i += 1) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i]; const b = t[i + 1] / m[i]; const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${fmt1(p[0][0])},${fmt1(p[0][1])}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3;
    d += ` C${fmt1(p[i][0] + h)},${fmt1(p[i][1] + t[i] * h)} ${fmt1(p[i + 1][0] - h)},${fmt1(p[i + 1][1] - t[i + 1] * h)} ${fmt1(p[i + 1][0])},${fmt1(p[i + 1][1])}`;
  }
  return d;
}

function useWidth() {
  const ref = useRef(null);
  const [size, setSize] = useState([0, 0]);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setSize([Math.floor(e.contentRect.width), Math.floor(e.contentRect.height)]));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size[0], size[1]];
}

const niceMax = (v) => { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

/** Progress ring with a gradient arc. */
export function Ring({ value, size = 92, stroke = 9, color = '#fff', to, track = 'rgba(255,255,255,0.16)', glow, children }) {
  const id = useId().replace(/:/g, '');
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs><linearGradient id={`rg${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor={to || color} /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {v > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#rg${id})`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-arc" style={glow ? { filter: `drop-shadow(0 0 5px ${glow})` } : undefined} />}
      </svg>
      <div className="ring-c">{children}</div>
    </div>
  );
}

/** Small smooth area line with a highlighted last point. */
function Spark({ data, color = '#0a3df0', to, height = 40 }) {
  const id = useId().replace(/:/g, '');
  const [ref, w] = useWidth();
  const max = Math.max(1, ...(data || []));
  const pad = 5;
  const pts = (data || []).map((v, i) => [pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1), height - pad - (v / max) * (height - pad * 2 - 2)]);
  const line = w ? curve(pts) : '';
  const last = pts.at(-1);
  return (
    <div ref={ref} className="spark2" style={{ height }} aria-hidden="true">
      {w > 0 && data?.length > 0 && (
        <svg width={w} height={height}>
          <defs>
            <linearGradient id={`sf${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.32" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient>
            <linearGradient id={`sl${id}`} x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor={to || color} /></linearGradient>
          </defs>
          <path d={`${line} L${last[0]},${height} L${pts[0][0]},${height} Z`} fill={`url(#sf${id})`} />
          <path d={line} fill="none" stroke={`url(#sl${id})`} strokeWidth="2.25" strokeLinecap="round" />
          <circle cx={last[0]} cy={last[1]} r="6.5" fill={to || color} opacity="0.16" />
          <circle cx={last[0]} cy={last[1]} r="3.25" fill="#fff" stroke={to || color} strokeWidth="2" />
        </svg>
      )}
    </div>
  );
}

/** Vertical gradient bars; the last bar (this week) is emphasised. */
function Bars({ data, from, to, labels, unit = '' }) {
  const max = Math.max(1, ...data);
  return (
    <div className="bars2" aria-hidden="true">
      {data.map((v, i) => (
        <span key={i} title={`${labels?.[i] ?? ''}${labels ? ': ' : ''}${v}${unit}`} className={i === data.length - 1 ? 'cur' : ''}
          style={{ height: `${Math.max(6, (v / max) * 100)}%`, '--b1': from, '--b2': to }} />
      ))}
    </div>
  );
}

/** Donut with rounded, separated segments. */
function Donut({ parts, size = 176, stroke = 18, center, sub }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const shown = parts.filter((p) => p.value > 0);
  const gap = shown.length > 1 ? 3 : 0;
  let off = 0;
  return (
    <div className="donut2" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map((p) => `${p.name}: ${p.value}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        {total > 0 && shown.map((p) => {
          const len = (p.value / total) * c;
          const el = <circle key={p.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke} strokeDasharray={`${Math.max(0.01, len - gap)} ${c}`} strokeDashoffset={-(off + gap / 2)} transform={`rotate(-90 ${size / 2} ${size / 2})`}><title>{`${p.name}: ${p.value}`}</title></circle>;
          off += len; return el;
        })}
      </svg>
      <div className="ring-c"><b>{center}</b><small>{sub}</small></div>
    </div>
  );
}

/** Two-series smooth area chart with a hover guide. series: [{ name, data, color }] */
function AreaChart({ labels, series, minHeight = 230, label }) {
  const [ref, w, h] = useWidth();
  const height = Math.max(minHeight, h);
  const [hover, setHover] = useState(null);
  const L = 30; const R = 10; const T = 12; const B = 26;
  const n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.data)));
  const X = (i) => L + (i * (w - L - R)) / Math.max(1, n - 1);
  const Y = (v) => T + (1 - v / max) * (height - T - B);
  const ticks = [0, max / 2, max];
  const every = Math.ceil(n / 7);
  const onMove = (e) => { const x = e.clientX - e.currentTarget.getBoundingClientRect().left; setHover(Math.max(0, Math.min(n - 1, Math.round(((x - L) / (w - L - R)) * (n - 1))))); };
  return (
    <figure className="chart2 fill m-0" ref={ref} style={{ minHeight }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>{series.map((s) => <linearGradient key={s.name} id={`ac${s.color.slice(1)}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity="0.22" /><stop offset="100%" stopColor={s.color} stopOpacity="0" /></linearGradient>)}</defs>
          {ticks.map((t) => <g key={t}><line x1={L} x2={w - R} y1={Y(t)} y2={Y(t)} className="gl" /><text x={L - 8} y={Y(t) + 3.5} className="ax" textAnchor="end">{t}</text></g>)}
          {labels.map((l, i) => ((i % every === 0 && i <= n - 1 - every) || i === n - 1) && <text key={l} x={X(i)} y={height - 6} className="ax" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{dayLbl(l)}</text>)}
          {series.map((s) => { const pts = s.data.map((v, i) => [X(i), Y(v)]); const d = curve(pts); return (
            <g key={s.name}><path d={`${d} L${X(n - 1)},${Y(0)} L${X(0)},${Y(0)} Z`} fill={`url(#ac${s.color.slice(1)})`} /><path d={d} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinecap="round" /></g>); })}
          {hover != null && <g><line x1={X(hover)} x2={X(hover)} y1={T} y2={height - B} className="guide" />{series.map((s) => <circle key={s.name} cx={X(hover)} cy={Y(s.data[hover])} r="4" fill="#fff" stroke={s.color} strokeWidth="2.25" />)}</g>}
        </svg>
      )}
      {hover != null && w > 0 && (
        <div className="tip2" style={{ left: Math.min(w - 150, Math.max(0, X(hover) + 12)), top: 8 }}>
          <b>{dayLbl(labels[hover])}</b>
          {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}<em>{s.data[hover]}</em></span>)}
        </div>
      )}
    </figure>
  );
}

/** Weekly planned-vs-delivered grouped bars with an on-time line on top. */
function DeliveryChart({ weeks, minHeight = 250 }) {
  const [ref, w, h] = useWidth();
  const height = Math.max(minHeight, h);
  const [hover, setHover] = useState(null);
  const L = 30; const R = 8; const T = 14; const B = 28;
  const n = weeks.length;
  const max = niceMax(Math.max(1, ...weeks.flatMap((x) => [x.planned, x.done])));
  const slot = (w - L - R) / Math.max(1, n);
  const bw = Math.max(6, Math.min(26, slot * 0.3));
  const Y = (v) => T + (1 - v / max) * (height - T - B);
  const base = Y(0);
  const bar = (x, v, cls) => { const h = Math.max(v ? 3 : 0, base - Y(v)); const rr = Math.min(6, bw / 2, h); return h ? <path className={cls} d={`M${x},${base} V${base - h + rr} Q${x},${base - h} ${x + rr},${base - h} H${x + bw - rr} Q${x + bw},${base - h} ${x + bw},${base - h + rr} V${base} Z`} /> : null; };
  return (
    <figure className="chart2 fill m-0" ref={ref} style={{ minHeight }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`Tasks planned and delivered per week: ${weeks.map((x) => `${dayLbl(x.week)} planned ${x.planned}, delivered ${x.done}`).join('; ')}`} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="dlv" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4f6bff" /><stop offset="100%" stopColor="#0a3df0" /></linearGradient>
            <linearGradient id="dlvc" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#5b3df5" /></linearGradient>
          </defs>
          {[0, max / 2, max].map((t) => <g key={t}><line x1={L} x2={w - R} y1={Y(t)} y2={Y(t)} className="gl" /><text x={L - 8} y={Y(t) + 3.5} className="ax" textAnchor="end">{t}</text></g>)}
          {weeks.map((x, i) => {
            const cx = L + slot * i + slot / 2; const cur = i === n - 1;
            return (
              <g key={x.week} onMouseEnter={() => setHover(i)}>
                <rect x={L + slot * i} y={T} width={slot} height={height - T - B} className={`hit ${hover === i ? 'on' : ''}`} rx="8" />
                {bar(cx - bw - 2, x.planned, 'b-plan')}
                {bar(cx + 2, x.done, cur ? 'b-done cur' : 'b-done')}
                {(slot >= 46 || (n - 1 - i) % 2 === 0) && <text x={cx} y={height - 8} className={`ax ${cur ? 'cur' : ''}`} textAnchor="middle">{cur ? (slot >= 60 ? 'This week' : 'Now') : dayLbl(x.week)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && w > 0 && (() => { const x = weeks[hover]; const left = L + slot * hover + slot / 2; return (
        <div className="tip2" style={{ left: Math.min(w - 160, Math.max(0, left + 14)), top: 6 }}>
          <b>Week of {dayLbl(x.week)}</b>
          <span><i className="sw-plan" />Planned to finish<em>{x.planned}</em></span>
          <span><i style={{ background: '#0a3df0' }} />Delivered<em>{x.done}</em></span>
          <span><i style={{ background: '#10b981' }} />On time<em>{x.done ? `${Math.round((x.onTime / x.done) * 100)}%` : '—'}</em></span>
        </div>); })()}
    </figure>
  );
}

function Delta({ now, before, invert, unit = 'vs last week' }) {
  if (before == null || (now === 0 && before === 0)) return <span className="delta flat">no change</span>;
  const diff = now - before; const up = diff > 0;
  const good = invert ? !up : up;
  if (diff === 0) return <span className="delta flat">same {unit.replace('vs ', 'as ')}</span>;
  return <span className={`delta ${good ? 'good' : 'bad'}`}>{up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{up ? '+' : ''}{diff} {unit}</span>;
}

/* ======================================================================================
   Sections
   ====================================================================================== */

const HEALTH = [['GREEN', 'On track', '#10b981'], ['AMBER', 'At risk', '#f59e0b'], ['RED', 'Off track', '#f43f5e']];
const SCHED = { AHEAD: ['Ahead', '#3b82f6'], ON_TRACK: ['On schedule', '#10b981'], AT_RISK: ['At risk', '#f59e0b'], DELAYED: ['Running late', '#f43f5e'], COMPLETED: ['Completed', '#a1a1aa'] };
const STATUS = [['DONE', 'Done', '#10b981'], ['IN_PROGRESS', 'In progress', '#0a3df0'], ['IN_REVIEW', 'In review', '#8b5cf6'], ['BLOCKED', 'Blocked', '#f43f5e'], ['TODO', 'To do', '#d4d4d8']];
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const sum = (a) => a.reduce((x, y) => x + y, 0);

function Hero({ user, ps, d, manager }) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const planned = ps.filter((p) => p.schedule);
  const onSched = planned.filter((p) => ['AHEAD', 'ON_TRACK', 'COMPLETED'].includes(p.schedule.status)).length;
  const active = ps.filter((p) => p.status !== 'DRAFT');
  const avg = active.length ? Math.round(active.reduce((a, p) => a + (p.progress || 0), 0) / active.length) : null;
  const onTime = d.delivery?.onTimeRate == null ? null : Math.round(d.delivery.onTimeRate * 100);
  const attention = active.filter((p) => p.health !== 'GREEN').length;
  const overdue = d.myTasks.filter((t) => t.overdue).length;
  const today = iso(new Date());
  const msSoon = (d.delivery?.milestones || []).filter((m) => m.date >= today && m.date <= addDays(today, 14)).length;
  const line = overdue ? `You have ${overdue} overdue task${overdue > 1 ? 's' : ''} — worth a look first.` : attention ? `${attention} of ${active.length} projects need attention today.` : 'Every project is on track. Nice work.';
  const sp = planned.length ? Math.round((onSched / planned.length) * 100) : null;
  return (
    <section className="hero hero2">
      <div className="hero-l">
        <div className="hero-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>{greet}, {user?.name?.split(' ')[0]}</h1>
        <p>{line}</p>
        <div className="hero-row">
          <div className="hero-chips">
            <span><FolderKanban size={13} /> {active.length} projects in flight</span>
            <span><CheckCircle2 size={13} /> {d.myTasks.length} open tasks for you</span>
            <span><Flag size={13} /> {msSoon} milestone{msSoon === 1 ? '' : 's'} in 14 days</span>
          </div>
          <div className="hero-actions">
            <Link to="/my-tasks" className="btn btn-sm btn-hero">My tasks</Link>
            {manager ? <Link to="/reports" className="btn btn-sm btn-hero-ghost"><BarChart3 size={14} /> Reports</Link> : <Link to="/projects" className="btn btn-sm btn-hero-ghost"><FolderKanban size={14} /> Projects</Link>}
          </div>
        </div>
      </div>
      <div className="hero-r">
        <div className="hero-ring" title={`${onSched} of ${planned.length} approved plans on schedule`}><Ring size={70} stroke={7} value={sp} color="#6ee7b7" to="#10b981" glow="rgba(110,231,183,.55)"><b>{sp ?? '—'}<small>{sp == null ? '' : '%'}</small></b></Ring><span>On schedule</span><small>{onSched} of {planned.length} plans</small></div>
        <div className="hero-ring" title="Average work done across active projects"><Ring size={70} stroke={7} value={avg} color="#a5b4fc" to="#60a5fa" glow="rgba(147,197,253,.55)"><b>{avg ?? '—'}<small>{avg == null ? '' : '%'}</small></b></Ring><span>Work done</span><small>portfolio average</small></div>
        <div className="hero-ring" title="Tasks finished on or before their planned date, last 8 weeks"><Ring size={70} stroke={7} value={onTime} color="#fde68a" to="#f59e0b" glow="rgba(253,230,138,.5)"><b>{onTime ?? '—'}<small>{onTime == null ? '' : '%'}</small></b></Ring><span>On-time delivery</span><small>last 8 weeks</small></div>
      </div>
    </section>
  );
}

function Kpi({ to, icon: Icon, tone, label, period, children }) {
  return (
    <Link to={to} className={`kpi2 tone-${tone}`}>
      <div className="k-top"><span className="k-ic"><Icon size={16} /></span><span className="k-label">{label}</span>{period && <span className="k-period">{period}</span>}</div>
      {children}
    </Link>
  );
}

function ProjectKpis({ ps, d, time, manager }) {
  const active = ps.filter((p) => p.status !== 'DRAFT');
  const parts = HEALTH.map(([k, name, color]) => ({ name, color, value: active.filter((p) => p.health === k).length })).concat([{ name: 'Planning', color: '#d4d4d8', value: ps.filter((p) => p.status === 'DRAFT').length }]);
  const weeks = d.delivery?.weeks || [];
  const done = weeks.map((w) => w.done);
  const late = [...active].filter((p) => p.counts?.overdue).sort((a, b) => b.counts.overdue - a.counts.overdue);
  const lateMax = Math.max(1, ...late.map((p) => p.counts.overdue));
  const tw = time?.weeks || [];
  const tasks = d.myTasks;
  const byStatus = STATUS.filter(([k]) => k !== 'DONE').map(([k, n, c]) => [n, tasks.filter((t) => t.status === k).length, c]);
  return (
    <div className="kpi-grid">
      <Kpi to="/projects" icon={FolderKanban} tone="blue" label="Projects in flight" period={`${ps.length} total`}>
        <div className="k-row"><div className="k-val">{active.length}<small>active</small></div><span className="delta flat">{parts[0].value} on track</span></div>
        <div className="seg-bar">{parts.filter((p) => p.value).map((p) => <span key={p.name} title={`${p.name}: ${p.value}`} style={{ flex: p.value, background: p.color }} />)}{!ps.length && <span style={{ flex: 1, background: '#f1f1f3' }} />}</div>
        <div className="k-legend">{parts.filter((p) => p.value).map((p) => <span key={p.name}><i style={{ background: p.color }} />{p.name} {p.value}</span>)}</div>
      </Kpi>
      <Kpi to="/projects" icon={CheckCircle2} tone="green" label="Tasks delivered" period="8 weeks">
        <div className="k-row"><div><div className="k-val">{sum(done)}</div><Delta now={sum(done.slice(4))} before={sum(done.slice(0, 4))} unit="vs prior 4 wks" /></div><Spark data={done} color="#34d399" to="#059669" /></div>
      </Kpi>
      <Kpi to="/my-tasks" icon={AlarmClock} tone="rose" label="Overdue tasks" period={`${late.length} project${late.length === 1 ? '' : 's'}`}>
        <div className="k-row"><div className="k-val">{d.delivery?.overdue ?? 0}<small>late</small></div>{!late.length && <span className="delta good">All on time</span>}</div>
        {late.length > 0 && <div className="hbars">{late.slice(0, 2).map((p) => <div key={p.id} title={`${p.name}: ${p.counts.overdue} late`}><span className="truncate">{p.code}</span><i><b style={{ width: `${(p.counts.overdue / lateMax) * 100}%` }} /></i><em>{p.counts.overdue}</em></div>)}</div>}
      </Kpi>
      {manager ? (
        <Kpi to="/time" icon={Timer} tone="amber" label="Hours logged" period="8 weeks">
          <div className="k-row">{tw.length ? <><div><div className="k-val">{Math.round(time.totals.hours).toLocaleString()}<small>h</small></div><span className="delta flat">{Math.round((time.totals.billable / Math.max(1, time.totals.hours)) * 100)}% billable</span></div>
            <Bars data={tw.map((w) => fmt1(w.billable + w.nonBillable))} from="#fcd34d" to="#f59e0b" labels={tw.map((w) => `Week of ${dayLbl(w.week)}`)} unit=" h" /></> : <div className="k-val">—</div>}</div>
        </Kpi>
      ) : (
        <Kpi to="/my-tasks" icon={Target} tone="violet" label="My open work" period={`${d.upcoming.length} due soon`}>
          <div className="k-row"><div className="k-val">{tasks.length}<small>tasks</small></div><span className="delta flat">{Number(d.timesheet.hours || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} h logged this week</span></div>
          <div className="seg-bar">{tasks.length ? byStatus.filter((b) => b[1]).map(([n, v, c]) => <span key={n} title={`${n}: ${v}`} style={{ flex: v, background: c }} />) : <span style={{ flex: 1, background: '#f1f1f3' }} />}</div>
          <div className="k-legend">{byStatus.filter((b) => b[1]).map(([n, v, c]) => <span key={n}><i style={{ background: c }} />{n} {v}</span>)}{!tasks.length && <span>Nothing assigned right now</span>}</div>
        </Kpi>
      )}
    </div>
  );
}

function DeliveryPanel({ delivery }) {
  const weeks = delivery?.weeks || [];
  const planned = sum(weeks.map((w) => w.planned)); const done = sum(weeks.map((w) => w.done));
  const onTime = delivery?.onTimeRate == null ? null : Math.round(delivery.onTimeRate * 100);
  return (
    <PanelCard title="Planned vs delivered" className="chart-card" tools={<span className="legend-inline"><span><i className="sw-plan" />Planned to finish</span><span><i style={{ background: 'linear-gradient(#4f6bff,#0a3df0)' }} />Delivered</span></span>}>
      <div className="metric-strip">
        <div><small>Delivered</small><b>{done}</b></div>
        <div><small>Planned to finish</small><b>{planned}</b></div>
        <div><small>Delivery rate</small><b>{planned ? `${Math.round((done / planned) * 100)}%` : '—'}</b></div>
        <div><small>On time</small><b className="good">{onTime == null ? '—' : `${onTime}%`}</b></div>
      </div>
      {weeks.length ? <DeliveryChart weeks={weeks} /> : <Empty icon={BarChart3} title="No delivery data yet" />}
    </PanelCard>
  );
}

function WorkMix({ delivery }) {
  const st = delivery?.status || {};
  const parts = STATUS.map(([k, name, color]) => ({ name, color, value: st[k] || 0 }));
  const total = sum(parts.map((p) => p.value));
  const pct = total ? Math.round(((st.DONE || 0) / total) * 100) : 0;
  return (
    <PanelCard title="Work by status" tools={<span className="small text-muted">All active projects</span>}>
      <div className="mix-wrap">
        <Donut parts={parts} center={`${pct}%`} sub="complete" />
        <ul className="mix-list">{parts.map((p) => (
          <li key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span><b>{p.value}</b><em>{total ? Math.round((p.value / total) * 100) : 0}%</em></li>
        ))}</ul>
      </div>
      <div className="mix-foot"><span>{total} tasks</span><span>{st.BLOCKED ? <><b className="text-danger">{st.BLOCKED}</b> blocked</> : 'Nothing blocked'}</span></div>
    </PanelCard>
  );
}

function PortfolioTimeline({ ps, manager }) {
  const today = iso(new Date());
  const rows = ps.filter((p) => p.plannedStart && p.plannedFinish).sort((a, b) => a.plannedFinish.localeCompare(b.plannedFinish)).slice(0, 10);
  const from = addDays(today, -28); const to = addDays(today, 84); const span = dayDiff(from, to);
  const x = (dte) => Math.max(0, Math.min(100, (dayDiff(from, dte) / span) * 100));
  const months = []; { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); while (iso(d) < to) { months.push(iso(d)); d.setUTCMonth(d.getUTCMonth() + 1); } }
  return (
    <PanelCard title="Portfolio timeline" tools={<><span className="small text-muted d-none d-md-inline">Bar = plan · fill = work done · ▲ = where the plan expects you today</span>{manager && <Link to="/projects?new=1" className="btn-square" aria-label="New project" title="New project"><Plus size={15} /></Link>}</>}>
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
      <div className="mix-wrap">
        <Donut parts={parts} size={150} stroke={16} center={ps.length} sub="projects" />
        <ul className="mix-list">{parts.map((p) => <li key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span><b>{p.value}</b></li>)}</ul>
      </div>
      {sched.length > 0 && <><div className="mini-h">Against approved plans</div><div className="seg-bar tall">{sched.map((s) => <span key={s.name} title={`${s.name}: ${s.value}`} style={{ flex: s.value, background: s.color }} />)}</div>
        <div className="k-legend">{sched.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name} {s.value}</span>)}</div></>}
      {late.length > 0 && <><div className="mini-h">Most late tasks</div>{late.map((p) => <Link key={p.id} to={`/projects/${p.id}/list`} className="late-row"><ProjectChip code={p.code} size={22} /><span className="truncate">{p.name}</span><b>{p.counts.overdue} late</b></Link>)}</>}
    </PanelCard>
  );
}

function TeamLoad({ wl }) {
  const tone = (pct) => (pct > 100 ? ['#fb7185', '#e11d48'] : pct > 80 ? ['#fcd34d', '#f59e0b'] : ['#6ee7b7', '#10b981']);
  return (
    <PanelCard title="Team load" tools={<><span className="small text-muted">Next 2 weeks</span><Link to="/planner" className="btn btn-sm btn-light">Planner</Link></>}>
      {wl.length ? <div className="load-grid">{wl.slice(0, 8).map((w) => {
        const [c1, c2] = tone(w.pct);
        return <div key={w.userId} className="load-cell" title={`${w.name}: ${Math.round(w.plannedHours)} h planned of ${Math.round(w.capacityHours)} h`}>
          <Ring value={Math.min(100, w.pct)} size={66} stroke={5} color={c1} to={c2} track="#f1f1f3"><Avatar name={w.name} /></Ring>
          <b className="truncate">{w.name.split(' ')[0]}</b><small style={{ color: c2 }}>{Math.round(w.pct)}% booked</small>
        </div>; })}</div> : <Empty icon={Users} title="No assigned work with estimates yet" />}
      <div className="load-legend"><span><i style={{ background: '#10b981' }} />Room to spare</span><span><i style={{ background: '#f59e0b' }} />Nearly full</span><span><i style={{ background: '#e11d48' }} />Overbooked</span></div>
    </PanelCard>
  );
}

function NextTwoWeeks({ d, ps }) {
  const today = iso(new Date());
  const days = [...Array(14)].map((_, i) => addDays(today, i));
  const ms = d.milestones || d.delivery?.milestones || [];
  const events = [
    ...ms.map((m) => ({ id: m.id, date: m.date, kind: 'ms', title: m.title, sub: ps.find((p) => p.id === m.projectId)?.name || m.projectCode, to: `/projects/${m.projectId}/tasks?item=${m.id}` })),
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
          <span className="pips">{evs.slice(0, 3).map((e) => <i key={`${e.kind}${e.id}`} className={e.kind === 'ms' ? 'dot-ms' : 'dot-task'} />)}</span>
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

/* ---------- support desk (bottom of the page) ---------- */

function SupportSection({ stats }) {
  if (!stats) return <div className="dash-section"><Loading rows={3} /></div>;
  const created = stats.trend.created; const resolved = stats.trend.resolved;
  const sla = stats.slaCompliance == null ? null : Math.round(stats.slaCompliance * 100);
  return (
    <>
      <div className="dash-section">
        <div><h2><LifeBuoy size={17} /> Support desk</h2><p>Tickets from your clients, last 14 days</p></div>
        <Link to="/tickets" className="btn btn-sm btn-light">Open queue <ArrowUpRight size={14} /></Link>
      </div>
      <div className="kpi-grid">
        <Kpi to="/tickets" icon={Inbox} tone="blue" label="Tickets raised" period="14 days">
          <div className="k-row"><div><div className="k-val">{sum(created)}</div><Delta now={sum(created.slice(7))} before={sum(created.slice(0, 7))} invert /></div><Spark data={created} color="#6d8bff" to="#0a3df0" /></div>
        </Kpi>
        <Kpi to="/tickets?view=all" icon={CheckCircle2} tone="green" label="Tickets resolved" period="14 days">
          <div className="k-row"><div><div className="k-val">{sum(resolved)}</div><Delta now={sum(resolved.slice(7))} before={sum(resolved.slice(0, 7))} /></div><Spark data={resolved} color="#34d399" to="#059669" /></div>
        </Kpi>
        <Kpi to="/tickets" icon={ShieldCheck} tone="violet" label="SLA met" period="30 days">
          <div className="k-row"><div><div className="k-val">{sla ?? '—'}<small>{sla == null ? '' : '%'}</small></div><span className={`delta ${stats.breached ? 'bad' : 'good'}`}>{stats.breached} breached now</span></div>
            <Ring value={sla} size={58} stroke={6} color="#c4b5fd" to="#7c3aed" track="#f1f1f3"><Gauge size={16} color="#7c3aed" /></Ring></div>
        </Kpi>
        <Kpi to="/tickets" icon={Star} tone="amber" label="Open now" period="queue">
          <div className="k-row"><div><div className="k-val">{stats.open}<small>open</small></div><span className="delta flat">Client rating {stats.csat.average == null ? '—' : `${stats.csat.average.toFixed(1)} / 5`}</span></div></div>
        </Kpi>
      </div>
    </>
  );
}

function TicketTrend({ stats }) {
  if (!stats) return <PanelCard title="Tickets created vs resolved"><Loading rows={4} /></PanelCard>;
  return (
    <PanelCard title="Tickets created vs resolved" tools={<span className="legend-inline"><span><i style={{ background: '#0a3df0' }} />Created</span><span><i style={{ background: '#10b981' }} />Resolved</span></span>}>
      <AreaChart minHeight={250} labels={stats.trend.days} label="Tickets created and resolved per day, last 14 days" series={[{ name: 'Created', data: stats.trend.created, color: '#0a3df0' }, { name: 'Resolved', data: stats.trend.resolved, color: '#10b981' }]} />
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
      <Hero user={user} ps={ps} d={d} manager={manager} />
      <ProjectKpis ps={ps} d={d} time={time.data} manager={manager} />
      <div className="row g-3 mb-3">
        <div className="col-xxl-8 col-xl-7"><DeliveryPanel delivery={d.delivery} /></div>
        <div className="col-xxl-4 col-xl-5"><WorkMix delivery={d.delivery} /></div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-xxl-8 col-xl-7"><PortfolioTimeline ps={ps} manager={manager} /></div>
        <div className="col-xxl-4 col-xl-5"><HealthPanel ps={ps} /></div>
      </div>
      <div className="row g-3 mb-3">
        {manager && <div className="col-xl-6"><TeamLoad wl={d.workload || []} /></div>}
        <div className={manager ? 'col-xl-6' : 'col-12'}><NextTwoWeeks d={d} ps={ps} /></div>
      </div>
      <SupportSection stats={stats.data} />
      <div className="row g-3">
        <div className="col-xxl-7 col-xl-7"><TicketTrend stats={stats.data} /></div>
        <div className="col-xxl-5 col-xl-5"><RecentActivity limit={6} /></div>
      </div>
    </div>
  );
}
