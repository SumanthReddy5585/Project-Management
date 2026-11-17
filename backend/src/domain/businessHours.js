// Business-hours arithmetic for SLA clocks. Instants are UTC; the calendar defines
// working days, daily hours, holidays and the timezone in which they are interpreted.
import { DateTime } from 'luxon';

export function makeBusinessCalendar({ timezone = 'UTC', workDays = [1, 2, 3, 4, 5], dayStart = '09:00', dayEnd = '17:00', holidays = [] } = {}) {
  const [sh, sm] = dayStart.split(':').map(Number);
  const [eh, em] = dayEnd.split(':').map(Number);
  if (eh * 60 + em <= sh * 60 + sm) throw new Error('dayEnd must be after dayStart');
  return { timezone, workDays: new Set(workDays), start: { hour: sh, minute: sm }, end: { hour: eh, minute: em },
    holidays: new Set(holidays.map((h) => (typeof h === 'string' ? h.slice(0, 10) : h.toISOString().slice(0, 10)))) };
}

function windowFor(day, cal) {
  if (!cal.workDays.has(day.weekday) || cal.holidays.has(day.toISODate())) return null;
  return [day.set({ ...cal.start, second: 0, millisecond: 0 }), day.set({ ...cal.end, second: 0, millisecond: 0 })];
}

/** Business minutes elapsed between two instants (0 if to <= from). */
export function businessMinutesBetween(from, to, cal) {
  const a = DateTime.fromJSDate(new Date(from), { zone: cal.timezone });
  const b = DateTime.fromJSDate(new Date(to), { zone: cal.timezone });
  if (b <= a) return 0;
  let total = 0;
  for (let day = a.startOf('day'); day <= b; day = day.plus({ days: 1 })) {
    const w = windowFor(day, cal);
    if (!w) continue;
    const s = a > w[0] ? a : w[0];
    const e = b < w[1] ? b : w[1];
    if (e > s) total += e.diff(s, 'minutes').minutes;
  }
  return Math.round(total);
}

/** Instant reached after consuming `minutes` business minutes from `from`. */
export function addBusinessMinutes(from, minutes, cal) {
  let cur = DateTime.fromJSDate(new Date(from), { zone: cal.timezone });
  let left = minutes;
  for (let guard = 0; guard < 3660; guard++) {
    const w = windowFor(cur.startOf('day'), cal);
    if (w) {
      const s = cur > w[0] ? cur : w[0];
      if (s < w[1]) {
        const avail = w[1].diff(s, 'minutes').minutes;
        if (left <= avail) return s.plus({ minutes: left }).toUTC().toJSDate();
        left -= avail;
      }
    }
    cur = cur.startOf('day').plus({ days: 1 });
  }
  throw new Error('Business calendar has no working time');
}
