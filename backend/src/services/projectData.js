import { prisma } from '../lib/prisma.js';
import { rollup } from '../domain/progress.js';
import { fmtDate } from '../lib/http.js';
import { loadCalendar, toWorkCalendar } from './calendars.js';

/** Load the scheduling-relevant shape of every work item in a project (dates as 'YYYY-MM-DD'). */
export async function loadSchedule(projectId, db = prisma) {
  const items = await db.workItem.findMany({ where: { projectId }, select: { id: true, parentId: true, phaseId: true, type: true, status: true, percentComplete: true,
    estimateHours: true, plannedStart: true, plannedFinish: true, customerVisible: true, title: true, number: true, assigneeId: true, version: true } });
  const deps = await db.dependency.findMany({ where: { projectId } });
  return { items: items.map((i) => ({ ...i, estimateHours: i.estimateHours == null ? null : Number(i.estimateHours), plannedStart: fmtDate(i.plannedStart), plannedFinish: fmtDate(i.plannedFinish) })), deps };
}

export async function projectCalendar(project, db = prisma) {
  return toWorkCalendar(await loadCalendar(db, project.calendarId, project.organizationId));
}

export async function projectProgress(projectId, db = prisma) {
  const { items } = await loadSchedule(projectId, db);
  return { r: rollup(items), items };
}
