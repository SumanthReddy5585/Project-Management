import { describe, it, expect } from 'vitest';
import { addWorkingDays, workingDaysBetween, nextWorkingDay, makeCalendar, finishFromDuration } from '../../src/domain/calendar.js';

const cal = makeCalendar({ holidays: ['2026-12-25'] });
describe('working-day calendar', () => {
  it('skips weekends', () => {
    expect(addWorkingDays('2026-11-20', 1, cal)).toBe('2026-11-23'); // Fri -> Mon
    expect(addWorkingDays('2026-11-23', -1, cal)).toBe('2026-11-20');
  });
  it('skips holidays', () => {
    expect(addWorkingDays('2026-12-24', 1, cal)).toBe('2026-12-28');
    expect(workingDaysBetween('2026-12-21', '2026-12-27', cal)).toBe(4);
  });
  it('counts inclusive and handles reversed ranges', () => {
    expect(workingDaysBetween('2026-11-16', '2026-11-20', cal)).toBe(5);
    expect(workingDaysBetween('2026-11-20', '2026-11-16', cal)).toBe(0);
  });
  it('rolls non-working start forward for durations', () => {
    expect(nextWorkingDay('2026-11-21', cal)).toBe('2026-11-23');
    expect(finishFromDuration('2026-11-21', 3, cal)).toEqual({ start: '2026-11-23', finish: '2026-11-25' });
  });
  it('supports Sun-Thu work weeks', () => {
    const me = makeCalendar({ workDays: [7, 1, 2, 3, 4] });
    expect(addWorkingDays('2026-11-19', 1, me)).toBe('2026-11-22'); // Thu -> Sun
  });
});
