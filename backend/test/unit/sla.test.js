import { describe, it, expect } from 'vitest';
import { makeBusinessCalendar, businessMinutesBetween, addBusinessMinutes } from '../../src/domain/businessHours.js';
import { initialDueDates, statusChangePatch, slaStatus } from '../../src/domain/sla.js';

const cal = makeBusinessCalendar({ timezone: 'Asia/Kolkata', dayStart: '09:00', dayEnd: '17:00' });
const ist = (s) => new Date(`${s}+05:30`);

describe('business hours', () => {
  it('counts only working-hour minutes in the calendar timezone', () => {
    expect(businessMinutesBetween(ist('2026-11-16T08:00:00'), ist('2026-11-16T10:30:00'), cal)).toBe(90);
    expect(businessMinutesBetween(ist('2026-11-20T16:00:00'), ist('2026-11-23T10:00:00'), cal)).toBe(120);
  });
  it('adds minutes across nights and weekends', () => {
    expect(addBusinessMinutes(ist('2026-11-20T16:00:00'), 120, cal).toISOString()).toBe(ist('2026-11-23T10:00:00').toISOString());
    expect(addBusinessMinutes(ist('2026-11-21T12:00:00'), 30, cal).toISOString()).toBe(ist('2026-11-23T09:30:00').toISOString());
  });
  it('respects holidays', () => {
    const h = makeBusinessCalendar({ timezone: 'UTC', holidays: ['2026-11-23'] });
    expect(addBusinessMinutes(new Date('2026-11-20T16:00:00Z'), 120, h).toISOString()).toBe('2026-11-24T10:00:00.000Z');
  });
});

describe('SLA clocks', () => {
  const policy = { responseMinutes: 240, resolutionMinutes: 960 };
  const created = ist('2026-11-16T09:00:00');
  it('computes due dates in business time', () => {
    const d = initialDueDates(created, policy, cal);
    expect(d.responseDueAt.toISOString()).toBe(ist('2026-11-16T13:00:00').toISOString());
    expect(d.resolutionDueAt.toISOString()).toBe(ist('2026-11-17T17:00:00').toISOString());
  });
  it('pauses while waiting on customer and extends due dates', () => {
    const t = { status: 'OPEN', createdAt: created, ...initialDueDates(created, policy, cal) };
    const p1 = statusChangePatch(t, 'WAITING_ON_CUSTOMER', ist('2026-11-16T10:00:00'), cal);
    const t2 = { ...t, ...p1 };
    const p2 = statusChangePatch(t2, 'OPEN', ist('2026-11-16T12:00:00'), cal);
    expect(p2.slaPausedAt).toBeNull();
    expect(p2.responseDueAt.toISOString()).toBe(ist('2026-11-16T15:00:00').toISOString());
    expect(slaStatus(t2, policy, ist('2026-11-16T23:00:00'), cal).response.state).toBe('PAUSED');
  });
  it('reports breach, at-risk and met', () => {
    const t = { status: 'OPEN', createdAt: created, ...initialDueDates(created, policy, cal) };
    expect(slaStatus(t, policy, ist('2026-11-16T12:30:00'), cal).response.state).toBe('AT_RISK');
    expect(slaStatus(t, policy, ist('2026-11-16T14:00:00'), cal).response.state).toBe('BREACHED');
    expect(slaStatus({ ...t, firstResponseAt: ist('2026-11-16T10:00:00') }, policy, ist('2026-11-18T10:00:00'), cal).response.state).toBe('MET');
  });
  it('reopen clears resolution and extends the resolution clock', () => {
    const t = { status: 'RESOLVED', resolvedAt: ist('2026-11-16T10:00:00'), createdAt: created, ...initialDueDates(created, policy, cal) };
    const p = statusChangePatch(t, 'OPEN', ist('2026-11-16T11:00:00'), cal);
    expect(p.resolvedAt).toBeNull();
    expect(p.reopenCount).toBe(1);
    expect(businessMinutesBetween(t.resolutionDueAt, p.resolutionDueAt, cal)).toBe(60);
  });
});
