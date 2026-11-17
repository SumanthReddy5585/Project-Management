import { describe, it, expect } from 'vitest';
import { wouldCreateCycle, previewShift, scheduleConflicts, criticalPath } from '../../src/domain/dependencies.js';
import { capacityHours, plannedLoad, utilization } from '../../src/domain/capacity.js';

const I = (id, s, f, o = {}) => ({ id, plannedStart: s, plannedFinish: f, status: 'TODO', type: 'TASK', ...o });
const D = (p, s, lag = 0) => ({ predecessorId: p, successorId: s, type: 'FS', lagDays: lag });

describe('dependencies', () => {
  it('detects direct and transitive cycles', () => {
    const e = [D('a', 'b'), D('b', 'c')];
    expect(wouldCreateCycle(e, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(e, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(e, 'a', 'c')).toBe(false);
  });
  it('flags FS conflicts', () => {
    const c = scheduleConflicts([I('a', '2026-11-16', '2026-11-18'), I('b', '2026-11-18', '2026-11-19')], [D('a', 'b')]);
    expect(c).toHaveLength(1);
    expect(c[0].earliestStart).toBe('2026-11-19');
  });
  it('previews downstream pushes preserving working-day durations', () => {
    const items = [I('a', '2026-11-16', '2026-11-17'), I('b', '2026-11-18', '2026-11-20'), I('c', '2026-11-23', '2026-11-23'), I('x', '2026-11-30', '2026-12-01')];
    const moves = previewShift(items, [D('a', 'b'), D('b', 'c'), D('a', 'x')], 'a', '2026-11-16', '2026-11-19');
    expect(moves).toEqual([
      { id: 'b', from: { start: '2026-11-18', finish: '2026-11-20' }, to: { start: '2026-11-20', finish: '2026-11-24' } },
      { id: 'c', from: { start: '2026-11-23', finish: '2026-11-23' }, to: { start: '2026-11-25', finish: '2026-11-25' } },
    ]);
  });
  it('computes the critical path', () => {
    const items = [I('a', '2026-11-16', '2026-11-17'), I('b', '2026-11-18', '2026-11-20'), I('c', '2026-11-18', '2026-11-18'), I('d', '2026-11-23', '2026-11-23')];
    const r = criticalPath(items, [D('a', 'b'), D('a', 'c'), D('b', 'd'), D('c', 'd')]);
    expect(r.durationDays).toBe(6);
    expect(r.critical.sort()).toEqual(['a', 'b', 'd']);
    expect(r.nodes.find((n) => n.id === 'c').slack).toBe(2);
  });
});

describe('capacity', () => {
  it('derives capacity from weekly hours and working days', () => {
    expect(capacityHours(40, '2026-11-16', '2026-11-22')).toBe(40);
    expect(capacityHours(20, '2026-11-16', '2026-11-17')).toBe(8);
  });
  it('spreads remaining estimate over task span', () => {
    const load = plannedLoad([I('a', '2026-11-16', '2026-11-27', { estimateHours: 80, percentComplete: 50 })], '2026-11-16', '2026-11-20');
    expect(load).toBe(20);
    expect(utilization(40, 50).state).toBe('OVER');
  });
});
