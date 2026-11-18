import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, dateOnly, toDate, fmtDate, uuid, listQuery, pageArgs, paged, partialNoDefaults } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { projectAccess, requireOrg } from '../policies/access.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';
import { addDays, isoWeekday } from '../domain/calendar.js';

const r = Router();
const LOCKED = new Set(['SUBMITTED', 'APPROVED']);
export const weekStartOf = (d) => addDays(d, 1 - isoWeekday(d));

async function sheetFor(tx, auth, date) {
  const weekStart = toDate(weekStartOf(date));
  return tx.timesheet.upsert({ where: { userId_weekStart: { userId: auth.userId, weekStart } }, create: { organizationId: auth.orgId, userId: auth.userId, weekStart }, update: {} });
}

const entryOut = (e) => ({ id: e.id, projectId: e.projectId, workItemId: e.workItemId, date: fmtDate(e.date), hours: Number(e.hours), billable: e.billable, note: e.note, timesheetId: e.timesheetId });

r.get('/week', async (req, res) => {
  requireOrg(req.auth, 'time.log');
  const { weekStart } = parse(z.object({ weekStart: dateOnly.optional() }), req.query);
  const ws = weekStartOf(weekStart ?? new Date().toISOString().slice(0, 10));
  const sheet = await prisma.timesheet.findUnique({ where: { userId_weekStart: { userId: req.auth.userId, weekStart: toDate(ws) } }, include: { entries: { orderBy: { date: 'asc' } } } });
  const memberships = await prisma.projectMember.findMany({ where: { userId: req.auth.userId, role: { in: ['MANAGER', 'MEMBER'] }, project: { status: { in: ['ACTIVE', 'ON_HOLD', 'COMPLETED'] } } },
    include: { project: { select: { id: true, code: true, name: true, billingEnabled: true } } } });
  const items = await prisma.workItem.findMany({ where: { projectId: { in: memberships.map((m) => m.projectId) }, type: { in: ['TASK', 'SUBTASK'] }, status: { notIn: ['CANCELLED'] },
    OR: [{ assigneeId: req.auth.userId }, { collaborators: { some: { userId: req.auth.userId } } }] }, select: { id: true, projectId: true, number: true, title: true, status: true }, take: 500 });
  const reviewer = sheet?.reviewedById ? await prisma.user.findUnique({ where: { id: sheet.reviewedById }, select: { name: true } }) : null;
  res.json({
    weekStart: ws, days: [...Array(7)].map((_, i) => addDays(ws, i)),
    timesheet: sheet ? { id: sheet.id, status: sheet.status, version: sheet.version, submittedAt: sheet.submittedAt, reviewedAt: sheet.reviewedAt, reviewNote: sheet.reviewNote, reviewerName: reviewer?.name ?? null } : { id: null, status: 'DRAFT', version: 0 },
    entries: (sheet?.entries ?? []).map(entryOut),
    projects: memberships.map((m) => m.project),
    workItems: items,
  });
});

const entryBody = z.object({ projectId: uuid, workItemId: uuid.nullable().optional(), date: dateOnly, hours: z.number().gt(0).max(24).multipleOf(0.25, 'Use quarter hours'),
  billable: z.boolean().default(false), note: z.string().max(1000).nullable().optional() });

async function validateEntry(auth, b, excludeId) {
  const a = await projectAccess(auth, b.projectId);
  a.require('time.log');
  if (a.isCustomer) throw forbidden();
  if (['DRAFT', 'CANCELLED', 'ARCHIVED'].includes(a.project.status)) throw badRequest(`Time cannot be logged on a ${a.project.status.toLowerCase()} project`);
  if (b.workItemId && !(await prisma.workItem.findFirst({ where: { id: b.workItemId, projectId: b.projectId, type: { not: 'MODULE' } } }))) throw badRequest('Work item not found in this project');
  if (b.billable && !a.project.billingEnabled) throw badRequest('Billing is not enabled for this project');
  if (b.date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw badRequest('Time cannot be logged in the future');
  const day = await prisma.timeEntry.aggregate({ where: { userId: auth.userId, date: toDate(b.date), ...(excludeId && { id: { not: excludeId } }) }, _sum: { hours: true } });
  if (Number(day._sum.hours ?? 0) + b.hours > 24) throw badRequest('Total hours for a day cannot exceed 24');
}

r.post('/entries', async (req, res) => {
  requireOrg(req.auth, 'time.log');
  const b = parse(entryBody, req.body);
  await validateEntry(req.auth, b);
  const e = await prisma.$transaction(async (tx) => {
    const sheet = await sheetFor(tx, req.auth, b.date);
    if (LOCKED.has(sheet.status)) throw conflict(`The timesheet for this week is ${sheet.status.toLowerCase()} and locked`);
    const row = await tx.timeEntry.create({ data: { ...b, date: toDate(b.date), organizationId: req.auth.orgId, userId: req.auth.userId, timesheetId: sheet.id } });
    await audit(tx, req.auth, { action: 'time.logged', entityType: 'TimeEntry', entityId: row.id, projectId: b.projectId, metadata: { hours: b.hours, date: b.date } }, req.ip);
    return row;
  });
  res.status(201).json(entryOut(e));
});

async function ownEntry(auth, id) {
  const e = await prisma.timeEntry.findFirst({ where: { id, userId: auth.userId, organizationId: auth.orgId }, include: { timesheet: true } });
  if (!e) throw notFound('Time entry');
  if (LOCKED.has(e.timesheet.status)) throw conflict(`This entry is on a ${e.timesheet.status.toLowerCase()} timesheet and cannot be changed`);
  return e;
}

r.patch('/entries/:id', async (req, res) => {
  const e = await ownEntry(req.auth, req.params.id);
  const b = parse(partialNoDefaults(entryBody), req.body);
  const merged = { projectId: e.projectId, workItemId: e.workItemId, date: fmtDate(e.date), hours: Number(e.hours), billable: e.billable, ...b };
  await validateEntry(req.auth, merged, e.id);
  const updated = await prisma.$transaction(async (tx) => {
    const sheet = weekStartOf(merged.date) === fmtDate(e.timesheet.weekStart) ? e.timesheet : await sheetFor(tx, req.auth, merged.date);
    if (LOCKED.has(sheet.status)) throw conflict('The target week is locked');
    const row = await tx.timeEntry.update({ where: { id: e.id }, data: { ...b, ...(b.date && { date: toDate(b.date) }), timesheetId: sheet.id } });
    await audit(tx, req.auth, { action: 'time.updated', entityType: 'TimeEntry', entityId: e.id, projectId: merged.projectId, metadata: b }, req.ip);
    return row;
  });
  res.json(entryOut(updated));
});

r.delete('/entries/:id', async (req, res) => {
  const e = await ownEntry(req.auth, req.params.id);
  await prisma.timeEntry.delete({ where: { id: e.id } });
  await audit(prisma, req.auth, { action: 'time.deleted', entityType: 'TimeEntry', entityId: e.id, projectId: e.projectId }, req.ip);
  res.status(204).end();
});

r.post('/timesheets/:id/submit', async (req, res) => {
  const { version } = parse(z.object({ version: z.number().int() }), req.body);
  const sheet = await prisma.timesheet.findFirst({ where: { id: req.params.id, userId: req.auth.userId }, include: { entries: true } });
  if (!sheet) throw notFound('Timesheet');
  if (!sheet.entries.length) throw badRequest('Add time before submitting');
  const n = await prisma.timesheet.updateMany({ where: { id: sheet.id, version, status: { in: ['DRAFT', 'REJECTED'] } }, data: { status: 'SUBMITTED', submittedAt: new Date(), reviewNote: null, version: { increment: 1 } } });
  if (!n.count) throw conflict('This timesheet was already submitted or changed. Reload and try again.');
  const managers = await prisma.projectMember.findMany({ where: { projectId: { in: [...new Set(sheet.entries.map((e) => e.projectId))] }, role: 'MANAGER' }, select: { userId: true } });
  await notify(prisma, { orgId: req.auth.orgId, userIds: managers.map((m) => m.userId), exclude: req.auth.userId, type: 'timesheet.submitted', title: `${req.auth.user.name} submitted a timesheet for week of ${fmtDate(sheet.weekStart)}`, link: '/time/approvals' });
  await audit(prisma, req.auth, { action: 'timesheet.submitted', entityType: 'Timesheet', entityId: sheet.id }, req.ip);
  res.json({ ok: true });
});

/** Reviewer must be an org admin, or a manager of every project on the timesheet. Never the owner. */
async function canReview(auth, sheet, projectIds) {
  if (sheet.userId === auth.userId) return false;
  if (auth.orgRole === 'ADMIN') return true;
  if (auth.orgRole !== 'MANAGER') return false;
  const managed = await prisma.projectMember.count({ where: { userId: auth.userId, role: 'MANAGER', projectId: { in: projectIds } } });
  return managed === projectIds.length;
}

r.get('/approvals', async (req, res) => {
  if (!['ADMIN', 'MANAGER'].includes(req.auth.orgRole)) throw forbidden();
  const q = parse(listQuery.extend({ status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']).default('SUBMITTED') }), req.query);
  const managed = req.auth.orgRole === 'ADMIN' ? null : (await prisma.projectMember.findMany({ where: { userId: req.auth.userId, role: 'MANAGER' }, select: { projectId: true } })).map((m) => m.projectId);
  const where = { organizationId: req.auth.orgId, status: q.status, userId: { not: req.auth.userId }, ...(managed && { entries: { some: { projectId: { in: managed } } } }) };
  const sheets = await prisma.timesheet.findMany({ where, include: { entries: true }, orderBy: { submittedAt: 'desc' }, take: 200 });
  const users = await prisma.user.findMany({ where: { id: { in: sheets.map((s) => s.userId) } }, select: { id: true, name: true } });
  const projects = await prisma.project.findMany({ where: { id: { in: [...new Set(sheets.flatMap((s) => s.entries.map((e) => e.projectId)))] } }, select: { id: true, code: true, name: true } });
  const un = new Map(users.map((u) => [u.id, u.name])); const pc = new Map(projects.map((p) => [p.id, p]));
  const out = [];
  for (const s of sheets) {
    const pids = [...new Set(s.entries.map((e) => e.projectId))];
    out.push({ id: s.id, userId: s.userId, userName: un.get(s.userId), weekStart: fmtDate(s.weekStart), status: s.status, version: s.version, submittedAt: s.submittedAt, reviewNote: s.reviewNote,
      totalHours: s.entries.reduce((a, e) => a + Number(e.hours), 0), billableHours: s.entries.filter((e) => e.billable).reduce((a, e) => a + Number(e.hours), 0),
      projects: pids.map((id) => pc.get(id)), canReview: s.status === 'SUBMITTED' && (await canReview(req.auth, s, pids)),
      entries: s.entries.map(entryOut) });
  }
  res.json(paged(out, out.length, { ...q, pageSize: 200 }));
});

async function review(req, res, decision) {
  const { version, note } = parse(z.object({ version: z.number().int(), note: z.string().max(1000).optional() }), req.body);
  if (decision === 'REJECTED' && !note) throw badRequest('Add a note explaining what needs to change');
  const sheet = await prisma.timesheet.findFirst({ where: { id: req.params.id, organizationId: req.auth.orgId }, include: { entries: true } });
  if (!sheet) throw notFound('Timesheet');
  if (!(await canReview(req.auth, sheet, [...new Set(sheet.entries.map((e) => e.projectId))]))) throw forbidden('You can only review timesheets for projects you manage, and never your own');
  // Guarded update: a second approve/reject (double click, two reviewers) finds no SUBMITTED row and fails.
  const n = await prisma.timesheet.updateMany({ where: { id: sheet.id, status: 'SUBMITTED', version }, data: { status: decision, reviewedById: req.auth.userId, reviewedAt: new Date(), reviewNote: note ?? null, version: { increment: 1 } } });
  if (!n.count) throw conflict('This timesheet has already been reviewed or changed');
  await audit(prisma, req.auth, { action: `timesheet.${decision.toLowerCase()}`, entityType: 'Timesheet', entityId: sheet.id, metadata: { note } }, req.ip);
  await notify(prisma, { orgId: req.auth.orgId, userIds: [sheet.userId], type: `timesheet.${decision.toLowerCase()}`, title: `Your timesheet for ${fmtDate(sheet.weekStart)} was ${decision.toLowerCase()}`, body: note, link: `/time?week=${fmtDate(sheet.weekStart)}` });
  res.json({ ok: true, status: decision });
}
r.post('/timesheets/:id/approve', (req, res) => review(req, res, 'APPROVED'));
r.post('/timesheets/:id/reject', (req, res) => review(req, res, 'REJECTED'));

export default r;
