// Dependency graph utilities. Only finish-to-start (FS) is scheduled today; other types are
// stored but flagged as "not scheduled" in the UI and ignored by calculations.
import { addWorkingDays, nextWorkingDay, workingDaysBetween, DEFAULT_CALENDAR } from './calendar.js';

export function wouldCreateCycle(edges, predecessorId, successorId) {
  if (predecessorId === successorId) return true;
  const out = new Map();
  for (const e of edges) out.set(e.predecessorId, [...(out.get(e.predecessorId) || []), e.successorId]);
  const stack = [successorId]; const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (n === predecessorId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(out.get(n) || []));
  }
  return false;
}

/**
 * Earliest allowed start for a successor of `pred` under FS + lag: the (1 + lag)-th working day after the
 * predecessor's finish. A finish on a weekend/holiday counts as finished that day, so the successor may
 * start on the very next working day (Fri or Sat finish → Monday start, not Tuesday).
 */
export const earliestStartAfter = (predFinish, lag, cal) => addWorkingDays(predFinish, 1 + Math.max(0, lag), cal);

/** Items whose planned start violates an FS predecessor. */
export function scheduleConflicts(items, deps, cal = DEFAULT_CALENDAR) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = [];
  for (const d of deps) {
    if (d.type !== 'FS') continue;
    const p = byId.get(d.predecessorId); const s = byId.get(d.successorId);
    if (!p?.plannedFinish || !s?.plannedStart || s.status === 'CANCELLED') continue;
    const earliest = earliestStartAfter(p.plannedFinish, d.lagDays || 0, cal);
    if (s.plannedStart < earliest) out.push({ successorId: s.id, predecessorId: p.id, earliestStart: earliest, plannedStart: s.plannedStart });
  }
  return out;
}

/**
 * Preview downstream impact of moving one item. Successors are pushed forward only (never
 * pulled earlier), preserving their working-day duration. Nothing is persisted here.
 */
export function previewShift(items, deps, changedId, newStart, newFinish, cal = DEFAULT_CALENDAR) {
  const cur = new Map(items.map((i) => [i.id, { ...i }]));
  const changed = cur.get(changedId);
  if (!changed) throw new Error('unknown item');
  changed.plannedStart = newStart; changed.plannedFinish = newFinish;
  const succ = new Map();
  for (const d of deps) if (d.type === 'FS') succ.set(d.predecessorId, [...(succ.get(d.predecessorId) || []), d]);
  const moves = new Map();
  const queue = [changedId];
  let guard = 0;
  while (queue.length && guard++ < 10000) {
    const pid = queue.shift(); const p = cur.get(pid);
    for (const d of succ.get(pid) || []) {
      const s = cur.get(d.successorId);
      if (!s?.plannedStart || !s.plannedFinish || !p.plannedFinish || s.status === 'CANCELLED' || s.status === 'DONE') continue;
      const earliest = earliestStartAfter(p.plannedFinish, d.lagDays || 0, cal);
      if (s.plannedStart >= earliest) continue;
      const dur = Math.max(1, workingDaysBetween(s.plannedStart, s.plannedFinish, cal));
      const orig = moves.get(s.id)?.from || { start: s.plannedStart, finish: s.plannedFinish };
      s.plannedStart = earliest;
      s.plannedFinish = addWorkingDays(earliest, dur - 1, cal);
      moves.set(s.id, { id: s.id, from: orig, to: { start: s.plannedStart, finish: s.plannedFinish } });
      queue.push(s.id);
    }
  }
  return [...moves.values()];
}

/**
 * Critical path (CPM) over FS dependencies using working-day durations from planned dates.
 * Items without both planned dates are excluded and reported.
 */
export function criticalPath(items, deps, cal = DEFAULT_CALENDAR) {
  const nodes = items.filter((i) => i.plannedStart && i.plannedFinish && i.status !== 'CANCELLED');
  const ids = new Set(nodes.map((n) => n.id));
  const fs = deps.filter((d) => d.type === 'FS' && ids.has(d.predecessorId) && ids.has(d.successorId));
  const dur = new Map(nodes.map((n) => [n.id, n.type === 'MILESTONE' ? 0 : Math.max(1, workingDaysBetween(n.plannedStart, n.plannedFinish, cal))]));
  const preds = new Map(); const succs = new Map(); const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const d of fs) {
    preds.set(d.successorId, [...(preds.get(d.successorId) || []), d]);
    succs.set(d.predecessorId, [...(succs.get(d.predecessorId) || []), d]);
    indeg.set(d.successorId, indeg.get(d.successorId) + 1);
  }
  const order = []; const q = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (q.length) { const n = q.shift(); order.push(n); for (const d of succs.get(n) || []) { indeg.set(d.successorId, indeg.get(d.successorId) - 1); if (!indeg.get(d.successorId)) q.push(d.successorId); } }
  if (order.length !== nodes.length) throw new Error('Dependency cycle detected');
  const ES = new Map(); const EF = new Map();
  for (const id of order) {
    const es = Math.max(0, ...(preds.get(id) || []).map((d) => EF.get(d.predecessorId) + (d.lagDays || 0)));
    ES.set(id, es); EF.set(id, es + dur.get(id));
  }
  const finish = Math.max(0, ...EF.values());
  const LS = new Map(); const LF = new Map();
  for (const id of [...order].reverse()) {
    const lf = Math.min(finish, ...(succs.get(id) || []).map((d) => LS.get(d.successorId) - (d.lagDays || 0)));
    LF.set(id, lf); LS.set(id, lf - dur.get(id));
  }
  const result = nodes.map((n) => ({ id: n.id, duration: dur.get(n.id), earlyStart: ES.get(n.id), lateStart: LS.get(n.id), slack: LS.get(n.id) - ES.get(n.id) }));
  return {
    durationDays: finish,
    critical: result.filter((r) => r.slack === 0 && (fs.some((d) => d.predecessorId === r.id || d.successorId === r.id) || nodes.length === 1)).map((r) => r.id),
    nodes: result,
    excluded: items.filter((i) => !ids.has(i.id)).map((i) => i.id),
  };
}
