// Deploy-time step: loads demo data only when the database has no organizations AND ALLOW_DEMO_SEED=true.
// Uses DEMO_PASSWORD for every demo account (set a strong, private value on public deployments).
import '../src/lib/dbUrl.js';
import pg from 'pg';
import { spawn } from 'node:child_process';
if (process.env.ALLOW_DEMO_SEED !== 'true') { console.log('[seed] ALLOW_DEMO_SEED is not true; skipping'); process.exit(0); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const n = Number((await c.query('SELECT count(*) FROM "Organization"')).rows[0].count);
await c.end();
if (n > 0) { console.log('[seed] organizations exist; skipping demo data'); process.exit(0); }
const code = await new Promise((r) => spawn(process.execPath, ['prisma/seed-demo.js'], { stdio: 'inherit', env: process.env }).on('exit', r));
process.exit(code ?? 1);
