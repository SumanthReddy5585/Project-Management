// Work item status <-> percent consistency rules, and ticket status transitions.
export const WORK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED'];

/**
 * Given the current item and a requested patch, return the normalized fields.
 * - status DONE  => percent 100, actualFinish defaults to today, actualStart defaults to today
 * - status TODO  => percent 0
 * - leaving DONE => percent capped at 90 and actualFinish cleared
 * - percent > 0 on a TODO item => status IN_PROGRESS
 * - percent 100 on a non-DONE item => status IN_REVIEW (explicit DONE still required)
 * - IN_PROGRESS with no actualStart => actualStart = today
 * Never touches planned dates or assignments.
 */
export function normalizeProgress(current, patch, today) {
  let status = patch.status ?? current.status;
  let pct = patch.percentComplete ?? current.percentComplete;
  const out = {};
  const statusChanged = patch.status && patch.status !== current.status;
  if (statusChanged) {
    if (status === 'DONE') pct = 100;
    else if (status === 'TODO') pct = 0;
    else if (current.status === 'DONE' && pct === 100) pct = 90;
  } else if (patch.percentComplete != null) {
    if (pct > 0 && status === 'TODO') status = 'IN_PROGRESS';
    if (pct === 100 && status !== 'DONE' && status !== 'CANCELLED') status = 'IN_REVIEW';
    if (pct < 100 && status === 'DONE') status = 'IN_PROGRESS';
  }
  out.status = status;
  out.percentComplete = pct;
  const started = current.actualStart || patch.actualStart;
  if (['IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'].includes(status) && !started) out.actualStart = today;
  if (status === 'DONE' && !(current.actualFinish || patch.actualFinish)) out.actualFinish = today;
  if (current.status === 'DONE' && status !== 'DONE') out.actualFinish = null;
  return out;
}

export const TICKET_TRANSITIONS = {
  NEW: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'],
  OPEN: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'WAITING_ON_CUSTOMER', 'RESOLVED'],
  WAITING_ON_CUSTOMER: ['OPEN', 'IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: ['OPEN'],
};
/** Customers may only confirm closure or reopen. */
export const CUSTOMER_TICKET_TRANSITIONS = { RESOLVED: ['CLOSED', 'OPEN'], CLOSED: ['OPEN'] };

export function canTransitionTicket(from, to, isCustomer) {
  const map = isCustomer ? CUSTOMER_TICKET_TRANSITIONS : TICKET_TRANSITIONS;
  return (map[from] || []).includes(to);
}

export const PROJECT_TRANSITIONS = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'CANCELLED'],
  COMPLETED: ['ARCHIVED', 'ACTIVE'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
};
/** Archived and cancelled projects are read-only; completed projects only accept time/ticket closure. */
export const READ_ONLY_PROJECT = new Set(['ARCHIVED', 'CANCELLED']);
