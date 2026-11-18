// One-time step after the 20261119000000_auto_schedule migration (run by db-migrate.js).
// The migration fixed the start of every existing item so no plan moves. Tasks that already start right
// after the task(s) they wait for are then freed, so from now on they follow their predecessors
// automatically. Tasks that start later than needed keep their fixed start.
import { makeCalendar, toKey } from '../src/domain/calendar.js';
import { earliestStartAfter } from '../src/domain/dependencies.js';

export async function freeChainedTasks(c, log = () => {}) {
  const k = (d) => (d ? toKey(d) : null);
  const cals = new Map();
  for (const r of (await c.query('SELECT id, "organizationId", "workDays", "isDefault" FROM "WorkingCalendar"')).rows) cals.set(r.id, { ...r, holidays: [] });
  for (const h of (await c.query('SELECT "calendarId", date FROM "Holiday"')).rows) cals.get(h.calendarId)?.holidays.push(k(h.date));
  const projects = (await c.query('SELECT id, "organizationId", "calendarId" FROM "Project"')).rows;
  let freed = 0;
  for (const p of projects) {
    const row = (p.calendarId && cals.get(p.calendarId)) || [...cals.values()].find((x) => x.organizationId === p.organizationId && x.isDefault);
    const cal = makeCalendar({ workDays: row?.workDays ?? [1, 2, 3, 4, 5], holidays: row?.holidays ?? [] });
    const items = new Map((await c.query('SELECT id, "plannedStart", "plannedFinish", "actualFinish", status, "startConstraint" FROM "WorkItem" WHERE "projectId" = $1', [p.id])).rows.map((r) => [r.id, r]));
    const preds = new Map();
    for (const d of (await c.query(`SELECT "predecessorId", "successorId", "lagDays" FROM "Dependency" WHERE "projectId" = $1 AND type = 'FS'`, [p.id])).rows) {
      preds.set(d.successorId, [...(preds.get(d.successorId) || []), d]);
    }
    const ids = [];
    for (const [sid, ds] of preds) {
      const s = items.get(sid);
      if (!s?.startConstraint || !s.plannedStart) continue;
      const earliest = ds.map((d) => { const pr = items.get(d.predecessorId); const f = pr && pr.status !== 'CANCELLED' && k(pr.status === 'DONE' ? pr.actualFinish || pr.plannedFinish : pr.plannedFinish); return f ? earliestStartAfter(f, d.lagDays || 0, cal) : null; })
        .filter(Boolean).sort().at(-1);
      if (earliest && k(s.plannedStart) <= earliest) ids.push(sid);
    }
    if (ids.length) { await c.query('UPDATE "WorkItem" SET "startConstraint" = NULL WHERE id = ANY($1::uuid[])', [ids]); freed += ids.length; }
  }
  log(`auto-schedule: ${freed} linked task(s) now follow their predecessors automatically`);
  return freed;
}
