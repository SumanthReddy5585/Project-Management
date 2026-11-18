// Plan vs original (baseline) comparison. Pure functions; see docs/CALCULATIONS.md.
//
// For every task / subtask / milestone:
//   finishVariance = working days between the original finish and the current forecast finish
//                    (+ = later than the original plan, - = earlier). Done items use their actual finish.
//   forecast finish of an open item = its planned finish, but never earlier than today when it is already overdue.
//   status:
//     DONE_ON_TIME / DONE_LATE  - finished on/before or after the original finish
//     OVERDUE                   - not finished and the original finish date has passed
//     DELAYED                   - not finished, current plan finishes after the original
//     AHEAD                     - not finished, current plan finishes before the original
//     ON_TRACK                  - not finished, same finish as the original
//     NOT_SCHEDULED             - in the original but now has no dates
//     ADDED                     - created after the original plan was locked (scope added)
//     REMOVED                   - in the original plan but deleted or cancelled since (scope removed)
//   lateStart = the original start has passed and work has not started.
//
// Project / phase:
//   originalFinish = latest original finish of their items; forecastFinish = latest forecast finish of open + done items.
//   plannedPct (PV%)  = share of original effort that the original plan expected to be finished by today
//                       (items weighted by original estimate, or equally when none has an estimate;
//                        an item part-way through its original dates counts pro rata by working days).
//   actualPct (EV%)   = the same original items weighted the same way, by their actual % complete.
//   SPI = actualPct / plannedPct (1.0 = exactly on plan; < 1 behind; > 1 ahead).
//   schedule status: AHEAD | ON_TRACK | AT_RISK | DELAYED | COMPLETED (rules in projectStatus()):
//     DELAYED  = end date > 5 working days later than the original, or SPI < 0.8 (once >= 10% was due)
//     AT_RISK  = end date later, any task overdue or slipped past its original finish, or SPI < 0.95
//     AHEAD    = end date earlier (and SPI >= 1), or SPI > 1.1;  COMPLETED = all original+added work done
import { workingDaysBetween } from './calendar.js';

const LEAF = new Set(['TASK', 'SUBTASK', 'MILESTONE']);

export function slipDays(from, to, cal) {
  if (!from || !to) return null;
  if (from === to) return 0;
  return to > from ? workingDaysBetween(from, to, cal) - 1 : -(workingDaysBetween(to, from, cal) - 1);
}

const maxDate = (xs) => xs.filter(Boolean).sort().at(-1) ?? null;

/** Share (0..1) of the original window [s, f] that has elapsed by `today`, in working days. */
export function elapsedShare(s, f, today, cal) {
  if (!s || !f) return 0;
  if (today >= f) return 1;
  if (today < s) return 0;
  const total = workingDaysBetween(s, f, cal);
  if (!total) return 1;
  return Math.min(1, workingDaysBetween(s, today, cal) / total);
}

export function classify(row, today, cal) {
  const { base, cur } = row;
  if (!base) return { status: 'ADDED', finishVariance: null, startVariance: null, lateStart: false, forecastFinish: cur.status === 'DONE' ? cur.actualFinish || cur.plannedFinish : cur.plannedFinish };
  if (!cur || cur.status === 'CANCELLED') return { status: 'REMOVED', finishVariance: null, startVariance: null, lateStart: false, forecastFinish: null };
  const bf = base.plannedFinish; const bs = base.plannedStart;
  const startedOn = cur.actualStart || (cur.status !== 'TODO' ? cur.plannedStart : null);
  const lateStart = Boolean(cur.type !== 'MILESTONE' && bs && bs < today && cur.status === 'TODO' && !cur.actualStart);
  if (cur.status === 'DONE') {
    const af = cur.actualFinish || cur.plannedFinish;
    const v = slipDays(bf, af, cal);
    return { status: v != null && v > 0 ? 'DONE_LATE' : 'DONE_ON_TIME', finishVariance: v, startVariance: slipDays(bs, startedOn || cur.plannedStart, cal), lateStart: false, forecastFinish: af };
  }
  if (!cur.plannedFinish) return { status: 'NOT_SCHEDULED', finishVariance: null, startVariance: null, lateStart, forecastFinish: null };
  const forecast = cur.plannedFinish < today ? today : cur.plannedFinish;
  const v = slipDays(bf, forecast, cal);
  const sv = slipDays(bs, startedOn || (cur.plannedStart && cur.plannedStart < today && cur.status === 'TODO' ? today : cur.plannedStart), cal);
  let status = 'ON_TRACK';
  if (bf && bf < today) status = 'OVERDUE';
  else if (v > 0) status = 'DELAYED';
  else if (v < 0) status = 'AHEAD';
  return { status, finishVariance: v, startVariance: sv, lateStart, forecastFinish: forecast };
}

export function projectStatus({ finishVariance, spi, plannedPct, actualPct, allDone, counts }) {
  if (allDone) return 'COMPLETED';
  const late = (counts.OVERDUE || 0) + (counts.DELAYED || 0);
  if ((finishVariance ?? 0) > 5 || (spi != null && plannedPct >= 10 && spi < 0.8)) return 'DELAYED';
  if ((finishVariance ?? 0) > 0 || late > 0 || (spi != null && plannedPct >= 10 && spi < 0.95)) return 'AT_RISK';
  if ((finishVariance ?? 0) < 0 && (spi == null || spi >= 1)) return 'AHEAD';
  if (spi != null && plannedPct >= 10 && spi > 1.1 && actualPct > plannedPct) return 'AHEAD';
  return 'ON_TRACK';
}

/**
 * @param current  work items now: { id, number, title, type, status, phaseId, parentId, assigneeId, plannedStart, plannedFinish, actualStart, actualFinish, percentComplete, estimateHours }
 * @param original baseline items: { workItemId, title, type, phaseId, parentId, assigneeId, plannedStart, plannedFinish, estimateHours }
 */
export function compareToOriginal({ current, original, today, cal, phases = [] }) {
  const byId = new Map(current.map((i) => [i.id, i]));
  const baseById = new Map(original.map((b) => [b.workItemId, b]));
  const rows = [];
  for (const b of original) {
    const type = b.type || byId.get(b.workItemId)?.type;
    if (!LEAF.has(type)) continue;
    const cur = byId.get(b.workItemId);
    rows.push({ id: b.workItemId, base: b, cur, type });
  }
  for (const c of current) if (LEAF.has(c.type) && !baseById.has(c.id)) rows.push({ id: c.id, base: null, cur: c, type: c.type });

  const counts = {};
  const out = rows.map((r) => {
    const k = classify(r, today, cal);
    counts[k.status] = (counts[k.status] || 0) + 1;
    const c = r.cur; const b = r.base;
    return {
      id: r.id, number: c?.number ?? null, title: c?.title ?? b?.title ?? '(deleted task)', type: r.type, workStatus: c?.status ?? 'DELETED',
      phaseId: c?.phaseId ?? b?.phaseId ?? null, assigneeId: c?.assigneeId ?? null, originalAssigneeId: b?.assigneeId ?? null,
      originalStart: b?.plannedStart ?? null, originalFinish: b?.plannedFinish ?? null, originalEstimate: b?.estimateHours ?? null,
      currentStart: c?.plannedStart ?? null, currentFinish: c?.plannedFinish ?? null, currentEstimate: c?.estimateHours ?? null,
      actualStart: c?.actualStart ?? null, actualFinish: c?.actualFinish ?? null, percentComplete: c?.status === 'DONE' ? 100 : c?.percentComplete ?? 0,
      ...k,
    };
  });

  // Planned value vs earned value over the ORIGINAL scope (added work does not inflate progress).
  const inScope = out.filter((r) => r.originalFinish && r.status !== 'ADDED' && r.status !== 'REMOVED');
  const anyEstimate = inScope.some((r) => r.originalEstimate > 0);
  const weight = (r) => (anyEstimate ? Number(r.originalEstimate || 0) : r.type === 'MILESTONE' ? 0 : 1);
  const totalW = inScope.reduce((s, r) => s + weight(r), 0);
  const ev = (rows2, at) => rows2.reduce((s, r) => s + weight(r) * (r.status === 'REMOVED' ? 0 : (r.status.startsWith('DONE') && (!at || (r.actualFinish || r.currentFinish) <= at) ? 1 : at ? 0 : (r.percentComplete || 0) / 100)), 0);
  const pv = (rows2, at) => rows2.reduce((s, r) => s + weight(r) * elapsedShare(r.originalStart || r.originalFinish, r.originalFinish, at, cal), 0);
  const plannedPct = totalW ? Math.round((pv(inScope, today) / totalW) * 1000) / 10 : null;
  const actualPct = totalW ? Math.round((ev(inScope) / totalW) * 1000) / 10 : null;
  const spi = plannedPct ? Math.round((actualPct / plannedPct) * 100) / 100 : null;

  const originalFinish = maxDate(out.filter((r) => r.status !== 'ADDED').map((r) => r.originalFinish));
  const live = out.filter((r) => r.status !== 'REMOVED');
  const allDone = live.length > 0 && live.every((r) => r.workStatus === 'DONE');
  const forecastFinish = maxDate(live.map((r) => r.forecastFinish));
  const finishVariance = slipDays(originalFinish, forecastFinish, cal);

  // Weekly S-curve: % of original effort planned vs actually completed by each week end.
  const originalStart = out.map((r) => r.originalStart).filter(Boolean).sort()[0] ?? null;
  const curve = [];
  if (originalStart && totalW) {
    const end = maxDate([originalFinish, forecastFinish, today]);
    let d = originalStart;
    for (let n = 0; d <= end && n < 120; n++) {
      const point = { date: d, planned: Math.round((pv(inScope, d) / totalW) * 1000) / 10 };
      if (d <= today) point.actual = Math.round((ev(inScope, d) / totalW) * 1000) / 10;
      curve.push(point);
      const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 7); d = x.toISOString().slice(0, 10);
    }
    if (curve.at(-1)?.date !== end) curve.push({ date: end, planned: Math.round((pv(inScope, end) / totalW) * 1000) / 10, ...(end <= today && { actual: Math.round((ev(inScope, end) / totalW) * 1000) / 10 }) });
  }

  const phaseRows = [...phases, { id: null, name: 'No phase' }].map((ph) => {
    const rs = out.filter((r) => (r.phaseId ?? null) === ph.id);
    if (!rs.length) return null;
    const of = maxDate(rs.filter((r) => r.status !== 'ADDED').map((r) => r.originalFinish));
    const os = rs.filter((r) => r.status !== 'ADDED').map((r) => r.originalStart || r.originalFinish).filter(Boolean).sort()[0] ?? null;
    const cs = rs.filter((r) => r.status !== 'REMOVED').map((r) => r.actualStart || r.currentStart || r.currentFinish).filter(Boolean).sort()[0] ?? null;
    const ff = maxDate(rs.filter((r) => r.status !== 'REMOVED').map((r) => r.forecastFinish));
    const sc = rs.filter((r) => r.originalFinish && r.status !== 'ADDED' && r.status !== 'REMOVED');
    const w = sc.reduce((s, r) => s + weight(r), 0);
    const pp = w ? Math.round((pv(sc, today) / w) * 1000) / 10 : null;
    const ap = w ? Math.round((ev(sc) / w) * 1000) / 10 : null;
    const c = {}; for (const r of rs) c[r.status] = (c[r.status] || 0) + 1;
    const done = rs.filter((r) => r.status !== 'REMOVED').every((r) => r.workStatus === 'DONE');
    const fv = slipDays(of, ff, cal);
    return { id: ph.id, name: ph.name, originalStart: os, currentStart: cs, done, originalFinish: of, forecastFinish: ff, finishVariance: fv, plannedPct: pp, actualPct: ap, counts: c, items: rs.length,
      status: projectStatus({ finishVariance: fv, spi: pp ? ap / pp : null, plannedPct: pp ?? 0, actualPct: ap ?? 0, allDone: done, counts: c }) };
  }).filter(Boolean);

  const currentStart = live.map((r) => r.actualStart || r.currentStart || r.currentFinish).filter(Boolean).sort()[0] ?? null;
  const summary = { originalStart, currentStart, originalFinish, forecastFinish, finishVariance, plannedPct, actualPct, spi, counts, items: out.length,
    status: projectStatus({ finishVariance, spi, plannedPct: plannedPct ?? 0, actualPct: actualPct ?? 0, allDone, counts }) };
  return { summary, phases: phaseRows, items: out, curve };
}
