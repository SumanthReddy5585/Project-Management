import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, dateOnly, toDate, fmtDate, uuid } from '../lib/http.js';
import { visibleProjectsWhere, ticketsWhere, requireOrg } from '../policies/access.js';
import { rollup } from '../domain/progress.js';
import { scheduleSummary } from '../services/planVariance.js';
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
    const isAdminOrMgr = auth.orgRole === 'ADMIN' || (await prisma.projectMember.findFirst({ where: { projectId: p.id, userId: auth.userId, role: { in: ['MANAGER', 'DIRECTOR'] } } }));
    const sched = await scheduleSummary(p);
    out.push({ id: p.id, code: p.code, name: p.name, status: p.status, health: p.health, customer: p.customerCompany?.name ?? null, plannedFinish: fmtDate(p.plannedFinish),
      progress: sched?.actualPct ?? roll.project.percent, milestones: roll.milestones, scheduleVarianceDays: sched ? sched.finishVariance : variance, baseline: sched ? 'Approved plan' : bl?.name ?? null, schedule: sched?.status ?? null,
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

// Resource planner: people x weeks heatmap of planned load vs capacity.
r.get('/workload/weeks', async (req, res) => {
  requireOrg(req.auth, 'workload.view');
  const t = iso(new Date());
  const q = parse(z.object({ from: dateOnly.default(weekStartOf(t)), weeks: z.coerce.number().int().min(1).max(26).default(8), projectId: uuid.optional() }), req.query);
  const from = weekStartOf(q.from);
  const weeks = [...Array(q.weeks)].map((_, i) => ({ start: addDays(from, i * 7), end: addDays(from, i * 7 + 6) }));
  const to = weeks.at(-1).end;
  const visible = await prisma.project.findMany({ where: { ...visibleProjectsWhere(req.auth), ...(q.projectId && { id: q.projectId }) }, select: { id: true, code: true, name: true } });
  const pids = visible.map((p) => p.id);
  const pmap = new Map(visible.map((p) => [p.id, p]));
  const members = await prisma.membership.findMany({ where: { organizationId: req.auth.orgId, status: 'ACTIVE', role: { in: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
    ...((req.auth.orgRole !== 'ADMIN' || q.projectId) && { user: { projectMembers: { some: { projectId: { in: pids } } } } }) }, include: { user: true }, orderBy: { user: { name: 'asc' } } });
  const cal = toWorkCalendar(await loadCalendar(prisma, null, req.auth.orgId));
  const tasks = await prisma.workItem.findMany({ where: { projectId: { in: pids }, assigneeId: { in: members.map((m) => m.userId) }, type: { in: ['TASK', 'SUBTASK'] }, status: { notIn: ['DONE', 'CANCELLED'] } },
    select: { id: true, number: true, title: true, projectId: true, assigneeId: true, plannedStart: true, plannedFinish: true, estimateHours: true, status: true, percentComplete: true, priority: true } });
  const data = members.map((m) => {
    const mine = tasks.filter((x) => x.assigneeId === m.userId).map((x) => ({ ...x, plannedStart: fmtDate(x.plannedStart), plannedFinish: fmtDate(x.plannedFinish), estimateHours: x.estimateHours == null ? null : Number(x.estimateHours) }));
    const inWindow = mine.filter((x) => x.plannedStart && x.plannedFinish && x.plannedStart <= to && x.plannedFinish >= from);
    const cells = weeks.map((w) => {
      const capacity = capacityHours(m.user.weeklyCapacityHours, w.start, w.end, cal);
      const planned = plannedLoad(inWindow, w.start, w.end, cal);
      const taskIds = inWindow.filter((x) => x.plannedStart <= w.end && x.plannedFinish >= w.start).map((x) => x.id);
      return { start: w.start, capacity, planned, taskIds, ...utilization(capacity, planned) };
    });
    return { userId: m.userId, name: m.user.name, title: m.user.title, department: m.user.department, weeklyCapacityHours: Number(m.user.weeklyCapacityHours), weeks: cells,
      totals: { capacity: Math.round(cells.reduce((s, c) => s + c.capacity, 0) * 10) / 10, planned: Math.round(cells.reduce((s, c) => s + c.planned, 0) * 10) / 10 },
      unscheduled: mine.filter((x) => !x.plannedStart || !x.plannedFinish).length, unestimated: inWindow.filter((x) => !x.estimateHours).length,
      tasks: inWindow.map((x) => ({ id: x.id, key: `${pmap.get(x.projectId).code}-${x.number}`, title: x.title, projectId: x.projectId, projectCode: pmap.get(x.projectId).code, plannedStart: x.plannedStart, plannedFinish: x.plannedFinish, estimateHours: x.estimateHours, status: x.status, priority: x.priority, percentComplete: x.percentComplete })) };
  });
  res.json({ from, to, weeks: weeks.map((w) => w.start), projects: visible, data,
    method: 'Each cell = remaining estimate of open tasks spread over their planned working days, against that week\'s capacity (weekly hours × working days). Over 100% means the person is overbooked that week.' });
});

// Project delivery for the staff dashboard, across the active projects the user can see:
// tasks planned to finish vs actually finished per week (last 8 weeks), on-time rate, status mix, coming milestones.
async function deliveryStats(a, today) {
  const projects = await prisma.project.findMany({ where: { ...visibleProjectsWhere(a), status: { in: ['ACTIVE', 'ON_HOLD'] } }, select: { id: true, code: true } });
  const pcode = new Map(projects.map((p) => [p.id, p.code]));
  const items = projects.length ? await prisma.workItem.findMany({ where: { projectId: { in: [...pcode.keys()] }, type: { not: 'MODULE' } },
    select: { id: true, projectId: true, title: true, type: true, status: true, plannedFinish: true, actualFinish: true } }) : [];
  const first = addDays(weekStartOf(today), -7 * 7);
  const weeks = [...Array(8)].map((_, i) => ({ week: addDays(first, i * 7), planned: 0, done: 0, onTime: 0 }));
  const status = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, BLOCKED: 0, DONE: 0 };
  const milestones = [];
  let overdue = 0;
  for (const i of items) {
    if (i.status === 'CANCELLED') continue;
    if (status[i.status] != null) status[i.status] += 1;
    const pf = fmtDate(i.plannedFinish); const af = fmtDate(i.actualFinish);
    if (pf && pf >= first) { const w = weeks[Math.floor((Date.parse(pf) - Date.parse(first)) / 604800000)]; if (w) w.planned += 1; }
    if (i.status === 'DONE' && af && af >= first) {
      const w = weeks[Math.floor((Date.parse(af) - Date.parse(first)) / 604800000)];
      if (w) { w.done += 1; if (pf && af <= pf) w.onTime += 1; }
    }
    if (i.status !== 'DONE' && pf && pf < today) overdue += 1;
    if (i.type === 'MILESTONE' && i.status !== 'DONE' && pf && pf <= addDays(today, 30)) milestones.push({ id: i.id, projectId: i.projectId, projectCode: pcode.get(i.projectId), title: i.title, date: pf, overdue: pf < today });
  }
  const done = weeks.reduce((s, w) => s + w.done, 0); const onTime = weeks.reduce((s, w) => s + w.onTime, 0);
  return { weeks, status, overdue, onTimeRate: done ? onTime / done : null, milestones: milestones.sort((x, y) => x.date.localeCompare(y.date)) };
}

// Things waiting for the signed-in person's decision. Directors: plans, documents and change requests of the
// projects they direct. Project managers: timesheets of their team and plans sent back to them.
async function pendingApprovals(a) {
  const directed = await prisma.project.findMany({ where: { organizationId: a.orgId, directorId: a.userId }, select: { id: true, code: true, name: true, planSubmittedAt: true, planApprovedAt: true } });
  const managedIds = (await prisma.projectMember.findMany({ where: { userId: a.userId, role: 'MANAGER' }, select: { projectId: true } })).map((m) => m.projectId);
  const dIds = directed.map((p) => p.id);
  const pc = new Map(directed.map((p) => [p.id, p]));
  const out = [];
  for (const p of directed) if (p.planSubmittedAt && !p.planApprovedAt) out.push({ kind: 'PLAN', id: p.id, projectId: p.id, code: p.code, title: `${p.name} — project plan`, since: p.planSubmittedAt, link: `/projects/${p.id}/plan` });
  if (dIds.length) {
    const docs = await prisma.deliverable.findMany({ where: { projectId: { in: dIds }, status: 'IN_REVIEW' }, include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1, include: { approvals: true } } } });
    const clients = new Set((await prisma.projectMember.findMany({ where: { projectId: { in: dIds }, role: 'CUSTOMER' }, select: { userId: true } })).map((m) => m.userId));
    for (const d of docs) {
      const v = d.versions[0];
      if (d.customerVisible && (v?.approvals || []).some((x) => x.decision === 'APPROVED' && !clients.has(x.reviewerId))) continue; // already with the client
      out.push({ kind: 'DOCUMENT', id: d.id, projectId: d.projectId, code: pc.get(d.projectId)?.code, title: `${d.name}${v ? ` (v${v.versionNumber})` : ''}`, since: v?.createdAt ?? d.createdAt, link: `/projects/${d.projectId}/approvals` });
    }
    const crs = await prisma.changeRequest.findMany({ where: { projectId: { in: dIds }, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } });
    for (const c of crs) out.push({ kind: 'CHANGE', id: c.id, projectId: c.projectId, code: pc.get(c.projectId)?.code, title: c.title, since: c.createdAt, link: `/projects/${c.projectId}/risks?tab=change-requests` });
  }
  if (managedIds.length && ['ADMIN', 'MANAGER'].includes(a.orgRole)) {
    const sheets = await prisma.timesheet.findMany({ where: { organizationId: a.orgId, status: 'SUBMITTED', userId: { not: a.userId }, entries: { some: { projectId: { in: managedIds } } } }, take: 50 });
    const names = new Map((await prisma.user.findMany({ where: { id: { in: sheets.map((t) => t.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    for (const t of sheets) out.push({ kind: 'TIMESHEET', id: t.id, title: `${names.get(t.userId)} — week of ${fmtDate(t.weekStart)}`, since: t.submittedAt, link: '/time?tab=approvals' });
    const returned = await prisma.project.findMany({ where: { id: { in: managedIds }, planReturnedAt: { not: null }, planSubmittedAt: null, planApprovedAt: null }, select: { id: true, code: true, name: true, planReturnedAt: true } });
    for (const p of returned) out.push({ kind: 'PLAN_RETURNED', id: p.id, projectId: p.id, code: p.code, title: `${p.name} — plan sent back by the director`, since: p.planReturnedAt, link: `/projects/${p.id}/plan` });
  }
  return out.sort((x, y) => new Date(x.since) - new Date(y.since));
}

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
  employee.delivery = await deliveryStats(a, today);
  employee.approvals = await pendingApprovals(a);
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

// Organisation-wide recent activity for the dashboard (staff only): project work in projects the
// user can see plus tickets they can see. Sign-ins, invitations and admin housekeeping are left out.
const FEED_SKIP = ['auth.', 'invitation.', 'member.', 'canned.', 'customer.', 'team.', 'calendar.', 'template.', 'org.', 'ticket_settings.'];
r.get('/activity/recent', async (req, res) => {
  const a = req.auth;
  if (a.isCustomer) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not available' } });
  const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).default(15) }), req.query);
  const projects = await prisma.project.findMany({ where: visibleProjectsWhere(a), select: { id: true, code: true, name: true } });
  const pmap = new Map(projects.map((p) => [p.id, p]));
  const tWhere = await ticketsWhere(a);
  const rows = await prisma.auditEvent.findMany({
    where: { organizationId: a.orgId, NOT: FEED_SKIP.map((x) => ({ action: { startsWith: x } })), OR: [{ projectId: { in: [...pmap.keys()] } }, { entityType: 'Ticket' }] },
    orderBy: { createdAt: 'desc' }, take: q.limit * 3,
  });
  const ticketIds = [...new Set(rows.filter((e) => e.entityType === 'Ticket' && e.entityId).map((e) => e.entityId))];
  const tickets = ticketIds.length ? await prisma.ticket.findMany({ where: { AND: [tWhere, { id: { in: ticketIds } }] }, select: { id: true, number: true, subject: true } }) : [];
  const tmap = new Map(tickets.map((t) => [t.id, t]));
  const events = rows.filter((e) => (e.entityType === 'Ticket' ? tmap.has(e.entityId) : pmap.has(e.projectId))).slice(0, q.limit);
  const wiIds = events.filter((e) => e.entityType === 'WorkItem' && e.entityId).map((e) => e.entityId);
  const items = wiIds.length ? await prisma.workItem.findMany({ where: { id: { in: wiIds } }, select: { id: true, number: true, title: true, projectId: true } }) : [];
  const imap = new Map(items.map((i) => [i.id, i]));
  const commentIds = events.map((e) => e.metadata?.commentId).filter((x) => typeof x === 'string');
  const comments = commentIds.length ? await prisma.comment.findMany({ where: { id: { in: commentIds }, deletedAt: null }, select: { id: true, body: true, visibility: true } }) : [];
  const cmap = new Map(comments.map((c) => [c.id, c]));
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.actorId).filter(Boolean))] } }, select: { id: true, name: true } });
  const umap = new Map(users.map((u) => [u.id, u.name]));
  res.json({ data: events.map((e) => {
    const p = e.projectId ? pmap.get(e.projectId) : null;
    const t = e.entityType === 'Ticket' ? tmap.get(e.entityId) : null;
    const wi = e.entityType === 'WorkItem' ? imap.get(e.entityId) : null;
    const c = cmap.get(e.metadata?.commentId);
    const target = t ? { type: 'ticket', label: `#${t.number} ${t.subject}`, link: `/tickets/${t.id}` }
      : wi ? { type: 'task', label: `${p?.code ?? ''}-${wi.number} ${wi.title}`, link: `/projects/${wi.projectId}/tasks?item=${wi.id}` }
        : p ? { type: e.entityType === 'Project' ? 'project' : e.entityType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), label: p.name, link: `/projects/${p.id}` } : null;
    return { id: e.id, action: e.action, entityType: e.entityType, actorName: e.actorId ? umap.get(e.actorId) ?? 'Someone' : 'System', createdAt: e.createdAt,
      project: p, target, metadata: e.metadata, snippet: c ? { body: c.body.slice(0, 280), internal: c.visibility !== 'PUBLIC' } : null };
  }) });
});

// Time report: logged hours per week (billable split), per project and per person. Admins see the whole
// organisation; managers see their own time plus the projects they manage.
r.get('/reports/time-summary', async (req, res) => {
  const a = req.auth;
  requireOrg(a, 'reports.portfolio');
  const q = parse(z.object({ weeks: z.coerce.number().int().min(1).max(26).default(8) }), req.query);
  const thisWeek = weekStartOf(iso(new Date()));
  const from = addDays(thisWeek, -(q.weeks - 1) * 7); const to = addDays(thisWeek, 6);
  const visible = await prisma.project.findMany({ where: visibleProjectsWhere(a), select: { id: true, code: true, name: true } });
  const managed = a.orgRole === 'ADMIN' ? visible.map((p) => p.id) : (await prisma.projectMember.findMany({ where: { userId: a.userId, role: { in: ['MANAGER', 'DIRECTOR'] } }, select: { projectId: true } })).map((m) => m.projectId);
  const rows = await prisma.timeEntry.findMany({ where: { organizationId: a.orgId, date: { gte: toDate(from), lte: toDate(to) }, OR: [{ userId: a.userId }, { projectId: { in: managed } }] },
    select: { userId: true, projectId: true, date: true, hours: true, billable: true } });
  const weeks = [...Array(q.weeks)].map((_, i) => addDays(from, i * 7));
  const wk = Object.fromEntries(weeks.map((w) => [w, { week: w, billable: 0, nonBillable: 0 }]));
  const byProject = new Map(); const byUser = new Map();
  const r1 = (n) => Math.round(n * 10) / 10;
  for (const e of rows) {
    const h = Number(e.hours); const w = wk[weekStartOf(fmtDate(e.date))];
    if (w) w[e.billable ? 'billable' : 'nonBillable'] += h;
    const pp = byProject.get(e.projectId) ?? { hours: 0, billable: 0 }; pp.hours += h; if (e.billable) pp.billable += h; byProject.set(e.projectId, pp);
    const uu = byUser.get(e.userId) ?? { hours: 0, billable: 0, projects: new Set() }; uu.hours += h; if (e.billable) uu.billable += h; uu.projects.add(e.projectId); byUser.set(e.userId, uu);
  }
  const pinfo = new Map(visible.map((p) => [p.id, p]));
  const missing = [...byProject.keys()].filter((id) => !pinfo.has(id));
  if (missing.length) (await prisma.project.findMany({ where: { id: { in: missing } }, select: { id: true, code: true, name: true } })).forEach((p) => pinfo.set(p.id, p));
  const users = await prisma.user.findMany({ where: { id: { in: [...byUser.keys()] } }, select: { id: true, name: true, title: true, weeklyCapacityHours: true } });
  const total = rows.reduce((s, e) => s + Number(e.hours), 0); const billable = rows.filter((e) => e.billable).reduce((s, e) => s + Number(e.hours), 0);
  res.json({ from, to, weeks: weeks.map((w) => ({ ...wk[w], billable: r1(wk[w].billable), nonBillable: r1(wk[w].nonBillable) })),
    totals: { hours: r1(total), billable: r1(billable), people: byUser.size, projects: byProject.size },
    byProject: [...byProject].map(([id, v]) => ({ id, code: pinfo.get(id)?.code, name: pinfo.get(id)?.name, hours: r1(v.hours), billable: r1(v.billable) })).sort((x, y) => y.hours - x.hours),
    byPerson: users.map((u) => { const v = byUser.get(u.id); const cap = Number(u.weeklyCapacityHours || 0) * q.weeks;
      return { id: u.id, name: u.name, title: u.title, hours: r1(v.hours), billable: r1(v.billable), projects: v.projects.size, capacity: r1(cap), pct: cap ? Math.round((v.hours / cap) * 100) : null }; }).sort((x, y) => y.hours - x.hours),
    method: 'Logged time from timesheets (any status). Capacity = weekly hours × weeks in the period.' });
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
  const managed = req.auth.orgRole === 'ADMIN' ? visible : (await prisma.projectMember.findMany({ where: { userId: req.auth.userId, role: { in: ['MANAGER', 'DIRECTOR'] } }, select: { projectId: true } })).map((m) => m.projectId);
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
