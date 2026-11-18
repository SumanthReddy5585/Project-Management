// Deploy-time step: loads demo data only when the database has no organizations AND ALLOW_DEMO_SEED=true.
// Uses DEMO_PASSWORD for every demo account (set a strong, private value on public deployments).
import '../src/lib/dbUrl.js';
import pg from 'pg';
import { spawn } from 'node:child_process';
if (process.env.ALLOW_DEMO_SEED !== 'true') { console.log('[seed] ALLOW_DEMO_SEED is not true; skipping'); process.exit(0); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const n = Number((await c.query('SELECT count(*) FROM "Organization"')).rows[0].count);
// An older demo database (created before the support desk and extra projects) gets a one-time additive upgrade.
const needsUpgrade = n > 0 && Number((await c.query(`SELECT count(*) FROM "Organization" o WHERE o.slug = 'northwind'
  AND NOT EXISTS (SELECT 1 FROM "Project" p WHERE p."organizationId" = o.id AND p.code = 'FPP')`)).rows[0].count) > 0;
await c.end();
if (n > 0 && !needsUpgrade) { console.log('[seed] organizations exist; skipping demo data'); process.exit(0); }
const code = await new Promise((r) => spawn(process.execPath, ['prisma/seed-demo.js', ...(needsUpgrade ? ['--upgrade'] : [])], { stdio: 'inherit', env: process.env }).on('exit', r));
// A failed optional upgrade must never block the app from starting.
process.exit(needsUpgrade ? 0 : code ?? 1);
