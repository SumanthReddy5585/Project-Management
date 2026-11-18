// Automatic scheduling of the working plan (forward pass over finish-to-start links).
//
// Rules, in plain words:
//   * A task that waits for others ("starts after") starts on the next working day after the last of them
//     finishes (+ lag). Tasks with no links run in parallel from the project start, or from the date the
//     manager fixed for them ("start no earlier than" = startConstraint).
//   * A task keeps its length in working days; its finish follows its start.
//   * A milestone falls on the day its last predecessor finishes (or on its fixed date, whichever is later).
//   * Work that has started or is done is never moved. Done work hands its actual finish to its dependents.
//   * In an active project, work that is overdue is expected to finish today at the earliest, so whatever
//     waits for it moves out day by day until it is done. The overdue item itself keeps its dates, so it
//     still shows as overdue.
//   * A parent (module, or a task with sub-tasks) spans its children. A link to or from a parent applies
//     to all of its children.
//   * Cancelled items are ignored. Items without both dates are left alone and do not hold anything up.
import { addWorkingDays, nextWorkingDay, workingDaysBetween, DEFAULT_CALENDAR } from './calendar.js';
import { earliestStartAfter } from './dependencies.js';

export class ScheduleCycleError extends Error {}

const STARTED = new Set(['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW']);
const maxKey = (xs) => xs.filter(Boolean).reduce((m, x) => (!m || x > m ? x : m), null);
const minKey = (xs) => xs.filter(Boolean).reduce((m, x) => (!m || x < m ? x : m), null);

/**
 * @param {object} p
 * @param {Array<{id,parentId,type,status,plannedStart,plannedFinish,actualStart?,actualFinish?,startConstraint?}>} p.items dates as 'YYYY-MM-DD'
 * @param {Array<{predecessorId,successorId,type,lagDays}>} p.deps
 * @param {string} p.projectStart
 * @param {string} p.today
 * @param {boolean} p.useToday  push work waiting on overdue items (active projects)
 * @returns {{ dates: Map<string,{start,finish}>, changes: Array<{id, from:{start,finish}, to:{start,finish}}>, finish: string|null }}
 */
export function autoSchedule({ items, deps, projectStart, today, useToday = false, cal = DEFAULT_CALENDAR }) {
  const live = items.filter((i) => i.status !== 'CANCELLED');
  const byId = new Map(live.map((i) => [i.id, i]));
  const kids = new Map();
  for (const i of live) if (i.parentId && byId.has(i.parentId)) kids.set(i.parentId, [...(kids.get(i.parentId) || []), i.id]);
  const isParent = (id) => kids.has(id);
  const leavesOf = (id, out = []) => { for (const k of kids.get(id) || []) (isParent(k) ? leavesOf(k, out) : out.push(k)); return out; };

  // graph: predecessor node -> leaf (with lag); leaf/child -> parent (span)
  const incoming = new Map(live.map((i) => [i.id, []])); // leaf id -> [{from, lag}]
  const out = new Map(live.map((i) => [i.id, new Set()]));
  const indeg = new Map(live.map((i) => [i.id, 0]));
  const edge = (a, b) => { if (!out.get(a).has(b)) { out.get(a).add(b); indeg.set(b, indeg.get(b) + 1); } };
  for (const d of deps) {
    if (d.type && d.type !== 'FS') continue;
    if (!byId.has(d.predecessorId) || !byId.has(d.successorId)) continue;
    const targets = isParent(d.successorId) ? leavesOf(d.successorId) : [d.successorId];
    for (const t of targets) { incoming.get(t).push({ from: d.predecessorId, lag: d.lagDays || 0 }); edge(d.predecessorId, t); }
  }
  for (const i of live) if (i.parentId && byId.has(i.parentId)) edge(i.id, i.parentId);

  const order = []; const q = live.filter((i) => indeg.get(i.id) === 0).map((i) => i.id);
  while (q.length) { const n = q.shift(); order.push(n); for (const m of out.get(n)) { indeg.set(m, indeg.get(m) - 1); if (!indeg.get(m)) q.push(m); } }
  if (order.length !== live.length) throw new ScheduleCycleError('The links between tasks go round in a circle, so the plan cannot be calculated.');

  const dates = new Map(); // id -> {start, finish}
  const eff = new Map();   // id -> finish that dependents wait for
  const late = (f, i) => (useToday && f && f < today && i.status !== 'DONE' ? today : f);

  for (const id of order) {
    const i = byId.get(id);
    if (isParent(id)) {
      const ch = kids.get(id).map((k) => dates.get(k)).filter((x) => x?.start && x?.finish);
      if (!ch.length) { dates.set(id, { start: i.plannedStart, finish: i.plannedFinish }); eff.set(id, late(i.plannedFinish, i)); continue; }
      dates.set(id, { start: minKey(ch.map((x) => x.start)), finish: maxKey(ch.map((x) => x.finish)) });
      eff.set(id, maxKey(kids.get(id).map((k) => eff.get(k))));
      continue;
    }
    const s0 = i.plannedStart; const f0 = i.plannedFinish;
    if (!s0 || !f0) { dates.set(id, { start: s0, finish: f0 }); eff.set(id, null); continue; }
    if (i.status === 'DONE') { dates.set(id, { start: s0, finish: f0 }); eff.set(id, i.actualFinish || f0); continue; }
    if (STARTED.has(i.status) || i.actualStart) { dates.set(id, { start: s0, finish: f0 }); eff.set(id, late(f0, i)); continue; }
    const preds = incoming.get(id).map((p) => ({ f: eff.get(p.from), lag: p.lag })).filter((p) => p.f);
    if (i.type === 'MILESTONE') {
      if (!preds.length && !i.startConstraint) { dates.set(id, { start: s0, finish: f0 }); eff.set(id, late(f0, i)); continue; }
      const d = maxKey([i.startConstraint, ...preds.map((p) => (p.lag > 0 ? addWorkingDays(p.f, p.lag, cal) : p.f))]);
      dates.set(id, { start: d, finish: d }); eff.set(id, late(d, i));
      continue;
    }
    const len = Math.max(1, workingDaysBetween(s0, f0, cal));
    const floor = i.startConstraint || projectStart;
    const start = nextWorkingDay(maxKey([floor, ...preds.map((p) => earliestStartAfter(p.f, p.lag, cal))]), cal);
    // a task that does not move keeps its due date exactly as typed (even on a weekend); one that moves keeps its length
    const finish = start === s0 ? f0 : addWorkingDays(start, len - 1, cal);
    dates.set(id, { start, finish }); eff.set(id, late(finish, i));
  }

  const changes = [];
  for (const i of live) {
    const d = dates.get(i.id);
    if (d && (d.start !== i.plannedStart || d.finish !== i.plannedFinish) && d.start && d.finish) changes.push({ id: i.id, from: { start: i.plannedStart, finish: i.plannedFinish }, to: d });
  }
  const finish = maxKey(live.filter((i) => !isParent(i.id)).map((i) => dates.get(i.id)?.finish));
  return { dates, changes, finish, start: minKey(live.filter((i) => !isParent(i.id)).map((i) => dates.get(i.id)?.start)) };
}

/** Duration in working days of an item as currently dated (1 when undated). */
export const durationOf = (i, cal = DEFAULT_CALENDAR) => (i.type === 'MILESTONE' ? 0 : i.plannedStart && i.plannedFinish ? Math.max(1, workingDaysBetween(i.plannedStart, i.plannedFinish, cal)) : 1);
