// Applies committed Prisma migrations with plain SQL (no Prisma engine download needed) and records them
// in _prisma_migrations exactly like `prisma migrate deploy`, so both tools stay interchangeable.
// CLI: DATABASE_URL=... node scripts/db-migrate.js
import '../src/lib/dbUrl.js';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const migDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

export async function applyMigrations(url, log = (m) => console.log(`[migrate] ${m}`)) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('SELECT pg_advisory_lock(72707369)'); // one migrator at a time
    await c.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
    const applied = new Set((await c.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows.map((r) => r.migration_name));
    const names = fs.readdirSync(migDir).filter((n) => fs.existsSync(path.join(migDir, n, 'migration.sql'))).sort();
    let count = 0; const done = [];
    for (const name of names) {
      if (applied.has(name)) continue;
      const sql = fs.readFileSync(path.join(migDir, name, 'migration.sql'));
      log(`applying ${name}`);
      await c.query('BEGIN');
      try {
        await c.query(sql.toString('utf8'));
        await c.query('INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)',
          [crypto.randomUUID(), crypto.createHash('sha256').update(sql).digest('hex'), name]);
        await c.query('COMMIT');
        count++; done.push(name);
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    }
    log(count ? `${count} migration(s) applied` : 'database is up to date');
    if (done.includes('20261119000000_auto_schedule')) {
      const { freeChainedTasks } = await import('./upgrade-schedule.js');
      await freeChainedTasks(c, log);
    }
    return count;
  } finally { await c.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }
  applyMigrations(process.env.DATABASE_URL).catch((e) => { console.error(e); process.exit(1); });
}
