// One-command local run: bundled PostgreSQL (embedded-postgres, no install), migrations,
// demo data on first run, API + web app on one address, browser opens automatically.
// Usage: node scripts/run-local.js   (or double-click START-WINDOWS.bat / run ./start.sh)
// Data lives in backend/.local (database) and backend/uploads (files). Delete .local to start fresh.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from './db-migrate.js';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.resolve(backend, '..', 'frontend', 'dist');
const localDir = path.join(backend, '.local');
const dataDir = path.join(localDir, 'pgdata');
const secretFile = path.join(localDir, 'secret.json');
const APP_PORT = Number(process.env.PORT || 4000);
const say = (m) => console.log(`[meridian] ${m}`);
const fail = (m) => { console.error(`\n[meridian] ERROR: ${m}\n`); process.exit(1); };

const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
  s.listen(port, '127.0.0.1');
});

if (!fs.existsSync(path.join(webDir, 'index.html'))) fail(`Built web app not found at ${webDir}. Run "npm ci && npm run build" in the frontend folder.`);
if (!(await portFree(APP_PORT))) fail(`Port ${APP_PORT} is already in use. Close the other program or set PORT, e.g. "set PORT=4100" (Windows) / "PORT=4100 ./start.sh".`);

fs.mkdirSync(localDir, { recursive: true });
const secret = fs.existsSync(secretFile) ? JSON.parse(fs.readFileSync(secretFile, 'utf8')) : { password: crypto.randomBytes(18).toString('base64url') };
fs.writeFileSync(secretFile, JSON.stringify(secret));
let dbPort = 5433;
while (!(await portFree(dbPort))) dbPort++;

const db = new EmbeddedPostgres({
  databaseDir: dataDir, user: 'meridian', password: secret.password, port: dbPort, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--no-locale'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  onLog: () => {}, onError: (e) => process.env.DEBUG && console.error(String(e)),
});

const firstRun = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
try {
  if (firstRun) { say('First run: creating the local database (one time, ~20 s)…'); await db.initialise(); }
  say('Starting database…');
  await db.start();
} catch (e) {
  fail(`The bundled database could not start: ${e.message || e}\nIf you are running this window "as administrator", run it normally instead. To start over, delete the folder ${localDir}`);
}
const url = `postgresql://meridian:${encodeURIComponent(secret.password)}@127.0.0.1:${dbPort}/meridian`;
let api;
const stop = async (code = 0) => {
  if (api && !api.killed) api.kill();
  try { await db.stop(); } catch { /* already stopped */ }
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// Create the database and apply committed migrations, recording them the way Prisma does,
// so `prisma migrate deploy` stays compatible with this database later.
const admin = new pg.Client({ connectionString: url.replace(/\/meridian$/, '/postgres') });
await admin.connect();
if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'meridian'")).rowCount) await admin.query('CREATE DATABASE meridian');
await admin.end();
try { await applyMigrations(url, say); } catch (e) { console.error(e); await stop(1); }
const c = new pg.Client({ connectionString: url });
await c.connect();
const orgs = Number((await c.query('SELECT count(*) FROM "Organization"')).rows[0].count);
await c.end();

const env = {
  ...process.env, NODE_ENV: 'development', DATABASE_URL: url, PORT: String(APP_PORT),
  APP_ORIGIN: `http://localhost:${APP_PORT}`, CORS_ORIGINS: `http://localhost:${APP_PORT},http://127.0.0.1:${APP_PORT}`,
  COOKIE_SECURE: 'false', UPLOAD_DIR: path.join(backend, 'uploads'), SERVE_WEB_DIR: webDir, LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
};
const run = (args) => new Promise((resolve) => spawn(process.execPath, args, { cwd: backend, env, stdio: 'inherit' }).on('exit', resolve));

if (orgs === 0 && process.env.SKIP_DEMO !== '1') {
  say('Loading demo data (first run)…');
  if ((await run(['prisma/seed-demo.js'])) !== 0) { console.error('[meridian] Demo data failed to load.'); await stop(1); }
}

api = spawn(process.execPath, ['src/server.js'], { cwd: backend, env, stdio: 'inherit' });
api.on('exit', (code) => { if (code) console.error(`[meridian] The app stopped (exit code ${code}).`); stop(code || 0); });

const appUrl = `http://localhost:${APP_PORT}`;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${appUrl}/ready`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`\n  Meridian is running at ${appUrl}\n\n  Demo sign-in (password Demo-pass-2026):\n    admin@demo.local · manager@demo.local · dev1@demo.local · customer@demo.local\n\n  Keep this window open while you use the app. Press Ctrl+C to stop.\n`);
if (process.env.NO_BROWSER !== '1') {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', appUrl]] : process.platform === 'darwin' ? ['open', [appUrl]] : ['xdg-open', [appUrl]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* open manually */ }
}
