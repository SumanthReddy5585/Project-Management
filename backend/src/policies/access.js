import { prisma } from '../lib/prisma.js';
import { notFound, forbidden } from '../lib/errors.js';
import { orgCan, projectCan } from './permissions.js';

/** Throw 403 unless the org role has `cap`. */
export function requireOrg(auth, cap) {
  if (!orgCan(auth, cap)) throw forbidden();
}

/**
 * Resolve the caller's access to a project. Projects outside the caller's org or scope
 * produce 404 (not 403) so identifiers cannot be probed.
 */
export async function projectAccess(auth, projectId, db = prisma) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId || '')) throw notFound('Project');
  const project = await db.project.findFirst({ where: { id: projectId, organizationId: auth.orgId } });
  if (!project) throw notFound('Project');
  let role = null;
  if (auth.orgRole === 'ADMIN') role = 'ADMIN';
  else {
    const m = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: auth.userId } } });
    role = m?.role ?? null;
    if (auth.isCustomer) {
      // customers need an explicit CUSTOMER membership, a shared project, and a matching company
      const ok = role === 'CUSTOMER' && project.customerVisible && project.customerCompanyId && project.customerCompanyId === auth.customerCompanyId;
      role = ok ? 'CUSTOMER' : null;
    } else if (role === 'CUSTOMER') role = null;
  }
  if (!role) throw notFound('Project');
  const can = (cap) => projectCan(role, cap);
  return { project, role, can, isCustomer: role === 'CUSTOMER', internal: role !== 'CUSTOMER',
    require(cap) { if (!can(cap)) throw forbidden(); } };
}

/** Prisma where-clause for projects visible to the caller (used by lists, dashboards, search). */
export function visibleProjectsWhere(auth) {
  const base = { organizationId: auth.orgId };
  if (auth.orgRole === 'ADMIN') return base;
  if (auth.isCustomer) {
    return { ...base, customerVisible: true, customerCompanyId: auth.customerCompanyId, members: { some: { userId: auth.userId, role: 'CUSTOMER' } } };
  }
  return { ...base, members: { some: { userId: auth.userId, role: { in: ['DIRECTOR', 'MANAGER', 'MEMBER', 'VIEWER'] } } } };
}

/** Work-item visibility filter for an access object. */
export const workItemScope = (access) => (access.isCustomer ? { customerVisible: true } : {});

/** Load a work item inside a project the caller can access; customers only see shared items. */
export async function workItemAccess(auth, projectId, itemId, db = prisma) {
  const access = await projectAccess(auth, projectId, db);
  const item = await db.workItem.findFirst({ where: { id: itemId, projectId, ...workItemScope(access) } });
  if (!item) throw notFound('Work item');
  const own = item.assigneeId === auth.userId ||
    Boolean(await db.workItemCollaborator.findUnique({ where: { workItemId_userId: { workItemId: item.id, userId: auth.userId } } }));
  const canEdit = access.can('work.editAny') || (access.can('work.editOwn') && own);
  return { ...access, item, canEdit };
}

/** Ticket scope for lists. */
export async function ticketsWhere(auth) {
  const base = { organizationId: auth.orgId };
  if (auth.isCustomer) return { ...base, customerCompanyId: auth.customerCompanyId ?? '00000000-0000-0000-0000-000000000000' };
  if (orgCan(auth, 'ticket.viewAll')) return base;
  const mine = await prisma.projectMember.findMany({ where: { userId: auth.userId, role: { not: 'CUSTOMER' } }, select: { projectId: true } });
  return { ...base, OR: [{ assigneeId: auth.userId }, { requesterId: auth.userId }, { projectId: { in: mine.map((m) => m.projectId) } }] };
}

export async function ticketAccess(auth, ticketId) {
  if (!/^[0-9a-f-]{36}$/i.test(ticketId || '')) throw notFound('Ticket');
  const t = await prisma.ticket.findFirst({ where: { id: ticketId, ...(await ticketsWhere(auth)) } });
  if (!t) throw notFound('Ticket');
  return t;
}
