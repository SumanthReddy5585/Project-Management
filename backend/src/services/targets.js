// Resolve a polymorphic target (work item / discussion / ticket / project / deliverable version)
// to the caller's effective permissions on it. Everything that attaches content to a parent
// (comments, files) goes through here so parent permissions always apply.
import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { projectAccess, workItemAccess, ticketAccess } from '../policies/access.js';
import { orgCan } from '../policies/permissions.js';

const UUID = /^[0-9a-f-]{36}$/i;

export async function resolveTarget(auth, type, id) {
  if (!UUID.test(id || '')) throw notFound('Target');
  if (type === 'workItem') {
    const row = await prisma.workItem.findFirst({ where: { id, project: { organizationId: auth.orgId } }, select: { projectId: true } });
    if (!row) throw notFound('Work item');
    const a = await workItemAccess(auth, row.projectId, id);
    return { kind: type, projectId: a.project.id, isCustomer: a.isCustomer, canInternal: a.can('comment.internal'), canPublic: a.can('comment.public') && a.item.customerVisible,
      canUploadInternal: a.internal && a.can('file.upload'), canUploadPublic: a.can('file.upload') && a.item.customerVisible, canDeleteAny: a.can('work.editAny'),
      fk: { workItemId: id, projectId: a.project.id }, link: `/projects/${a.project.id}/work/${id}`, label: `${a.project.code}-${a.item.number} ${a.item.title}`,
      watchers: [a.item.assigneeId, a.item.createdById], projectCode: a.project.code };
  }
  if (type === 'discussion') {
    const d = await prisma.discussion.findFirst({ where: { id, project: { organizationId: auth.orgId } } });
    if (!d) throw notFound('Discussion');
    const a = await projectAccess(auth, d.projectId);
    if (a.isCustomer && d.visibility !== 'PUBLIC') throw notFound('Discussion');
    return { kind: type, projectId: d.projectId, isCustomer: a.isCustomer, canInternal: d.visibility === 'INTERNAL' && a.can('comment.internal'), canPublic: d.visibility === 'PUBLIC' && a.can('comment.public'),
      forcedVisibility: d.visibility, fk: { discussionId: id, projectId: d.projectId }, link: `/projects/${d.projectId}/discussions/${id}`, label: d.title, watchers: [d.createdById] };
  }
  if (type === 'ticket') {
    const t = await ticketAccess(auth, id);
    const internal = !auth.isCustomer && orgCan(auth, 'ticket.work');
    return { kind: type, isCustomer: auth.isCustomer, canInternal: internal, canPublic: true, canUploadInternal: internal, canUploadPublic: true, canDeleteAny: internal,
      fk: { ticketId: id }, ticket: t, link: `/tickets/${id}`, label: `#${t.number} ${t.subject}`, watchers: [t.assigneeId, t.requesterId] };
  }
  if (type === 'project') {
    const a = await projectAccess(auth, id);
    return { kind: type, projectId: id, isCustomer: a.isCustomer, canUploadInternal: a.internal && a.can('file.upload'), canUploadPublic: a.can('file.upload'), canDeleteAny: a.can('project.edit'),
      fk: { projectId: id }, link: `/projects/${id}/files` };
  }
  if (type === 'deliverableVersion') {
    const v = await prisma.deliverableVersion.findFirst({ where: { id, deliverable: { project: { organizationId: auth.orgId } } }, include: { deliverable: true } });
    if (!v) throw notFound('Deliverable version');
    const a = await projectAccess(auth, v.deliverable.projectId);
    if (a.isCustomer && !(v.deliverable.customerVisible && v.deliverable.status !== 'DRAFT')) throw notFound('Deliverable version');
    return { kind: type, projectId: a.project.id, isCustomer: a.isCustomer, canUploadInternal: false, canUploadPublic: a.can('deliverable.manage'), canDeleteAny: a.can('deliverable.manage'),
      fk: { deliverableVersionId: id, projectId: a.project.id }, link: `/projects/${a.project.id}/deliverables` };
  }
  throw notFound('Target');
}
