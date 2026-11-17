import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, listQuery, pageArgs, paged, uuid } from '../lib/http.js';
import { forbidden, notFound, badRequest } from '../lib/errors.js';
import { projectAccess, visibleProjectsWhere, ticketsWhere } from '../policies/access.js';
import * as S from '../policies/serializers.js';
import { audit } from '../services/audit.js';
import { notify, mentionedIds } from '../services/notify.js';
import { resolveTarget } from '../services/targets.js';

const r = Router();
const TARGET = z.enum(['workItem', 'discussion']);

async function withAuthors(rows) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((c) => c.authorId))] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u]));
}

/** Notify mentioned users only if they can see the comment (customers never get internal comments). */
export async function notifyMentions(tx, auth, { body, visibility, target, projectId, ticketCompanyId }) {
  const ids = mentionedIds(body);
  if (!ids.length) return;
  const members = await tx.membership.findMany({ where: { organizationId: auth.orgId, userId: { in: ids }, status: 'ACTIVE' } });
  const allowed = [];
  for (const m of members) {
    if (m.role === 'CUSTOMER') {
      if (visibility !== 'PUBLIC') continue;
      if (projectId && !(await tx.projectMember.findFirst({ where: { projectId, userId: m.userId, role: 'CUSTOMER' } }))) continue;
      if (ticketCompanyId && m.customerCompanyId !== ticketCompanyId) continue;
    } else if (projectId && m.role !== 'ADMIN' && !(await tx.projectMember.findFirst({ where: { projectId, userId: m.userId } }))) continue;
    allowed.push(m.userId);
  }
  await notify(tx, { orgId: auth.orgId, userIds: allowed, exclude: auth.userId, type: 'mention', title: `${auth.user.name} mentioned you on ${target.label}`, body: body.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1'), link: target.link });
}

r.get('/comments', async (req, res) => {
  const q = parse(z.object({ targetType: TARGET, targetId: uuid }), req.query);
  const t = await resolveTarget(req.auth, q.targetType, q.targetId);
  const rows = await prisma.comment.findMany({ where: { organizationId: req.auth.orgId, ...t.fk, projectId: undefined, ...(t.isCustomer && { visibility: 'PUBLIC' }) }, orderBy: { createdAt: 'asc' }, take: 500 });
  const authors = await withAuthors(rows);
  res.json({ data: rows.map((c) => S.comment(c, authors)), canInternal: t.canInternal, canPublic: t.canPublic });
});

r.post('/comments', async (req, res) => {
  const b = parse(z.object({ targetType: TARGET, targetId: uuid, body: z.string().trim().min(1).max(10000), visibility: z.enum(['INTERNAL', 'PUBLIC']).default('INTERNAL') }), req.body);
  const t = await resolveTarget(req.auth, b.targetType, b.targetId);
  const visibility = t.forcedVisibility ?? (t.isCustomer ? 'PUBLIC' : b.visibility);
  if (t.isCustomer && b.visibility === 'INTERNAL' && b.targetType === 'workItem') throw forbidden('Customers can only post customer-visible comments');
  if (visibility === 'INTERNAL' && !t.canInternal) throw forbidden();
  if (visibility === 'PUBLIC' && !t.canPublic) throw forbidden(b.targetType === 'workItem' ? 'This item is not shared with the customer, so only internal comments are allowed' : undefined);
  const c = await prisma.$transaction(async (tx) => {
    const row = await tx.comment.create({ data: { organizationId: req.auth.orgId, ...t.fk, authorId: req.auth.userId, body: b.body, visibility } });
    await audit(tx, req.auth, { action: 'comment.created', entityType: b.targetType, entityId: b.targetId, projectId: t.projectId, visibility, metadata: { commentId: row.id } }, req.ip);
    await notifyMentions(tx, req.auth, { body: b.body, visibility, target: t, projectId: t.projectId });
    const watchers = [];
    for (const w of t.watchers.filter(Boolean)) {
      const m = await tx.membership.findFirst({ where: { organizationId: req.auth.orgId, userId: w } });
      if (m && (m.role !== 'CUSTOMER' || visibility === 'PUBLIC')) watchers.push(w);
    }
    await notify(tx, { orgId: req.auth.orgId, userIds: watchers.filter((w) => !mentionedIds(b.body).includes(w)), exclude: req.auth.userId, type: 'comment', title: `New comment on ${t.label}`, body: b.body.slice(0, 200), link: t.link });
    return row;
  });
  res.status(201).json(S.comment(c, await withAuthors([c])));
});

r.patch('/comments/:id', async (req, res) => {
  const { body } = parse(z.object({ body: z.string().trim().min(1).max(10000) }), req.body);
  const c = await prisma.comment.findFirst({ where: { id: req.params.id, organizationId: req.auth.orgId, deletedAt: null } });
  if (!c || c.authorId !== req.auth.userId) throw notFound('Comment');
  await prisma.comment.update({ where: { id: c.id }, data: { body, editedAt: new Date() } });
  res.json({ ok: true });
});

r.delete('/comments/:id', async (req, res) => {
  const c = await prisma.comment.findFirst({ where: { id: req.params.id, organizationId: req.auth.orgId, deletedAt: null } });
  if (!c) throw notFound('Comment');
  if (c.authorId !== req.auth.userId) {
    const t = c.workItemId ? await resolveTarget(req.auth, 'workItem', c.workItemId) : null;
    if (!t?.canDeleteAny) throw notFound('Comment');
  }
  await prisma.comment.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
  await audit(prisma, req.auth, { action: 'comment.deleted', entityType: 'Comment', entityId: c.id, projectId: c.projectId }, req.ip);
  res.status(204).end();
});

// ----- Discussions -----
r.get('/projects/:projectId/discussions', async (req, res) => {
  const a = await projectAccess(req.auth, req.params.projectId);
  const rows = await prisma.discussion.findMany({ where: { projectId: a.project.id, ...(a.isCustomer && { visibility: 'PUBLIC' }) }, orderBy: { createdAt: 'desc' }, take: 200 });
  const counts = await prisma.comment.groupBy({ by: ['discussionId'], where: { discussionId: { in: rows.map((d) => d.id) }, deletedAt: null }, _count: true });
  const cm = new Map(counts.map((c) => [c.discussionId, c._count]));
  res.json({ data: rows.map((d) => ({ id: d.id, title: d.title, visibility: d.visibility, createdAt: d.createdAt, comments: cm.get(d.id) ?? 0 })) });
});
r.post('/projects/:projectId/discussions', async (req, res) => {
  const a = await projectAccess(req.auth, req.params.projectId);
  const b = parse(z.object({ title: z.string().trim().min(1).max(200), visibility: z.enum(['INTERNAL', 'PUBLIC']).default('INTERNAL'), body: z.string().trim().min(1).max(10000) }), req.body);
  const visibility = a.isCustomer ? 'PUBLIC' : b.visibility;
  if (!a.can(visibility === 'PUBLIC' ? 'comment.public' : 'comment.internal')) throw forbidden();
  if (visibility === 'PUBLIC' && !a.project.customerVisible && !a.isCustomer) throw badRequest('Share the project with the customer before starting customer-visible discussions');
  const d = await prisma.$transaction(async (tx) => {
    const disc = await tx.discussion.create({ data: { projectId: a.project.id, title: b.title, visibility, createdById: req.auth.userId } });
    await tx.comment.create({ data: { organizationId: req.auth.orgId, projectId: a.project.id, discussionId: disc.id, authorId: req.auth.userId, body: b.body, visibility } });
    await audit(tx, req.auth, { action: 'discussion.created', entityType: 'Discussion', entityId: disc.id, projectId: a.project.id, visibility }, req.ip);
    await notifyMentions(tx, req.auth, { body: b.body, visibility, target: { label: b.title, link: `/projects/${a.project.id}/discussions/${disc.id}` }, projectId: a.project.id });
    return disc;
  });
  res.status(201).json(d);
});

// ----- Status updates / announcements -----
r.get('/projects/:projectId/updates', async (req, res) => {
  const a = await projectAccess(req.auth, req.params.projectId);
  const rows = await prisma.statusUpdate.findMany({ where: { projectId: a.project.id, ...(a.isCustomer && { customerVisible: true }) }, orderBy: { createdAt: 'desc' }, take: 100 });
  const authors = await withAuthors(rows);
  res.json({ data: rows.map((u) => ({ id: u.id, title: u.title, body: u.body, health: u.health, createdAt: u.createdAt, author: S.publicUser(authors.get(u.authorId)), ...(a.internal && { customerVisible: u.customerVisible }) })) });
});
r.post('/projects/:projectId/updates', async (req, res) => {
  const a = await projectAccess(req.auth, req.params.projectId);
  a.require('update.publish');
  const b = parse(z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20000), health: z.enum(['GREEN', 'AMBER', 'RED']), customerVisible: z.boolean().default(false), applyHealth: z.boolean().default(true) }), req.body);
  if (b.customerVisible && !a.project.customerVisible) throw badRequest('Share the project with the customer before publishing customer-visible updates');
  const u = await prisma.$transaction(async (tx) => {
    const row = await tx.statusUpdate.create({ data: { projectId: a.project.id, authorId: req.auth.userId, title: b.title, body: b.body, health: b.health, customerVisible: b.customerVisible } });
    if (b.applyHealth) await tx.project.update({ where: { id: a.project.id }, data: { health: b.health, version: { increment: 1 } } });
    const members = await tx.projectMember.findMany({ where: { projectId: a.project.id, ...(b.customerVisible ? {} : { role: { not: 'CUSTOMER' } }) } });
    await notify(tx, { orgId: req.auth.orgId, userIds: members.map((m) => m.userId), exclude: req.auth.userId, type: 'status_update', title: `${a.project.code} status update: ${b.title}`, link: `/projects/${a.project.id}` });
    await audit(tx, req.auth, { action: 'status_update.published', entityType: 'StatusUpdate', entityId: row.id, projectId: a.project.id, visibility: b.customerVisible ? 'PUBLIC' : 'INTERNAL' }, req.ip);
    return row;
  });
  res.status(201).json(u);
});

// ----- Notifications -----
r.get('/notifications', async (req, res) => {
  const q = parse(listQuery.extend({ unread: z.enum(['true', 'false']).optional() }), req.query);
  const where = { userId: req.auth.userId, organizationId: req.auth.orgId, ...(q.unread === 'true' && { readAt: null }) };
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }), prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.auth.userId, organizationId: req.auth.orgId, readAt: null } }),
  ]);
  res.json({ ...paged(rows.map(({ dedupeKey, organizationId, ...n }) => n), total, q), unread, emailDelivery: 'NOT_CONFIGURED' });
});
r.post('/notifications/:id/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.auth.userId, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
r.post('/notifications/read-all', async (req, res) => {
  const n = await prisma.notification.updateMany({ where: { userId: req.auth.userId, organizationId: req.auth.orgId, readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: n.count });
});

// ----- Search (permission-filtered) -----
r.get('/search', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
  const pw = visibleProjectsWhere(req.auth);
  const projects = await prisma.project.findMany({ where: { ...pw, OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] }, take: 8 });
  const accessible = await prisma.project.findMany({ where: pw, select: { id: true, code: true } });
  const codes = new Map(accessible.map((p) => [p.id, p.code]));
  const keyMatch = q.match(/^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/);
  const items = await prisma.workItem.findMany({ where: { projectId: { in: [...codes.keys()] }, ...(req.auth.isCustomer && { customerVisible: true }),
    OR: [{ title: { contains: q, mode: 'insensitive' } }, ...(keyMatch ? [{ number: Number(keyMatch[2]), project: { code: keyMatch[1].toUpperCase() } }] : [])] }, take: 12, orderBy: { updatedAt: 'desc' } });
  const tw = await ticketsWhere(req.auth);
  const num = q.replace(/^#/, '');
  const tickets = await prisma.ticket.findMany({ where: { ...tw, AND: [{ OR: [{ subject: { contains: q, mode: 'insensitive' } }, ...(/^\d+$/.test(num) ? [{ number: Number(num) }] : [])] }] }, take: 8, orderBy: { updatedAt: 'desc' } });
  res.json({
    projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status })),
    workItems: items.map((i) => ({ id: i.id, projectId: i.projectId, key: `${codes.get(i.projectId)}-${i.number}`, title: i.title, type: i.type, status: i.status })),
    tickets: tickets.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status })),
  });
});

export default r;
