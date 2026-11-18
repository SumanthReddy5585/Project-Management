// Runs the automatic scheduler for one project and saves the result (see domain/autoSchedule.js).
// Called after every change that can move dates: tasks added/changed/removed, links added/removed,
// the project start moved, and once a day for active projects (overdue work pushes what waits for it).
import { prisma } from '../lib/prisma.js';
import { fmtDate, toDate } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { autoSchedule, ScheduleCycleError } from '../domain/autoSchedule.js';
import { projectCalendar } from './projectData.js';

const todayKey = () => new Date().toISOString().slice(0, 10);

async function run(tx, projectId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project || ['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(project.status)) return { moved: [], project };
  const [rows, deps, cal] = await Promise.all([
    tx.workItem.findMany({ where: { projectId }, select: { id: true, parentId: true, type: true, status: true, number: true, title: true, plannedStart: true, plannedFinish: true, actualStart: true, actualFinish: true, startConstraint: true } }),
    tx.dependency.findMany({ where: { projectId } }),
    projectCalendar(project, tx),
  ]);
  const items = rows.map((i) => ({ ...i, plannedStart: fmtDate(i.plannedStart), plannedFinish: fmtDate(i.plannedFinish), actualStart: fmtDate(i.actualStart), actualFinish: fmtDate(i.actualFinish), startConstraint: fmtDate(i.startConstraint) }));
  const out = autoSchedule({ items, deps, projectStart: fmtDate(project.plannedStart), today: todayKey(), useToday: project.status === 'ACTIVE', cal });
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const c of out.changes) await tx.workItem.update({ where: { id: c.id }, data: { plannedStart: toDate(c.to.start), plannedFinish: toDate(c.to.finish), version: { increment: 1 } } });
  // Until the plan is approved the project's end date is simply the end of its last task.
  let projectFinish = null;
  if (!project.planApprovedAt && out.finish && out.finish >= fmtDate(project.plannedStart) && out.finish !== fmtDate(project.plannedFinish)) {
    await tx.project.update({ where: { id: projectId }, data: { plannedFinish: toDate(out.finish), version: { increment: 1 } } });
    projectFinish = { from: fmtDate(project.plannedFinish), to: out.finish };
  }
  return {
    project, projectFinish,
    moved: out.changes.map((c) => ({ id: c.id, number: byId.get(c.id).number, title: byId.get(c.id).title, type: byId.get(c.id).type, from: c.from, to: c.to })),
  };
}

/**
 * Recalculate and save the working plan of a project. Never throws for a circular plan (it reports it).
 * @returns {Promise<{moved: Array, projectFinish: {from,to}|null, cycle?: string}>}
 */
export async function reschedule(projectId, db = null) {
  if (process.env.AUTO_SCHEDULE === 'off') return { moved: [], projectFinish: null }; // bulk loaders (demo seed) finish with one pass
  try {
    const r = db ? await run(db, projectId) : await prisma.$transaction((tx) => run(tx, projectId), { timeout: 60000 });
    return { moved: r.moved, projectFinish: r.projectFinish ?? null };
  } catch (err) {
    if (err instanceof ScheduleCycleError) return { moved: [], projectFinish: null, cycle: err.message };
    logger.error({ err, projectId }, 'reschedule failed');
    throw err;
  }
}

/** Daily: move work that waits for overdue tasks in every active project. */
export async function rescheduleActiveProjects(db = prisma) {
  const projects = await db.project.findMany({ where: { status: { in: ['ACTIVE', 'DRAFT'] } }, select: { id: true, organizationId: true } });
  let moved = 0; const touched = [];
  for (const p of projects) {
    const r = await reschedule(p.id);
    if (r.moved.length || r.projectFinish) { moved += r.moved.length; touched.push(p); }
  }
  return { projects: projects.length, moved, touched };
}
