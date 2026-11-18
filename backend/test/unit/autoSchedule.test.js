import { describe, it, expect } from 'vitest';
import { autoSchedule, ScheduleCycleError } from '../../src/domain/autoSchedule.js';
import { makeCalendar } from '../../src/domain/calendar.js';

const cal = makeCalendar({ workDays: [1, 2, 3, 4, 5], holidays: [] });
// 2026-12-07 is a Monday
const MON = '2026-12-07';
const t = (id, s, f, extra = {}) => ({ id, parentId: null, type: 'TASK', status: 'TODO', plannedStart: s, plannedFinish: f, startConstraint: null, ...extra });
const fs = (p, s, lagDays = 0) => ({ predecessorId: p, successorId: s, type: 'FS', lagDays });
const run = (items, deps, o = {}) => autoSchedule({ items, deps, projectStart: MON, today: '2026-12-01', cal, ...o });

describe('autoSchedule', () => {
  it('chains tasks: each starts the working day after the one it waits for', () => {
    const r = run([t('a', MON, '2026-12-11'), t('b', MON, '2026-12-09'), t('c', MON, MON)], [fs('a', 'b'), fs('b', 'c')]);
    expect(r.dates.get('a')).toEqual({ start: MON, finish: '2026-12-11' });
    expect(r.dates.get('b')).toEqual({ start: '2026-12-14', finish: '2026-12-16' }); // 3 working days, keeps length
    expect(r.dates.get('c')).toEqual({ start: '2026-12-17', finish: '2026-12-17' });
    expect(r.finish).toBe('2026-12-17');
  });

  it('runs unlinked tasks in parallel from the project start', () => {
    const r = run([t('a', '2026-12-09', '2026-12-10'), t('b', '2026-12-14', '2026-12-18')], []);
    expect(r.dates.get('a')).toEqual({ start: MON, finish: '2026-12-08' });
    expect(r.dates.get('b')).toEqual({ start: MON, finish: '2026-12-11' });
  });

  it('waits for the last of several predecessors (parallel branches join)', () => {
    const r = run([t('a', MON, '2026-12-08'), t('b', MON, '2026-12-11'), t('c', MON, MON)], [fs('a', 'c'), fs('b', 'c')]);
    expect(r.dates.get('c').start).toBe('2026-12-14');
  });

  it('keeps a fixed start ("start no earlier than") but still pushes it after predecessors', () => {
    const fixed = run([t('a', MON, '2026-12-08'), t('b', '2026-12-16', '2026-12-17', { startConstraint: '2026-12-16' })], [fs('a', 'b')]);
    expect(fixed.dates.get('b')).toEqual({ start: '2026-12-16', finish: '2026-12-17' });
    const pushed = run([t('a', MON, '2026-12-18'), t('b', '2026-12-16', '2026-12-17', { startConstraint: '2026-12-16' })], [fs('a', 'b')]);
    expect(pushed.dates.get('b')).toEqual({ start: '2026-12-21', finish: '2026-12-22' });
  });

  it('pulls dependents in when a predecessor gets shorter', () => {
    const r = run([t('a', MON, MON), t('b', '2026-12-21', '2026-12-22')], [fs('a', 'b')]);
    expect(r.dates.get('b')).toEqual({ start: '2026-12-08', finish: '2026-12-09' });
  });

  it('handles weekends and lag in working days', () => {
    const r = run([t('a', '2026-12-10', '2026-12-11', { startConstraint: '2026-12-10' }), t('b', MON, '2026-12-08')], [fs('a', 'b', 2)]);
    expect(r.dates.get('b')).toEqual({ start: '2026-12-16', finish: '2026-12-17' }); // Fri finish +2 lag -> Wed
  });

  it('puts a milestone on the day its last predecessor finishes', () => {
    const r = run([t('a', MON, '2026-12-11'), t('m', '2026-12-01', '2026-12-01', { type: 'MILESTONE' })], [fs('a', 'm')]);
    expect(r.dates.get('m')).toEqual({ start: '2026-12-11', finish: '2026-12-11' });
  });

  it('never moves started or finished work; done work hands on its actual finish', () => {
    const r = run([
      t('a', MON, '2026-12-11', { status: 'DONE', actualFinish: '2026-12-08' }),
      t('b', '2026-12-14', '2026-12-15'),
      t('c', '2026-12-09', '2026-12-10', { status: 'IN_PROGRESS', actualStart: '2026-12-09' }),
    ], [fs('a', 'b'), fs('a', 'c')]);
    expect(r.dates.get('a')).toEqual({ start: MON, finish: '2026-12-11' });
    expect(r.dates.get('b')).toEqual({ start: '2026-12-09', finish: '2026-12-10' });
    expect(r.dates.get('c')).toEqual({ start: '2026-12-09', finish: '2026-12-10' });
  });

  it('in an active project, overdue work pushes what waits for it to after today', () => {
    const items = [t('a', MON, '2026-12-08', { status: 'IN_PROGRESS', actualStart: MON }), t('b', '2026-12-09', '2026-12-10')];
    const r = run(items, [fs('a', 'b')], { today: '2026-12-16', useToday: true });
    expect(r.dates.get('a')).toEqual({ start: MON, finish: '2026-12-08' }); // still shown as overdue
    expect(r.dates.get('b')).toEqual({ start: '2026-12-17', finish: '2026-12-18' });
    const draft = run(items, [fs('a', 'b')], { today: '2026-12-16', useToday: false });
    expect(draft.dates.get('b')).toEqual({ start: '2026-12-09', finish: '2026-12-10' });
  });

  it('spans parents over their children and applies a link to a parent to all its children', () => {
    const r = run([
      t('x', MON, MON),
      t('p', MON, MON, { type: 'MODULE' }),
      t('c1', MON, '2026-12-08', { parentId: 'p' }),
      t('c2', MON, '2026-12-10', { parentId: 'p' }),
      t('y', MON, MON),
    ], [fs('x', 'p'), fs('p', 'y')]);
    expect(r.dates.get('c1').start).toBe('2026-12-08');
    expect(r.dates.get('c2')).toEqual({ start: '2026-12-08', finish: '2026-12-11' });
    expect(r.dates.get('p')).toEqual({ start: '2026-12-08', finish: '2026-12-11' });
    expect(r.dates.get('y').start).toBe('2026-12-14');
  });

  it('ignores cancelled and undated items and reports only real changes', () => {
    const r = run([t('a', MON, '2026-12-08', { status: 'CANCELLED' }), t('b', null, null), t('c', MON, MON)], [fs('a', 'c'), fs('b', 'c')]);
    expect(r.changes).toEqual([]);
  });

  it('leaves a task that does not move exactly as typed, even with a weekend due date', () => {
    const r = run([t('a', MON, '2026-12-13', { startConstraint: MON }), t('b', '2026-12-14', '2026-12-15')], [fs('a', 'b')]);
    expect(r.dates.get('a')).toEqual({ start: MON, finish: '2026-12-13' });
    expect(r.dates.get('b').start).toBe('2026-12-14');
  });

  it('refuses a circular plan', () => {
    expect(() => run([t('a', MON, MON), t('b', MON, MON)], [fs('a', 'b'), fs('b', 'a')])).toThrow(ScheduleCycleError);
  });
});
