import { describe, it, expect } from 'vitest';
import { resolveDateChange, DateRuleError, lengthOf } from '../../src/domain/dates.js';
import { makeCalendar } from '../../src/domain/calendar.js';
import { dateOnly } from '../../src/lib/http.js';

const cal = makeCalendar({ holidays: ['2026-12-25'] }); // Mon-Fri + Christmas
const task = { type: 'TASK', plannedStart: '2026-11-23', plannedFinish: '2026-11-27' }; // Mon-Fri, 5 working days

describe('date input validation', () => {
  it('accepts real dates only', () => {
    expect(dateOnly.safeParse('2026-12-15').success).toBe(true);
    for (const bad of ['0001-12-04', '0202-12-04', '2026-02-30', '2026-13-01', '15-12-2026', '2026-1-5', '']) expect(dateOnly.safeParse(bad).success).toBe(false);
  });
});

describe('changing dates', () => {
  it('moving the start keeps the length in working days (skips weekends and holidays)', () => {
    expect(resolveDateChange(task, { plannedStart: '2026-11-25' }, cal)).toEqual({ start: '2026-11-25', finish: '2026-12-01', adjusted: { finish: '2026-12-01', days: 5, unit: 'working' } });
    expect(resolveDateChange(task, { plannedStart: '2026-12-21' }, cal).finish).toBe('2026-12-28'); // 21-24, skip 25 (holiday) + weekend, 28
    expect(resolveDateChange(task, { plannedStart: '2026-11-28' }, cal)).toMatchObject({ start: '2026-11-28', finish: '2026-12-04' }); // Saturday start: counts from Monday
    expect(resolveDateChange(task, { plannedStart: '2026-11-16' }, cal).finish).toBe('2026-11-20'); // earlier works too
  });
  it('changing only the due date keeps the start, and refuses a due date before the start', () => {
    expect(resolveDateChange(task, { plannedFinish: '2026-12-04' }, cal)).toEqual({ start: '2026-11-23', finish: '2026-12-04', adjusted: null });
    expect(() => resolveDateChange(task, { plannedFinish: '2026-11-20' }, cal)).toThrow(DateRuleError);
    expect(() => resolveDateChange(task, { plannedFinish: '2026-11-20' }, cal)).toThrow(/can't be before the start date/);
  });
  it('both dates, milestones, clearing and unscheduled tasks', () => {
    expect(resolveDateChange(task, { plannedStart: '2026-12-01', plannedFinish: '2026-12-03' }, cal)).toEqual({ start: '2026-12-01', finish: '2026-12-03', adjusted: null });
    expect(() => resolveDateChange(task, { plannedStart: '2026-12-05', plannedFinish: '2026-12-03' }, cal)).toThrow(DateRuleError);
    expect(resolveDateChange({ type: 'MILESTONE', plannedStart: '2026-11-27', plannedFinish: '2026-11-27' }, { plannedFinish: '2026-12-11' }, cal)).toEqual({ start: '2026-12-11', finish: '2026-12-11', adjusted: null });
    expect(resolveDateChange(task, { plannedFinish: null }, cal)).toEqual({ start: '2026-11-23', finish: null, adjusted: null });
    expect(resolveDateChange({ type: 'TASK', plannedStart: null, plannedFinish: null }, { plannedStart: '2026-11-23' }, cal)).toEqual({ start: '2026-11-23', finish: null, adjusted: null });
    expect(lengthOf('2026-11-28', '2026-11-29', cal)).toEqual({ days: 2, unit: 'calendar' }); // weekend-only task
  });
});
