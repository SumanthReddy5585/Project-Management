// In-process background jobs. Each run takes a Postgres advisory lock so that when several
// backend instances run, only one executes a given job at a time. No extra infrastructure.
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { storage } from '../storage/index.js';
import { notify } from '../services/notify.js';
import { slaContext } from '../routes/tickets.js';
import { slaStatus } from '../domain/sla.js';
import { sendMail } from '../services/mail.js';
import { config } from '../config.js';

const JOBS = [];
const timers = [];
export function defineJob(name, everyMs, fn) { JOBS.push({ name, everyMs, fn, lock: hash(name) }); }
const hash = (s) => [...s].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 7);

async function runJob(job) {
  const started = Date.now();
  try {
    await prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${job.lock}) AS locked`;
      if (!locked) return;
      const result = await job.fn(tx);
      logger.info({ job: job.name, ms: Date.now() - started, result }, 'job finished');
    }, { timeout: 120000 });
  } catch (err) { logger.error({ err, job: job.name }, 'job failed'); }
}

export function startJobs() {
  for (const j of JOBS) { timers.push(setTimeout(() => runJob(j), 5000)); timers.push(setInterval(() => runJob(j), j.everyMs)); }
}
export function stopJobs() { for (const t of timers) { clearTimeout(t); clearInterval(t); } }
export const runAllOnce = async () => { for (const j of JOBS) await runJob(j); };

// SLA: notify assignee (or service desk) once per ticket per state when a clock becomes at-risk or breached.
defineJob('sla-evaluation', 5 * 60000, async (tx) => {
  const open = await tx.ticket.findMany({ where: { status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] } }, take: 5000 });
  let sent = 0; const ctx = {};
  for (const t of open) {
    const k = `${t.organizationId}:${t.priority}`;
    ctx[k] ??= await slaContext(t.organizationId, t.priority, tx);
    const s = slaStatus(t, ctx[k].policy, new Date(), ctx[k].cal);
    for (const [clock, st] of Object.entries(s)) {
      if (!['AT_RISK', 'BREACHED'].includes(st.state)) continue;
      const to = t.assigneeId ? [t.assigneeId] : (await tx.membership.findMany({ where: { organizationId: t.organizationId, role: { in: ['ADMIN', 'MANAGER'] }, status: 'ACTIVE' } })).map((m) => m.userId);
      sent += await notify(tx, { orgId: t.organizationId, userIds: to, type: `sla.${st.state.toLowerCase()}`, title: `Ticket #${t.number} ${clock} SLA ${st.state === 'BREACHED' ? 'breached' : 'at risk'}`, link: `/tickets/${t.id}`, dedupeKey: `sla:${t.id}:${clock}:${st.state}:${t.reopenCount}` });
    }
  }
  return { checked: open.length, sent };
});

// Reminders: tasks due tomorrow, once per task per due date.
defineJob('due-reminders', 60 * 60000, async (tx) => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const due = await tx.workItem.findMany({ where: { plannedFinish: new Date(`${tomorrow}T00:00:00Z`), status: { notIn: ['DONE', 'CANCELLED'] }, assigneeId: { not: null }, project: { status: 'ACTIVE' } }, include: { project: true } });
  let sent = 0;
  for (const i of due) sent += await notify(tx, { orgId: i.project.organizationId, userIds: [i.assigneeId], type: 'work_item.due', title: `Due tomorrow: ${i.project.code}-${i.number} ${i.title}`, link: `/projects/${i.projectId}/work/${i.id}`, dedupeKey: `due:${i.id}:${tomorrow}` });
  return { sent };
});

// Housekeeping: expired sessions/tokens; storage orphans (bytes without rows) and soft-deleted files past retention.
defineJob('cleanup', 6 * 3600000, async (tx) => {
  const now = new Date();
  const sessions = await tx.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const resets = await tx.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date(now - 7 * 86400000) } } });
  const purge = await tx.fileObject.findMany({ where: { deletedAt: { lt: new Date(now - 7 * 86400000) } }, take: 1000 });
  for (const f of purge) { await storage.remove(f.storageKey); await tx.fileObject.delete({ where: { id: f.id } }); }
  let orphans = 0; let missing = 0;
  const keys = new Set((await tx.fileObject.findMany({ select: { storageKey: true } })).map((f) => f.storageKey));
  for await (const obj of storage.list()) {
    if (!keys.has(obj.key) && obj.mtime < new Date(now - 3600000)) { await storage.remove(obj.key); orphans++; }
  }
  for (const k of keys) if (!(await storage.stat(k))) missing++;
  if (missing) logger.warn({ missing }, 'file rows reference missing storage objects');
  return { sessions: sessions.count, resets: resets.count, purged: purge.length, orphans, missing };
});

// Email copies of notifications (only when SMTP is configured). Sent at most once; failures are recorded.
defineJob('notification-email', 60000, async (tx) => {
  if (!config.emailConfigured) return { skipped: true };
  const rows = await tx.notification.findMany({ where: { emailStatus: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 40 });
  if (!rows.length) return { sent: 0 };
  const users = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((n) => n.userId))] } }, select: { id: true, email: true, name: true } })).map((u) => [u.id, u]));
  let sent = 0;
  for (const n of rows) {
    const u = users.get(n.userId);
    const link = n.link ? `${config.APP_ORIGIN}${n.link.replace(/\/work\/([0-9a-f-]{36})$/, '/tasks?item=$1')}` : config.APP_ORIGIN;
    const r = u ? await sendMail({ to: u.email, subject: n.title, heading: n.title, body: n.body || '', cta: 'Open in O2 Support Hub', url: link }) : { sent: false };
    await tx.notification.update({ where: { id: n.id }, data: { emailStatus: r.sent ? 'SENT' : 'FAILED' } });
    if (r.sent) sent++;
  }
  return { sent, total: rows.length };
});
