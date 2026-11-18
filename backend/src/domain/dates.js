// Rules for changing a task's planned dates (pure; see docs/CALCULATIONS.md "Changing dates").
//   - Milestones have one date: start = finish.
//   - Changing only the START keeps the task's length in working days: the due date moves with it.
//   - Changing only the DUE date keeps the start; it may not be before the start.
//   - Changing both: the due date may not be before the start.
//   - Clearing a date is allowed (the task becomes unscheduled).
import { workingDaysBetween, addWorkingDays, nextWorkingDay, addDays } from './calendar.js';

export class DateRuleError extends Error {}

const fmt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Length of [s, f] in working days (calendar days if the task sits entirely on non-working days). */
export function lengthOf(s, f, cal) {
  const wd = workingDaysBetween(s, f, cal);
  return wd > 0 ? { days: wd, unit: 'working' } : { days: Math.round((Date.parse(f) - Date.parse(s)) / 864e5) + 1, unit: 'calendar' };
}

/**
 * @param item   { type, plannedStart, plannedFinish } current values ('YYYY-MM-DD' or null)
 * @param change { plannedStart?, plannedFinish? } only the keys being changed
 * @returns { start, finish, adjusted } adjusted = { finish, days } when the due date was moved to keep the length
 */
export function resolveDateChange(item, change, cal) {
  const hasS = Object.hasOwn(change, 'plannedStart'); const hasF = Object.hasOwn(change, 'plannedFinish');
  if (!hasS && !hasF) throw new DateRuleError('Nothing to change');
  if (item.type === 'MILESTONE') {
    const d = hasF ? change.plannedFinish : change.plannedStart;
    return { start: d ?? null, finish: d ?? null, adjusted: null };
  }
  let start = hasS ? change.plannedStart ?? null : item.plannedStart;
  let finish = hasF ? change.plannedFinish ?? null : item.plannedFinish;
  let adjusted = null;
  if (hasS && !hasF && start && item.plannedStart && item.plannedFinish) {
    const len = lengthOf(item.plannedStart, item.plannedFinish, cal);
    finish = len.unit === 'working' ? addWorkingDays(nextWorkingDay(start, cal), len.days - 1, cal) : addDays(start, len.days - 1);
    if (finish !== item.plannedFinish) adjusted = { finish, days: len.days, unit: len.unit };
  }
  if (start && finish && finish < start) {
    throw new DateRuleError(hasF ? `The due date (${fmt(finish)}) can't be before the start date (${fmt(start)}).` : `The start date (${fmt(start)}) can't be after the due date (${fmt(finish)}).`);
  }
  return { start, finish, adjusted };
}
