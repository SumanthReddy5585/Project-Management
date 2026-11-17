// Capacity model (docs/CALCULATIONS.md):
// capacity(person, range) = working days in range x (weeklyCapacityHours / working days per week)
// planned load = for each assigned, non-done task with planned dates and an estimate, the
//                estimate spread evenly over its working days; the share inside the range counts.
// Recorded time (time entries) is reported separately and never mixed into planned load.
import { workingDaysBetween, DEFAULT_CALENDAR } from './calendar.js';

export function capacityHours(weeklyHours, from, to, cal = DEFAULT_CALENDAR) {
  const perDay = Number(weeklyHours) / cal.workDays.size;
  return Math.round(workingDaysBetween(from, to, cal) * perDay * 10) / 10;
}

export function plannedLoad(tasks, from, to, cal = DEFAULT_CALENDAR) {
  let total = 0;
  for (const t of tasks) {
    if (!t.plannedStart || !t.plannedFinish || !t.estimateHours || ['DONE', 'CANCELLED'].includes(t.status)) continue;
    const span = workingDaysBetween(t.plannedStart, t.plannedFinish, cal);
    if (!span) continue;
    const s = t.plannedStart > from ? t.plannedStart : from;
    const f = t.plannedFinish < to ? t.plannedFinish : to;
    const inRange = workingDaysBetween(s, f, cal);
    const remainingShare = 1 - (t.percentComplete || 0) / 100;
    total += (Number(t.estimateHours) * remainingShare * inRange) / span;
  }
  return Math.round(total * 10) / 10;
}

export function utilization(capacity, load) {
  if (!capacity) return { pct: load > 0 ? Infinity : 0, state: load > 0 ? 'OVER' : 'IDLE' };
  const pct = Math.round((load / capacity) * 100);
  return { pct, state: pct > 100 ? 'OVER' : pct >= 85 ? 'FULL' : 'OK' };
}
