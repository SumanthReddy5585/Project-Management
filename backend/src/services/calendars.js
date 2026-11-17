import { makeCalendar, toKey } from '../domain/calendar.js';
import { makeBusinessCalendar } from '../domain/businessHours.js';

export async function loadCalendar(db, calendarId, orgId) {
  const cal = calendarId
    ? await db.workingCalendar.findFirst({ where: { id: calendarId, organizationId: orgId }, include: { holidays: true } })
    : await db.workingCalendar.findFirst({ where: { organizationId: orgId, isDefault: true }, include: { holidays: true } });
  return cal;
}
export const toWorkCalendar = (c) => makeCalendar({ workDays: c?.workDays ?? [1, 2, 3, 4, 5], holidays: (c?.holidays ?? []).map((h) => toKey(h.date)) });
export const toBusinessCalendar = (c, fallbackTz = 'UTC') => makeBusinessCalendar({
  timezone: c?.timezone ?? fallbackTz, workDays: c?.workDays ?? [1, 2, 3, 4, 5], dayStart: c?.dayStart ?? '09:00', dayEnd: c?.dayEnd ?? '17:00',
  holidays: (c?.holidays ?? []).map((h) => toKey(h.date)),
});
