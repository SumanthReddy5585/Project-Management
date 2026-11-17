// SLA rules (documented in docs/CALCULATIONS.md):
// - Targets come from the org's SlaPolicy for the ticket priority, measured in business minutes.
// - Response clock stops at the first PUBLIC reply from an internal user.
// - Resolution clock stops when the ticket becomes RESOLVED or CLOSED.
// - Both clocks pause while status = WAITING_ON_CUSTOMER; on leaving that status, due dates
//   are pushed out by the business minutes spent paused.
// - Reopening (RESOLVED/CLOSED -> OPEN) clears resolvedAt/closedAt and extends the resolution
//   due date by the business minutes the ticket spent resolved.
// - AT_RISK when remaining business time is <= 25% of the target.
import { addBusinessMinutes, businessMinutesBetween } from './businessHours.js';

export const AT_RISK_RATIO = 0.25;

export function initialDueDates(createdAt, policy, cal) {
  if (!policy) return { responseDueAt: null, resolutionDueAt: null };
  return {
    responseDueAt: addBusinessMinutes(createdAt, policy.responseMinutes, cal),
    resolutionDueAt: addBusinessMinutes(createdAt, policy.resolutionMinutes, cal),
  };
}

const extend = (due, mins, cal) => (due && mins > 0 ? addBusinessMinutes(due, mins, cal) : due);

/** Fields to persist when a ticket moves from `t.status` to `next` at `now`. */
export function statusChangePatch(t, next, now, cal) {
  const patch = { status: next };
  const prev = t.status;
  if (prev === 'WAITING_ON_CUSTOMER' && next !== 'WAITING_ON_CUSTOMER' && t.slaPausedAt) {
    const paused = businessMinutesBetween(t.slaPausedAt, now, cal);
    patch.slaPausedAt = null;
    if (!t.firstResponseAt) patch.responseDueAt = extend(t.responseDueAt, paused, cal);
    patch.resolutionDueAt = extend(t.resolutionDueAt, paused, cal);
  }
  if (next === 'WAITING_ON_CUSTOMER' && prev !== 'WAITING_ON_CUSTOMER') patch.slaPausedAt = now;
  if (next === 'RESOLVED' && !t.resolvedAt) patch.resolvedAt = now;
  if (next === 'CLOSED') { patch.closedAt = now; if (!t.resolvedAt) patch.resolvedAt = now; }
  if ((prev === 'RESOLVED' || prev === 'CLOSED') && !['RESOLVED', 'CLOSED'].includes(next)) {
    const stoppedAt = t.resolvedAt || t.closedAt;
    if (stoppedAt) patch.resolutionDueAt = extend(t.resolutionDueAt, businessMinutesBetween(stoppedAt, now, cal), cal);
    patch.resolvedAt = null;
    patch.closedAt = null;
    patch.reopenCount = (t.reopenCount || 0) + 1;
  }
  return patch;
}

function clock(dueAt, stoppedAt, paused, targetMinutes, createdAt, now, cal) {
  if (!dueAt) return { state: 'NONE' };
  if (stoppedAt) return { state: stoppedAt <= dueAt ? 'MET' : 'BREACHED', dueAt };
  if (paused) return { state: 'PAUSED', dueAt };
  if (now > dueAt) return { state: 'BREACHED', dueAt };
  const remaining = businessMinutesBetween(now, dueAt, cal);
  return { state: targetMinutes && remaining <= targetMinutes * AT_RISK_RATIO ? 'AT_RISK' : 'ON_TRACK', dueAt, remainingMinutes: remaining };
}

export function slaStatus(t, policy, now, cal) {
  const paused = t.status === 'WAITING_ON_CUSTOMER';
  return {
    response: clock(t.responseDueAt, t.firstResponseAt, paused, policy?.responseMinutes, t.createdAt, now, cal),
    resolution: clock(t.resolutionDueAt, t.resolvedAt, paused, policy?.resolutionMinutes, t.createdAt, now, cal),
  };
}
