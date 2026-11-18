import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Save, Flag } from 'lucide-react';
import { get, post, patch, del } from '../../api/client.js';
import { useLive } from '../../lib/live.js';
import { useLoad } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { addDaysISO, fmtDate, labelize, todayISO } from '../../lib/format.js';
import { ErrorBox, Field, Loading, Modal, Notice, Select, StatusBadge, useToast, Empty } from '../../components/ui.jsx';
import { useProject } from './Workspace.jsx';

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function RescheduleModal({ item, onClose, onApplied, initial }) {
  const { project } = useProject();
  const toast = useToast();
  const [start, setStart] = useState(initial?.start || item.plannedStart || todayISO());
  const [finish, setFinish] = useState(initial?.finish || item.plannedFinish || item.plannedStart || todayISO());
  const [preview, setPreview] = useState(initial?.preview || null);
  const [withDown, setWithDown] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const isMs = item.type === 'MILESTONE';
  const doPreview = async () => { setErr(null); try { setPreview(await post(`/projects/${project.id}/schedule/preview`, { itemId: item.id, plannedStart: start, plannedFinish: isMs ? start : finish })); } catch (e) { setErr(e); } };
  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post(`/projects/${project.id}/schedule/apply`, { itemId: item.id, plannedStart: start, plannedFinish: isMs ? start : finish, includeDownstream: withDown && preview.moves.length > 0, expectedMoves: withDown ? preview.moves.map((m) => ({ id: m.id, start: m.to.start, finish: m.to.finish })) : [] });
      toast(`${r.updated} task(s) moved`, 'success'); onApplied(); onClose();
    } catch (e) { setErr(e); if (e.status === 409) setPreview(null); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Change dates" size="lg" footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button>
      {!preview ? <button className="btn btn-primary" onClick={doPreview}>Check what else moves</button> : <button className="btn btn-primary" disabled={busy} onClick={apply}>{busy ? 'Applying…' : `Save ${1 + (withDown ? preview.moves.length : 0)} change(s)`}</button>}</>}>
      <p className="mb-2 fw-medium">{item.title}</p>
      <ErrorBox error={err} />
      <div className="row"><div className="col-6"><Field label={isMs ? 'Date' : 'Start'}>{(id) => <input id={id} type="date" className="form-control" value={start} onChange={(e) => { setStart(e.target.value); setPreview(null); }} />}</Field></div>
        {!isMs && <div className="col-6"><Field label="Due">{(id) => <input id={id} type="date" className="form-control" value={finish} min={start} onChange={(e) => { setFinish(e.target.value); setPreview(null); }} />}</Field></div>}</div>
      {preview && (preview.moves.length === 0 ? <Notice>Nothing else needs to move.</Notice> : <>
        <Notice tone="warn">{preview.moves.length} task(s) that wait for this one would now start too early. We can push them later and keep their length.</Notice>
        <table className="table table-sm mt-2"><thead><tr><th>Task</th><th>Now</th><th>New dates</th></tr></thead>
          <tbody>{preview.moves.map((m) => <tr key={m.id}><td><span className="mono text-muted">{project.code}-{m.number}</span> {m.title}</td><td className="small">{fmtDate(m.from.start)} → {fmtDate(m.from.finish)}</td><td className="small fw-semibold">{fmtDate(m.to.start)} → {fmtDate(m.to.finish)}</td></tr>)}</tbody></table>
        <div className="form-check"><input className="form-check-input" type="checkbox" id="wd" checked={withDown} onChange={(e) => setWithDown(e.target.checked)} /><label className="form-check-label" htmlFor="wd">Move these too</label></div>
        {!withDown && <div className="form-text">Only this task changes; the others will be flagged as starting too early.</div>}
      </>)}
    </Modal>
  );
}

export function Timeline() {
  const { project, can, openItem, reload: reloadProject } = useProject();
  const toast = useToast();
  const items = useLoad(() => get(`/projects/${project.id}/work-items`, { all: 'true' }), [project.id]);
  useLive((e) => e.type === 'work.changed' && e.projectId === project.id && !e.self, () => items.reload({ silent: true }), [project.id]);
  const analysis = useLoad(() => get(`/projects/${project.id}/schedule/analysis`), [project.id, items.data]);
  const baselines = useLoad(() => get(`/projects/${project.id}/baselines`), [project.id]);
  const [blId, setBlId] = useState('');
  const [blTouched, setBlTouched] = useState(false);
  useEffect(() => { const o = baselines.data?.data?.find((b) => b.kind === 'ORIGINAL'); if (o && !blTouched && !blId) setBlId(o.id); }, [baselines.data, blTouched, blId]);
  const cmp = useLoad(() => (blId ? get(`/projects/${project.id}/baselines/${blId}/compare`) : Promise.resolve(null)), [blId, items.data]);
  const [showCp, setShowCp] = useState(true);
  const [zoom, setZoom] = useState(20);
  const [moving, setMoving] = useState(null);
  const [blName, setBlName] = useState(null);
  const deps = useLoad(() => get(`/projects/${project.id}/dependencies`), [project.id, items.data]);
  const [drag, setDrag] = useState(null); // { id, mode, x0, s, f, ds, df }
  const [link, setLink] = useState(null); // { fromId, x, y }
  const [selDep, setSelDep] = useState(null);
  const [busy, setBusy] = useState(false);
  const laneRef = useRef(null);
  const dragRef = useRef(null);
  dragRef.current = drag;
  const live = useRef({});
  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const d = dragRef.current; if (!d) return;
      const n = Math.round((e.clientX - d.x0) / live.current.zoom);
      let ds = d.s; let df = d.f;
      if (d.mode === 'move') { ds = addDaysISO(d.s, n); df = addDaysISO(d.f, n); }
      if (d.mode === 'start') { ds = addDaysISO(d.s, n); if (ds > df) ds = df; }
      if (d.mode === 'end') { df = addDaysISO(d.f, n); if (df < ds) df = ds; }
      setDrag({ ...d, ds, df, moved: d.moved || Math.abs(e.clientX - d.x0) > 3 });
    };
    const up = async () => {
      const d = dragRef.current; setDrag(null);
      if (!d) return;
      const item = live.current.byId.get(d.id);
      if (!d.moved) { setMoving(item); return; }
      if (d.ds === d.s && d.df === d.f) return;
      const finish = item.type === 'MILESTONE' ? d.ds : d.df;
      setBusy(true);
      try {
        const pv = await post(`/projects/${project.id}/schedule/preview`, { itemId: d.id, plannedStart: d.ds, plannedFinish: finish });
        if (pv.moves.length) { setMoving({ ...item, _initial: { start: d.ds, finish, preview: pv } }); return; }
        await post(`/projects/${project.id}/schedule/apply`, { itemId: d.id, plannedStart: d.ds, plannedFinish: finish, includeDownstream: false, expectedMoves: [] });
        toast(`${item.title}: ${fmtDate(d.ds)} → ${fmtDate(finish)}`, 'success');
        items.reload({ silent: true }); reloadProject();
      } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id]);
  const laneXY = (e) => { const b = laneRef.current.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  live.current = { zoom, laneXY, byId: live.current.byId };
  const onLinkDown = (e, r) => { e.preventDefault(); e.stopPropagation(); setLink({ fromId: r.id, ...laneXY(e) }); };
  useEffect(() => {
    if (!link) return undefined;
    const move = (e) => setLink((l) => (l ? { ...l, ...live.current.laneXY(e) } : l));
    const up = async (e) => {
      const fromId = link.fromId; setLink(null);
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-item]');
      const toId = el?.getAttribute('data-item');
      if (!toId || toId === fromId) return;
      try { await post(`/projects/${project.id}/dependencies`, { predecessorId: fromId, successorId: toId, type: 'FS' }); toast(`Linked: ${live.current.byId.get(fromId)?.key} must finish before ${live.current.byId.get(toId)?.key} starts`, 'success'); deps.reload(); items.reload({ silent: true }); }
      catch (err) { toast(err.message, 'error'); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.fromId]);

  const rows = useMemo(() => {
    const all = items.data?.data || [];
    const byParent = new Map();
    for (const i of all) byParent.set(i.parentId || `phase:${i.phaseId}`, [...(byParent.get(i.parentId || `phase:${i.phaseId}`) || []), i]);
    const out = [];
    const walk = (key, depth) => { for (const i of (byParent.get(key) || []).sort((a, b) => (a.plannedStart || '9').localeCompare(b.plannedStart || '9') || a.number - b.number)) { out.push({ ...i, depth }); walk(i.id, depth + 1); } };
    for (const ph of project.phases) { out.push({ phase: true, ...ph, depth: 0 }); walk(`phase:${ph.id}`, 1); }
    if (byParent.get('phase:null')?.length) { out.push({ phase: true, id: 'none', name: 'No phase', depth: 0 }); walk('phase:null', 1); }
    return out;
  }, [items.data, project.phases]);
  if (items.loading && !items.data) return <Loading rows={8} />;
  const dated = rows.filter((r) => r.plannedStart);
  const start = addDaysISO([project.plannedStart, ...dated.map((r) => r.plannedStart)].sort()[0], -3);
  const end = addDaysISO([project.plannedFinish, ...dated.map((r) => r.plannedFinish || r.plannedStart)].sort().at(-1), 5);
  const days = Math.min(730, dayDiff(start, end) + 1);
  const dayList = [...Array(days)].map((_, i) => addDaysISO(start, i));
  const x = (d) => dayDiff(start, d) * zoom;
  const today = todayISO();
  const cp = new Set(showCp ? analysis.data?.criticalPath?.ids || [] : []);
  const conflicts = new Set((analysis.data?.conflicts || []).map((c) => c.successorId));
  const base = new Map((cmp.data?.data || []).map((r) => [r.id, r]));
  const canSchedule = can('work.schedule') && !project.readOnly;
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  live.current.byId = byId;
  const shown = (r) => (drag?.id === r.id ? { s: drag.ds, f: drag.df } : { s: r.plannedStart, f: r.plannedFinish || r.plannedStart });
  const onBarDown = (e, r, mode) => {
    if (!canSchedule || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const s0 = r.plannedStart; const f0 = r.plannedFinish || r.plannedStart;
    setDrag({ id: r.id, mode, x0: e.clientX, s: s0, f: f0, ds: s0, df: f0, moved: false });
  };
  const removeDep = async (d) => { try { await del(`/projects/${project.id}/dependencies/${d.id}`); toast('Link removed', 'success'); setSelDep(null); deps.reload(); items.reload({ silent: true }); } catch (e) { toast(e.message, 'error'); } };
  const ROW = 36;
  const arrows = (deps.data?.data || []).map((d) => {
    const a = byId.get(d.predecessorId); const b = byId.get(d.successorId);
    if (!a || !b || !a.plannedStart || !b.plannedStart) return null;
    const A = shown(a); const B = shown(b);
    const fromEnd = d.type === 'FS' || d.type === 'FF'; const toStart = d.type === 'FS' || d.type === 'SS';
    const x1 = fromEnd ? x(A.f) + zoom : x(A.s); const y1 = rowIndex.get(a.id) * ROW + ROW / 2;
    const x2 = toStart ? x(B.s) : x(B.f) + zoom; const y2 = rowIndex.get(b.id) * ROW + ROW / 2;
    const bend = fromEnd ? x1 + 8 : x1 - 8;
    const path = x2 - 8 >= bend || !fromEnd
      ? `M${x1},${y1} H${bend} V${y2} H${x2 - (toStart ? 2 : -2)}`
      : `M${x1},${y1} H${bend} V${y1 + (y2 > y1 ? ROW / 2 : -ROW / 2)} H${x2 - 12} V${y2} H${x2 - 2}`;
    const late = conflicts.has(b.id);
    return { d, path, late };
  }).filter(Boolean);
  const saveBaseline = async () => { try { await post(`/projects/${project.id}/baselines`, { name: blName }); toast('Plan saved', 'success'); setBlName(null); baselines.reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <div className="filters">
        <div className="btn-group btn-group-sm" role="group" aria-label="Zoom">{[[34, 'Days'], [20, 'Weeks'], [7, 'Months']].map(([z, l]) => <button key={z} className={`btn btn-light ${zoom === z ? 'active' : ''}`} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{l}</button>)}</div>
        <div className="form-check form-switch m-0"><input className="form-check-input" type="checkbox" id="cp" checked={showCp} onChange={(e) => setShowCp(e.target.checked)} /><label className="form-check-label small" htmlFor="cp">Show critical path</label></div>
        <Select aria-label="Compare with baseline" value={blId} onChange={(v) => { setBlTouched(true); setBlId(v || ''); }} placeholder="Compare with a saved plan…" options={(baselines.data?.data || []).map((b) => ({ value: b.id, label: b.kind === 'ORIGINAL' ? `🔒 ${b.name}` : `${b.kind === 'REVISION' ? 'Revision' : 'Snapshot'}: ${b.name} · ${fmtDate(b.createdAt)}` }))} />
        {canSchedule && <button className="btn btn-sm btn-light" onClick={() => setBlName(`Snapshot ${fmtDate(today)}`)} title="Saves an extra copy for reference. The original plan is never replaced."><Save size={14} /> Save snapshot</button>}
      </div>
      <div className="small text-muted mb-2">{canSchedule ? 'Drag a bar to move it, drag its edges to change the dates, or drag the dot at its end onto another task to link them. Click an arrow to remove a link.' : 'Click a bar to open it.'}{busy ? ' Saving…' : ''}{analysis.data?.criticalPath && showCp ? ` Red bars are the critical path: if any of them slip, the end date slips (${analysis.data.criticalPath.durationDays} working days end to end).` : ''}</div>
      <ErrorBox error={items.error || analysis.error} />
      <div className="d-flex gap-3 small text-muted my-2 flex-wrap"><span><span className="gantt-legend" style={{ display: 'inline-block', width: 14, height: 8, background: 'var(--steel-500)', borderRadius: 2 }} /> Task</span><span><span style={{ display: 'inline-block', width: 14, height: 8, background: 'var(--risk)', borderRadius: 2 }} /> Critical</span><span><span style={{ display: 'inline-block', width: 14, height: 8, background: 'var(--ok)', borderRadius: 2 }} /> Done</span><span><span style={{ display: 'inline-block', width: 14, height: 8, boxShadow: '0 0 0 2px var(--warn)', borderRadius: 2 }} /> Conflict</span>{blId && <span><span style={{ display: 'inline-block', width: 14, height: 4, background: '#94a3b8' }} /> {baselines.data?.data?.find((b) => b.id === blId)?.kind === 'ORIGINAL' ? 'Original plan' : 'Saved plan'} (Var. = finish slip in working days)</span>}</div>
      <div className="gantt">
        <div className="gantt-left">
          <div className="gantt-head small-caps d-flex align-items-center px-2">Task{blId && <span className="ms-auto">Var.</span>}</div>
          {rows.map((r) => <div key={r.id} className="gantt-row" style={{ paddingLeft: 8 + r.depth * 14, background: r.phase ? '#fafbfc' : undefined }}>
            {r.phase ? <strong className="small">{r.name}</strong> : <><span className="mono text-muted small">{r.key}</span><button onClick={() => openItem(r.id)} className="truncate">{r.title}</button>
              {blId && base.get(r.id)?.finishVarianceDays != null && base.get(r.id).finishVarianceDays !== 0 && <span className={`ms-auto small fw-semibold ${base.get(r.id).finishVarianceDays > 0 ? 'text-danger' : 'text-success'}`}>{base.get(r.id).finishVarianceDays > 0 ? '+' : ''}{base.get(r.id).finishVarianceDays}d</span>}</>}
          </div>)}
        </div>
        <div className="gantt-right">
          <div style={{ width: days * zoom, position: 'relative' }} className={drag ? 'gantt-dragging' : ''}>
            <div className="gantt-head">{dayList.map((d) => { const dt = new Date(`${d}T00:00:00Z`); const wd = dt.getUTCDay(); const first = dt.getUTCDate() === 1;
              return <div key={d} className={`gantt-day ${wd === 0 || wd === 6 ? 'weekend' : ''} ${d === today ? 'today' : ''}`} style={{ width: zoom }}>{zoom >= 20 ? (wd === 1 || zoom >= 34 ? <>{dt.getUTCDate()}<br />{first || wd === 1 ? dt.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' }) : ''}</> : '') : first ? dt.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' }) : ''}</div>; })}</div>
            {today >= start && today <= end && <div className="gantt-today" style={{ left: x(today) + zoom / 2, top: 44 }} />}
            <div ref={laneRef} style={{ position: 'relative' }}>
            <svg className="gantt-links" width={days * zoom} height={rows.length * ROW} aria-hidden="true">
              <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b" /></marker>
                <marker id="arr-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#d97706" /></marker>
                <marker id="arr-sel" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#2563eb" /></marker></defs>
              {arrows.map(({ d, path, late }) => <g key={d.id} className="gantt-link" onClick={() => canSchedule && setSelDep(d)}>
                <path d={path} className="hit" /><path d={path} className={`line ${late ? 'late' : ''} ${selDep?.id === d.id ? 'sel' : ''}`} markerEnd={`url(#${selDep?.id === d.id ? 'arr-sel' : late ? 'arr-late' : 'arr'})`} /></g>)}
              {link && (() => { const a = byId.get(link.fromId); const A = shown(a); return <path d={`M${x(A.f) + zoom},${rowIndex.get(a.id) * ROW + ROW / 2} L${link.x},${link.y}`} className="line drawing" markerEnd="url(#arr-sel)" />; })()}
            </svg>
            {rows.map((r) => {
              const { s, f } = shown(r);
              const bl = base.get(r.id);
              return (
                <div key={r.id} className="gantt-lane" style={{ background: r.phase ? '#fafbfc' : undefined }}>
                  {bl?.baselineStart && <div className="gantt-baseline" style={{ left: x(bl.baselineStart), width: Math.max(zoom, (dayDiff(bl.baselineStart, bl.baselineFinish || bl.baselineStart) + 1) * zoom) }} />}
                  {s && (r.type === 'MILESTONE'
                    ? <><button data-item={r.id} className={`gantt-ms ${r.status === 'DONE' ? 'done' : ''} ${drag?.id === r.id ? 'dragging' : ''}`} style={{ left: x(s) + zoom / 2 - 8 }} title={`${r.title} · ${fmtDate(s)}`} aria-label={`Milestone ${r.title}, ${fmtDate(s)}`}
                        onPointerDown={(e) => onBarDown(e, r, 'move')} onClick={() => !canSchedule && openItem(r.id)} onKeyDown={(e) => e.key === 'Enter' && canSchedule && setMoving(r)} />
                      {canSchedule && <span className="gantt-dot" style={{ left: x(s) + zoom / 2 + 9 }} onPointerDown={(e) => onLinkDown(e, r)} title="Drag to another task to link" />}</>
                    : <><div data-item={r.phase || r.type === 'MODULE' ? undefined : r.id} role="button" tabIndex={r.phase || r.type === 'MODULE' ? -1 : 0} className={`gantt-bar ${r.phase ? 'phase' : r.type === 'MODULE' ? 'module' : ''} ${cp.has(r.id) ? 'critical' : ''} ${conflicts.has(r.id) ? 'conflict' : ''} ${r.status === 'DONE' ? 'done' : ''} ${canSchedule && !r.phase && r.type !== 'MODULE' ? 'draggable' : ''} ${drag?.id === r.id ? 'dragging' : ''}`}
                        style={{ left: x(s), width: Math.max(zoom, (dayDiff(s, f) + 1) * zoom) }} title={`${r.phase ? r.name : r.title} · ${fmtDate(s)} → ${fmtDate(f)}`}
                        aria-label={`${r.phase ? r.name : r.title}: ${fmtDate(s)} to ${fmtDate(f)}`}
                        onPointerDown={(e) => !r.phase && r.type !== 'MODULE' && onBarDown(e, r, 'move')}
                        onClick={() => !canSchedule && !r.phase && r.type !== 'MODULE' && openItem(r.id)}
                        onDoubleClick={() => !r.phase && r.type !== 'MODULE' && openItem(r.id)}
                        onKeyDown={(e) => e.key === 'Enter' && !r.phase && r.type !== 'MODULE' && (canSchedule ? setMoving(r) : openItem(r.id))}>
                        {!r.phase && r.type !== 'MODULE' && <span className="fill" style={{ width: `${r.progress || 0}%` }} />}{zoom >= 20 && !r.phase && r.type !== 'MODULE' ? <span style={{ position: 'relative', pointerEvents: 'none' }}>{r.title}</span> : null}
                        {canSchedule && !r.phase && r.type !== 'MODULE' && <><span className="grip l" onPointerDown={(e) => onBarDown(e, r, 'start')} /><span className="grip r" onPointerDown={(e) => onBarDown(e, r, 'end')} /></>}
                      </div>
                      {canSchedule && !r.phase && r.type !== 'MODULE' && <span className="gantt-dot" style={{ left: x(s) + Math.max(zoom, (dayDiff(s, f) + 1) * zoom) + 3 }} onPointerDown={(e) => onLinkDown(e, r)} title="Drag to another task to link" />}</>)}
                  {drag?.id === r.id && <span className="gantt-tip" style={{ left: x(s) }}>{fmtDate(s)}{r.type !== 'MILESTONE' ? ` → ${fmtDate(f)}` : ''}</span>}
                </div>);
            })}
            </div>
          </div>
        </div>
      </div>
      {dated.length === 0 && <div className="form-text mt-2">Add planned dates to work items to see them on the timeline.</div>}
      {moving && <RescheduleModal item={moving} initial={moving._initial} onClose={() => setMoving(null)} onApplied={() => { items.reload(); reloadProject(); }} />}
      {selDep && <div className="bulkbar rounded mt-2"><span>Link: <strong>{byId.get(selDep.predecessorId)?.key}</strong> {selDep.type === 'FS' ? 'must finish before' : selDep.type === 'SS' ? 'must start before' : selDep.type === 'FF' ? 'must finish before finishing' : 'starts before finishing'} <strong>{byId.get(selDep.successorId)?.key}</strong>{selDep.lagDays ? ` (+${selDep.lagDays}d lag)` : ''}</span>
        <button className="btn btn-sm btn-outline-danger ms-auto" onClick={() => removeDep(selDep)}>Remove link</button><button className="btn btn-sm btn-ghost" onClick={() => setSelDep(null)}>Close</button></div>}
      <Modal open={blName != null} onClose={() => setBlName(null)} title="Save a snapshot of the plan" footer={<><button className="btn btn-light" onClick={() => setBlName(null)}>Cancel</button><button className="btn btn-primary" disabled={!blName?.trim()} onClick={saveBaseline}>Save</button></>}>
        <p className="small text-muted">Saves today's dates and estimates as an extra reference point. It does not replace the locked original plan, which stays the main comparison.</p>
        <Field label="Name">{(id) => <input id={id} className="form-control" value={blName || ''} onChange={(e) => setBlName(e.target.value)} />}</Field>
      </Modal>
    </>
  );
}

export function CalendarView() {
  const { project, openItem } = useProject();
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const { data, error, loading, reload } = useLoad(() => get(`/projects/${project.id}/work-items`, { all: 'true' }), [project.id]);
  useLive((e) => e.type === 'work.changed' && e.projectId === project.id && !e.self, () => reload({ silent: true }), [project.id]);
  const first = `${month}-01`;
  const gridStart = addDaysISO(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7));
  const cells = [...Array(42)].map((_, i) => addDaysISO(gridStart, i));
  const byDay = new Map();
  for (const i of data?.data || []) { const d = i.plannedFinish || i.plannedStart; if (d && i.type !== 'MODULE') byDay.set(d, [...(byDay.get(d) || []), i]); }
  const shift = (n) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const today = todayISO();
  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-2"><button className="btn btn-sm btn-light" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={15} /></button>
        <h2 className="h6 m-0" style={{ minWidth: 150, textAlign: 'center' }}>{new Date(`${first}T00:00:00Z`).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
        <button className="btn btn-sm btn-light" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={15} /></button><button className="btn btn-sm btn-link" onClick={() => setMonth(today.slice(0, 7))}>Today</button>
        <span className="small text-muted ms-auto">Tasks show on their due date.</span></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : <div className="cal" role="grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
        {cells.map((d) => <div key={d} role="gridcell" className={`cell ${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''}`}><span className="num">{Number(d.slice(8))}</span>
          {(byDay.get(d) || []).slice(0, 4).map((i) => <button key={i.id} className={`ev ${i.type === 'MILESTONE' ? 'ms' : ''} ${d < today && !['DONE', 'CANCELLED'].includes(i.status) ? 'late' : ''}`} onClick={() => openItem(i.id)} title={i.title}>{i.type === 'MILESTONE' ? '◆ ' : ''}{i.title}</button>)}
          {(byDay.get(d) || []).length > 4 && <div className="small text-muted">+{byDay.get(d).length - 4} more</div>}</div>)}
      </div>}
    </>
  );
}

export function Milestones() {
  const { project, can, openItem, reload: reloadProject } = useProject();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get(`/projects/${project.id}/work-items`, { type: 'MILESTONE', all: 'true', sort: 'plannedFinish', dir: 'asc' }), [project.id]);
  const phaseName = new Map(project.phases.map((p) => [p.id, p.name]));
  const today = todayISO();
  const toggle = async (m) => { try { await patch(`/projects/${project.id}/work-items/${m.id}`, { status: m.status === 'DONE' ? 'TODO' : 'DONE', version: m.version }); reload(); reloadProject(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="card"><ErrorBox error={error} />
      {loading && !data ? <div className="p-3"><Loading /></div> : data?.data.length === 0 ? <Empty icon={Flag} title="No milestones" /> : (
        <table className="table table-hover"><thead><tr><th>Milestone</th><th>Phase</th><th>Date</th><th>Status</th>{can('work.editAny') && <th />}</tr></thead>
          <tbody>{data.data.map((m) => { const late = m.status !== 'DONE' && m.plannedFinish && m.plannedFinish < today; return (
            <tr key={m.id}><td><button className="btn btn-link p-0 text-start text-body fw-medium" onClick={() => openItem(m.id)}><Flag size={13} className={m.status === 'DONE' ? 'text-success me-1' : late ? 'text-danger me-1' : 'text-muted me-1'} />{m.title}</button></td>
              <td className="small">{phaseName.get(m.phaseId) || '—'}</td><td className={`small ${late ? 'text-danger fw-semibold' : ''}`}>{fmtDate(m.plannedFinish)}{late && ' · overdue'}</td><td><StatusBadge status={m.status} /></td>
              {can('work.editAny') && <td className="text-end">{!project.readOnly && <button className="btn btn-sm btn-light" onClick={() => toggle(m)}>{m.status === 'DONE' ? 'Reopen' : 'Mark reached'}</button>}</td>}</tr>); })}</tbody></table>)}
    </div>
  );
}
