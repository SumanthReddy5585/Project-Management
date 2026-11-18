// In-process realtime bus. Route handlers publish small events ("ticket 123 changed"); the SSE endpoint
// filters them per connected user and forwards only ids, so clients re-fetch through the normal,
// permission-checked APIs. Nothing sensitive travels on the stream itself.
// Single-instance deployments only; for several instances, back this with Postgres LISTEN/NOTIFY.
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0);

/**
 * @param {{orgId:string, type:string, ticketId?:string, projectId?:string, customerCompanyId?:string|null,
 *          internal?:boolean, userIds?:string[], assigneeId?:string|null, requesterId?:string|null, actorId?:string}} evt
 */
export function publish(evt) {
  try { bus.emit('evt', { ...evt, at: Date.now() }); } catch { /* a broken listener must never break a request */ }
}

export function subscribe(fn) {
  bus.on('evt', fn);
  return () => bus.off('evt', fn);
}

/** Decide whether a connected user may be told about an event. */
export function visibleTo(auth, evt, { canViewAllTickets }) {
  if (evt.orgId !== auth.orgId) return false;
  if (evt.userIds) return evt.userIds.includes(auth.userId);
  if (evt.type.startsWith('ticket')) {
    if (auth.isCustomer) return !evt.internal && evt.customerCompanyId && evt.customerCompanyId === auth.customerCompanyId;
    return canViewAllTickets || evt.assigneeId === auth.userId || evt.requesterId === auth.userId;
  }
  if (evt.type.startsWith('work') || evt.type.startsWith('project')) return !auth.isCustomer;
  if (evt.type.startsWith('kb')) return true;
  return false;
}

export const ticketEvent = (type, t, extra = {}) => ({ orgId: t.organizationId, type, ticketId: t.id, projectId: t.projectId, customerCompanyId: t.customerCompanyId,
  assigneeId: t.assigneeId, requesterId: t.requesterId, ...extra });
