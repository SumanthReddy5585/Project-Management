import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Users, Flame, Coffee, Gauge, X, UserRoundCog } from 'lucide-react';
import { get, patch } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useLive, emitLocal } from '../lib/live.js';
import { addDaysISO, fmtDate, mondayOf, todayISO, projectColor } from '../lib/format.js';
import { Avatar, Card, Empty, ErrorBox, Loading, PageHeader, ProjectChip, StatusBadge, Segmented, useToast } from '../components/ui.jsx';

const wk = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const h = (n) => `${Math.round(n)}h`;
const free = (c) => Math.max(0, c.capacity - c.planned);
const tone = (c) => (!c.capacity ? 'none' : c.pct > 100 ? 'over' : c.pct >= 85 ? 'full' : c.planned ? 'ok' : 'idle');

/**
 * Resource planner: who is booked when, across projects. Each cell shows the week's planned hours against
 * the person's capacity, split by project. Click a cell to see the tasks and move work to someone with room.
 */
export default function ResourcePlanner() {
  const toast = useToast();
  const [from, setFrom] = useState(mondayOf(todayISO()));
  const [weeks, setWeeks] = useState(8);
  const [projectId, setProjectId] = useState('');
  const [dept, setDept] = useState('');
  const [show, setShow] = useState('all');
  const [sort, setSort] = useState('busy');
  const [q, setQ] = useState('');
  const [openRows, setOpenRows] = useState(() => new Set());
  const [sel, setSel] = useState(null); // { userId, week }
  const { data, error, loading, reload } = useLoad(() => get('/workload/weeks', { from, weeks, projectId: projectId || undefined }), [from, weeks, projectId]);
  useLive((e) => e.type === 'work.changed', () => reload({ silent: true }), []);
  const thisWeek = mondayOf(todayISO());
  const all = data?.data || [];
  const pmap = useMemo(() => new Map((data?.projects || []).map((p) => [p.id, p])), [data]);
  const departments = useMemo(() => [...new Set(all.map((p) => p.department).filter(Boolean))].sort(), [all]);
  const people = useMemo(() => {
    const load = (p) => (p.totals.capacity ? p.totals.planned / p.totals.capacity : 0);
    let r = all.filter((p) => (!q || `${p.name} ${p.title || ''}`.toLowerCase().includes(q.toLowerCase())) && (!dept || p.department === dept));
    if (show === 'over') r = r.filter((p) => p.weeks.some((c) => c.state === 'OVER'));
    if (show === 'free') r = r.filter((p) => p.weeks.slice(0, 2).some((c) => free(c) >= 8));
    return [...r].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'free' ? load(a) - load(b) : load(b) - load(a)));
  }, [all, q, dept, show, sort]);
  const over = all.filter((p) => p.weeks.some((c) => c.state === 'OVER'));
  const wkIdx = Math.max(0, (data?.weeks || []).indexOf(thisWeek));
  const freeNow = all.map((p) => ({ p, c: p.weeks[wkIdx] })).filter((x) => x.c && free(x.c) >= 4).sort((a, b) => free(b.c) - free(a.c));
  const planned = people.reduce((s, p) => s + p.totals.planned, 0); const cap = people.reduce((s, p) => s + p.totals.capacity, 0);
  const util = cap ? Math.round((planned / cap) * 100) : 0;
  const shownProjects = useMemo(() => [...new Set(all.flatMap((p) => p.weeks.flatMap((c) => Object.keys(c.byProject || {}))))].map((id) => pmap.get(id)).filter(Boolean), [all, pmap]);
  const person = sel && all.find((p) => p.userId === sel.userId);
  const toggleRow = (id) => setOpenRows((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const range = data ? `${wk(data.weeks[0])} – ${wk(addDaysISO(data.weeks.at(-1), 6))}` : '';
  const reassign = async (t, userId) => {
    try { await patch(`/projects/${t.projectId}/work-items/${t.id}`, { assigneeId: userId, version: t.version }); toast(`${t.key} moved to ${all.find((p) => p.userId === userId)?.name}`, 'success'); emitLocal({ type: 'work.changed', projectId: t.projectId, self: true }); reload({ silent: true }); }
    catch (e) { toast(e.status === 403 ? 'Only the project manager of that project can reassign its tasks.' : e.message, 'error'); }
  };
  return (
    <>
      <PageHeader title="Resource planner" sub="Who is booked when, across your projects. Bars show planned hours against each person's weekly capacity; click a week to see the work and move it to someone with room." />
      <div className="rp-toolbar">
        <div className="btn-group btn-group-sm"><button className="btn btn-light" onClick={() => setFrom(addDaysISO(from, -7 * Math.max(1, weeks / 2)))} aria-label="Earlier weeks"><ChevronLeft size={15} /></button>
          <button className="btn btn-light" onClick={() => setFrom(thisWeek)} disabled={from === thisWeek}>This week</button>
          <button className="btn btn-light" onClick={() => setFrom(addDaysISO(from, 7 * Math.max(1, weeks / 2)))} aria-label="Later weeks"><ChevronRight size={15} /></button></div>
        <strong className="rp-range">{range}</strong>
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Weeks shown">{[4, 8, 12, 16].map((n) => <option key={n} value={n}>{n} weeks</option>)}</select>
        <select className="form-select form-select-sm" style={{ width: 'auto', maxWidth: 240 }} value={projectId} onChange={(e) => { setProjectId(e.target.value); setSel(null); }} aria-label="Project"><option value="">All projects</option>{(data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
        {departments.length > 1 && <select className="form-select form-select-sm" style={{ width: 'auto' }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}</select>}
        <input className="form-control form-control-sm" style={{ maxWidth: 190 }} placeholder="Find a person or role" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find person" />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {data && <div className="row g-3 mb-3">
        <div className="col-md-4"><button className={`rp-kpi ${over.length ? 'red' : 'green'} ${show === 'over' ? 'on' : ''}`} onClick={() => setShow(show === 'over' ? 'all' : 'over')}>
          <span className="ic"><Flame size={17} /></span><span><span className="lbl">Overbooked</span><span className="val">{over.length} {over.length === 1 ? 'person' : 'people'}</span>
            <span className="hint">{over.length ? over.slice(0, 3).map((p) => p.name.split(' ')[0]).join(', ') : 'Nobody is over capacity'}</span></span></button></div>
        <div className="col-md-4"><button className={`rp-kpi blue ${show === 'free' ? 'on' : ''}`} onClick={() => setShow(show === 'free' ? 'all' : 'free')}>
          <span className="ic"><Coffee size={17} /></span><span><span className="lbl">Free this week</span><span className="val">{h(freeNow.reduce((s, x) => s + free(x.c), 0))}</span>
            <span className="hint">{freeNow.length ? freeNow.slice(0, 3).map((x) => `${x.p.name.split(' ')[0]} ${h(free(x.c))}`).join(' · ') : 'Everyone is fully booked'}</span></span></button></div>
        <div className="col-md-4"><div className="rp-kpi amber"><span className="ic"><Gauge size={17} /></span><span className="flex-grow-1"><span className="lbl">Team utilisation · {weeks} weeks</span><span className="val">{util}% <small>{h(planned)} of {h(cap)}</small></span>
          <span className="rp-meter"><span style={{ width: `${Math.min(100, util)}%`, background: util > 100 ? '#dc2626' : util >= 85 ? '#f59e0b' : '#0a3df0' }} /></span></span></div></div>
      </div>}
      {data && <div className="rp-controls">
        <Segmented label="Show" value={show} onChange={setShow} options={[['all', 'Everyone'], ['over', 'Overbooked'], ['free', 'Has free time']]} />
        <Segmented label="Sort" value={sort} onChange={setSort} options={[['busy', 'Busiest first'], ['free', 'Most free first'], ['name', 'Name']]} />
        <span className="ms-auto rp-legend">{shownProjects.slice(0, 8).map((p) => <span key={p.id}><i style={{ background: projectColor(p.code) }} />{p.code}</span>)}<span><i className="over" />Over capacity</span></span>
      </div>}
      {loading && !data ? <Loading rows={8} /> : people.length === 0 ? <Card><Empty icon={Users} title={show !== 'all' || q || dept ? 'Nobody matches' : 'No people to plan'}>{show !== 'all' ? 'Try “Everyone”.' : ''}</Empty></Card> : (
        <div className="row g-3">
          <div className={sel ? 'col-xl-8' : 'col-12'}><div className="card"><div className="table-wrap"><table className="rp-grid">
            <thead><tr><th className="who">Person</th>{data.weeks.map((w) => <th key={w} className={w === thisWeek ? 'cur' : ''}>{w === thisWeek ? 'This week' : wk(w)}</th>)}<th>Total</th></tr></thead>
            <tbody>{people.map((p) => {
              const expanded = openRows.has(p.userId);
              const mine = [...new Set(p.weeks.flatMap((c) => Object.keys(c.byProject || {})))];
              return [
                <tr key={p.userId}>
                  <td className="who"><div className="d-flex align-items-center gap-2">
                    {mine.length ? <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggleRow(p.userId)} aria-expanded={expanded} aria-label={expanded ? `Hide ${p.name}'s projects` : `Show ${p.name}'s projects`} title="Hours per project">{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                      : <span className="rp-spacer" aria-hidden="true" />}
                    <Avatar sm name={p.name} /><span className="min-w-0"><span className="fw-semibold small d-block truncate">{p.name}</span><span className="small text-muted d-block truncate">{p.title || p.department || ''} · {p.weeklyCapacityHours}h/wk</span></span></div>
                    {(p.unscheduled > 0 || p.unestimated > 0) && <div className="small text-warning-emphasis ms-5" title="These tasks are not counted"><AlertTriangle size={11} /> {[p.unscheduled && `${p.unscheduled} undated`, p.unestimated && `${p.unestimated} without hours`].filter(Boolean).join(', ')}</div>}</td>
                  {p.weeks.map((c) => {
                    const t = tone(c); const on = sel?.userId === p.userId && sel.week === c.start;
                    const parts = Object.entries(c.byProject || {});
                    const scale = Math.max(c.capacity, c.planned) || 1;
                    return <td key={c.start} className={c.start === thisWeek ? 'cur' : ''}><button className={`rp-cell ${t} ${on ? 'on' : ''}`} onClick={() => setSel({ userId: p.userId, week: c.start })}
                      title={`${p.name}, week of ${fmtDate(c.start)}: ${h(c.planned)} planned of ${h(c.capacity)}${parts.length ? `\n${parts.map(([id, x]) => `${pmap.get(id)?.code}: ${h(x)}`).join('\n')}` : ''}`}
                      aria-label={`${p.name}, week of ${fmtDate(c.start)}: ${Math.round(c.planned)} of ${Math.round(c.capacity)} hours planned`}>
                      <span className="nums">{c.planned ? <><b>{Math.round(c.planned)}</b>/{Math.round(c.capacity)}h</> : <span className="text-muted">{c.capacity ? `${Math.round(c.capacity)}h free` : 'off'}</span>}</span>
                      <span className="bar">{parts.map(([id, x]) => <i key={id} style={{ width: `${(x / scale) * 100}%`, background: projectColor(pmap.get(id)?.code || '') }} />)}
                        {c.planned > c.capacity && c.capacity > 0 && <em style={{ left: `${(c.capacity / scale) * 100}%` }} />}</span>
                    </button></td>;
                  })}
                  <td className="tot"><b>{h(p.totals.planned)}</b><span>/{h(p.totals.capacity)}</span></td>
                </tr>,
                ...(expanded ? mine.map((pid) => <tr key={`${p.userId}-${pid}`} className="sub">
                  <td className="who"><span className="d-flex align-items-center gap-2 ms-5 small"><ProjectChip code={pmap.get(pid)?.code} size={18} /><span className="truncate">{pmap.get(pid)?.name}</span></span></td>
                  {p.weeks.map((c) => <td key={c.start} className="small text-center num">{c.byProject?.[pid] ? h(c.byProject[pid]) : <span className="text-muted">—</span>}</td>)}
                  <td className="tot small">{h(p.weeks.reduce((s, c) => s + (c.byProject?.[pid] || 0), 0))}</td></tr>) : []),
              ];
            })}</tbody></table></div></div>
            <div className="form-text mt-2">{data.method}</div></div>
          {sel && person && <div className="col-xl-4"><WeekPanel person={person} week={sel.week} all={all} pmap={pmap} onClose={() => setSel(null)} onReassign={reassign} /></div>}
        </div>)}
    </>
  );
}

function WeekPanel({ person, week, all, pmap, onClose, onReassign }) {
  const cell = person.weeks.find((c) => c.start === week);
  const tasks = person.tasks.filter((t) => cell.taskIds.includes(t.id)).sort((a, b) => (a.plannedFinish || '').localeCompare(b.plannedFinish || ''));
  const byProject = [...new Set(tasks.map((t) => t.projectId))].map((pid) => ({ p: pmap.get(pid), items: tasks.filter((t) => t.projectId === pid) }));
  const roomFor = (pid) => all.filter((x) => x.userId !== person.userId && x.projectIds?.includes(pid)).map((x) => ({ x, c: x.weeks.find((w) => w.start === week) })).filter((y) => y.c).sort((a, b) => free(b.c) - free(a.c));
  const others = all.filter((x) => x.userId !== person.userId).map((x) => ({ x, c: x.weeks.find((w) => w.start === week) })).filter((y) => y.c && free(y.c) >= 4).sort((a, b) => free(b.c) - free(a.c)).slice(0, 5);
  const t = tone(cell);
  return (
    <Card title={<span className="d-inline-flex align-items-center gap-2"><Avatar sm name={person.name} />{person.name}</span>} actions={<button className="btn btn-sm btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={15} /></button>}>
      <div className="small text-muted">Week of <b className="text-body">{fmtDate(week)}</b></div>
      <div className={`rp-week ${t}`}><b>{h(cell.planned)}</b> planned of {h(cell.capacity)} {t === 'over' ? <span className="pill pill-risk ms-1">{h(cell.planned - cell.capacity)} over</span> : <span className="pill pill-ok ms-1">{h(free(cell))} free</span>}</div>
      <div className="rp-meter mb-3"><span style={{ width: `${Math.min(100, cell.pct || 0)}%`, background: t === 'over' ? '#dc2626' : t === 'full' ? '#f59e0b' : '#0a3df0' }} /></div>
      {tasks.length === 0 ? <div className="small text-muted mb-3">No planned work this week.</div> : byProject.map(({ p, items }) => (
        <div key={p?.id} className="mb-3">
          <div className="d-flex align-items-center gap-2 mb-1"><ProjectChip code={p?.code} size={20} /><b className="small">{p?.name}</b><span className="small text-muted ms-auto">{h(cell.byProject?.[p?.id] || 0)}</span></div>
          <ul className="list-plain">{items.map((it) => {
            const room = roomFor(it.projectId);
            return <li key={it.id} className="d-block rp-task">
              <Link to={`/projects/${it.projectId}/list?item=${it.id}`} className="fw-semibold small text-body d-flex align-items-center gap-1"><span className="mono text-muted">{it.key}</span><span className="truncate">{it.title}</span></Link>
              <div className="small text-muted d-flex gap-2 align-items-center flex-wrap">{fmtDate(it.plannedStart)} → {fmtDate(it.plannedFinish)} · {it.estimateHours ? `${it.estimateHours}h` : <span className="text-warning-emphasis">no hours</span>}{it.status !== 'TODO' && <StatusBadge status={it.status} />}</div>
              {room.length > 0 && it.status === 'TODO' && <label className="rp-move"><UserRoundCog size={13} /><select className="form-select form-select-sm" value="" onChange={(e) => e.target.value && onReassign(it, e.target.value)} aria-label={`Give ${it.key} to someone else`}>
                <option value="">Give to someone else…</option>{room.map(({ x, c }) => <option key={x.userId} value={x.userId}>{x.name} — {free(c) > 0 ? `${h(free(c))} free` : `${h(c.planned - c.capacity)} over`} that week</option>)}</select></label>}
            </li>;
          })}</ul>
        </div>))}
      {others.length > 0 && <><div className="form-label mt-2">Who has room this week</div>
        <ul className="list-plain">{others.map(({ x, c }) => <li key={x.userId} className="small"><Avatar sm name={x.name} /><span className="flex-grow-1 truncate">{x.name}</span><b>{h(free(c))} free</b></li>)}</ul></>}
    </Card>
  );
}
