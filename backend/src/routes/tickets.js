import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, listQuery, pageArgs, paged, uuid, orderBy } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ticketsWhere, ticketAccess, projectAccess, workItemAccess, requireOrg } from '../policies/access.js';
import { orgCan } from '../policies/permissions.js';
import * as S from '../policies/serializers.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';
import { notifyMentions } from './collaboration.js';
import { loadCalendar, toBusinessCalendar } from '../services/calendars.js';
import { initialDueDates, statusChangePatch, slaStatus } from '../domain/sla.js';
import { canTransitionTicket } from '../domain/workflow.js';
import { toCsv } from '../lib/csv.js';
import { publish, ticketEvent } from '../services/events.js';

const r = Router();
const PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const TYPE = z.enum(['BUG', 'SERVICE_REQUEST', 'QUESTION', 'CHANGE_REQUEST']);
const STATUS = z.enum(['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED']);

export async function slaContext(orgId, priority, db = prisma) {
  const policy = await db.slaPolicy.findUnique({ where: { organizationId_priority: { organizationId: orgId, priority } } });
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  const cal = await loadCalendar(db, policy?.calendarId, orgId);
  return { policy, cal: toBusinessCalendar(cal, org.timezone) };
}

async function withSla(tickets) {
  const ctx = {};
  const now = new Date();
  const out = [];
  for (const t of tickets) {
    ctx[t.priority] ??= await slaContext(t.organizationId, t.priority);
    out.push({ t, sla: slaStatus(t, ctx[t.priority].policy, now, ctx[t.priority].cal) });
  }
  return out;
}

async function names(ids) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean))] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

const listSchema = listQuery.extend({ status: z.string().optional(), priority: PRIORITY.optional(), type: TYPE.optional(), assigneeId: z.union([uuid, z.literal('me'), z.literal('none')]).optional(),
  customerCompanyId: uuid.optional(), projectId: uuid.optional(), sla: z.enum(['BREACHED', 'AT_RISK']).optional(), tag: z.string().max(40).optional(), requester: z.literal('me').optional(),
  view: z.enum(['mine', 'unassigned', 'open', 'overdue', 'waiting', 'new', 'resolved', 'all', 'requested']).optional() });

const OPEN = ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'];
const breachedWhere = () => ({ resolvedAt: null, status: { notIn: ['WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] }, OR: [{ resolutionDueAt: { lt: new Date() } }, { firstResponseAt: null, responseDueAt: { lt: new Date() } }] });
/** Saved views for the queue sidebar. Each maps to a where-fragment applied on top of the user's scope. */
function viewWhere(view, auth) {
  switch (view) {
    case 'mine': return { status: { in: OPEN }, assigneeId: auth.userId };
    case 'unassigned': return { status: { in: OPEN }, assigneeId: null };
    case 'open': return { status: { in: OPEN } };
    case 'overdue': return breachedWhere();
    case 'waiting': return { status: 'WAITING_ON_CUSTOMER' };
    case 'new': return { status: 'NEW' };
    case 'resolved': return { status: { in: ['RESOLVED', 'CLOSED'] } };
    case 'requested': return { requesterId: auth.userId };
    default: return {};
  }
}

async function listWhere(req, q) {
  const statuses = q.status === 'open' ? ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'] : q.status?.split(',').filter((s) => STATUS.safeParse(s).success);
  const and = [await ticketsWhere(req.auth)];
  if (statuses?.length) and.push({ status: { in: statuses } });
  if (q.priority) and.push({ priority: q.priority });
  if (q.type) and.push({ type: q.type });
  if (q.assigneeId && !req.auth.isCustomer) and.push({ assigneeId: q.assigneeId === 'me' ? req.auth.userId : q.assigneeId === 'none' ? null : q.assigneeId });
  if (q.customerCompanyId && !req.auth.isCustomer) and.push({ customerCompanyId: q.customerCompanyId });
  if (q.projectId) and.push({ projectId: q.projectId });
  if (q.q) and.push({ OR: [{ subject: { contains: q.q, mode: 'insensitive' } }, ...(/^#?\d+$/.test(q.q) ? [{ number: Number(q.q.replace('#', '')) }] : [])] });
  if (q.sla === 'BREACHED') and.push(breachedWhere());
  if (q.view) and.push(viewWhere(q.view, req.auth));
  if (q.tag && !req.auth.isCustomer) and.push({ tags: { has: q.tag } });
  if (q.requester === 'me') and.push({ requesterId: req.auth.userId });
  return { AND: and };
}

// Counts for the queue sidebar.
r.get('/views', async (req, res) => {
  const scope = await ticketsWhere(req.auth);
  const keys = req.auth.isCustomer ? ['open', 'waiting', 'resolved', 'requested', 'all'] : ['mine', 'unassigned', 'open', 'overdue', 'waiting', 'new', 'resolved', 'all'];
  const counts = await Promise.all(keys.map((k) => prisma.ticket.count({ where: { AND: [scope, viewWhere(k, req.auth)] } })));
  res.json(Object.fromEntries(keys.map((k, i) => [k, counts[i]])));
});

const DAY = 86400000;
// Service-desk dashboard metrics (staff only).
r.get('/stats', async (req, res) => {
  if (req.auth.isCustomer) throw forbidden();
  const scope = await ticketsWhere(req.auth);
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);
  const since14 = new Date(new Date().setHours(0, 0, 0, 0) - 13 * DAY);
  const [open, recentCreated, recentResolved, rated] = await Promise.all([
    prisma.ticket.findMany({ where: { AND: [scope, { status: { in: OPEN } }] }, include: { customerCompany: { select: { name: true } } } }),
    prisma.ticket.findMany({ where: { AND: [scope, { createdAt: { gte: since30 } }] }, select: { createdAt: true, firstResponseAt: true } }),
    prisma.ticket.findMany({ where: { AND: [scope, { resolvedAt: { gte: since30 } }] }, select: { createdAt: true, resolvedAt: true, resolutionDueAt: true, assigneeId: true } }),
    prisma.ticket.findMany({ where: { AND: [scope, { csatAt: { gte: new Date(now - 90 * DAY) } }] }, select: { csatRating: true } }),
  ]);
  const enriched = await withSla(open);
  const state = (x) => [x.sla.response, x.sla.resolution].some((c) => c?.state === 'BREACHED') ? 'BREACHED' : [x.sla.response, x.sla.resolution].some((c) => c?.state === 'AT_RISK') ? 'AT_RISK' : 'OK';
  const days = [...Array(14)].map((_, i) => new Date(since14.getTime() + i * DAY).toISOString().slice(0, 10));
  const perDay = (dates) => days.map((d) => dates.filter((x) => x && x.toISOString().slice(0, 10) === d).length);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const responded = recentCreated.filter((t) => t.firstResponseAt);
  const nm = await names([...open.map((t) => t.assigneeId), ...recentResolved.map((t) => t.assigneeId)]);
  const agents = new Map();
  for (const t of open) if (t.assigneeId) { const a = agents.get(t.assigneeId) || { id: t.assigneeId, name: nm.get(t.assigneeId), open: 0, resolved: 0 }; a.open++; agents.set(t.assigneeId, a); }
  for (const t of recentResolved) if (t.assigneeId) { const a = agents.get(t.assigneeId) || { id: t.assigneeId, name: nm.get(t.assigneeId), open: 0, resolved: 0 }; a.resolved++; agents.set(t.assigneeId, a); }
  const byCustomer = new Map();
  for (const t of open) { const k = t.customerCompany?.name || 'Internal'; byCustomer.set(k, (byCustomer.get(k) || 0) + 1); }
  const count = (key, vals) => Object.fromEntries(vals.map((v) => [v, open.filter((t) => t[key] === v).length]));
  res.json({
    open: open.length,
    unassigned: open.filter((t) => !t.assigneeId).length,
    breached: enriched.filter((x) => state(x) === 'BREACHED').length,
    atRisk: enriched.filter((x) => state(x) === 'AT_RISK').length,
    createdToday: recentCreated.filter((t) => t.createdAt >= new Date(new Date().setHours(0, 0, 0, 0))).length,
    resolved30: recentResolved.length,
    avgFirstResponseHours: avg(responded.map((t) => (t.firstResponseAt - t.createdAt) / 3600000)),
    avgResolutionHours: avg(recentResolved.map((t) => (t.resolvedAt - t.createdAt) / 3600000)),
    slaCompliance: recentResolved.length ? recentResolved.filter((t) => !t.resolutionDueAt || t.resolvedAt <= t.resolutionDueAt).length / recentResolved.length : null,
    csat: { average: avg(rated.map((t) => t.csatRating)), count: rated.length },
    byPriority: count('priority', ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
    byStatus: count('status', OPEN),
    trend: { days, created: perDay(recentCreated.map((t) => t.createdAt)), resolved: perDay(recentResolved.map((t) => t.resolvedAt)) },
    agents: [...agents.values()].sort((a, b) => b.open - a.open).slice(0, 8),
    customers: [...byCustomer].map(([name, n]) => ({ name, open: n })).sort((a, b) => b.open - a.open).slice(0, 6),
  });
});

// Bulk triage: assign, change priority, set status or add a tag on many tickets at once.
r.post('/bulk', async (req, res) => {
  if (req.auth.isCustomer || !orgCan(req.auth, 'ticket.work')) throw forbidden();
  const b = parse(z.object({ ids: z.array(uuid).min(1).max(200), assigneeId: uuid.nullable().optional(), priority: PRIORITY.optional(), status: STATUS.optional(), addTag: z.string().trim().min(1).max(40).optional() }), req.body);
  if (b.assigneeId && !(await prisma.membership.findFirst({ where: { organizationId: req.auth.orgId, userId: b.assigneeId, status: 'ACTIVE', role: { not: 'CUSTOMER' } } }))) throw badRequest('Assignee must be an internal user');
  const tickets = await prisma.ticket.findMany({ where: { AND: [await ticketsWhere(req.auth), { id: { in: b.ids } }] } });
  let updated = 0; const skipped = [];
  for (const t of tickets) {
    const data = {};
    if (b.assigneeId !== undefined) { data.assigneeId = b.assigneeId; if (b.assigneeId && t.status === 'NEW') data.status = 'OPEN'; }
    if (b.priority && b.priority !== t.priority) { const { policy, cal } = await slaContext(t.organizationId, b.priority); Object.assign(data, { priority: b.priority }, initialDueDates(t.createdAt, policy, cal)); }
    if (b.addTag && !t.tags.includes(b.addTag)) data.tags = [...t.tags, b.addTag];
    if (b.status && b.status !== t.status) {
      if (!canTransitionTicket(t.status, b.status, false)) { skipped.push({ id: t.id, number: t.number, reason: `can't move from ${t.status}` }); continue; }
      const { cal } = await slaContext(t.organizationId, t.priority);
      Object.assign(data, statusChangePatch(t, b.status, new Date(), cal));
    }
    if (!Object.keys(data).length) continue;
    await prisma.ticket.update({ where: { id: t.id }, data: { ...data, version: { increment: 1 } } });
    await audit(prisma, req.auth, { action: data.status ? 'ticket.status_changed' : 'ticket.updated', entityType: 'Ticket', entityId: t.id, projectId: t.projectId, visibility: data.status ? 'PUBLIC' : 'INTERNAL', metadata: data.status ? { from: t.status, to: data.status, bulk: true } : { changes: { ...b, ids: undefined }, bulk: true } }, req.ip);
    if (b.assigneeId && b.assigneeId !== t.assigneeId) await notify(prisma, { orgId: req.auth.orgId, userIds: [b.assigneeId], exclude: req.auth.userId, type: 'ticket.assigned', title: `Ticket #${t.number} assigned to you`, link: `/tickets/${t.id}` });
    publish(ticketEvent('ticket.updated', { ...t, ...data }, { actorId: req.auth.userId }));
    updated++;
  }
  res.json({ updated, skipped });
});

r.get('/', async (req, res) => {
  const q = parse(listSchema, req.query);
  const where = await listWhere(req, q);
  const [rows, total] = await Promise.all([
    prisma.ticket.findMany({ where, orderBy: orderBy(q.sort, q.dir, ['number', 'updatedAt', 'createdAt', 'priority', 'status', 'resolutionDueAt'], 'updatedAt'), ...pageArgs(q), include: { customerCompany: true, project: { select: { code: true, name: true } } } }),
    prisma.ticket.count({ where }),
  ]);
  const nm = await names(rows.flatMap((t) => [t.assigneeId, t.requesterId]));
  const enriched = await withSla(rows);
  res.json(paged(enriched.map(({ t, sla }) => S.ticket(t, req.auth.isCustomer, { sla, customerName: t.customerCompany?.name ?? null, project: t.project, requesterName: nm.get(t.requesterId), ...(!req.auth.isCustomer && { assigneeName: nm.get(t.assigneeId) ?? null }) })), total, q));
});

r.get('/export.csv', async (req, res) => {
  const q = parse(listSchema.omit({ page: true, pageSize: true }), req.query);
  const rows = await prisma.ticket.findMany({ where: await listWhere(req, q), orderBy: { number: 'asc' }, take: 10000, include: { customerCompany: true } });
  const nm = await names(rows.flatMap((t) => [t.assigneeId, t.requesterId]));
  const enriched = await withSla(rows);
  const cols = [{ label: 'Number', value: ({ t }) => t.number }, { label: 'Subject', value: ({ t }) => t.subject }, { label: 'Customer', value: ({ t }) => t.customerCompany?.name },
    { label: 'Type', value: ({ t }) => t.type }, { label: 'Priority', value: ({ t }) => t.priority }, { label: 'Status', value: ({ t }) => t.status },
    { label: 'Requester', value: ({ t }) => nm.get(t.requesterId) }, { label: 'Created', value: ({ t }) => t.createdAt }, { label: 'Resolved', value: ({ t }) => t.resolvedAt },
    { label: 'Response SLA', value: ({ sla }) => sla.response.state }, { label: 'Resolution SLA', value: ({ sla }) => sla.resolution.state }];
  if (!req.auth.isCustomer) cols.splice(7, 0, { label: 'Assignee', value: ({ t }) => nm.get(t.assigneeId) });
  await audit(prisma, req.auth, { action: 'export.tickets', entityType: 'Ticket', metadata: { rows: rows.length } }, req.ip);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="tickets.csv"' }).send('﻿' + toCsv(cols, enriched));
});

r.post('/', async (req, res) => {
  requireOrg(req.auth, 'ticket.create');
  const b = parse(z.object({ subject: z.string().trim().min(3).max(200), description: z.string().trim().min(1).max(20000), type: TYPE.default('QUESTION'), priority: PRIORITY.default('MEDIUM'),
    severity: z.number().int().min(1).max(5).default(3), category: z.string().max(60).optional().nullable(), projectId: uuid.optional().nullable(), customerCompanyId: uuid.optional().nullable(),
    requesterId: uuid.optional(), assigneeId: uuid.optional().nullable() }), req.body);
  const auth = req.auth;
  let companyId = b.customerCompanyId ?? null; let requesterId = auth.userId;
  if (auth.isCustomer) {
    companyId = auth.customerCompanyId; delete b.assigneeId;
  } else {
    if (companyId && !(await prisma.customerCompany.findFirst({ where: { id: companyId, organizationId: auth.orgId } }))) throw badRequest('Unknown customer company');
    if (b.requesterId) {
      const m = await prisma.membership.findFirst({ where: { organizationId: auth.orgId, userId: b.requesterId, status: 'ACTIVE' } });
      if (!m) throw badRequest('Unknown requester');
      if (m.role === 'CUSTOMER') { if (companyId && companyId !== m.customerCompanyId) throw badRequest('Requester belongs to a different customer'); companyId = m.customerCompanyId; }
      requesterId = b.requesterId;
    }
    if (b.assigneeId && !(await prisma.membership.findFirst({ where: { organizationId: auth.orgId, userId: b.assigneeId, status: 'ACTIVE', role: { not: 'CUSTOMER' } } }))) throw badRequest('Assignee must be an internal user');
  }
  if (b.projectId) {
    const a = await projectAccess(auth, b.projectId);
    if (companyId && a.project.customerCompanyId && a.project.customerCompanyId !== companyId) throw badRequest('That project belongs to a different customer');
    companyId ??= a.project.customerCompanyId;
  }
  if (b.category && !(await prisma.ticketCategory.findFirst({ where: { organizationId: auth.orgId, name: b.category } }))) throw badRequest('Unknown category');
  const { policy, cal } = await slaContext(auth.orgId, b.priority);
  const now = new Date();
  const t = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({ where: { id: auth.orgId }, data: { ticketSeq: { increment: 1 } }, select: { ticketSeq: true } });
    const row = await tx.ticket.create({ data: { organizationId: auth.orgId, number: org.ticketSeq, subject: b.subject, description: b.description, type: b.type, priority: b.priority, severity: b.severity,
      category: b.category, projectId: b.projectId ?? null, customerCompanyId: companyId, requesterId, assigneeId: b.assigneeId ?? null, status: b.assigneeId ? 'OPEN' : 'NEW', createdAt: now, ...initialDueDates(now, policy, cal) } });
    await audit(tx, auth, { action: 'ticket.created', entityType: 'Ticket', entityId: row.id, projectId: row.projectId, visibility: 'PUBLIC', metadata: { number: row.number, priority: row.priority } }, req.ip);
    const desk = await tx.membership.findMany({ where: { organizationId: auth.orgId, role: { in: ['ADMIN', 'MANAGER'] }, status: 'ACTIVE' }, select: { userId: true } });
    await notify(tx, { orgId: auth.orgId, userIds: row.assigneeId ? [row.assigneeId] : desk.map((d) => d.userId), exclude: auth.userId, type: 'ticket.created', title: `New ticket #${row.number}: ${row.subject}`, link: `/tickets/${row.id}` });
    return row;
  });
  publish(ticketEvent('ticket.created', t, { actorId: auth.userId }));
  res.status(201).json(S.ticket(t, auth.isCustomer));
});

r.get('/:id', async (req, res) => {
  const t = await ticketAccess(req.auth, req.params.id);
  const isC = req.auth.isCustomer;
  const [messages, links, history, company, project] = await Promise.all([
    prisma.comment.findMany({ where: { ticketId: t.id, ...(isC && { visibility: 'PUBLIC' }) }, orderBy: { createdAt: 'asc' } }),
    isC ? [] : prisma.ticketLink.findMany({ where: { ticketId: t.id }, include: { workItem: { include: { project: { select: { id: true, code: true } } } } } }),
    prisma.auditEvent.findMany({ where: { organizationId: req.auth.orgId, entityType: 'Ticket', entityId: t.id, ...(isC && { visibility: 'PUBLIC' }) }, orderBy: { createdAt: 'asc' }, take: 200 }),
    t.customerCompanyId ? prisma.customerCompany.findUnique({ where: { id: t.customerCompanyId } }) : null,
    t.projectId ? prisma.project.findUnique({ where: { id: t.projectId }, select: { id: true, code: true, name: true } }) : null,
  ]);
  const nm = await names([t.assigneeId, t.requesterId, ...messages.map((m) => m.authorId), ...history.map((h) => h.actorId)]);
  const authors = new Map([...nm].map(([id, name]) => [id, { id, name }]));
  const { policy, cal } = await slaContext(t.organizationId, t.priority);
  res.json({
    ...S.ticket(t, isC, { sla: slaStatus(t, policy, new Date(), cal), customerName: company?.name ?? null, project, requesterName: nm.get(t.requesterId), ...(!isC && { assigneeName: nm.get(t.assigneeId) ?? null }) }),
    messages: messages.map((m) => S.comment(m, authors)),
    links: links.map((l) => ({ workItemId: l.workItemId, projectId: l.workItem.projectId, key: `${l.workItem.project.code}-${l.workItem.number}`, title: l.workItem.title, status: l.workItem.status, linkType: l.linkType })),
    history: history.map((h) => ({ action: h.action, actorName: nm.get(h.actorId) ?? 'System', createdAt: h.createdAt, metadata: isC ? { from: h.metadata?.from, to: h.metadata?.to } : h.metadata })),
    allowedStatuses: Object.keys({ NEW: 1, OPEN: 1, IN_PROGRESS: 1, WAITING_ON_CUSTOMER: 1, RESOLVED: 1, CLOSED: 1 }).filter((s) => canTransitionTicket(t.status, s, isC)),
    canWork: !isC && orgCan(req.auth, 'ticket.work'),
    slaPolicy: isC ? undefined : policy && { responseMinutes: policy.responseMinutes, resolutionMinutes: policy.resolutionMinutes },
  });
});

r.patch('/:id', async (req, res) => {
  const t = await ticketAccess(req.auth, req.params.id);
  if (req.auth.isCustomer || !orgCan(req.auth, 'ticket.work')) throw forbidden();
  const { version, ...b } = parse(z.object({ version: z.number().int(), subject: z.string().trim().min(3).max(200).optional(), priority: PRIORITY.optional(), severity: z.number().int().min(1).max(5).optional(),
    type: TYPE.optional(), category: z.string().max(60).nullable().optional(), assigneeId: uuid.nullable().optional(), projectId: uuid.nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional() }), req.body);
  if (b.assigneeId && !(await prisma.membership.findFirst({ where: { organizationId: req.auth.orgId, userId: b.assigneeId, status: 'ACTIVE', role: { not: 'CUSTOMER' } } }))) throw badRequest('Assignee must be an internal user');
  if (b.projectId) { const a = await projectAccess(req.auth, b.projectId); if (t.customerCompanyId && a.project.customerCompanyId && a.project.customerCompanyId !== t.customerCompanyId) throw badRequest('That project belongs to a different customer'); }
  const data = { ...b, version: { increment: 1 } };
  if (b.priority && b.priority !== t.priority) {
    // documented rule: a priority change recalculates both targets from the ticket's creation time
    const { policy, cal } = await slaContext(t.organizationId, b.priority);
    Object.assign(data, initialDueDates(t.createdAt, policy, cal));
  }
  if (b.assigneeId && t.status === 'NEW') data.status = 'OPEN';
  const n = await prisma.ticket.updateMany({ where: { id: t.id, version }, data });
  if (!n.count) throw conflict('This ticket was updated by someone else. Reload and try again.');
  await audit(prisma, req.auth, { action: 'ticket.updated', entityType: 'Ticket', entityId: t.id, projectId: t.projectId, metadata: { changes: b } }, req.ip);
  if (b.assigneeId && b.assigneeId !== t.assigneeId) await notify(prisma, { orgId: req.auth.orgId, userIds: [b.assigneeId], exclude: req.auth.userId, type: 'ticket.assigned', title: `Ticket #${t.number} assigned to you`, link: `/tickets/${t.id}` });
  const fresh = await prisma.ticket.findUnique({ where: { id: t.id } });
  publish(ticketEvent('ticket.updated', fresh, { actorId: req.auth.userId, internal: !('assigneeId' in b || 'priority' in b || 'subject' in b) }));
  res.json(S.ticket(fresh, false));
});

// Customer satisfaction: the requester rates a resolved or closed ticket once (can update their rating).
r.post('/:id/csat', async (req, res) => {
  const t = await ticketAccess(req.auth, req.params.id);
  if (t.requesterId !== req.auth.userId) throw forbidden('Only the person who raised the ticket can rate it');
  if (!['RESOLVED', 'CLOSED'].includes(t.status)) throw badRequest('You can rate a ticket once it is resolved');
  const b = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional().nullable() }), req.body);
  const row = await prisma.ticket.update({ where: { id: t.id }, data: { csatRating: b.rating, csatComment: b.comment || null, csatAt: new Date() } });
  await audit(prisma, req.auth, { action: 'ticket.rated', entityType: 'Ticket', entityId: t.id, projectId: t.projectId, visibility: 'PUBLIC', metadata: { rating: b.rating } }, req.ip);
  if (t.assigneeId) await notify(prisma, { orgId: req.auth.orgId, userIds: [t.assigneeId], type: 'ticket.rated', title: `Ticket #${t.number} rated ${b.rating}/5`, body: b.comment?.slice(0, 200), link: `/tickets/${t.id}` });
  publish(ticketEvent('ticket.updated', row, { actorId: req.auth.userId }));
  res.json({ ok: true, rating: row.csatRating });
});

r.post('/:id/status', async (req, res) => {
  const t = await ticketAccess(req.auth, req.params.id);
  const { status, version } = parse(z.object({ status: STATUS, version: z.number().int() }), req.body);
  if (!req.auth.isCustomer && !orgCan(req.auth, 'ticket.work')) throw forbidden();
  if (!canTransitionTicket(t.status, status, req.auth.isCustomer)) throw badRequest(`Cannot move a ${t.status.replace(/_/g, ' ').toLowerCase()} ticket to ${status.replace(/_/g, ' ').toLowerCase()}`);
  const { cal } = await slaContext(t.organizationId, t.priority);
  const patch = statusChangePatch(t, status, new Date(), cal);
  const n = await prisma.ticket.updateMany({ where: { id: t.id, version }, data: { ...patch, version: { increment: 1 } } });
  if (!n.count) throw conflict('This ticket was updated by someone else. Reload and try again.');
  await audit(prisma, req.auth, { action: patch.reopenCount ? 'ticket.reopened' : 'ticket.status_changed', entityType: 'Ticket', entityId: t.id, projectId: t.projectId, visibility: 'PUBLIC', metadata: { from: t.status, to: status } }, req.ip);
  await notify(prisma, { orgId: req.auth.orgId, userIds: [t.requesterId, t.assigneeId], exclude: req.auth.userId, type: 'ticket.status', title: `Ticket #${t.number} is now ${status.replace(/_/g, ' ').toLowerCase()}`, link: `/tickets/${t.id}` });
  publish(ticketEvent('ticket.updated', { ...t, status }, { actorId: req.auth.userId }));
  res.json({ ok: true, status });
});

r.post('/:id/messages', async (req, res) => {
  const t = await ticketAccess(req.auth, req.params.id);
  const b = parse(z.object({ body: z.string().trim().min(1).max(20000), visibility: z.enum(['INTERNAL', 'PUBLIC']).default('PUBLIC') }), req.body);
  if (req.auth.isCustomer && b.visibility === 'INTERNAL') throw forbidden('Customers cannot post internal notes');
  if (!req.auth.isCustomer && !orgCan(req.auth, 'ticket.work')) throw forbidden();
  if (t.status === 'CLOSED') throw badRequest('Reopen the ticket before replying');
  const now = new Date();
  const msg = await prisma.$transaction(async (tx) => {
    const row = await tx.comment.create({ data: { organizationId: req.auth.orgId, ticketId: t.id, projectId: t.projectId, authorId: req.auth.userId, body: b.body, visibility: b.visibility } });
    const data = {};
    if (b.visibility === 'PUBLIC' && !req.auth.isCustomer && !t.firstResponseAt) data.firstResponseAt = now;
    if (b.visibility === 'PUBLIC' && !req.auth.isCustomer && t.status === 'NEW') data.status = 'OPEN';
    // documented sync: a customer reply on a ticket waiting for the customer resumes the SLA clock
    if (req.auth.isCustomer && t.status === 'WAITING_ON_CUSTOMER') { const { cal } = await slaContext(t.organizationId, t.priority); Object.assign(data, statusChangePatch(t, 'OPEN', now, cal)); }
    if (Object.keys(data).length) await tx.ticket.update({ where: { id: t.id }, data: { ...data, version: { increment: 1 } } });
    await audit(tx, req.auth, { action: b.visibility === 'PUBLIC' ? 'ticket.replied' : 'ticket.internal_note', entityType: 'Ticket', entityId: t.id, projectId: t.projectId, visibility: b.visibility, metadata: { commentId: row.id, ...(data.status && { from: t.status, to: data.status }) } }, req.ip);
    const recipients = b.visibility === 'PUBLIC' ? [t.requesterId, t.assigneeId] : [t.assigneeId];
    await notify(tx, { orgId: req.auth.orgId, userIds: recipients, exclude: req.auth.userId, type: b.visibility === 'PUBLIC' ? 'ticket.reply' : 'ticket.note', title: `${b.visibility === 'PUBLIC' ? 'Reply' : 'Internal note'} on ticket #${t.number}`, body: b.body.slice(0, 200), link: `/tickets/${t.id}` });
    await notifyMentions(tx, req.auth, { body: b.body, visibility: b.visibility, target: { label: `ticket #${t.number}`, link: `/tickets/${t.id}` }, ticketCompanyId: t.customerCompanyId });
    return row;
  });
  publish(ticketEvent('ticket.message', t, { actorId: req.auth.userId, internal: b.visibility === 'INTERNAL' }));
  res.status(201).json(S.comment(msg, new Map([[req.auth.userId, req.auth.user]])));
});

r.post('/:id/links', async (req, res) => {
  const t = await ticketAccess(req.auth, req.params.id);
  if (req.auth.isCustomer || !orgCan(req.auth, 'ticket.work')) throw forbidden();
  const { workItemId } = parse(z.object({ workItemId: uuid }), req.body);
  const wi = await prisma.workItem.findFirst({ where: { id: workItemId, project: { organizationId: req.auth.orgId } } });
  if (!wi) throw notFound('Work item');
  await workItemAccess(req.auth, wi.projectId, wi.id);
  await prisma.ticketLink.upsert({ where: { ticketId_workItemId: { ticketId: t.id, workItemId } }, create: { ticketId: t.id, workItemId }, update: {} });
  await audit(prisma, req.auth, { action: 'ticket.linked', entityType: 'Ticket', entityId: t.id, projectId: wi.projectId, metadata: { workItemId } }, req.ip);
  res.status(201).json({ ok: true });
});

r.delete('/:id/links/:workItemId', async (req, res) => {
  const t = await ticketAccess(req.auth, req.params.id);
  if (req.auth.isCustomer || !orgCan(req.auth, 'ticket.work')) throw forbidden();
  await prisma.ticketLink.deleteMany({ where: { ticketId: t.id, workItemId: req.params.workItemId } });
  await audit(prisma, req.auth, { action: 'ticket.unlinked', entityType: 'Ticket', entityId: t.id, metadata: { workItemId: req.params.workItemId } }, req.ip);
  res.status(204).end();
});

// Creates a task from a ticket. The conversation stays on the ticket; the task links back to it.
// Ticket and task statuses are independent.
r.post('/:id/create-task', async (req, res) => {
  const t = await ticketAccess(req.auth, req.params.id);
  if (req.auth.isCustomer) throw forbidden();
  const b = parse(z.object({ projectId: uuid.optional(), phaseId: uuid.nullable().optional(), parentId: uuid.nullable().optional(), title: z.string().trim().min(1).max(300).optional(), assigneeId: uuid.nullable().optional() }), req.body);
  const projectId = b.projectId ?? t.projectId;
  if (!projectId) throw badRequest('Choose a project for the new task');
  const a = await projectAccess(req.auth, projectId);
  a.require('work.create');
  if (b.assigneeId && !(await prisma.projectMember.findFirst({ where: { projectId, userId: b.assigneeId, role: { in: ['MANAGER', 'MEMBER'] } } }))) throw badRequest('Assignee must be a member of the project');
  let parent = null;
  if (b.parentId) { parent = await prisma.workItem.findFirst({ where: { id: b.parentId, projectId, type: 'MODULE' } }); if (!parent) throw badRequest('Parent must be a module in this project'); }
  if (b.phaseId && !(await prisma.phase.findFirst({ where: { id: b.phaseId, projectId } }))) throw badRequest('Phase not found');
  const item = await prisma.$transaction(async (tx) => {
    const p = await tx.project.update({ where: { id: projectId }, data: { workItemSeq: { increment: 1 } }, select: { workItemSeq: true } });
    const wi = await tx.workItem.create({ data: { projectId, type: 'TASK', number: p.workItemSeq, title: b.title ?? t.subject, phaseId: parent?.phaseId ?? b.phaseId ?? null, parentId: parent?.id ?? null,
      description: `Created from ticket #${t.number}: ${t.subject}\n\n${t.description}`, assigneeId: b.assigneeId ?? null, priority: t.priority, createdById: req.auth.userId, labels: ['from-ticket'] } });
    await tx.ticketLink.create({ data: { ticketId: t.id, workItemId: wi.id, linkType: 'CREATED_FROM' } });
    await audit(tx, req.auth, { action: 'ticket.task_created', entityType: 'Ticket', entityId: t.id, projectId, metadata: { workItemId: wi.id, number: wi.number } }, req.ip);
    await audit(tx, req.auth, { action: 'work_item.created', entityType: 'WorkItem', entityId: wi.id, projectId, metadata: { number: wi.number, fromTicket: t.number } }, req.ip);
    await notify(tx, { orgId: req.auth.orgId, userIds: [wi.assigneeId], exclude: req.auth.userId, type: 'work_item.assigned', title: `Assigned: ${a.project.code}-${wi.number} ${wi.title}`, link: `/projects/${projectId}/work/${wi.id}` });
    return wi;
  });
  res.status(201).json(S.workItem(item, a, { code: a.project.code }));
});

export default r;
