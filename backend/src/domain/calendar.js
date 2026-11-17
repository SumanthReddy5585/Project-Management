// Working-day arithmetic on date-only values ('YYYY-MM-DD'). No timezones involved:
// business dates are calendar dates in the project's timezone by definition.

const DAY = 86400000;
export const toKey = (d) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const parse = (k) => Date.parse(`${k}T00:00:00Z`);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
/** ISO weekday 1 (Mon) .. 7 (Sun) */
export const isoWeekday = (k) => ((new Date(parse(k)).getUTCDay() + 6) % 7) + 1;

export function makeCalendar({ workDays = [1, 2, 3, 4, 5], holidays = [] } = {}) {
  if (!workDays.length) throw new Error('Calendar needs at least one working day');
  return { workDays: new Set(workDays), holidays: new Set(holidays.map(toKey)) };
}
export const DEFAULT_CALENDAR = makeCalendar();

export const addDays = (k, n) => fromMs(parse(toKey(k)) + n * DAY);
export const isWorkingDay = (k, cal = DEFAULT_CALENDAR) => cal.workDays.has(isoWeekday(toKey(k))) && !cal.holidays.has(toKey(k));

export function nextWorkingDay(k, cal = DEFAULT_CALENDAR) {
  let d = toKey(k);
  for (let i = 0; i < 3660 && !isWorkingDay(d, cal); i++) d = addDays(d, 1);
  return d;
}

/** Move n working days from k (n may be negative). n = 0 returns k unchanged. */
export function addWorkingDays(k, n, cal = DEFAULT_CALENDAR) {
  let d = toKey(k);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (left > 0) {
    d = addDays(d, step);
    if (isWorkingDay(d, cal)) left--;
  }
  return d;
}

/** Inclusive count of working days in [start, finish]. Returns 0 when finish < start. */
export function workingDaysBetween(start, finish, cal = DEFAULT_CALENDAR) {
  const a = parse(toKey(start)); const b = parse(toKey(finish));
  if (b < a) return 0;
  let n = 0;
  for (let t = a; t <= b; t += DAY) if (isWorkingDay(fromMs(t), cal)) n++;
  return n;
}

/** Finish date for a task of `duration` working days starting on (or after) `start`. */
export function finishFromDuration(start, duration, cal = DEFAULT_CALENDAR) {
  const s = nextWorkingDay(start, cal);
  return { start: s, finish: addWorkingDays(s, Math.max(1, duration) - 1, cal) };
}
