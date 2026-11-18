import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, AlertTriangle, Users } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { addDaysISO, fmtDate, mondayOf, todayISO, labelize } from '../lib/format.js';
import { Avatar, Card, Empty, ErrorBox, Loading, PageHeader, ProjectDot, StatusBadge } from '../components/ui.jsx';

const level = (c) => (!c.planned ? 'l0' : c.pct > 100 ? 'l4' : c.pct >= 85 ? 'l3' : c.pct >= 50 ? 'l2' : 'l1');
const wk = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** People × weeks heatmap of planned work vs capacity, across all visible projects. */
export default function ResourcePlanner() {
  const [from, setFrom] = useState(mondayOf(todayISO()));
  const [weeks, setWeeks] = useState(8);
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null); // { userId, week }
  const { data, error, loading, reload } = useLoad(() => get('/workload/weeks', { from, weeks, projectId: projectId || undefined }), [from, weeks, projectId]);
  useLive((e) => e.type === 'work.changed', () => reload({ silent: true }), []);
  const people = useMemo(() => (data?.data || []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.title || '').toLowerCase().includes(q.toLowerCase())), [data, q]);
  const thisWeek = mondayOf(todayISO());
  const over = people.filter((p) => p.weeks.some((c) => c.state === 'OVER'));
  const idle = people.filter((p) => p.weeks.slice(0, 2).every((c) => !c.planned));
  const person = sel && data?.data.find((p) => p.userId === sel.userId);
  const cell = person && (sel.week ? person.weeks.find((c) => c.start === sel.week) : null);
  const tasks = person ? (cell ? person.tasks.filter((t) => cell.taskIds.includes(t.id)) : person.tasks) : [];
  return (
    <>
      <PageHeader title="Resource planner" sub="Who is booked when. Each cell is planned hours against that person's capacity for the week — spot overload before it happens." />
      <div className="filters">
        <div className="btn-group btn-group-sm"><button className="btn btn-light" onClick={() => setFrom(addDaysISO(from, -7 * Math.max(1, weeks / 2)))} aria-label="Earlier"><ChevronLeft size={15} /></button>
          <button className="btn btn-light" onClick={() => setFrom(thisWeek)}>This week</button>
          <button className="btn btn-light" onClick={() => setFrom(addDaysISO(from, 7 * Math.max(1, weeks / 2)))} aria-label="Later"><ChevronRight size={15} /></button></div>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Weeks shown">{[4, 8, 12, 16].map((n) => <option key={n} value={n}>{n} weeks</option>)}</select>
        <select className="form-select form-select-sm" style={{ width: 'auto', maxWidth: 260 }} value={projectId} onChange={(e) => { setProjectId(e.target.value); setSel(null); }} aria-label="Project"><option value="">All projects</option>{(data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
        <input className="form-control form-control-sm" style={{ maxWidth: 200 }} placeholder="Find person or role" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find person" />
        <span className="ms-auto small text-muted d-flex gap-2 flex-wrap"><span><span className="legend-sw" style={{ background: '#f1f5f9' }} />Free</span><span><span className="legend-sw" style={{ background: '#dbeafe' }} />&lt;50%</span><span><span className="legend-sw" style={{ background: '#93c5fd' }} />50–84%</span><span><span className="legend-sw" style={{ background: '#fde68a' }} />85–100%</span><span><span className="legend-sw" style={{ background: '#fca5a5' }} />Over 100%</span></span>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {data && <div className="row g-3 mb-3">
        <div className="col-md-4"><div className={`tile ${over.length ? 'red' : 'green'}`}><div className="label">Overbooked people</div><div className="value">{over.length}</div><div className="small">{over.slice(0, 3).map((p) => p.name.split(' ')[0]).join(', ') || 'Nobody is over capacity'}</div></div></div>
        <div className="col-md-4"><div className="tile blue"><div className="label">Free in the next 2 weeks</div><div className="value">{idle.length}</div><div className="small">{idle.slice(0, 3).map((p) => p.name.split(' ')[0]).join(', ') || 'Everyone has planned work'}</div></div></div>
        <div className="col-md-4"><div className="tile orange"><div className="label">Planned vs capacity</div><div className="value">{Math.round(people.reduce((s, p) => s + p.totals.planned, 0))}h <span className="small fw-normal">/ {Math.round(people.reduce((s, p) => s + p.totals.capacity, 0))}h</span></div><div className="small">Over {weeks} weeks for {people.length} people</div></div></div>
      </div>}
      {loading && !data ? <Loading rows={8} /> : people.length === 0 ? <Card><Empty icon={Users} title="No people to plan" /></Card> : (
        <div className="row g-3">
          <div className={sel ? 'col-xl-8' : 'col-12'}><div className="card"><div className="table-wrap p-2"><table className="planner">
            <thead><tr><th className="text-start">Person</th>{data.weeks.map((w) => <th key={w} className={w === thisWeek ? 'cur' : ''}>{w === thisWeek ? 'This wk' : wk(w)}</th>)}<th>Total</th></tr></thead>
            <tbody>{people.map((p) => <tr key={p.userId}>
              <td className="person"><button className="btn btn-link p-0 text-body text-start text-decoration-none d-flex align-items-center gap-2" onClick={() => setSel({ userId: p.userId, week: null })}><Avatar sm name={p.name} /><span className="min-w-0"><span className="fw-semibold small d-block truncate">{p.name}</span><span className="small text-muted d-block truncate">{p.title || p.department || ''} · {p.weeklyCapacityHours}h/wk</span></span></button>
                {(p.unscheduled > 0 || p.unestimated > 0) && <div className="small text-warning-emphasis" title="These tasks are not counted"><AlertTriangle size={11} /> {[p.unscheduled && `${p.unscheduled} undated`, p.unestimated && `${p.unestimated} unestimated`].filter(Boolean).join(', ')}</div>}</td>
              {p.weeks.map((c) => <td key={c.start} className="cellh"><button className={`hc ${level(c)} ${sel?.userId === p.userId && sel.week === c.start ? 'on' : ''}`} onClick={() => setSel({ userId: p.userId, week: c.start })} title={`${p.name}, week of ${fmtDate(c.start)}: ${c.planned}h planned of ${c.capacity}h`} aria-label={`${p.name}, week of ${fmtDate(c.start)}: ${c.planned} hours planned of ${c.capacity}`}>
                {c.planned ? `${Number.isFinite(c.pct) ? c.pct : '∞'}%` : '—'}<small>{c.planned ? `${Math.round(c.planned)}h` : `${Math.round(c.capacity)}h free`}</small></button></td>)}
              <td className="text-center small num fw-semibold">{Math.round(p.totals.planned)}h<div className="text-muted fw-normal">/{Math.round(p.totals.capacity)}h</div></td>
            </tr>)}</tbody></table></div></div>
            <div className="form-text mt-2">{data.method}</div></div>
          {sel && person && <div className="col-xl-4"><Card title={<span className="d-inline-flex align-items-center gap-2"><Avatar sm name={person.name} />{person.name}</span>} actions={<button className="btn btn-sm btn-ghost" onClick={() => setSel(null)}>Close</button>}>
            <div className="small text-muted mb-2">{cell ? <>Week of <b className="text-body">{fmtDate(cell.start)}</b>: {cell.planned}h planned of {cell.capacity}h ({Number.isFinite(cell.pct) ? `${cell.pct}%` : 'no capacity'})</> : <>All planned work in the next {weeks} weeks</>}</div>
            {cell && <div className="meter mb-3"><span style={{ width: `${Math.min(100, cell.pct || 0)}%`, background: cell.state === 'OVER' ? 'var(--red)' : undefined }} /></div>}
            {tasks.length === 0 ? <div className="small text-muted">No dated tasks in this period.</div> : <ul className="list-plain">{tasks.sort((a, b) => a.plannedFinish.localeCompare(b.plannedFinish)).map((t) => <li key={t.id} className="d-block">
              <Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="fw-semibold small text-body d-flex align-items-center gap-1"><ProjectDot code={t.projectCode} /><span className="mono text-muted">{t.key}</span> <span className="truncate">{t.title}</span></Link>
              <div className="small text-muted d-flex gap-2 align-items-center">{fmtDate(t.plannedStart)} → {fmtDate(t.plannedFinish)} · {t.estimateHours ? `${t.estimateHours}h` : <span className="text-warning-emphasis">no estimate</span>}{t.status !== 'TODO' && <StatusBadge status={t.status} />}{t.priority === 'CRITICAL' || t.priority === 'HIGH' ? <span className="pill pill-warn">{labelize(t.priority)}</span> : null}</div></li>)}</ul>}
            {cell?.state === 'OVER' && <div className="form-text">Overbooked: move a task's dates on its project Gantt, or reassign it in the project's Table view.</div>}
          </Card></div>}
        </div>)}
    </>
  );
}
