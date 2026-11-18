import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, listQuery, pageArgs, paged, dateOnly, toDate, fmtDate, uuid, orderBy, partialNoDefaults } from '../lib/http.js';
import { badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { projectAccess, workItemAccess, workItemScope } from '../policies/access.js';
import * as S from '../policies/serializers.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';
import { loadSchedule, projectCalendar } from '../services/projectData.js';
import { rollup } from '../domain/progress.js';
import { normalizeProgress, READ_ONLY_PROJECT } from '../domain/workflow.js';
import { wouldCreateCycle, previewShift, scheduleConflicts, criticalPath } from '../domain/dependencies.js';
import { toCsv } from '../lib/csv.js';
import { resolveDateChange, DateRuleError } from '../domain/dates.js';
import { addWorkingDays, nextWorkingDay, workingDaysBetween } from '../domain/calendar.js';
import { reschedule } from '../services/autoSchedule.js';

const r = Router({ mergeParams: true });
const STATUS = z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED']);
const PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const today = () => toDate(new Date().toISOString().slice(0, 10));
const writable = (access) => { if (READ_ONLY_PROJECT.has(access.project.status)) throw conflict(`${access.project.status.toLowerCase()} projects are read-only`); };

const PARENT_RULES = { MODULE: [null], TASK: [null, 'MODULE'], SUBTASK: ['TASK'], MILESTONE: [null, 'MODULE'] };

async function validateAssignee(projectId, userId) {
  if (!userId) return;
  const m = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!m || !['MANAGER', 'MEMBER'].includes(m.role)) throw badRequest('Assignee must be a manager or member of this project');
}

function serializeList(items, access, code, roll, extras = {}) {
  return items.map((i) => S.workItem(i, access, { code, internal: { progress: roll?.byId.get(i.id)?.percent ?? i.percentComplete, ...(extras[i.id] || {}) }, customer: { progress: roll?.byId.get(i.id)?.percent ?? i.percentComplete } }));
}

// ----- List -----
r.get('/work-items', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  const q = parse(listQuery.extend({
    phaseId: uuid.optional(), parentId: z.union([uuid, z.literal('root')]).optional(), assigneeId: z.union([uuid, z.literal('me'), z.literal('none')]).optional(),
    status: z.string().optional(), type: z.string().optional(), overdue: z.enum(['true', 'false']).optional(), label: z.string().max(40).optional(),
    all: z.enum(['true', 'false']).optional(), pageSize: z.coerce.number().int().min(1).max(500).default(100),
  }), req.query);
  const statuses = q.status?.split(',').filter((s) => STATUS.safeParse(s).success);
  const types = q.type?.split(',').filter(Boolean);
  const where = {
    projectId: access.project.id, ...workItemScope(access),
    ...(q.phaseId && { phaseId: q.phaseId }), ...(q.parentId && { parentId: q.parentId === 'root' ? null : q.parentId }),
    ...(q.assigneeId && access.internal && { assigneeId: q.assigneeId === 'me' ? req.auth.userId : q.assigneeId === 'none' ? null : q.assigneeId }),
    ...(statuses?.length && { status: { in: statuses } }), ...(types?.length && { type: { in: types } }),
    ...(q.label && access.internal && { labels: { has: q.label } }),
    ...(q.overdue === 'true' && { plannedFinish: { lt: today() }, status: { notIn: ['DONE', 'CANCELLED'] } }),
    ...(q.q && { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, ...(/^\d+$/.test(q.q) ? [{ number: Number(q.q) }] : [])] }),
  };
  const page = q.all === 'true' ? { take: 2000 } : pageArgs(q);
  const [rows, total, sched] = await Promise.all([
    prisma.workItem.findMany({ where, orderBy: [orderBy(q.sort, q.dir === 'desc' && !q.sort ? 'asc' : q.dir, ['number', 'title', 'plannedStart', 'plannedFinish', 'status', 'priority', 'updatedAt', 'sortOrder'], 'sortOrder'), { number: 'asc' }], ...page }),
    prisma.workItem.count({ where }),
    loadSchedule(access.project.id),
  ]);
  const roll = rollup(sched.items);
  const extras = {};
  if (access.internal && rows.length) {
    // hours logged per item, for the grid view's "Logged" column
    const logged = await prisma.timeEntry.groupBy({ by: ['workItemId'], where: { projectId: access.project.id, workItemId: { in: rows.map((r) => r.id) } }, _sum: { hours: true } });
    for (const l of logged) (extras[l.workItemId] ??= {}).loggedHours = Number(l._sum.hours ?? 0);
  }
  if (access.internal) {
    const cal = await projectCalendar(access.project);
    for (const c of scheduleConflicts(sched.items, sched.deps, cal)) (extras[c.successorId] ??= {}).scheduleConflict = { earliestStart: c.earliestStart, predecessorId: c.predecessorId };
    for (const d of sched.deps) { (extras[d.successorId] ??= {}).predecessorCount = (extras[d.successorId].predecessorCount || 0) + 1; }
    const kids = await prisma.workItem.groupBy({ by: ['parentId'], where: { projectId: access.project.id, parentId: { in: rows.map((x) => x.id) } }, _count: true });
    for (const k of kids) (extras[k.parentId] ??= {}).childCount = k._count;
  }
  res.json(paged(serializeList(rows, access, access.project.code, roll, extras), total, { page: q.all === 'true' ? 1 : q.page, pageSize: q.all === 'true' ? 2000 : q.pageSize }));
});

// ----- Create -----
const itemBody = z.object({
  type: z.enum(['MODULE', 'TASK', 'SUBTASK', 'MILESTONE']), title: z.string().trim().min(1).max(300),
  description: z.string().max(20000).nullable().optional(), acceptanceCriteria: z.string().max(10000).nullable().optional(),
  phaseId: uuid.nullable().optional(), parentId: uuid.nullable().optional(), assigneeId: uuid.nullable().optional(),
  status: STATUS.optional(), priority: PRIORITY.optional(), plannedStart: dateOnly.nullable().optional(), plannedFinish: dateOnly.nullable().optional(),
  actualStart: dateOnly.nullable().optional(), actualFinish: dateOnly.nullable().optional(),
  estimateHours: z.number().min(0).max(100000).nullable().optional(), percentComplete: z.number().int().min(0).max(100).optional(),
  customerVisible: z.boolean().optional(), labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(), sortOrder: z.number().int().optional(),
});

async function resolveHierarchy(projectId, type, parentId, phaseId) {
  let parent = null;
  if (parentId) {
    parent = await prisma.workItem.findFirst({ where: { id: parentId, projectId } });
    if (!parent) throw badRequest('Parent work item not found in this project');
  }
  if (!PARENT_RULES[type].includes(parent?.type ?? null)) {
    throw badRequest(`A ${type.toLowerCase()} cannot be placed under ${parent ? `a ${parent.type.toLowerCase()}` : 'the project root'}`);
  }
  const effectivePhase = parent ? parent.phaseId : phaseId ?? null;
  if (effectivePhase && !(await prisma.phase.findFirst({ where: { id: effectivePhase, projectId } }))) throw badRequest('Phase not found in this project');
  return { parent, phaseId: effectivePhase };
}

r.post('/work-items', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('work.create');
  writable(access);
  const b = parse(itemBody, req.body);
  const { parent, phaseId } = await resolveHierarchy(access.project.id, b.type, b.parentId, b.phaseId);
  if (b.type === 'MILESTONE') { b.plannedStart = b.plannedFinish ?? b.plannedStart; b.plannedFinish = b.plannedStart; b.estimateHours = null; }
  if (b.plannedStart && b.plannedFinish && b.plannedFinish < b.plannedStart) throw badRequest('Planned finish must be on or after planned start');
  if (!access.can('work.editAny')) { delete b.customerVisible; if (b.assigneeId && b.assigneeId !== req.auth.userId) throw forbidden('Members can only assign new work to themselves'); }
  await validateAssignee(access.project.id, b.assigneeId);
  const norm = normalizeProgress({ status: 'TODO', percentComplete: 0 }, { status: b.status, percentComplete: b.percentComplete }, today());
  const item = await prisma.$transaction(async (tx) => {
    const p = await tx.project.update({ where: { id: access.project.id }, data: { workItemSeq: { increment: 1 } }, select: { workItemSeq: true } });
    const it = await tx.workItem.create({ data: {
      ...b, ...norm, projectId: access.project.id, phaseId, parentId: parent?.id ?? null, number: p.workItemSeq, createdById: req.auth.userId,
      customerVisible: b.customerVisible ?? (parent ? parent.customerVisible : false),
      plannedStart: toDate(b.plannedStart), plannedFinish: toDate(b.plannedFinish), actualStart: toDate(b.actualStart) ?? norm.actualStart, actualFinish: toDate(b.actualFinish) ?? norm.actualFinish,
      // a start date typed by the manager is kept ("start no earlier than"); links can only push it later
      startConstraint: b.type !== 'MODULE' ? toDate(b.plannedStart) : null,
    } });
    await audit(tx, req.auth, { action: 'work_item.created', entityType: 'WorkItem', entityId: it.id, projectId: access.project.id, metadata: { number: it.number, type: it.type, title: it.title } }, req.ip);
    await notify(tx, { orgId: req.auth.orgId, userIds: [it.assigneeId], exclude: req.auth.userId, type: 'work_item.assigned', title: `Assigned: ${access.project.code}-${it.number} ${it.title}`, link: `/projects/${access.project.id}/work/${it.id}` });
    return it;
  });
  const rescheduled = await reschedule(access.project.id);
  const fresh = rescheduled.moved.length ? await prisma.workItem.findUnique({ where: { id: item.id } }) : item;
  res.status(201).json({ ...S.workItem(fresh, access, { code: access.project.code }), rescheduled });
});

// ----- Detail -----
r.get('/work-items/:itemId', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  const { item } = a;
  const sched = await loadSchedule(a.project.id);
  const roll = rollup(sched.items);
  const byId = new Map(sched.items.map((i) => [i.id, i]));
  const chain = []; for (let p = byId.get(item.parentId); p; p = byId.get(p.parentId)) chain.unshift({ id: p.id, number: p.number, title: p.title, type: p.type });
  const children = sched.items.filter((i) => i.parentId === item.id && (a.internal || i.customerVisible));
  const extra = { code: a.project.code };
  const base = { ancestors: a.internal ? chain : chain.filter((c) => byId.get(c.id).customerVisible), children: children.map((c) => ({ id: c.id, number: c.number, title: c.title, type: c.type, status: c.status, progress: roll.byId.get(c.id)?.percent })),
    progress: roll.byId.get(item.id)?.percent ?? item.percentComplete, canEdit: a.canEdit, canSchedule: a.can('work.schedule') };
  if (a.isCustomer) return res.json({ ...S.workItem(item, a, extra), ...base });
  const [checklist, collaborators, links, logged, phase] = await Promise.all([
    prisma.checklistItem.findMany({ where: { workItemId: item.id }, orderBy: { sortOrder: 'asc' } }),
    prisma.workItemCollaborator.findMany({ where: { workItemId: item.id } }),
    prisma.ticketLink.findMany({ where: { workItemId: item.id }, include: { ticket: { select: { id: true, number: true, subject: true, status: true } } } }),
    prisma.timeEntry.aggregate({ where: { workItemId: item.id }, _sum: { hours: true } }),
    item.phaseId ? prisma.phase.findUnique({ where: { id: item.phaseId }, select: { id: true, name: true } }) : null,
  ]);
  const deps = sched.deps.filter((d) => d.predecessorId === item.id || d.successorId === item.id).map((d) => {
    const other = byId.get(d.predecessorId === item.id ? d.successorId : d.predecessorId);
    return { id: d.id, type: d.type, lagDays: d.lagDays, direction: d.predecessorId === item.id ? 'successor' : 'predecessor', item: { id: other.id, number: other.number, title: other.title, status: other.status, plannedStart: other.plannedStart, plannedFinish: other.plannedFinish } };
  });
  const cal = await projectCalendar(a.project);
  const conflicts = scheduleConflicts(sched.items, sched.deps, cal).filter((c) => c.successorId === item.id);
  res.json({ ...S.workItem(item, a, extra), ...base, phase, checklist, collaboratorIds: collaborators.map((c) => c.userId), dependencies: deps, scheduleConflicts: conflicts,
    tickets: links.map((l) => ({ ...l.ticket, linkType: l.linkType })), actualHours: Number(logged._sum.hours ?? 0) });
});

// ----- Update -----
const OWN_FIELDS = new Set(['status', 'percentComplete', 'actualStart', 'actualFinish', 'description', 'acceptanceCriteria', 'labels', 'version']);
r.patch('/work-items/:itemId', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  if (!a.canEdit) throw forbidden('You can only update work assigned to you');
  writable(a);
  const { version, ...b } = parse(partialNoDefaults(itemBody.omit({ type: true })).extend({ version: z.number().int() }), req.body);
  if (!a.can('work.editAny')) for (const k of Object.keys(b)) if (!OWN_FIELDS.has(k)) throw forbidden(`Only project managers can change ${k}`);
  const it = a.item;
  if ('parentId' in b || 'phaseId' in b) {
    const h = await resolveHierarchy(a.project.id, it.type, 'parentId' in b ? b.parentId : it.parentId, 'phaseId' in b ? b.phaseId : it.phaseId);
    if (h.parent && (h.parent.id === it.id || (await isDescendant(a.project.id, h.parent.id, it.id)))) throw badRequest('An item cannot be moved under itself');
    b.parentId = h.parent?.id ?? null; b.phaseId = h.phaseId;
  }
  if (it.type === 'MILESTONE' && (b.plannedStart || b.plannedFinish)) { b.plannedStart = b.plannedFinish ?? b.plannedStart; b.plannedFinish = b.plannedStart; }
  const s = 'plannedStart' in b ? b.plannedStart : fmtDate(it.plannedStart); const f = 'plannedFinish' in b ? b.plannedFinish : fmtDate(it.plannedFinish);
  if (s && f && f < s) throw badRequest('Planned finish must be on or after planned start');
  const as = 'actualStart' in b ? b.actualStart : fmtDate(it.actualStart); const af = 'actualFinish' in b ? b.actualFinish : fmtDate(it.actualFinish);
  if (as && af && af < as) throw badRequest('Actual finish must be on or after actual start');
  if ('assigneeId' in b) await validateAssignee(a.project.id, b.assigneeId);
  const norm = (b.status || b.percentComplete != null) ? normalizeProgress(it, { status: b.status, percentComplete: b.percentComplete, actualStart: b.actualStart, actualFinish: b.actualFinish }, today()) : {};
  const data = { ...b, ...norm, version: { increment: 1 } };
  for (const k of ['plannedStart', 'plannedFinish', 'actualStart', 'actualFinish']) if (k in b) data[k] = toDate(b[k]);
  if ('plannedStart' in b && it.type !== 'MODULE') data.startConstraint = toDate(b.plannedStart);
  if (b.status === 'DONE') {
    const openKids = await prisma.workItem.count({ where: { parentId: it.id, status: { notIn: ['DONE', 'CANCELLED'] } } });
    if (openKids) throw badRequest(`Complete or cancel the ${openKids} open child item(s) first`);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const n = await tx.workItem.updateMany({ where: { id: it.id, version }, data });
    if (!n.count) throw conflict('This item was changed by someone else. Reload to see the latest version.', { current: S.workItem(await tx.workItem.findUnique({ where: { id: it.id } }), a, { code: a.project.code }) });
    const changes = Object.fromEntries(Object.keys(b).map((k) => [k, { from: it[k] instanceof Date ? fmtDate(it[k]) : it[k], to: b[k] }]));
    if (norm.status && norm.status !== it.status) changes.status = { from: it.status, to: norm.status };
    await audit(tx, req.auth, { action: 'work_item.updated', entityType: 'WorkItem', entityId: it.id, projectId: a.project.id, metadata: { number: it.number, changes },
      visibility: it.customerVisible && Object.keys(changes).every((k) => ['status', 'percentComplete'].includes(k)) ? 'PUBLIC' : 'INTERNAL' }, req.ip);
    if (b.assigneeId && b.assigneeId !== it.assigneeId) await notify(tx, { orgId: req.auth.orgId, userIds: [b.assigneeId], exclude: req.auth.userId, type: 'work_item.assigned', title: `Assigned: ${a.project.code}-${it.number} ${it.title}`, link: `/projects/${a.project.id}/work/${it.id}` });
    if (norm.status && norm.status !== it.status && it.assigneeId) await notify(tx, { orgId: req.auth.orgId, userIds: [it.assigneeId], exclude: req.auth.userId, type: 'work_item.status', title: `${a.project.code}-${it.number} moved to ${norm.status.replace('_', ' ').toLowerCase()}`, link: `/projects/${a.project.id}/work/${it.id}` });
    return tx.workItem.findUnique({ where: { id: it.id } });
  });
  // Dates, status and hierarchy all feed the schedule: recalculate everything that waits on this item.
  const rescheduled = await reschedule(a.project.id);
  const fresh = rescheduled.moved.length ? await prisma.workItem.findUnique({ where: { id: it.id } }) : updated;
  res.json({ ...S.workItem(fresh, a, { code: a.project.code }), rescheduled, downstreamConflicts: [] });
});

// ----- Change a task's dates (the one path used by the table, the task panel, the Gantt and the plan builder) -----
// Works out the final dates on the project calendar (moving the start keeps the length), saves them and then
// recalculates the plan: everything that waits for this task moves with it, automatically.
// A start typed by the manager becomes the task's "start no earlier than" date; autoStart clears it so the task
// starts as soon as what it waits for is finished.
const datesBody = z.object({ plannedStart: dateOnly.nullable().optional(), plannedFinish: dateOnly.nullable().optional(), version: z.number().int(),
  autoStart: z.boolean().optional(), moveDependents: z.boolean().optional(), expectedMoves: z.array(z.any()).max(2000).optional() });
r.post('/work-items/:itemId/dates', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  if (!a.can('work.editAny')) throw forbidden('Only project managers can change dates');
  writable(a);
  const b = parse(datesBody, req.body);
  const change = {}; if ('plannedStart' in b) change.plannedStart = b.plannedStart; if ('plannedFinish' in b) change.plannedFinish = b.plannedFinish;
  const cal = await projectCalendar(a.project);
  const it = a.item;
  let next;
  if (b.autoStart && !Object.keys(change).length) next = { start: fmtDate(it.plannedStart), finish: fmtDate(it.plannedFinish), adjusted: null };
  else {
    try { next = resolveDateChange({ type: it.type, plannedStart: fmtDate(it.plannedStart), plannedFinish: fmtDate(it.plannedFinish) }, change, cal); }
    catch (e) { if (e instanceof DateRuleError) throw badRequest(e.message); throw e; }
  }
  const startTyped = 'plannedStart' in change || (it.type === 'MILESTONE' && 'plannedFinish' in change);
  const constraint = b.autoStart ? null : startTyped ? next.start : undefined;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.project.id}))`;
    const n = await tx.workItem.updateMany({ where: { id: it.id, version: b.version }, data: { plannedStart: toDate(next.start), plannedFinish: toDate(next.finish),
      ...(constraint !== undefined && it.type !== 'MODULE' && { startConstraint: toDate(constraint) }), version: { increment: 1 } } });
    if (!n.count) throw conflict('This task was changed by someone else. Showing the latest version.');
    await audit(tx, req.auth, { action: 'work_item.dates_changed', entityType: 'WorkItem', entityId: it.id, projectId: a.project.id,
      metadata: { number: it.number, from: { start: fmtDate(it.plannedStart), finish: fmtDate(it.plannedFinish) }, to: { start: next.start, finish: next.finish }, ...(b.autoStart && { autoStart: true }) } }, req.ip);
  });
  const rescheduled = await reschedule(a.project.id);
  const item = await prisma.workItem.findUnique({ where: { id: it.id } });
  const start = fmtDate(item.plannedStart); const finish = fmtDate(item.plannedFinish);
  // The task could not start on the typed date because it waits for another task: say which one.
  let heldBy = null;
  if (startTyped && next.start && start && start > next.start) {
    const preds = await prisma.dependency.findMany({ where: { successorId: it.id, type: 'FS' }, include: { predecessor: { select: { id: true, number: true, title: true, plannedFinish: true, actualFinish: true, status: true } } } });
    const p = preds.map((d) => d.predecessor).filter((x) => x.status !== 'CANCELLED').sort((x, y) => fmtDate(y.actualFinish || y.plannedFinish)?.localeCompare(fmtDate(x.actualFinish || x.plannedFinish)))[0];
    heldBy = p ? { id: p.id, number: p.number, title: p.title, finish: fmtDate(p.actualFinish || p.plannedFinish) } : null;
  }
  res.json({ applied: true, start, finish, adjusted: next.adjusted, heldBy, moved: rescheduled.moved.filter((m) => m.id !== it.id && m.type !== 'MODULE'),
    rescheduled, item: S.workItem(item, a, { code: a.project.code }) });
});

async function isDescendant(projectId, candidateId, ancestorId) {
  const all = await prisma.workItem.findMany({ where: { projectId }, select: { id: true, parentId: true } });
  const byId = new Map(all.map((x) => [x.id, x.parentId]));
  for (let p = byId.get(candidateId); p; p = byId.get(p)) if (p === ancestorId) return true;
  return false;
}

r.delete('/work-items/:itemId', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  a.require('work.delete');
  writable(a);
  const time = await prisma.timeEntry.count({ where: { workItem: { OR: [{ id: a.item.id }, { parentId: a.item.id }, { parent: { parentId: a.item.id } }] } } });
  if (time) throw badRequest('Time has been logged against this item or its children. Cancel it instead of deleting so the history is kept.');
  await prisma.$transaction(async (tx) => {
    await tx.workItem.delete({ where: { id: a.item.id } });
    await audit(tx, req.auth, { action: 'work_item.deleted', entityType: 'WorkItem', entityId: a.item.id, projectId: a.project.id, metadata: { number: a.item.number, title: a.item.title } }, req.ip);
  });
  await reschedule(a.project.id);
  res.status(204).end();
});

// ----- Bulk -----
r.post('/work-items/bulk', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('work.editAny');
  writable(access);
  const { ids, patch } = parse(z.object({ ids: z.array(uuid).min(1).max(200), patch: z.object({ status: STATUS.optional(), assigneeId: uuid.nullable().optional(), priority: PRIORITY.optional(),
    customerVisible: z.boolean().optional(), addLabel: z.string().trim().min(1).max(40).optional() }).refine((p) => Object.keys(p).length > 0, 'Nothing to change') }), req.body);
  if ('assigneeId' in patch) await validateAssignee(access.project.id, patch.assigneeId);
  const items = await prisma.workItem.findMany({ where: { id: { in: ids }, projectId: access.project.id } });
  if (items.length !== new Set(ids).size) throw notFound('One or more work items');
  const skipped = [];
  await prisma.$transaction(async (tx) => {
    for (const it of items) {
      if (patch.status === 'DONE' && (await tx.workItem.count({ where: { parentId: it.id, status: { notIn: ['DONE', 'CANCELLED'] } } }))) { skipped.push({ id: it.id, reason: 'Has open child items' }); continue; }
      const { addLabel, ...p } = patch;
      const data = { ...p, ...(patch.status && normalizeProgress(it, { status: patch.status }, today())), ...(addLabel && !it.labels.includes(addLabel) && { labels: [...it.labels, addLabel] }), version: { increment: 1 } };
      await tx.workItem.update({ where: { id: it.id }, data });
    }
    await audit(tx, req.auth, { action: 'work_item.bulk_updated', entityType: 'Project', entityId: access.project.id, projectId: access.project.id, metadata: { count: items.length - skipped.length, patch } }, req.ip);
  });
  const rescheduled = patch.status ? await reschedule(access.project.id) : undefined;
  res.json({ updated: items.length - skipped.length, skipped, rescheduled });
});

// ----- Checklist & collaborators -----
// ----- CSV import (rows parsed client-side; validated + created here) -----
const IMPORT_TYPES = { task: 'TASK', subtask: 'SUBTASK', 'sub-task': 'SUBTASK', milestone: 'MILESTONE', module: 'MODULE', epic: 'MODULE', deliverable: 'MODULE' };
const IMPORT_STATUS = { todo: 'TODO', 'to do': 'TODO', 'not started': 'TODO', open: 'TODO', 'in progress': 'IN_PROGRESS', in_progress: 'IN_PROGRESS', doing: 'IN_PROGRESS', 'in review': 'IN_REVIEW', in_review: 'IN_REVIEW', review: 'IN_REVIEW', blocked: 'BLOCKED', done: 'DONE', complete: 'DONE', completed: 'DONE', closed: 'DONE', cancelled: 'CANCELLED', canceled: 'CANCELLED' };
const IMPORT_PRIO = { low: 'LOW', medium: 'MEDIUM', normal: 'MEDIUM', high: 'HIGH', critical: 'CRITICAL', urgent: 'CRITICAL', p1: 'CRITICAL', p2: 'HIGH', p3: 'MEDIUM', p4: 'LOW' };
function importDate(v) {
  if (!v) return { value: null };
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { value: t };
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) { const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; if (!Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return { value: d }; }
  return { error: `"${t}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)` };
}
const importRow = z.object({ title: z.string().optional(), type: z.string().optional(), phase: z.string().optional(), parent: z.string().optional(), assignee: z.string().optional(),
  start: z.string().optional(), due: z.string().optional(), estimate: z.union([z.string(), z.number()]).optional(), priority: z.string().optional(), status: z.string().optional(), description: z.string().optional() }).passthrough();

r.post('/work-items/import', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('work.editAny');
  writable(access);
  const b = parse(z.object({ rows: z.array(importRow).min(1).max(1000), dryRun: z.boolean().default(true) }), req.body);
  const pid = access.project.id;
  const [phases, members, existing] = await Promise.all([
    prisma.phase.findMany({ where: { projectId: pid } }),
    prisma.projectMember.findMany({ where: { projectId: pid, role: { in: ['MANAGER', 'MEMBER'] } }, include: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.workItem.findMany({ where: { projectId: pid }, select: { id: true, number: true, title: true, type: true, phaseId: true } }),
  ]);
  const lc = (x) => String(x ?? '').trim().toLowerCase();
  const phaseBy = new Map(phases.map((p) => [lc(p.name), p]));
  const memberBy = new Map(); for (const m of members) { memberBy.set(lc(m.user.email), m.user); memberBy.set(lc(m.user.name), m.user); }
  const refBy = new Map(); for (const e of existing) { refBy.set(lc(`${access.project.code}-${e.number}`), e); if (!refBy.has(lc(e.title))) refBy.set(lc(e.title), e); }
  const plan = [];
  b.rows.forEach((raw, idx) => {
    const errors = []; const warnings = [];
    const title = String(raw.title ?? '').trim();
    if (!title) errors.push('Title is required');
    if (title.length > 300) errors.push('Title is longer than 300 characters');
    const type = raw.type ? IMPORT_TYPES[lc(raw.type)] : 'TASK';
    if (!type) errors.push(`Unknown type "${raw.type}" (task, subtask, milestone, module)`);
    let phase = null;
    if (raw.phase?.trim()) { phase = phaseBy.get(lc(raw.phase)); if (!phase) warnings.push(`Phase "${raw.phase}" not found — left without a phase`); }
    let parent = null;
    if (raw.parent?.trim()) {
      parent = refBy.get(lc(raw.parent));
      if (!parent) errors.push(`Parent "${raw.parent}" not found (use a task key like ${access.project.code}-12 or the exact title of a row above)`);
    }
    if (type && !PARENT_RULES[type].includes(parent?.type ?? null)) errors.push(parent ? `A ${type.toLowerCase()} cannot sit under a ${parent.type.toLowerCase()}` : `A ${type.toLowerCase()} needs a parent task`);
    let assignee = null;
    if (raw.assignee?.trim() && type !== 'MILESTONE' && type !== 'MODULE') { assignee = memberBy.get(lc(raw.assignee)); if (!assignee) warnings.push(`"${raw.assignee}" is not on this project's team — left unassigned`); }
    const st = importDate(raw.start); const du = importDate(raw.due);
    if (st.error) errors.push(`Start: ${st.error}`); if (du.error) errors.push(`Due: ${du.error}`);
    let plannedStart = st.value; let plannedFinish = du.value;
    if (type === 'MILESTONE') { plannedStart = plannedFinish ?? plannedStart; plannedFinish = plannedStart; }
    if (plannedStart && plannedFinish && plannedFinish < plannedStart) errors.push('Due date is before the start date');
    let estimateHours = null;
    if (raw.estimate != null && String(raw.estimate).trim() !== '' && type !== 'MILESTONE') {
      estimateHours = Number(String(raw.estimate).replace(/h(ours?)?$/i, '').trim());
      if (!Number.isFinite(estimateHours) || estimateHours < 0 || estimateHours > 100000) { errors.push(`Estimate "${raw.estimate}" is not a number of hours`); estimateHours = null; }
    }
    const priority = raw.priority?.trim() ? IMPORT_PRIO[lc(raw.priority)] : 'MEDIUM';
    if (!priority) warnings.push(`Unknown priority "${raw.priority}" — set to Medium`);
    const status = raw.status?.trim() ? IMPORT_STATUS[lc(raw.status)] : 'TODO';
    if (!status) warnings.push(`Unknown status "${raw.status}" — set to To do`);
    const entry = { row: idx + 2, title, type, phaseId: parent ? parent.phaseId : phase?.id ?? null, phaseName: phase?.name ?? null, parentRef: parent ? { id: parent.id, title: parent.title, pending: !!parent.pending } : null,
      assigneeId: assignee?.id ?? null, assigneeName: assignee?.name ?? null, plannedStart, plannedFinish, estimateHours, priority: priority || 'MEDIUM', status: status || 'TODO',
      description: raw.description?.trim() || null, errors, warnings };
    plan.push(entry);
    // later rows can use this one as a parent by its title
    if (!errors.length && title && !refBy.has(lc(title))) refBy.set(lc(title), { id: `pending:${idx}`, pending: true, title, type, phaseId: entry.phaseId, planIndex: plan.length - 1 });
  });
  const valid = plan.filter((p) => !p.errors.length);
  const summary = { total: plan.length, valid: valid.length, invalid: plan.length - valid.length, warnings: plan.reduce((n, p) => n + p.warnings.length, 0) };
  if (b.dryRun) return res.json({ dryRun: true, summary, rows: plan });
  if (!valid.length) throw badRequest('No valid rows to import');
  const created = await prisma.$transaction(async (tx) => {
    const ids = new Map();
    const out = [];
    const t = today();
    for (const p of plan) {
      if (p.errors.length) continue;
      let parentId = p.parentRef?.id ?? null;
      if (parentId?.startsWith('pending:')) { parentId = ids.get(Number(parentId.slice(8))) ?? null; if (!parentId) continue; }
      const seq = await tx.project.update({ where: { id: pid }, data: { workItemSeq: { increment: 1 } }, select: { workItemSeq: true } });
      const norm = normalizeProgress({ status: 'TODO', percentComplete: 0 }, { status: p.status }, t);
      const it = await tx.workItem.create({ data: { projectId: pid, number: seq.workItemSeq, type: p.type, title: p.title, description: p.description, phaseId: p.phaseId, parentId, assigneeId: p.assigneeId,
        priority: p.priority, ...norm, plannedStart: toDate(p.plannedStart), plannedFinish: toDate(p.plannedFinish), startConstraint: p.type !== 'MODULE' ? toDate(p.plannedStart) : null, estimateHours: p.estimateHours, createdById: req.auth.userId, customerVisible: false } });
      ids.set(plan.indexOf(p), it.id);
      out.push(it);
    }
    await audit(tx, req.auth, { action: 'work_item.imported', entityType: 'Project', entityId: pid, projectId: pid, metadata: { created: out.length, skipped: plan.length - out.length } }, req.ip);
    const byAssignee = new Map(); for (const it of out) if (it.assigneeId) byAssignee.set(it.assigneeId, (byAssignee.get(it.assigneeId) || 0) + 1);
    for (const [uid, n] of byAssignee) await notify(tx, { orgId: req.auth.orgId, userIds: [uid], exclude: req.auth.userId, type: 'work_item.assigned', title: `${n} imported task(s) assigned to you in ${access.project.code}`, link: `/projects/${pid}/tasks` });
    return out;
  }, { timeout: 30000 });
  const rescheduled = await reschedule(pid);
  res.status(201).json({ dryRun: false, summary, created: created.length, rescheduled });
});

r.post('/work-items/:itemId/checklist', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  if (!a.canEdit) throw forbidden();
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(300) }), req.body);
  const n = await prisma.checklistItem.count({ where: { workItemId: a.item.id } });
  if (n >= 100) throw badRequest('Checklists are limited to 100 items');
  res.status(201).json(await prisma.checklistItem.create({ data: { workItemId: a.item.id, text, sortOrder: n } }));
});
r.patch('/work-items/:itemId/checklist/:cid', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  if (!a.canEdit) throw forbidden();
  const b = parse(z.object({ text: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }), req.body);
  const n = await prisma.checklistItem.updateMany({ where: { id: req.params.cid, workItemId: a.item.id }, data: b });
  if (!n.count) throw notFound('Checklist item');
  res.json({ ok: true });
});
r.delete('/work-items/:itemId/checklist/:cid', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  if (!a.canEdit) throw forbidden();
  await prisma.checklistItem.deleteMany({ where: { id: req.params.cid, workItemId: a.item.id } });
  res.status(204).end();
});
r.put('/work-items/:itemId/collaborators', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  a.require('work.editAny');
  const { userIds } = parse(z.object({ userIds: z.array(uuid).max(30) }), req.body);
  const ok = await prisma.projectMember.count({ where: { projectId: a.project.id, userId: { in: userIds }, role: { in: ['MANAGER', 'MEMBER'] } } });
  if (ok !== new Set(userIds).size) throw badRequest('Collaborators must be managers or members of this project');
  await prisma.$transaction([
    prisma.workItemCollaborator.deleteMany({ where: { workItemId: a.item.id } }),
    prisma.workItemCollaborator.createMany({ data: [...new Set(userIds)].map((userId) => ({ workItemId: a.item.id, userId })) }),
  ]);
  res.json({ ok: true });
});

// ----- Dependencies -----
r.get('/dependencies', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('project.viewInternal');
  res.json({ data: await prisma.dependency.findMany({ where: { projectId: access.project.id } }) });
});

r.post('/dependencies', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('work.schedule');
  writable(access);
  const b = parse(z.object({ predecessorId: uuid, successorId: uuid, type: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'), lagDays: z.number().int().min(-60).max(365).default(0) }), req.body);
  const dep = await prisma.$transaction(async (tx) => {
    // serialize dependency writes per project so concurrent edits cannot create a cycle
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${access.project.id}))`;
    const items = await tx.workItem.findMany({ where: { id: { in: [b.predecessorId, b.successorId] }, projectId: access.project.id } });
    if (items.length !== 2) throw badRequest('Both items must belong to this project');
    if (items.some((i) => i.type === 'MODULE')) throw badRequest('Link tasks or milestones, not modules');
    const edges = await tx.dependency.findMany({ where: { projectId: access.project.id } });
    if (wouldCreateCycle(edges, b.predecessorId, b.successorId)) throw badRequest('This dependency would create a circular chain');
    const d = await tx.dependency.create({ data: { ...b, projectId: access.project.id } });
    await audit(tx, req.auth, { action: 'dependency.created', entityType: 'Dependency', entityId: d.id, projectId: access.project.id, metadata: b }, req.ip);
    return d;
  });
  // the task that now waits is moved straight away (and everything after it)
  const rescheduled = await reschedule(access.project.id);
  res.status(201).json({ ...dep, conflict: null, scheduled: dep.type === 'FS', rescheduled });
});

r.delete('/dependencies/:depId', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('work.schedule');
  const n = await prisma.dependency.deleteMany({ where: { id: req.params.depId, projectId: access.project.id } });
  if (!n.count) throw notFound('Dependency');
  await audit(prisma, req.auth, { action: 'dependency.deleted', entityType: 'Dependency', entityId: req.params.depId, projectId: access.project.id }, req.ip);
  await reschedule(access.project.id);
  res.status(204).end();
});

// ----- Plan builder -----
// The simple way to enter a plan: each row is "what · who · how many working days · starts after which tasks".
// Dates are never typed here unless the manager wants to fix a start; the scheduler calculates them, runs
// unlinked tasks in parallel and moves everything that waits for a task when that task moves.
const planItemBody = z.object({
  type: z.enum(['TASK', 'MILESTONE']).default('TASK'), title: z.string().trim().min(1).max(300), phaseId: uuid.nullable().optional(), assigneeId: uuid.nullable().optional(),
  durationDays: z.number().int().min(1).max(1000).default(5), after: z.array(uuid).max(50).default([]), fixedStart: dateOnly.nullable().optional(),
  estimateHours: z.number().min(0).max(100000).nullable().optional(),
});
const HOURS_PER_DAY = 8;

async function checkPlanRefs(projectId, { phaseId, assigneeId, after = [] }, selfId = null) {
  if (phaseId && !(await prisma.phase.findFirst({ where: { id: phaseId, projectId } }))) throw badRequest('Stage not found in this project');
  await validateAssignee(projectId, assigneeId);
  const ids = [...new Set(after)];
  if (selfId && ids.includes(selfId)) throw badRequest('A task cannot wait for itself');
  if (ids.length) {
    const rows = await prisma.workItem.findMany({ where: { id: { in: ids }, projectId }, select: { id: true, type: true } });
    if (rows.length !== ids.length) throw badRequest('A task it should wait for is not in this project');
    if (rows.some((x) => x.type === 'MODULE')) throw badRequest('Pick tasks or milestones to wait for, not work packages');
  }
  return ids;
}

r.get('/plan-items', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('project.viewInternal');
  const p = access.project;
  const [rows, deps, phases, cal] = await Promise.all([
    prisma.workItem.findMany({ where: { projectId: p.id, status: { not: 'CANCELLED' } }, orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }] }),
    prisma.dependency.findMany({ where: { projectId: p.id } }),
    prisma.phase.findMany({ where: { projectId: p.id }, orderBy: { sortOrder: 'asc' } }),
    projectCalendar(p),
  ]);
  const after = new Map(); for (const d of deps) if (d.type === 'FS') after.set(d.successorId, [...(after.get(d.successorId) || []), d.predecessorId]);
  const parents = new Set(rows.map((x) => x.parentId).filter(Boolean));
  const leaf = rows.filter((x) => !parents.has(x.id));
  const fin = leaf.map((x) => fmtDate(x.plannedFinish)).filter(Boolean).sort().at(-1) ?? null;
  const st = leaf.map((x) => fmtDate(x.plannedStart)).filter(Boolean).sort()[0] ?? null;
  res.json({
    projectStart: fmtDate(p.plannedStart), projectFinish: fmtDate(p.plannedFinish), approved: Boolean(p.planApprovedAt),
    canEdit: access.can('work.schedule') && !READ_ONLY_PROJECT.has(p.status),
    calculatedStart: st, calculatedFinish: fin, workingDays: st && fin ? workingDaysBetween(st, fin, cal) : 0,
    workDays: [...cal.workDays], holidays: [...cal.holidays],
    phases: phases.map((ph) => ({ id: ph.id, name: ph.name, sortOrder: ph.sortOrder, version: ph.version })),
    rows: rows.map((x) => ({
      id: x.id, number: x.number, key: `${p.code}-${x.number}`, type: x.type, title: x.title, phaseId: x.phaseId, parentId: x.parentId, isParent: parents.has(x.id),
      assigneeId: x.assigneeId, status: x.status, version: x.version, estimateHours: x.estimateHours == null ? null : Number(x.estimateHours),
      start: fmtDate(x.plannedStart), finish: fmtDate(x.plannedFinish), fixedStart: fmtDate(x.startConstraint),
      durationDays: x.type === 'MILESTONE' ? 0 : x.plannedStart && x.plannedFinish ? Math.max(1, workingDaysBetween(x.plannedStart, x.plannedFinish, cal)) : null,
      after: after.get(x.id) || [],
    })),
  });
});

r.post('/plan-items', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('work.schedule');
  writable(access);
  const b = parse(planItemBody, req.body);
  const p = access.project;
  const after = await checkPlanRefs(p.id, b);
  const cal = await projectCalendar(p);
  const ms = b.type === 'MILESTONE';
  const start = nextWorkingDay(b.fixedStart || fmtDate(p.plannedStart), cal);
  const finish = ms ? start : addWorkingDays(start, b.durationDays - 1, cal);
  const item = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.id}))`;
    const seq = await tx.project.update({ where: { id: p.id }, data: { workItemSeq: { increment: 1 } }, select: { workItemSeq: true } });
    const last = await tx.workItem.aggregate({ where: { projectId: p.id }, _max: { sortOrder: true } });
    const it = await tx.workItem.create({ data: {
      projectId: p.id, type: b.type, title: b.title, phaseId: b.phaseId ?? null, assigneeId: ms ? null : b.assigneeId ?? null, number: seq.workItemSeq,
      plannedStart: toDate(start), plannedFinish: toDate(finish), startConstraint: b.fixedStart ? toDate(start) : null,
      estimateHours: ms ? null : b.estimateHours !== undefined ? b.estimateHours : b.durationDays * HOURS_PER_DAY,
      sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: req.auth.userId,
    } });
    if (after.length) await tx.dependency.createMany({ data: after.map((pid) => ({ projectId: p.id, predecessorId: pid, successorId: it.id, type: 'FS', lagDays: 0 })) });
    await audit(tx, req.auth, { action: 'work_item.created', entityType: 'WorkItem', entityId: it.id, projectId: p.id, metadata: { number: it.number, type: it.type, title: it.title, after: after.length } }, req.ip);
    if (it.assigneeId) await notify(tx, { orgId: req.auth.orgId, userIds: [it.assigneeId], exclude: req.auth.userId, type: 'work_item.assigned', title: `Assigned: ${p.code}-${it.number} ${it.title}`, link: `/projects/${p.id}/work/${it.id}` });
    return it;
  });
  const rescheduled = await reschedule(p.id);
  res.status(201).json({ item: S.workItem(await prisma.workItem.findUnique({ where: { id: item.id } }), access, { code: p.code }), rescheduled });
});

r.patch('/plan-items/:itemId', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  a.require('work.schedule');
  writable(a);
  // no defaults here: a field that is not sent is not changed
  const b = parse(z.object({ type: z.enum(['TASK', 'MILESTONE']).optional(), title: z.string().trim().min(1).max(300).optional(), phaseId: uuid.nullable().optional(),
    assigneeId: uuid.nullable().optional(), durationDays: z.number().int().min(1).max(1000).optional(), after: z.array(uuid).max(50).optional(),
    fixedStart: dateOnly.nullable().optional(), estimateHours: z.number().min(0).max(100000).nullable().optional(), version: z.number().int() }), req.body);
  const it = a.item; const p = a.project;
  if (it.type === 'MODULE') throw badRequest('Work packages take their dates from the tasks inside them');
  const after = b.after ? await checkPlanRefs(p.id, b, it.id) : (await checkPlanRefs(p.id, { phaseId: b.phaseId, assigneeId: b.assigneeId }), null);
  const cal = await projectCalendar(p);
  const type = b.type ?? it.type; const ms = type === 'MILESTONE';
  if (b.type && b.type !== it.type && !['TASK', 'MILESTONE'].includes(it.type)) throw badRequest('Only tasks and milestones can be switched');
  if (ms && b.type && (await prisma.workItem.count({ where: { parentId: it.id } }))) throw badRequest('A task with sub-tasks cannot become a milestone');
  const oldDur = it.plannedStart && it.plannedFinish ? Math.max(1, workingDaysBetween(it.plannedStart, it.plannedFinish, cal)) : null;
  let start = fmtDate(it.plannedStart) || fmtDate(p.plannedStart);
  if (b.fixedStart) start = b.fixedStart;
  start = nextWorkingDay(start, cal);
  const dur = b.durationDays ?? (it.type === 'MILESTONE' ? 5 : oldDur ?? 5);
  const finish = ms ? start : addWorkingDays(start, dur - 1, cal);
  const data = { version: { increment: 1 }, plannedStart: toDate(start), plannedFinish: toDate(finish), type };
  if (b.title !== undefined) data.title = b.title;
  if (b.phaseId !== undefined) data.phaseId = b.phaseId;
  if (b.assigneeId !== undefined) data.assigneeId = ms ? null : b.assigneeId;
  if (ms) { data.assigneeId = b.assigneeId !== undefined || b.type ? null : undefined; data.estimateHours = null; }
  if (b.estimateHours !== undefined && !ms) data.estimateHours = b.estimateHours;
  else if (!ms && (b.durationDays || b.type)) {
    // effort follows the length while it is still the default (days × 8 h)
    const est = it.estimateHours == null ? null : Number(it.estimateHours);
    if (est == null || (oldDur && est === oldDur * HOURS_PER_DAY) || it.type === 'MILESTONE') data.estimateHours = dur * HOURS_PER_DAY;
  }
  if (b.fixedStart !== undefined) data.startConstraint = b.fixedStart ? toDate(start) : null;
  else if (b.type === 'MILESTONE' && it.type !== 'MILESTONE') data.startConstraint = it.startConstraint;
  if (data.assigneeId === undefined) delete data.assigneeId;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.id}))`;
    const n = await tx.workItem.updateMany({ where: { id: it.id, version: b.version }, data });
    if (!n.count) throw conflict('This task was changed by someone else. Showing the latest version.');
    if (after) {
      const current = await tx.dependency.findMany({ where: { projectId: p.id } });
      const mine = current.filter((d) => d.successorId === it.id && d.type === 'FS');
      const keep = new Set(after);
      const others = current.filter((d) => !(d.successorId === it.id && d.type === 'FS'));
      for (const pid of after) if (wouldCreateCycle(others.concat(after.filter((x) => x !== pid).map((x) => ({ predecessorId: x, successorId: it.id }))), pid, it.id)) {
        const t = await tx.workItem.findUnique({ where: { id: pid }, select: { number: true, title: true } });
        throw badRequest(`#${t.number} ${t.title} already waits for this task, so this task cannot wait for it`);
      }
      const drop = mine.filter((d) => !keep.has(d.predecessorId)).map((d) => d.id);
      if (drop.length) await tx.dependency.deleteMany({ where: { id: { in: drop } } });
      const have = new Set(mine.map((d) => d.predecessorId));
      const add = after.filter((x) => !have.has(x));
      if (add.length) await tx.dependency.createMany({ data: add.map((pid) => ({ projectId: p.id, predecessorId: pid, successorId: it.id, type: 'FS', lagDays: 0 })) });
    }
    const fields = Object.keys(b).filter((k) => k !== 'version');
    await audit(tx, req.auth, { action: 'work_item.updated', entityType: 'WorkItem', entityId: it.id, projectId: p.id, metadata: { number: it.number, fields } }, req.ip);
    if (b.assigneeId && b.assigneeId !== it.assigneeId) await notify(tx, { orgId: req.auth.orgId, userIds: [b.assigneeId], exclude: req.auth.userId, type: 'work_item.assigned', title: `Assigned: ${p.code}-${it.number} ${b.title ?? it.title}`, link: `/projects/${p.id}/work/${it.id}` });
  });
  const rescheduled = await reschedule(p.id);
  res.json({ item: S.workItem(await prisma.workItem.findUnique({ where: { id: it.id } }), a, { code: p.code }), rescheduled });
});

r.delete('/plan-items/:itemId', async (req, res) => {
  const a = await workItemAccess(req.auth, req.params.projectId, req.params.itemId);
  a.require('work.delete');
  writable(a);
  const it = a.item; const p = a.project;
  if (await prisma.workItem.count({ where: { parentId: it.id } })) throw badRequest('Delete or move the items inside it first');
  if (await prisma.timeEntry.count({ where: { workItemId: it.id } })) throw badRequest('Time has been logged against this task. Cancel it instead of deleting so the history is kept.');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.id}))`;
    // whatever waited for this task now waits for what this task waited for, so the chain is not broken
    const all = await tx.dependency.findMany({ where: { projectId: p.id } });
    const preds = all.filter((d) => d.successorId === it.id && d.type === 'FS').map((d) => d.predecessorId);
    const succs = all.filter((d) => d.predecessorId === it.id && d.type === 'FS').map((d) => d.successorId);
    let edges = all.filter((d) => d.predecessorId !== it.id && d.successorId !== it.id);
    const add = [];
    for (const s2 of succs) for (const p2 of preds) {
      if (edges.some((e) => e.predecessorId === p2 && e.successorId === s2) || wouldCreateCycle(edges, p2, s2)) continue;
      edges = edges.concat({ predecessorId: p2, successorId: s2 }); add.push({ projectId: p.id, predecessorId: p2, successorId: s2, type: 'FS', lagDays: 0 });
    }
    await tx.workItem.delete({ where: { id: it.id } });
    if (add.length) await tx.dependency.createMany({ data: add, skipDuplicates: true });
    await audit(tx, req.auth, { action: 'work_item.deleted', entityType: 'WorkItem', entityId: it.id, projectId: p.id, metadata: { number: it.number, title: it.title, relinked: add.length } }, req.ip);
  });
  const rescheduled = await reschedule(p.id);
  res.json({ deleted: true, rescheduled });
});

// ----- Scheduling: preview, explicit apply, analysis -----
const moveBody = z.object({ itemId: uuid, plannedStart: dateOnly, plannedFinish: dateOnly });
async function computePreview(access, b) {
  if (b.plannedFinish < b.plannedStart) throw badRequest('Planned finish must be on or after planned start');
  const sched = await loadSchedule(access.project.id);
  if (!sched.items.some((i) => i.id === b.itemId)) throw notFound('Work item');
  const cal = await projectCalendar(access.project);
  return { sched, moves: previewShift(sched.items, sched.deps, b.itemId, b.plannedStart, b.plannedFinish, cal) };
}

r.post('/schedule/preview', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('work.schedule');
  const b = parse(moveBody, req.body);
  const { sched, moves } = await computePreview(access, b);
  const byId = new Map(sched.items.map((i) => [i.id, i]));
  const target = byId.get(b.itemId);
  res.json({ item: { id: b.itemId, from: { start: target.plannedStart, finish: target.plannedFinish }, to: { start: b.plannedStart, finish: b.plannedFinish } },
    moves: moves.map((m) => ({ ...m, number: byId.get(m.id).number, title: byId.get(m.id).title })),
    mode: 'manual-with-preview', note: 'Only finish-to-start successors that would start too early are pushed later. Nothing is saved until you apply.' });
});

r.post('/schedule/apply', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('work.schedule');
  writable(access);
  const b = parse(moveBody.extend({ includeDownstream: z.boolean(), expectedMoves: z.array(z.object({ id: uuid, start: dateOnly, finish: dateOnly })).max(2000).default([]) }), req.body);
  const updatedIds = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${access.project.id}))`;
    const { moves } = await computePreview(access, b);
    const want = b.includeDownstream ? moves : [];
    // The user confirmed a specific set of changes; refuse if the plan changed meanwhile.
    const key = (xs) => xs.map((m) => `${m.id}:${m.to?.start ?? m.start}:${m.to?.finish ?? m.finish}`).sort().join('|');
    if (b.includeDownstream && key(want) !== key(b.expectedMoves)) throw conflict('The schedule changed since the preview. Preview again before applying.');
    const target = await tx.workItem.findFirst({ where: { id: b.itemId, projectId: access.project.id } });
    const changes = [{ id: b.itemId, start: b.plannedStart, finish: target.type === 'MILESTONE' ? b.plannedStart : b.plannedFinish }, ...want.map((m) => ({ id: m.id, start: m.to.start, finish: m.to.finish }))];
    for (const c of changes) await tx.workItem.update({ where: { id: c.id }, data: { plannedStart: toDate(c.start), plannedFinish: toDate(c.finish), ...(c.id === b.itemId && target.type !== 'MODULE' && { startConstraint: toDate(c.start) }), version: { increment: 1 } } });
    await audit(tx, req.auth, { action: 'schedule.applied', entityType: 'Project', entityId: access.project.id, projectId: access.project.id, metadata: { itemId: b.itemId, downstream: want.length, changes } }, req.ip);
    return changes.map((c) => c.id);
  });
  const rescheduled = await reschedule(access.project.id);
  res.json({ updated: updatedIds.length, ids: updatedIds, rescheduled });
});

r.get('/schedule/analysis', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('project.viewInternal');
  const sched = await loadSchedule(access.project.id);
  const cal = await projectCalendar(access.project);
  const t = new Date().toISOString().slice(0, 10);
  const leaf = sched.items.filter((i) => i.type !== 'MODULE');
  let cp = null; let cpError = null;
  try { cp = criticalPath(leaf, sched.deps, cal); } catch (e) { cpError = e.message; }
  res.json({
    conflicts: scheduleConflicts(sched.items, sched.deps, cal),
    overdue: sched.items.filter((i) => i.plannedFinish && i.plannedFinish < t && !['DONE', 'CANCELLED'].includes(i.status)).map((i) => ({ id: i.id, number: i.number, title: i.title, plannedFinish: i.plannedFinish })),
    criticalPath: cp && { durationDays: cp.durationDays, ids: cp.critical, slack: Object.fromEntries(cp.nodes.map((n) => [n.id, n.slack])), excludedUndated: cp.excluded.length },
    criticalPathError: cpError,
    unsupportedDependencyTypes: sched.deps.filter((d) => d.type !== 'FS').length,
    method: 'FS dependencies only; durations are working days between planned dates on the project calendar.',
  });
});

// ----- Progress -----
r.get('/progress', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  const { items } = await loadSchedule(access.project.id);
  const roll = rollup(items);
  const phases = await prisma.phase.findMany({ where: { projectId: access.project.id, ...(access.isCustomer && { customerVisible: true }) }, orderBy: { sortOrder: 'asc' } });
  const modules = items.filter((i) => i.type === 'MODULE' && (access.internal || i.customerVisible));
  res.json({ project: roll.project, milestones: roll.milestones, phases: phases.map((p) => ({ id: p.id, name: p.name, ...roll.phase(p.id) })),
    modules: modules.map((m) => ({ id: m.id, number: m.number, title: m.title, ...roll.byId.get(m.id) })) });
});

// ----- Activity -----
r.get('/activity', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  const q = parse(listQuery.extend({ entityId: uuid.optional() }), req.query);
  const where = { organizationId: req.auth.orgId, projectId: access.project.id, ...(access.isCustomer && { visibility: 'PUBLIC' }), ...(q.entityId && { entityId: q.entityId }),
    ...(q.q && { action: { contains: q.q } }) };
  const [rows, total] = await Promise.all([prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }), prisma.auditEvent.count({ where })]);
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((x) => x.actorId).filter(Boolean) } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  res.json(paged(rows.map((e) => ({ id: e.id, action: e.action, entityType: e.entityType, entityId: e.entityId, actorName: names.get(e.actorId) ?? 'System', createdAt: e.createdAt,
    metadata: access.isCustomer ? { number: e.metadata?.number, changes: e.metadata?.changes && { status: e.metadata.changes.status, percentComplete: e.metadata.changes.percentComplete } } : e.metadata })), total, q));
});

// ----- CSV export -----
r.get('/export/work-items.csv', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('export.csv');
  const [rows, users, phases, sched] = await Promise.all([
    prisma.workItem.findMany({ where: { projectId: access.project.id }, orderBy: { number: 'asc' } }),
    prisma.user.findMany({ where: { projectMembers: { some: { projectId: access.project.id } } }, select: { id: true, name: true } }),
    prisma.phase.findMany({ where: { projectId: access.project.id } }), loadSchedule(access.project.id),
  ]);
  const roll = rollup(sched.items);
  const un = new Map(users.map((u) => [u.id, u.name])); const pn = new Map(phases.map((p) => [p.id, p.name]));
  const csv = toCsv([
    { label: 'Key', value: (i) => `${access.project.code}-${i.number}` }, { label: 'Type', key: 'type' }, { label: 'Title', key: 'title' },
    { label: 'Phase', value: (i) => pn.get(i.phaseId) }, { label: 'Status', key: 'status' }, { label: 'Priority', key: 'priority' },
    { label: 'Assignee', value: (i) => un.get(i.assigneeId) }, { label: 'Planned start', value: (i) => fmtDate(i.plannedStart) }, { label: 'Planned finish', value: (i) => fmtDate(i.plannedFinish) },
    { label: 'Estimate (h)', value: (i) => (i.estimateHours == null ? '' : Number(i.estimateHours)) }, { label: 'Progress %', value: (i) => roll.byId.get(i.id)?.percent ?? i.percentComplete },
    { label: 'Customer visible', value: (i) => (i.customerVisible ? 'yes' : 'no') }, { label: 'Labels', value: (i) => i.labels.join('; ') },
  ], rows);
  await audit(prisma, req.auth, { action: 'export.work_items', entityType: 'Project', entityId: access.project.id, projectId: access.project.id, metadata: { rows: rows.length } }, req.ip);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${access.project.code}-work-items.csv"` }).send('﻿' + csv);
});

// ----- Registers: risks, issues, decisions, change requests -----
const REG = {
  risks: { model: 'risk', body: z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(5000).nullable().optional(), probability: z.number().int().min(1).max(5), impact: z.number().int().min(1).max(5),
    ownerId: uuid.nullable().optional(), mitigation: z.string().max(5000).nullable().optional(), status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']).optional(), workItemId: uuid.nullable().optional() }) },
  issues: { model: 'issue', body: z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(5000).nullable().optional(), severity: z.number().int().min(1).max(5),
    ownerId: uuid.nullable().optional(), targetDate: dateOnly.nullable().optional(), status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']).optional(), workItemId: uuid.nullable().optional() }) },
  decisions: { model: 'decision', body: z.object({ title: z.string().trim().min(1).max(200), context: z.string().max(5000).nullable().optional(), decision: z.string().trim().min(1).max(5000),
    decidedById: uuid.nullable().optional(), decidedOn: dateOnly, workItemId: uuid.nullable().optional() }) },
  'change-requests': { model: 'changeRequest', body: z.object({ title: z.string().trim().min(1).max(200), scope: z.string().trim().min(1).max(5000), scheduleImpactDays: z.number().int().min(-365).max(3650).default(0),
    costImpact: z.number().min(-1e12).max(1e12).nullable().optional(), reviewerId: uuid.nullable().optional(), ticketId: uuid.nullable().optional() }) },
};
function reg(req) { const x = REG[req.params.kind]; if (!x) throw notFound('Register'); return x; }
const regOut = (row) => ({ ...row, ...(row.targetDate !== undefined && { targetDate: fmtDate(row.targetDate) }), ...(row.decidedOn && { decidedOn: fmtDate(row.decidedOn) }), ...(row.costImpact != null && { costImpact: Number(row.costImpact) }) });
async function checkRefs(projectId, orgId, b) {
  if (b.workItemId && !(await prisma.workItem.findFirst({ where: { id: b.workItemId, projectId } }))) throw badRequest('Linked work item not found in this project');
  for (const k of ['ownerId', 'decidedById', 'reviewerId']) if (b[k] && !(await prisma.projectMember.findFirst({ where: { projectId, userId: b[k], role: { not: 'CUSTOMER' } } }))) throw badRequest(`${k} must be an internal project member`);
  if (b.ticketId && !(await prisma.ticket.findFirst({ where: { id: b.ticketId, organizationId: orgId } }))) throw badRequest('Ticket not found');
}

r.get('/registers/:kind', async (req, res) => {
  const { model } = reg(req);
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('register.view');
  const rows = await prisma[model].findMany({ where: { projectId: access.project.id }, orderBy: { createdAt: 'desc' }, take: 500 });
  res.json({ data: rows.map(regOut) });
});
r.post('/registers/:kind', async (req, res) => {
  const { model, body } = reg(req);
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('register.manage');
  const b = parse(body, req.body);
  await checkRefs(access.project.id, req.auth.orgId, b);
  const row = await prisma[model].create({ data: { ...b, projectId: access.project.id, ...(b.targetDate !== undefined && { targetDate: toDate(b.targetDate) }), ...(b.decidedOn && { decidedOn: toDate(b.decidedOn) }), ...(model === 'changeRequest' && { createdById: req.auth.userId }) } });
  await audit(prisma, req.auth, { action: `${model}.created`, entityType: model, entityId: row.id, projectId: access.project.id, metadata: { title: row.title } }, req.ip);
  res.status(201).json(regOut(row));
});
r.patch('/registers/:kind/:id', async (req, res) => {
  const { model, body } = reg(req);
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('register.manage');
  const row = await prisma[model].findFirst({ where: { id: req.params.id, projectId: access.project.id } });
  if (!row) throw notFound('Record');
  const ext = model === 'changeRequest' ? partialNoDefaults(body).extend({ status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional(), outcomeNote: z.string().max(5000).optional() }) : partialNoDefaults(body);
  const b = parse(ext, req.body);
  await checkRefs(access.project.id, req.auth.orgId, b);
  if (model === 'changeRequest' && b.status && ['APPROVED', 'REJECTED'].includes(b.status)) {
    if (['APPROVED', 'REJECTED', 'IMPLEMENTED'].includes(row.status)) throw conflict('This change request has already been decided');
    if (row.reviewerId && row.reviewerId !== req.auth.userId && access.role !== 'ADMIN') throw forbidden('Only the assigned reviewer can decide this change request');
    b.decidedAt = new Date();
  }
  const data = { ...b, ...('targetDate' in b && { targetDate: toDate(b.targetDate) }), ...(b.decidedOn && { decidedOn: toDate(b.decidedOn) }) };
  const n = await prisma[model].updateMany({ where: { id: row.id, ...(model === 'changeRequest' && b.status && { status: row.status }) }, data });
  if (!n.count) throw conflict('This record changed meanwhile. Reload and try again.');
  await audit(prisma, req.auth, { action: `${model}.updated`, entityType: model, entityId: row.id, projectId: access.project.id, metadata: b }, req.ip);
  // Approved change requests never alter the baseline automatically; re-baselining is an explicit action.
  res.json({ ...regOut(await prisma[model].findUnique({ where: { id: row.id } })), ...(b.status === 'APPROVED' && { nextStep: 'Apply the approved scope and schedule changes, then create a new baseline referencing this change request.' }) });
});

export default r;
