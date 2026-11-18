// Loads a project's original (approved) plan and compares the current working plan against it.
import { prisma } from '../lib/prisma.js';
import { fmtDate } from '../lib/http.js';
import { compareToOriginal } from '../domain/variance.js';
import { projectCalendar } from './projectData.js';

export const todayISO = () => new Date().toISOString().slice(0, 10);

export async function originalBaseline(projectId, db = prisma) {
  return db.baseline.findFirst({ where: { projectId, kind: 'ORIGINAL' } });
}

export async function planVariance(project, { baselineId, db = prisma } = {}) {
  const bl = baselineId ? await db.baseline.findFirst({ where: { id: baselineId, projectId: project.id } }) : await originalBaseline(project.id, db);
  if (!bl) return null;
  const [baseItems, items, phases, cal] = await Promise.all([
    db.baselineItem.findMany({ where: { baselineId: bl.id } }),
    db.workItem.findMany({ where: { projectId: project.id }, select: { id: true, number: true, title: true, type: true, status: true, phaseId: true, parentId: true, assigneeId: true,
      plannedStart: true, plannedFinish: true, actualStart: true, actualFinish: true, percentComplete: true, estimateHours: true } }),
    db.phase.findMany({ where: { projectId: project.id }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }),
    projectCalendar(project, db),
  ]);
  const num = (v) => (v == null ? null : Number(v));
  const current = items.map((i) => ({ ...i, plannedStart: fmtDate(i.plannedStart), plannedFinish: fmtDate(i.plannedFinish), actualStart: fmtDate(i.actualStart), actualFinish: fmtDate(i.actualFinish), estimateHours: num(i.estimateHours) }));
  const original = baseItems.map((b) => ({ ...b, plannedStart: fmtDate(b.plannedStart), plannedFinish: fmtDate(b.plannedFinish), estimateHours: num(b.estimateHours) }));
  const result = compareToOriginal({ current, original, today: todayISO(), cal, phases });
  return { baseline: { id: bl.id, name: bl.name, kind: bl.kind, createdAt: bl.createdAt, createdById: bl.createdById, note: bl.note }, ...result };
}

/** Light summary for lists and dashboards. */
export async function scheduleSummary(project, db = prisma) {
  if (!project.planApprovedAt) return null;
  const v = await planVariance(project, { db });
  if (!v) return null;
  const { status, finishVariance, originalFinish, forecastFinish, plannedPct, actualPct, spi, counts } = v.summary;
  return { status, finishVariance, originalFinish, forecastFinish, plannedPct, actualPct, spi, delayed: (counts.DELAYED || 0) + (counts.OVERDUE || 0) };
}
