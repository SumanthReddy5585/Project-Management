import { describe, it, expect } from 'vitest';
import { compareToOriginal, classify, slipDays, elapsedShare } from '../../src/domain/variance.js';
import { makeCalendar } from '../../src/domain/calendar.js';

const cal = makeCalendar(); // Mon-Fri
const T = (id, o = {}) => ({ id, number: 1, title: id, type: 'TASK', status: 'TODO', phaseId: 'ph', percentComplete: 0, estimateHours: 8, ...o });
const B = (id, s, f, o = {}) => ({ workItemId: id, title: id, type: 'TASK', phaseId: 'ph', plannedStart: s, plannedFinish: f, estimateHours: 8, ...o });

describe('slip and elapsed share (working days)', () => {
  it('counts working days, skipping weekends', () => {
    expect(slipDays('2026-11-13', '2026-11-16', cal)).toBe(1); // Fri -> Mon
    expect(slipDays('2026-11-16', '2026-11-13', cal)).toBe(-1);
    expect(slipDays('2026-11-16', '2026-11-16', cal)).toBe(0);
    expect(elapsedShare('2026-11-16', '2026-11-20', '2026-11-18', cal)).toBeCloseTo(0.4); // Mon+Tue done by the start of Wed
    expect(elapsedShare('2026-11-16', '2026-11-20', '2026-11-16', cal)).toBe(0); // nothing expected on day one
    expect(elapsedShare('2026-11-16', '2026-11-20', '2026-11-20', cal)).toBeCloseTo(0.8);
  });
});

describe('task classification against the original plan', () => {
  const today = '2026-11-18';
  it('flags done late, done on time, overdue, delayed, ahead, added, removed', () => {
    expect(classify({ base: B('a', '2026-11-09', '2026-11-13'), cur: T('a', { status: 'DONE', actualFinish: '2026-11-17' }) }, today, cal)).toMatchObject({ status: 'DONE_LATE', finishVariance: 2 });
    expect(classify({ base: B('a', '2026-11-09', '2026-11-13'), cur: T('a', { status: 'DONE', actualFinish: '2026-11-12' }) }, today, cal)).toMatchObject({ status: 'DONE_ON_TIME', finishVariance: -1 });
    expect(classify({ base: B('a', '2026-11-09', '2026-11-13'), cur: T('a', { status: 'IN_PROGRESS', plannedStart: '2026-11-09', plannedFinish: '2026-11-13' }) }, today, cal)).toMatchObject({ status: 'OVERDUE', finishVariance: 3, forecastFinish: today });
    expect(classify({ base: B('a', '2026-11-23', '2026-11-27'), cur: T('a', { plannedStart: '2026-11-25', plannedFinish: '2026-12-01' }) }, today, cal)).toMatchObject({ status: 'DELAYED', finishVariance: 2 });
    expect(classify({ base: B('a', '2026-11-23', '2026-11-27'), cur: T('a', { plannedStart: '2026-11-19', plannedFinish: '2026-11-24' }) }, today, cal)).toMatchObject({ status: 'AHEAD', finishVariance: -3 });
    expect(classify({ base: null, cur: T('a') }, today, cal).status).toBe('ADDED');
    expect(classify({ base: B('a', '2026-11-23', '2026-11-27'), cur: undefined }, today, cal).status).toBe('REMOVED');
    expect(classify({ base: B('a', '2026-11-16', '2026-11-27'), cur: T('a', { plannedStart: '2026-11-16', plannedFinish: '2026-11-27' }) }, today, cal)).toMatchObject({ status: 'ON_TRACK', lateStart: true });
  });
});

describe('project summary', () => {
  it('reports forecast vs original finish, planned vs actual progress and an overall status', () => {
    const original = [B('a', '2026-11-02', '2026-11-06'), B('b', '2026-11-09', '2026-11-13'), B('c', '2026-11-16', '2026-11-20'), B('m', '2026-11-20', '2026-11-20', { type: 'MILESTONE', estimateHours: null })];
    const current = [
      T('a', { status: 'DONE', actualFinish: '2026-11-06', plannedStart: '2026-11-02', plannedFinish: '2026-11-06' }),
      T('b', { status: 'IN_PROGRESS', percentComplete: 50, plannedStart: '2026-11-09', plannedFinish: '2026-11-20' }),
      T('c', { plannedStart: '2026-11-23', plannedFinish: '2026-11-27' }),
      T('m', { type: 'MILESTONE', plannedStart: '2026-11-27', plannedFinish: '2026-11-27', estimateHours: null }),
      T('x', { plannedStart: '2026-11-23', plannedFinish: '2026-11-24' }),
    ];
    const v = compareToOriginal({ current, original, today: '2026-11-18', cal, phases: [{ id: 'ph', name: 'Build' }] });
    expect(v.summary.originalFinish).toBe('2026-11-20');
    expect(v.summary.forecastFinish).toBe('2026-11-27');
    expect(v.summary.finishVariance).toBe(5);
    expect(v.summary.counts).toMatchObject({ DONE_ON_TIME: 1, OVERDUE: 1, DELAYED: 2, ADDED: 1 });
    expect(v.summary.plannedPct).toBeGreaterThan(v.summary.actualPct);
    expect(v.summary.status).toBe('DELAYED'); // 50% done vs 80% planned by the start of today (SPI 0.63)
    expect(v.summary.spi).toBeCloseTo(0.63, 2);
    expect(v.phases[0]).toMatchObject({ name: 'Build', finishVariance: 5 });
    expect(v.curve.length).toBeGreaterThan(2);
    expect(v.curve[0].planned).toBeLessThanOrEqual(v.curve.at(-1).planned);
  });
  it('is on track when everything matches the original', () => {
    const original = [B('a', '2026-11-23', '2026-11-27')];
    const current = [T('a', { plannedStart: '2026-11-23', plannedFinish: '2026-11-27' })];
    expect(compareToOriginal({ current, original, today: '2026-11-18', cal }).summary).toMatchObject({ status: 'ON_TRACK', finishVariance: 0, plannedPct: 0 });
  });
});

describe('lateness in working days around weekends', () => {
  it('counts the working days after the planned date', () => {
    expect(slipDays('2026-11-27', '2026-11-30', cal)).toBe(1);  // Fri -> Mon
    expect(slipDays('2026-11-28', '2026-11-30', cal)).toBe(1);  // Sat -> Mon (was 0)
    expect(slipDays('2026-11-27', '2026-11-28', cal)).toBe(0);  // Fri -> Sat: no working day lost
    expect(slipDays('2026-11-30', '2026-11-27', cal)).toBe(-1); // Mon -> Fri: 1 day early
    expect(slipDays('2026-11-30', '2026-12-07', cal)).toBe(5);  // one week
    expect(slipDays('2026-12-07', '2026-11-30', cal)).toBe(-5);
  });
});
