import { execFileSync } from 'node:child_process';
import { prisma } from '../../src/lib/prisma.js';
import { createApp } from '../../src/app.js';
import { ApiClient } from '../../scripts/api-client.js';
import { hashPassword } from '../../src/auth/passwords.js';
import { initializeOrganization } from '../../src/services/orgSetup.js';

export const PW = 'Test-pass-2026';
/** Truncate every table in the TEST database (setup-env.js guarantees the _test suffix). */
export async function resetDb() {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.pathname.endsWith('_test')) throw new Error('not a test database');
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

export async function startServer() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

export async function makeOrg(name, slug) {
  const org = await prisma.organization.create({ data: { name, slug } });
  await prisma.$transaction((tx) => initializeOrganization(tx, org.id));
  const email = `admin@${slug}.test`;
  const u = await prisma.user.create({ data: { email, name: `${name} Admin`, passwordHash: await hashPassword(PW) } });
  await prisma.membership.create({ data: { organizationId: org.id, userId: u.id, role: 'ADMIN' } });
  return { org, adminEmail: email, adminId: u.id };
}

/** Invite + accept through the API; returns a logged-in client. */
export async function invite(base, adminClient, { email, name, role, customerCompanyId }) {
  const inv = await adminClient.post('/api/org/invitations', { email, name, role, ...(customerCompanyId && { customerCompanyId }) });
  const c = new ApiClient(base);
  const me = await c.post('/api/auth/invitations/accept', { token: new URL(inv.url).searchParams.get('token'), name, password: PW });
  c.userId = me.user.id;
  return c;
}

export async function login(base, email) { const c = new ApiClient(base); const me = await c.login(email, PW); c.userId = me.user.id; return c; }
export const expectStatus = async (p, status) => { try { await p; } catch (e) { if (e.status === status) return e.data; throw new Error(`expected ${status}, got ${e.status}: ${e.message}`); } throw new Error(`expected ${status}, got 2xx`); };
export { prisma };
