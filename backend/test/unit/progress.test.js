import { describe, it, expect } from 'vitest';
import { rollup, aggregate } from '../../src/domain/progress.js';
import { normalizeProgress, canTransitionTicket } from '../../src/domain/workflow.js';

const T = (id, o = {}) => ({ id, type: 'TASK', status: 'TODO', percentComplete: 0, parentId: null, ...o });
describe('progress rollup', () => {
  it('weights by estimate', () => {
    const r = aggregate([T('a', { estimateHours: 30, status: 'DONE' }), T('b', { estimateHours: 10 })]);
    expect(r).toMatchObject({ percent: 75, method: 'effort' });
  });
  it('uses mean estimate for unestimated leaves', () => {
    const r = aggregate([T('a', { estimateHours: 10, status: 'DONE' }), T('b')]);
    expect(r.percent).toBe(50);
    expect(r.unestimated).toBe(1);
  });
  it('falls back to count when nothing is estimated', () => {
    expect(aggregate([T('a', { percentComplete: 50 }), T('b'), T('c', { status: 'DONE' })])).toMatchObject({ percent: 50, method: 'count' });
  });
  it('excludes cancelled work and milestones from effort', () => {
    const items = [
      T('m', { type: 'MODULE' }),
      T('a', { parentId: 'm', estimateHours: 8, status: 'DONE' }),
      T('b', { parentId: 'm', estimateHours: 100, status: 'CANCELLED' }),
      T('ms', { type: 'MILESTONE', status: 'DONE' }),
    ];
    const r = rollup(items);
    expect(r.byId.get('m').percent).toBe(100);
    expect(r.project.percent).toBe(100);
    expect(r.milestones).toEqual({ total: 1, done: 1 });
  });
  it('rolls subtasks into tasks into modules', () => {
    const items = [
      T('m', { type: 'MODULE' }), T('t1', { parentId: 'm' }), T('s1', { parentId: 't1', type: 'SUBTASK', status: 'DONE' }),
      T('s2', { parentId: 't1', type: 'SUBTASK' }), T('t2', { parentId: 'm', status: 'DONE' }),
    ];
    const r = rollup(items);
    expect(r.byId.get('t1').percent).toBe(50);
    expect(r.byId.get('m').percent).toBeCloseTo(66.7, 1);
  });
});

describe('status/percent consistency', () => {
  const today = new Date('2026-11-17');
  it('DONE forces 100 and stamps actuals', () => {
    expect(normalizeProgress({ status: 'IN_PROGRESS', percentComplete: 40 }, { status: 'DONE' }, today)).toMatchObject({ status: 'DONE', percentComplete: 100, actualFinish: today, actualStart: today });
  });
  it('progress on TODO moves to IN_PROGRESS; 100% moves to review, not done', () => {
    expect(normalizeProgress({ status: 'TODO', percentComplete: 0 }, { percentComplete: 20 }, today).status).toBe('IN_PROGRESS');
    expect(normalizeProgress({ status: 'IN_PROGRESS', percentComplete: 20 }, { percentComplete: 100 }, today).status).toBe('IN_REVIEW');
  });
  it('reopening DONE caps percent and clears actual finish', () => {
    expect(normalizeProgress({ status: 'DONE', percentComplete: 100, actualStart: today, actualFinish: today }, { status: 'IN_PROGRESS' }, today)).toMatchObject({ percentComplete: 90, actualFinish: null });
  });
  it('ticket transitions differ for customers', () => {
    expect(canTransitionTicket('OPEN', 'RESOLVED', false)).toBe(true);
    expect(canTransitionTicket('OPEN', 'RESOLVED', true)).toBe(false);
    expect(canTransitionTicket('RESOLVED', 'OPEN', true)).toBe(true);
  });
});
