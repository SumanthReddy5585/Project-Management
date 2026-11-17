import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, dateOnly, toDate, fmtDate, uuid } from '../lib/http.js';
import { visibleProjectsWhere, ticketsWhere, requireOrg } from '../policies/access.js';
import { rollup } from '../domain/progress.js';
import { capacityHours, plannedLoad, utilization } from '../domain/capacity.js';
import { workingDaysBetween, addDays } from '../domain/calendar.js';
import { loadSchedule, projectCalendar } from '../services/projectData.js';
import { loadCalendar, toWorkCalendar } from '../services/calendars.js';
import { slaContext } from './tickets.js';
import { slaStatus } from '../domain/sla.js';
import { weekStartOf } from './time.js';
import { toCsv } from '../lib/csv.js';

const r = Router();
const iso = (d) => d.toISOString().slice(0, 10);
const OPEN = ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'];

async function portfolio(auth) {
  const projects = await prisma.project.findMany({ where: { ...visibleProjectsWhere(auth), status: { in: ['ACTIVE', 'ON_HOLD', 'DRAFT'] } }, include: { customerCompany: true }, orderBy: { plannedFinish: 'asc' } });
  const today = iso(new Date()); const soon = addDays(today, 14);
  const out = []; const milestones = [];
  for (const p of projects) {
    const { items } = await loadSchedule(p.id);
    const roll = rollup(items);
    const cal = await projectCalendar(p);
    const ms = items.filter((i) => i.type === 'MILESTONE' && i.status !== 'DONE' && i.status !== 'CANCELLED' && i.plannedFinish && i.plannedFinish <= soon);
    for (const m of ms) milestones.push({ id: m.id, projectId: p.id, projectCode: p.code, title: m.title, date: m.plannedFinish, overdue: m.plannedFinish < today });
    // Schedule variance: latest planned finish of open work vs. the latest baseline's planned finish (working days).
    const bl = await prisma.baseline.findFirst({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, include: { items: true } });
    const curFinish = items.reduce((m, i) => (i.plannedFinish && i.plannedFinish > m ? i.plannedFinish : m), fmtDate(p.plannedFinish));
    const blFinish = bl ? bl.items.reduce((m, i) => { const f = fmtDate(i.plannedFinish); return f && f > m ? f : m; }, '0000-00-00') : null;
    const variance = blFinish && blFinish !== '0000-00-00' ? (curFinish >= blFinish ? workingDaysBetween(blFinish, curFinish, cal) - 1 : -(workingDaysBetween(curFinish, blFinish, cal) - 1)) : null;
    const est = items.filter((i) => !['MODULE', 'MILESTONE'].includes(i.type) && i.status !== 'CANCELLED').reduce((a, i) => a + (i.estimateHours || 0), 0);
    const logged = await prisma.timeEntry.aggregate({ where: { projectId: p.id }, _sum: { hours: true } });
    const billable = p.billingEnabled ? await prisma.timeEntry.aggregate({ where: { projectId: p.id, billable: true }, _sum: { hours: true } }) : null;
    const isAdminOrMgr = auth.orgRole === 'ADMIN' || (await prisma.projectMember.findFirst({ where: { projectId: p.id, userId: auth.userId, role: 'MANAGER' } }));
    out.push({ id: p.id, code: p.code, name: p.name, status: p.status, health: p.health, customer: p.customerCompany?.name ?? null, plannedFinish: fmtDate(p.plannedFinish),
      progress: roll.project.percent, milestones: roll.milestones, scheduleVarianceDays: variance, baseline: bl?.name ?? null,
      estimateHours: Math.round(est * 10) / 10, actualHours: Number(logged._sum.hours ?? 0),
      ...(isAdminOrMgr && p.budgetAmount != null && { budget: { amount: Number(p.budgetAmount), currency: p.budgetCurrency, consumed: p.hourlyRate && billable ? Math.round(Number(billable._sum.hours ?? 0) * Number(p.hourlyRate) * 100) / 100 : null } }) });
  }
  return { projects: out, milestones: milestones.sort((a, b) => a.date.localeCompare(b.date)) };
}

async function ticketStats(auth) {
  const where = await ticketsWhere(auth);
  const byStatus = await prisma.ticket.groupBy({ by: ['status'], where, _count: true });
  const byPriority = await prisma.ticket.groupBy({ by: ['priority'], where: { ...where, status: { in: OPEN } }, _count: true });
  const since = new Date(Date.now() - 30 * 86400000);
  const recent = await prisma.ticket.findMany({ where: { ...where, OR: [{ createdAt: { gte: since } }, { status: { in: OPEN } }] }, take: 2000 });
  const sla = { response: { MET: 0, BREACHED: 0, AT_RISK: 0, ON_TRACK: 0, PAUSED: 0, NONE: 0 }, resolution: { MET: 0, BREACHED: 0, AT_RISK: 0, ON_TRACK: 0, PAUSED: 0, NONE: 0 } };
  const ctx = {};
  for (const t of recent) {
    ctx[t.priority] ??= await slaContext(t.organizationId, t.priority);
    const s = slaStatus(t, ctx[t.priority].policy, new Date(), ctx[t.priority].cal);
    sla.response[s.response.state]++; sla.resolution[s.resolution.state]++;
  }
  return { byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count])), openByPriority: Object.fromEntries(byPriority.map((x) => [x.priority, x._count])), sla, slaWindow: 'Tickets created in the last 30 days plus all open tickets' };
}

async function workload(auth, from, to) {
  const visible = await prisma.project.findMany({ where: visibleProjectsWhere(auth), select: { id: true } });
  const pids = visible.map((p) => p.id);
  const members = await prisma.membership.findMany({ where: { organizationId: auth.orgId, status: 'ACTIVE', role: { in: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
    ...(auth.orgRole !== 'ADMIN' && { user: { projectMembers: { some: { projectId: { in: pids } } } } }) }, include: { user: true } });
  const cal = toWorkCalendar(await loadCalendar(prisma, null, auth.orgId));
  const tasks = await prisma.workItem.findMany({ where: { projectId: { in: pids }, assigneeId: { in: members.map((m) => m.userId) }, type: { in: ['TASK', 'SUBTASK'] } },
    select: { assigneeId: true, plannedStart: true, plannedFinish: true, estimateHours: true, status: true, percentComplete: true } });
  const logged = await prisma.timeEntry.groupBy({ by: ['userId'], where: { userId: { in: members.map((m) => m.userId) }, date: { gte: toDate(from), lte: toDate(to) }, projectId: { in: pids } }, _sum: { hours: true } });
  const lm = new Map(logged.map((l) => [l.userId, Number(l._sum.hours ?? 0)]));
  return members.map((m) => {
    const mine = tasks.filter((t) => t.assigneeId === m.userId).map((t) => ({ ...t, plannedStart: fmtDate(t.plannedStart), plannedFinish: fmtDate(t.plannedFinish), estimateHours: t.estimateHours == null ? null : Number(t.estimateHours) }));
    const capacity = capacityHours(m.user.weeklyCapacityHours, from, to, cal);
    const load = plannedLoad(mine, from, to, cal);
    return { userId: m.userId, name: m.user.name, title: m.user.title, capacityHours: capacity, plannedHours: load, loggedHours: lm.get(m.userId) ?? 0,
      ...utilization(capacity, load), unestimatedTasks: mine.filter((t) => !t.estimateHours && !['DONE', 'CANCELLED'].includes(t.status)).length };
  }).sort((a, b) => b.pct - a.pct);
}

r.get('/workload', async (req, res) => {
  requireOrg(req.auth, 'workload.view');
  const t = iso(new Date());
  const q = parse(z.object({ from: dateOnly.default(weekStartOf(t)), to: dateOnly.default(addDays(weekStartOf(t), 13)) }), req.query);
  if (q.to < q.from || workingDaysBetween(q.from, q.to) > 130) throw new Error('Invalid range');
  res.json({ from: q.from, to: q.to, data: await workload(req.auth, q.from, q.to),
    method: 'Capacity = working days × weekly hours ÷ working days per week. Planned = remaining estimate of assigned open tasks spread evenly over their planned working days. Logged time is shown separately.' });
});

r.get('/dashboard', async (req, res) => {
  const a = req.auth;
  const today = iso(new Date());
  if (a.isCustomer) {
    const pf = await portfolio(a);
    const pids = pf.projects.map((p) => p.id);
    const updates = await prisma.statusUpdate.findMany({ where: { projectId: { in: pids }, customerVisible: true }, orderBy: { createdAt: 'desc' }, take: 5, include: { project: { select: { code: true } } } });
    const deliverables = await prisma.deliverable.findMany({ where: { projectId: { in: pids }, customerVisible: true, status: 'IN_REVIEW' }, include: { project: { select: { id: true, code: true } } } });
    const tickets = await prisma.ticket.findMany({ where: { ...(await ticketsWhere(a)), status: { in: [...OPEN, 'RESOLVED'] } }, orderBy: { updatedAt: 'desc' }, take: 10 });
    const ms = [];
    for (const pid of pids) {
      const { items } = await loadSchedule(pid);
      for (const m of items.filter((i) => i.type === 'MILESTONE' && i.customerVisible && i.status !== 'DONE' && i.plannedFinish)) ms.push({ id: m.id, projectId: pid, projectCode: pf.projects.find((p) => p.id === pid).code, title: m.title, date: m.plannedFinish, overdue: m.plannedFinish < today });
    }
    return res.json({ kind: 'customer',
      projects: pf.projects.map(({ id, code, name, status, health, customer, progress, plannedFinish, milestones }) => ({ id, code, name, status, health, customer, progress, plannedFinish, milestones })),
      milestones: ms.sort((x, y) => x.date.localeCompare(y.date)).slice(0, 10),
      updates: updates.map((u) => ({ id: u.id, projectId: u.projectId, projectCode: u.project.code, title: u.title, health: u.health, createdAt: u.createdAt })),
      deliverablesAwaitingReview: deliverables.map((d) => ({ id: d.id, name: d.name, projectId: d.project.id, projectCode: d.project.code, dueDate: fmtDate(d.dueDate) })),
      tickets: tickets.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, updatedAt: t.updatedAt })) });
  }
  const mine = await prisma.workItem.findMany({ where: { assigneeId: a.userId, status: { notIn: ['DONE', 'CANCELLED'] }, project: { organizationId: a.orgId, status: { in: ['ACTIVE', 'ON_HOLD'] }, members: { some: { userId: a.userId } } } },
    include: { project: { select: { id: true, code: true } } }, orderBy: [{ plannedFinish: 'asc' }], take: 50 });
  const ws = weekStartOf(today);
  const sheet = await prisma.timesheet.findUnique({ where: { userId_weekStart: { userId: a.userId, weekStart: toDate(ws) } }, include: { entries: true } });
  const myTickets = await prisma.ticket.findMany({ where: { organizationId: a.orgId, assigneeId: a.userId, status: { in: OPEN } }, orderBy: { updatedAt: 'desc' }, take: 10 });
  const mentions = await prisma.notification.count({ where: { userId: a.userId, type: 'mention', readAt: null } });
  const unread = await prisma.notification.count({ where: { userId: a.userId, readAt: null } });
  const wi = (i) => ({ id: i.id, projectId: i.project.id, key: `${i.project.code}-${i.number}`, title: i.title, status: i.status, plannedFinish: fmtDate(i.plannedFinish), overdue: Boolean(i.plannedFinish && fmtDate(i.plannedFinish) < today) });
  const employee = {
    myTasks: mine.map(wi), upcoming: mine.filter((i) => i.plannedFinish && fmtDate(i.plannedFinish) <= addDays(today, 7)).map(wi), blocked: mine.filter((i) => i.status === 'BLOCKED').map(wi),
    timesheet: { weekStart: ws, status: sheet?.status ?? 'DRAFT', hours: (sheet?.entries ?? []).reduce((s, e) => s + Number(e.hours), 0) },
    myTickets: myTickets.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority })), unreadMentions: mentions, unreadNotifications: unread,
  };
  if (a.orgRole === 'EMPLOYEE') return res.json({ kind: 'employee', ...employee });
  const pf = await portfolio(a);
  const wl = await workload(a, ws, addDays(ws, 13));
  res.json({ kind: 'management', ...employee, portfolio: pf.projects, milestones: pf.milestones, tickets: await ticketStats(a), workload: wl,
    definitions: {
      progress: 'Effort-weighted completion of leaf work items (docs/CALCULATIONS.md).',
      scheduleVariance: 'Working days between the latest planned finish now and in the most recent baseline. Positive = late.',
      budgetConsumed: 'Billable hours × project hourly rate. Shown only where billing and a rate are configured.',
      workload: 'Next two weeks. Planned hours vs capacity.',
    } });
});

r.get('/reports/portfolio.csv', async (req, res) => {
  requireOrg(req.auth, 'reports.portfolio');
  const pf = await portfolio(req.auth);
  const csv = toCsv([{ label: 'Code', key: 'code' }, { label: 'Project', key: 'name' }, { label: 'Customer', key: 'customer' }, { label: 'Status', key: 'status' }, { label: 'Health', key: 'health' },
    { label: 'Progress %', key: 'progress' }, { label: 'Planned finish', key: 'plannedFinish' }, { label: 'Schedule variance (days)', key: 'scheduleVarianceDays' },
    { label: 'Estimate (h)', key: 'estimateHours' }, { label: 'Actual (h)', key: 'actualHours' }], pf.projects);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="portfolio.csv"' }).send('﻿' + csv);
});

r.get('/reports/time.csv', async (req, res) => {
  const q = parse(z.object({ from: dateOnly, to: dateOnly, projectId: uuid.optional() }), req.query);
  const visible = (await prisma.project.findMany({ where: visibleProjectsWhere(req.auth), select: { id: true } })).map((p) => p.id);
  const managed = req.auth.orgRole === 'ADMIN' ? visible : (await prisma.projectMember.findMany({ where: { userId: req.auth.userId, role: 'MANAGER' }, select: { projectId: true } })).map((m) => m.projectId);
  if (req.auth.isCustomer) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not available' } });
  const where = { organizationId: req.auth.orgId, date: { gte: toDate(q.from), lte: toDate(q.to) }, ...(q.projectId && { projectId: q.projectId }),
    OR: [{ userId: req.auth.userId }, { projectId: { in: managed } }] };
  const rows = await prisma.timeEntry.findMany({ where, include: { project: { select: { code: true } }, workItem: { select: { number: true, title: true } }, timesheet: { select: { status: true } } }, orderBy: { date: 'asc' }, take: 20000 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((x) => x.userId))] } }, select: { id: true, name: true } });
  const un = new Map(users.map((u) => [u.id, u.name]));
  const csv = toCsv([{ label: 'Date', value: (e) => fmtDate(e.date) }, { label: 'Person', value: (e) => un.get(e.userId) }, { label: 'Project', value: (e) => e.project.code },
    { label: 'Work item', value: (e) => (e.workItem ? `${e.project.code}-${e.workItem.number} ${e.workItem.title}` : '') }, { label: 'Hours', value: (e) => Number(e.hours) },
    { label: 'Billable', value: (e) => (e.billable ? 'yes' : 'no') }, { label: 'Timesheet', value: (e) => e.timesheet.status }, { label: 'Note', key: 'note' }], rows);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="time.csv"' }).send('﻿' + csv);
});

export default r;
