import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, listQuery, pageArgs, paged, dateOnly, toDate, fmtDate, uuid, orderBy } from '../lib/http.js';
import { badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { requireOrg, projectAccess, visibleProjectsWhere } from '../policies/access.js';
import * as S from '../policies/serializers.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';
import { loadCalendar, toWorkCalendar } from '../services/calendars.js';
import { projectProgress, projectCalendar, loadSchedule } from '../services/projectData.js';
import { workingDaysBetween, nextWorkingDay, addWorkingDays } from '../domain/calendar.js';
import { PROJECT_TRANSITIONS, READ_ONLY_PROJECT } from '../domain/workflow.js';

const r = Router();
const enumP = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const enumH = z.enum(['GREEN', 'AMBER', 'RED']);

r.get('/', async (req, res) => {
  const q = parse(listQuery.extend({ status: z.string().optional(), customerCompanyId: uuid.optional(), health: enumH.optional() }), req.query);
  const statuses = q.status?.split(',').filter(Boolean);
  const where = { ...visibleProjectsWhere(req.auth), ...(statuses?.length && { status: { in: statuses } }), ...(q.health && { health: q.health }),
    ...(q.customerCompanyId && { customerCompanyId: q.customerCompanyId }),
    ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] }) };
  if (!statuses?.length && !q.q) where.status = { not: 'ARCHIVED' };
  const [rows, total] = await Promise.all([
    prisma.project.findMany({ where, include: { customerCompany: true }, orderBy: orderBy(q.sort, q.dir, ['name', 'code', 'plannedFinish', 'updatedAt', 'status'], 'updatedAt'), ...pageArgs(q) }),
    prisma.project.count({ where }),
  ]);
  const managers = await prisma.user.findMany({ where: { id: { in: rows.map((p) => p.managerId).filter(Boolean) } }, select: { id: true, name: true } });
  const mgr = new Map(managers.map((m) => [m.id, m.name]));
  const out = [];
  for (const p of rows) {
    const { r: roll } = await projectProgress(p.id);
    const access = { isCustomer: req.auth.isCustomer, role: req.auth.orgRole === 'ADMIN' ? 'ADMIN' : undefined, can: () => false };
    out.push(S.project(p, access, { progress: roll.project.percent, milestones: roll.milestones, customerName: p.customerCompany?.name ?? null, managerName: mgr.get(p.managerId) ?? null }));
  }
  res.json(paged(out, total, q));
});

const createBody = z.object({
  name: z.string().trim().min(2).max(160), code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/, '2–10 letters/digits, starting with a letter'),
  description: z.string().max(5000).optional().nullable(), objectives: z.string().max(5000).optional().nullable(),
  customerCompanyId: uuid.optional().nullable(), customerContactIds: z.array(uuid).max(50).default([]),
  managerId: uuid, teamMemberIds: z.array(uuid).max(200).default([]),
  plannedStart: dateOnly, plannedFinish: dateOnly, priority: enumP.default('MEDIUM'), health: enumH.default('GREEN'),
  status: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT'), calendarId: uuid.optional().nullable(), timezone: z.string().max(60).default('UTC'),
  budgetAmount: z.number().min(0).max(1e12).optional().nullable(), budgetCurrency: z.string().length(3).toUpperCase().optional().nullable(),
  billingEnabled: z.boolean().default(false), hourlyRate: z.number().min(0).max(1e6).optional().nullable(),
  templateId: uuid.optional().nullable(), customerVisible: z.boolean().default(false),
});

r.post('/', async (req, res) => {
  requireOrg(req.auth, 'project.create');
  const b = parse(createBody, req.body);
  if (b.plannedFinish < b.plannedStart) throw badRequest('Planned finish must be on or after the planned start');
  if (b.timezone !== 'UTC' && !Intl.supportedValuesOf('timeZone').includes(b.timezone)) throw badRequest('Unknown timezone');
  const orgId = req.auth.orgId;
  const mgr = await prisma.membership.findFirst({ where: { organizationId: orgId, userId: b.managerId, status: 'ACTIVE', role: { in: ['ADMIN', 'MANAGER'] } } });
  if (!mgr) throw badRequest('Project manager must be an active manager or administrator');
  if (b.customerCompanyId && !(await prisma.customerCompany.findFirst({ where: { id: b.customerCompanyId, organizationId: orgId } }))) throw badRequest('Unknown customer company');
  if (b.customerContactIds.length) {
    if (!b.customerCompanyId) throw badRequest('Choose a customer company before adding customer contacts');
    const n = await prisma.membership.count({ where: { organizationId: orgId, userId: { in: b.customerContactIds }, role: 'CUSTOMER', customerCompanyId: b.customerCompanyId, status: 'ACTIVE' } });
    if (n !== new Set(b.customerContactIds).size) throw badRequest('Customer contacts must be active users of the selected customer company');
  }
  const team = [...new Set(b.teamMemberIds)].filter((id) => id !== b.managerId);
  if (team.length && (await prisma.membership.count({ where: { organizationId: orgId, userId: { in: team }, role: { in: ['ADMIN', 'MANAGER', 'EMPLOYEE'] }, status: 'ACTIVE' } })) !== team.length) {
    throw badRequest('Team members must be active internal users');
  }
  const calRow = await loadCalendar(prisma, b.calendarId, orgId);
  if (b.calendarId && !calRow) throw badRequest('Unknown calendar');
  const cal = toWorkCalendar(calRow);
  const template = b.templateId
    ? await prisma.projectTemplate.findFirst({ where: { id: b.templateId, organizationId: orgId }, include: { phases: { orderBy: { sortOrder: 'asc' } } } })
    : await prisma.projectTemplate.findFirst({ where: { organizationId: orgId, isDefault: true }, include: { phases: { orderBy: { sortOrder: 'asc' } } } });
  if (b.templateId && !template) throw badRequest('Unknown template');

  // Scale template phase durations to the project's working-day window, sequentially.
  const start = nextWorkingDay(b.plannedStart, cal);
  const totalDays = workingDaysBetween(start, b.plannedFinish, cal);
  const tphases = template?.phases ?? [];
  if (tphases.length && totalDays < tphases.length) throw badRequest(`The planned window has ${totalDays} working days; this template needs at least ${tphases.length}`);
  const tTotal = tphases.reduce((a, p) => a + p.durationDays, 0) || 1;
  let cursor = start; let used = 0;
  const phasePlan = tphases.map((p, i) => {
    const remainingPhases = tphases.length - i - 1;
    let days = i === tphases.length - 1 ? totalDays - used : Math.max(1, Math.round((p.durationDays / tTotal) * totalDays));
    days = Math.min(days, totalDays - used - remainingPhases);
    const s = cursor; const f = addWorkingDays(s, days - 1, cal);
    used += days; cursor = addWorkingDays(f, 1, cal);
    return { t: p, start: s, finish: f };
  });

  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({ data: {
      organizationId: orgId, name: b.name, code: b.code, description: b.description, objectives: b.objectives, customerCompanyId: b.customerCompanyId || null,
      managerId: b.managerId, status: b.status, priority: b.priority, health: b.health, plannedStart: toDate(b.plannedStart), plannedFinish: toDate(b.plannedFinish),
      calendarId: calRow?.id ?? null, timezone: b.timezone, budgetAmount: b.budgetAmount, budgetCurrency: b.budgetCurrency, billingEnabled: b.billingEnabled,
      hourlyRate: b.hourlyRate, templateId: template?.id ?? null, customerVisible: b.customerVisible,
    } });
    const members = [{ userId: b.managerId, role: 'MANAGER' }, ...team.map((userId) => ({ userId, role: 'MEMBER' })), ...b.customerContactIds.map((userId) => ({ userId, role: 'CUSTOMER' }))];
    if (req.auth.userId !== b.managerId && req.auth.orgRole === 'MANAGER' && !team.includes(req.auth.userId)) members.push({ userId: req.auth.userId, role: 'MANAGER' });
    await tx.projectMember.createMany({ data: members.map((m) => ({ ...m, projectId: p.id })), skipDuplicates: true });
    let seq = 0;
    for (const [i, ph] of phasePlan.entries()) {
      const phase = await tx.phase.create({ data: { projectId: p.id, name: ph.t.name, sortOrder: i, ownerId: b.managerId, plannedStart: toDate(ph.start), plannedFinish: toDate(ph.finish), completionCriteria: ph.t.completionCriteria } });
      for (const [j, m] of ph.t.milestones.entries()) {
        await tx.workItem.create({ data: { projectId: p.id, phaseId: phase.id, type: 'MILESTONE', number: ++seq, title: m, plannedStart: toDate(ph.finish), plannedFinish: toDate(ph.finish), customerVisible: b.customerVisible, sortOrder: 1000 + j, createdById: req.auth.userId } });
      }
      for (const d of ph.t.deliverables) await tx.deliverable.create({ data: { projectId: p.id, phaseId: phase.id, name: d, dueDate: toDate(ph.finish) } });
    }
    await tx.project.update({ where: { id: p.id }, data: { workItemSeq: seq } });
    await audit(tx, req.auth, { action: 'project.created', entityType: 'Project', entityId: p.id, projectId: p.id, metadata: { code: p.code, template: template?.name ?? null, phases: phasePlan.length } }, req.ip);
    await notify(tx, { orgId, userIds: members.filter((m) => m.role !== 'CUSTOMER').map((m) => m.userId), exclude: req.auth.userId, type: 'project.added', title: `You were added to ${p.code} · ${p.name}`, link: `/projects/${p.id}` });
    return p;
  });
  res.status(201).json(S.project(project, await projectAccess(req.auth, project.id)));
});

async function projectDetail(req, access) {
  const p = access.project;
  const { r: roll, items } = await projectProgress(p.id);
  const phases = await prisma.phase.findMany({ where: { projectId: p.id, ...(access.isCustomer && { customerVisible: true }) }, orderBy: { sortOrder: 'asc' } });
  const members = await prisma.projectMember.findMany({ where: { projectId: p.id, ...(access.isCustomer && { role: { in: ['MANAGER', 'CUSTOMER'] } }) }, include: { user: true } });
  const [customer, calendar] = await Promise.all([
    p.customerCompanyId ? prisma.customerCompany.findUnique({ where: { id: p.customerCompanyId } }) : null,
    access.internal ? loadCalendar(prisma, p.calendarId, p.organizationId) : null,
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const visible = access.isCustomer ? items.filter((i) => i.customerVisible) : items;
  const open = visible.filter((i) => !['DONE', 'CANCELLED'].includes(i.status));
  return S.project(p, access, {
    progress: roll.project.percent, progressMethod: roll.project.method, milestones: roll.milestones,
    customerName: customer?.name ?? null, calendarName: calendar?.name ?? null,
    phases: phases.map((ph) => S.phase(ph, access, roll.phase(ph.id).percent)),
    members: members.map((m) => ({ ...S.publicUser(m.user), role: m.role, ...(access.internal && { email: m.user.email, allocationPct: m.allocationPct }) })),
    counts: { items: visible.length, open: open.length, overdue: open.filter((i) => i.plannedFinish && i.plannedFinish < today).length,
      ...(access.internal && { blocked: open.filter((i) => i.status === 'BLOCKED').length }) },
    readOnly: READ_ONLY_PROJECT.has(p.status),
  });
}

r.get('/:projectId', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  res.json(await projectDetail(req, access));
});

const patchBody = createBody.pick({ name: true, description: true, objectives: true, priority: true, health: true, plannedStart: true, plannedFinish: true,
  calendarId: true, timezone: true, budgetAmount: true, budgetCurrency: true, billingEnabled: true, hourlyRate: true, customerVisible: true, customerCompanyId: true, managerId: true })
  .partial().extend({ version: z.number().int() });

r.patch('/:projectId', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('project.edit');
  if (READ_ONLY_PROJECT.has(access.project.status)) throw conflict(`${access.project.status.toLowerCase()} projects are read-only`);
  const { version, ...b } = parse(patchBody, req.body);
  const p = access.project;
  if (!access.can('project.financials')) for (const k of ['budgetAmount', 'budgetCurrency', 'billingEnabled', 'hourlyRate']) delete b[k];
  const s = b.plannedStart ?? fmtDate(p.plannedStart); const f = b.plannedFinish ?? fmtDate(p.plannedFinish);
  if (f < s) throw badRequest('Planned finish must be on or after the planned start');
  if (b.calendarId && !(await loadCalendar(prisma, b.calendarId, p.organizationId))) throw badRequest('Unknown calendar');
  if (b.managerId && !(await prisma.membership.findFirst({ where: { organizationId: p.organizationId, userId: b.managerId, role: { in: ['ADMIN', 'MANAGER'] }, status: 'ACTIVE' } }))) throw badRequest('Invalid project manager');
  if (b.customerCompanyId && !(await prisma.customerCompany.findFirst({ where: { id: b.customerCompanyId, organizationId: p.organizationId } }))) throw badRequest('Unknown customer company');
  const data = { ...b, ...(b.plannedStart && { plannedStart: toDate(b.plannedStart) }), ...(b.plannedFinish && { plannedFinish: toDate(b.plannedFinish) }), version: { increment: 1 } };
  await prisma.$transaction(async (tx) => {
    const n = await tx.project.updateMany({ where: { id: p.id, version }, data });
    if (!n.count) throw conflict('This project was changed by someone else. Reload to see the latest version.');
    if (b.managerId) await tx.projectMember.upsert({ where: { projectId_userId: { projectId: p.id, userId: b.managerId } }, create: { projectId: p.id, userId: b.managerId, role: 'MANAGER' }, update: { role: 'MANAGER' } });
    if (b.customerCompanyId !== undefined && b.customerCompanyId !== p.customerCompanyId) {
      // changing the customer removes contacts of the previous customer
      await tx.projectMember.deleteMany({ where: { projectId: p.id, role: 'CUSTOMER' } });
    }
    await audit(tx, req.auth, { action: 'project.updated', entityType: 'Project', entityId: p.id, projectId: p.id, metadata: { fields: Object.keys(b) } }, req.ip);
  });
  res.json(await projectDetail(req, await projectAccess(req.auth, p.id)));
});

r.post('/:projectId/status', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('project.edit');
  const { status, version, reason } = parse(z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED']), version: z.number().int(), reason: z.string().max(1000).optional() }), req.body);
  const p = access.project;
  if (!PROJECT_TRANSITIONS[p.status].includes(status)) throw badRequest(`A ${p.status} project cannot move to ${status}`);
  if (status === 'COMPLETED') {
    const open = await prisma.workItem.count({ where: { projectId: p.id, status: { notIn: ['DONE', 'CANCELLED'] } } });
    if (open) throw badRequest(`Close or cancel the ${open} open work item(s) before completing the project`);
  }
  const n = await prisma.project.updateMany({ where: { id: p.id, version }, data: { status, version: { increment: 1 } } });
  if (!n.count) throw conflict('This project was changed by someone else. Reload and try again.');
  await audit(prisma, req.auth, { action: 'project.status_changed', entityType: 'Project', entityId: p.id, projectId: p.id, metadata: { from: p.status, to: status, reason } }, req.ip);
  res.json(await projectDetail(req, await projectAccess(req.auth, p.id)));
});

// ----- Members -----
r.put('/:projectId/members/:userId', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('project.members');
  const { role, allocationPct } = parse(z.object({ role: z.enum(['MANAGER', 'MEMBER', 'VIEWER', 'CUSTOMER']), allocationPct: z.number().int().min(0).max(100).default(100) }), req.body);
  const m = await prisma.membership.findFirst({ where: { organizationId: req.auth.orgId, userId: req.params.userId, status: 'ACTIVE' } });
  if (!m) throw notFound('User');
  if ((role === 'CUSTOMER') !== (m.role === 'CUSTOMER')) throw badRequest(role === 'CUSTOMER' ? 'Only customer users can be customer members' : 'Customer users can only be added as customer members');
  if (role === 'CUSTOMER' && m.customerCompanyId !== access.project.customerCompanyId) throw badRequest('This contact belongs to a different customer company');
  if (role === 'MANAGER' && !['ADMIN', 'MANAGER'].includes(m.role)) throw badRequest('Only managers or administrators can manage a project');
  await prisma.projectMember.upsert({ where: { projectId_userId: { projectId: access.project.id, userId: m.userId } }, create: { projectId: access.project.id, userId: m.userId, role, allocationPct }, update: { role, allocationPct } });
  await audit(prisma, req.auth, { action: 'project.member_set', entityType: 'Project', entityId: access.project.id, projectId: access.project.id, metadata: { userId: m.userId, role } }, req.ip);
  await notify(prisma, { orgId: req.auth.orgId, userIds: [m.userId], exclude: req.auth.userId, type: 'project.added', title: `You now have ${role.toLowerCase()} access to ${access.project.code}`, link: `/projects/${access.project.id}` });
  res.json({ ok: true });
});

r.delete('/:projectId/members/:userId', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('project.members');
  if (req.params.userId === access.project.managerId) throw badRequest('Assign a different project manager first');
  await prisma.projectMember.deleteMany({ where: { projectId: access.project.id, userId: req.params.userId } });
  await audit(prisma, req.auth, { action: 'project.member_removed', entityType: 'Project', entityId: access.project.id, projectId: access.project.id, metadata: { userId: req.params.userId } }, req.ip);
  res.status(204).end();
});

// ----- Phases -----
const phaseBody = z.object({ name: z.string().trim().min(1).max(120), ownerId: uuid.nullable().optional(), status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED']).optional(),
  plannedStart: dateOnly.nullable().optional(), plannedFinish: dateOnly.nullable().optional(), completionCriteria: z.string().max(2000).nullable().optional(), customerVisible: z.boolean().optional() });
function checkRange(s, f) { if (s && f && f < s) throw badRequest('Finish must be on or after start'); }

r.post('/:projectId/phases', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('phase.manage');
  const b = parse(phaseBody, req.body);
  checkRange(b.plannedStart, b.plannedFinish);
  const max = await prisma.phase.aggregate({ where: { projectId: access.project.id }, _max: { sortOrder: true } });
  const ph = await prisma.phase.create({ data: { ...b, projectId: access.project.id, sortOrder: (max._max.sortOrder ?? -1) + 1, plannedStart: toDate(b.plannedStart), plannedFinish: toDate(b.plannedFinish) } });
  await audit(prisma, req.auth, { action: 'phase.created', entityType: 'Phase', entityId: ph.id, projectId: access.project.id }, req.ip);
  res.status(201).json(S.phase(ph, access, null));
});

r.patch('/:projectId/phases/:phaseId', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('phase.manage');
  const ph = await prisma.phase.findFirst({ where: { id: req.params.phaseId, projectId: access.project.id } });
  if (!ph) throw notFound('Phase');
  const { version, ...b } = parse(phaseBody.partial().extend({ version: z.number().int() }), req.body);
  checkRange(b.plannedStart ?? fmtDate(ph.plannedStart), b.plannedFinish ?? fmtDate(ph.plannedFinish));
  const data = { ...b, version: { increment: 1 } };
  if ('plannedStart' in b) data.plannedStart = toDate(b.plannedStart);
  if ('plannedFinish' in b) data.plannedFinish = toDate(b.plannedFinish);
  const n = await prisma.phase.updateMany({ where: { id: ph.id, version }, data });
  if (!n.count) throw conflict('This phase was changed by someone else. Reload and try again.');
  await audit(prisma, req.auth, { action: 'phase.updated', entityType: 'Phase', entityId: ph.id, projectId: access.project.id, metadata: { fields: Object.keys(b) } }, req.ip);
  res.json(S.phase(await prisma.phase.findUnique({ where: { id: ph.id } }), access, null));
});

r.post('/:projectId/phases/reorder', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('phase.manage');
  const { ids } = parse(z.object({ ids: z.array(uuid).min(1).max(100) }), req.body);
  const existing = await prisma.phase.findMany({ where: { projectId: access.project.id }, select: { id: true } });
  if (existing.length !== ids.length || !existing.every((p) => ids.includes(p.id))) throw badRequest('Provide every phase of the project exactly once');
  await prisma.$transaction(ids.map((id, i) => prisma.phase.update({ where: { id }, data: { sortOrder: i } })));
  await audit(prisma, req.auth, { action: 'phase.reordered', entityType: 'Project', entityId: access.project.id, projectId: access.project.id }, req.ip);
  res.json({ ok: true });
});

r.delete('/:projectId/phases/:phaseId', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('phase.manage');
  const n = await prisma.workItem.count({ where: { phaseId: req.params.phaseId, projectId: access.project.id } });
  if (n) throw badRequest(`Move or delete the ${n} work item(s) in this phase first`);
  const del = await prisma.phase.deleteMany({ where: { id: req.params.phaseId, projectId: access.project.id } });
  if (!del.count) throw notFound('Phase');
  await audit(prisma, req.auth, { action: 'phase.deleted', entityType: 'Phase', entityId: req.params.phaseId, projectId: access.project.id }, req.ip);
  res.status(204).end();
});

// ----- Baselines -----
r.get('/:projectId/baselines', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('project.viewInternal');
  const rows = await prisma.baseline.findMany({ where: { projectId: access.project.id }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { items: true } } } });
  res.json({ data: rows.map((b) => ({ id: b.id, name: b.name, note: b.note, createdAt: b.createdAt, items: b._count.items })) });
});

r.post('/:projectId/baselines', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('work.schedule');
  const b = parse(z.object({ name: z.string().trim().min(1).max(120), note: z.string().max(2000).optional(), changeRequestId: uuid.optional() }), req.body);
  if (b.changeRequestId && !(await prisma.changeRequest.findFirst({ where: { id: b.changeRequestId, projectId: access.project.id, status: { in: ['APPROVED', 'IMPLEMENTED'] } } }))) {
    throw badRequest('Re-baselining against a change request requires an approved change request on this project');
  }
  const items = await prisma.workItem.findMany({ where: { projectId: access.project.id }, select: { id: true, plannedStart: true, plannedFinish: true, estimateHours: true } });
  const bl = await prisma.$transaction(async (tx) => {
    const x = await tx.baseline.create({ data: { projectId: access.project.id, name: b.name, note: b.note, createdById: req.auth.userId } });
    await tx.baselineItem.createMany({ data: items.map((i) => ({ baselineId: x.id, workItemId: i.id, plannedStart: i.plannedStart, plannedFinish: i.plannedFinish, estimateHours: i.estimateHours })) });
    if (b.changeRequestId) await tx.changeRequest.update({ where: { id: b.changeRequestId }, data: { status: 'IMPLEMENTED' } });
    await audit(tx, req.auth, { action: 'baseline.created', entityType: 'Baseline', entityId: x.id, projectId: access.project.id, metadata: { items: items.length, changeRequestId: b.changeRequestId ?? null } }, req.ip);
    return x;
  });
  res.status(201).json({ id: bl.id, name: bl.name, items: items.length });
});

r.get('/:projectId/baselines/:baselineId/compare', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('project.viewInternal');
  const bl = await prisma.baseline.findFirst({ where: { id: req.params.baselineId, projectId: access.project.id }, include: { items: true } });
  if (!bl) throw notFound('Baseline');
  const cal = await projectCalendar(access.project);
  const { items } = await loadSchedule(access.project.id);
  const base = new Map(bl.items.map((i) => [i.workItemId, i]));
  const slip = (a, b) => (!a || !b ? null : a === b ? 0 : b > a ? workingDaysBetween(a, b, cal) - 1 : -(workingDaysBetween(b, a, cal) - 1));
  const rows = items.map((i) => {
    const bi = base.get(i.id);
    const bs = fmtDate(bi?.plannedStart); const bf = fmtDate(bi?.plannedFinish);
    return { id: i.id, number: i.number, title: i.title, type: i.type, status: i.status, baselineStart: bs, baselineFinish: bf, currentStart: i.plannedStart, currentFinish: i.plannedFinish,
      startVarianceDays: slip(bs, i.plannedStart), finishVarianceDays: slip(bf, i.plannedFinish), baselineEstimate: bi?.estimateHours == null ? null : Number(bi.estimateHours), currentEstimate: i.estimateHours, added: !bi };
  });
  res.json({ baseline: { id: bl.id, name: bl.name, createdAt: bl.createdAt }, data: rows });
});

export default r;
