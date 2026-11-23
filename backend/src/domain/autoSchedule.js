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
//   * A work package (module) spans its children; a link to or from it applies to the items inside it.
//   * A task with sub-tasks is a box: it keeps its own length, and its sub-tasks are scheduled inside it
//     (they start no earlier than the task, one after another or in parallel). Whatever waits for the task
//     also waits for its sub-tasks. If sub-tasks would run past the task's end, the task is stretched to
//     cover them and the overrun is reported (the plan editor refuses such changes).
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
  // a box is a dated task with sub-tasks; any other parent (a work package, or an undated task) is a group that spans its children
  const isBox = (id) => kids.has(id) && byId.get(id).type !== 'MODULE' && Boolean(byId.get(id).plannedStart && byId.get(id).plannedFinish);
  const isGroup = (id) => kids.has(id) && !isBox(id);
  const descOf = (id, out = []) => { for (const k of kids.get(id) || []) { out.push(k); descOf(k, out); } return out; };
  const targetsOf = (id) => (isGroup(id) ? kids.get(id).flatMap((k) => targetsOf(k)) : [id]);

  const incoming = new Map(live.map((i) => [i.id, []])); // id -> [{from, lag}]
  const out = new Map(live.map((i) => [i.id, new Set()]));
  const indeg = new Map(live.map((i) => [i.id, 0]));
  const edge = (a, b) => { if (a !== b && !out.get(a).has(b)) { out.get(a).add(b); indeg.set(b, indeg.get(b) + 1); } };
  for (const d of deps) {
    if (d.type && d.type !== 'FS') continue;
    if (!byId.has(d.predecessorId) || !byId.has(d.successorId)) continue;
    for (const t of targetsOf(d.successorId)) {
      incoming.get(t).push({ from: d.predecessorId, lag: d.lagDays || 0 });
      edge(d.predecessorId, t);
      // waiting for a box means waiting for everything inside it too
      if (isBox(d.predecessorId)) for (const x of descOf(d.predecessorId)) edge(x, t);
    }
  }
  for (const i of live) {
    if (!i.parentId || !byId.has(i.parentId)) continue;
    if (isBox(i.parentId)) edge(i.parentId, i.id); // the box is placed first, its sub-tasks inside it
  }
  for (const id of kids.keys()) if (isGroup(id)) for (const x of descOf(id)) edge(x, id); // a group is placed after everything in it

  const order = []; const q = live.filter((i) => indeg.get(i.id) === 0).map((i) => i.id);
  while (q.length) { const n = q.shift(); order.push(n); for (const m of out.get(n)) { indeg.set(m, indeg.get(m) - 1); if (!indeg.get(m)) q.push(m); } }
  if (order.length !== live.length) throw new ScheduleCycleError('The links between tasks go round in a circle, so the plan cannot be calculated.');

  const dates = new Map(); // id -> {start, finish}
  const eff = new Map();   // id -> finish that dependents wait for (own part)
  const effOf = (id) => (kids.has(id) ? maxKey([eff.get(id), ...descOf(id).map((x) => eff.get(x))]) : eff.get(id));
  const late = (f, i) => (useToday && f && f < today && i.status !== 'DONE' ? today : f);

  for (const id of order) {
    const i = byId.get(id);
    if (isGroup(id)) { eff.set(id, maxKey(kids.get(id).map(effOf)) ?? late(i.plannedFinish, i)); continue; } // dates: after the loop
    const s0 = i.plannedStart; const f0 = i.plannedFinish;
    if (!s0 || !f0) { dates.set(id, { start: s0, finish: f0 }); eff.set(id, null); continue; }
    if (i.status === 'DONE') { dates.set(id, { start: s0, finish: f0 }); eff.set(id, i.actualFinish || f0); continue; }
    if (STARTED.has(i.status) || i.actualStart) { dates.set(id, { start: s0, finish: f0 }); eff.set(id, late(f0, i)); continue; }
    const preds = incoming.get(id).map((p) => ({ f: effOf(p.from), lag: p.lag })).filter((p) => p.f);
    if (i.type === 'MILESTONE') {
      if (!preds.length && !i.startConstraint) { dates.set(id, { start: s0, finish: f0 }); eff.set(id, late(f0, i)); continue; }
      const d = maxKey([i.startConstraint, ...preds.map((p) => (p.lag > 0 ? addWorkingDays(p.f, p.lag, cal) : p.f))]);
      dates.set(id, { start: d, finish: d }); eff.set(id, late(d, i));
      continue;
    }
    const len = Math.max(1, workingDaysBetween(s0, f0, cal));
    // inside a box, a sub-task starts no earlier than its task; elsewhere no earlier than the project start
    const box = i.parentId && isBox(i.parentId) ? dates.get(i.parentId) : null;
    const floor = box ? maxKey([i.startConstraint, box.start]) : i.startConstraint || projectStart;
    const start = nextWorkingDay(maxKey([floor, ...preds.map((p) => earliestStartAfter(p.f, p.lag, cal))]), cal);
    // a task that does not move keeps its due date exactly as typed (even on a weekend); one that moves keeps its length
    const finish = start === s0 ? f0 : addWorkingDays(start, len - 1, cal);
    dates.set(id, { start, finish }); eff.set(id, late(finish, i));
  }

  // boxes and groups, deepest first: a box covers its sub-tasks (reporting any overrun), a group spans its children
  const depth = (id) => { let n = 0; for (let p = byId.get(id)?.parentId; p && byId.has(p); p = byId.get(p).parentId) n += 1; return n; };
  const overflow = [];
  for (const id of [...kids.keys()].sort((a, b) => depth(b) - depth(a))) {
    const ch = kids.get(id).map((k) => dates.get(k)).filter((x) => x?.start && x?.finish);
    const i = byId.get(id);
    if (isGroup(id)) { dates.set(id, ch.length ? { start: minKey(ch.map((x) => x.start)), finish: maxKey(ch.map((x) => x.finish)) } : { start: i.plannedStart, finish: i.plannedFinish }); continue; }
    const own = dates.get(id);
    const need = maxKey(ch.map((x) => x.finish));
    if (need && need > own.finish) { overflow.push({ id, finish: own.finish, needed: need }); dates.set(id, { start: minKey([own.start, ...ch.map((x) => x.start)]), finish: need }); }
  }

  const changes = [];
  for (const i of live) {
    const d = dates.get(i.id);
    if (d && (d.start !== i.plannedStart || d.finish !== i.plannedFinish) && d.start && d.finish) changes.push({ id: i.id, from: { start: i.plannedStart, finish: i.plannedFinish }, to: d });
  }
  const real = live.filter((i) => !isGroup(i.id));
  return { dates, changes, overflow, finish: maxKey(real.map((i) => dates.get(i.id)?.finish)), start: minKey(real.map((i) => dates.get(i.id)?.start)) };
}

/** Duration in working days of an item as currently dated (1 when undated). */
export const durationOf = (i, cal = DEFAULT_CALENDAR) => (i.type === 'MILESTONE' ? 0 : i.plannedStart && i.plannedFinish ? Math.max(1, workingDaysBetween(i.plannedStart, i.plannedFinish, cal)) : 1);
