// OPTIONAL demo data for local development. Refuses to run in production.
// Creates two organizations, invites users through the real API, and builds a project from a template.
// Usage: npm run seed:demo        (uses DATABASE_URL; requires an empty database or --force)
import { prisma } from '../src/lib/prisma.js';
import { config } from '../src/config.js';
import { hashPassword } from '../src/auth/passwords.js';
import { initializeOrganization } from '../src/services/orgSetup.js';
import { createApp } from '../src/app.js';
import { ApiClient } from '../scripts/api-client.js';

if (config.isProd && process.env.ALLOW_DEMO_SEED !== 'true') { console.error('Refusing to seed demo data in production (set ALLOW_DEMO_SEED=true to override).'); process.exit(1); }
if ((await prisma.organization.count()) && !process.argv.includes('--force')) { console.error('Database already has organizations. Re-run with --force to add demo orgs anyway.'); process.exit(1); }

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-pass-2026';
if (config.isProd && DEMO_PASSWORD === 'Demo-pass-2026') { console.error('Set DEMO_PASSWORD to a private value before seeding a public deployment.'); process.exit(1); }
const sfx = process.argv.includes('--force') ? `-${Date.now().toString(36)}` : '';
const mail = (u) => `${u}${sfx}@demo.local`;

async function bootstrapOrg(name, slug, adminEmail, adminName, tz) {
  const org = await prisma.organization.create({ data: { name, slug: slug + sfx, timezone: tz } });
  await prisma.$transaction((tx) => initializeOrganization(tx, org.id));
  await prisma.workingCalendar.updateMany({ where: { organizationId: org.id }, data: { timezone: tz } });
  const u = await prisma.user.create({ data: { email: adminEmail, name: adminName, passwordHash: await hashPassword(DEMO_PASSWORD), title: 'Operations Director' } });
  await prisma.membership.create({ data: { organizationId: org.id, userId: u.id, role: 'ADMIN' } });
  return org;
}

export async function seedDemo(base) {
  await bootstrapOrg('Northwind Delivery', 'northwind', mail('admin'), 'Asha Admin', 'Asia/Kolkata');
  await bootstrapOrg('Globex Consulting', 'globex', mail('globex.admin'), 'Gary Globex', 'UTC');
  const admin = new ApiClient(base); await admin.login(mail('admin'), DEMO_PASSWORD);
  const contoso = await admin.post('/api/org/customers', { name: 'Contoso Retail', domain: 'contoso.example' });
  const fabrikam = await admin.post('/api/org/customers', { name: 'Fabrikam Health', domain: 'fabrikam.example' });
  const people = [
    ['manager', 'Meera Manager', 'MANAGER', null, 'Senior Project Manager', ['planning', 'stakeholders']],
    ['dev1', 'Ravi Developer', 'EMPLOYEE', null, 'Full-stack Engineer', ['react', 'node']],
    ['dev2', 'Sara Analyst', 'EMPLOYEE', null, 'Business Analyst', ['requirements', 'uat']],
    ['qa', 'Omar Tester', 'EMPLOYEE', null, 'QA Engineer', ['testing']],
    ['customer', 'Carla Customer', 'CUSTOMER', contoso.id, null, []],
    ['fabrikam', 'Frank Fabrikam', 'CUSTOMER', fabrikam.id, null, []],
  ];
  const ids = {};
  for (const [u, name, role, customerCompanyId, title, skills] of people) {
    const inv = await admin.post('/api/org/invitations', { email: mail(u), name, role, ...(customerCompanyId && { customerCompanyId }) });
    const c = new ApiClient(base);
    const me = await c.post('/api/auth/invitations/accept', { token: new URL(inv.url).searchParams.get('token'), name, password: DEMO_PASSWORD });
    ids[u] = me.user.id;
    if (title) await admin.patch(`/api/org/members/${me.user.id}`, { title, skills });
  }
  await admin.post('/api/org/teams', { name: 'Delivery Team A', memberIds: [ids.manager, ids.dev1, ids.dev2, ids.qa] });
  const mgr = new ApiClient(base); await mgr.login(mail('manager'), DEMO_PASSWORD);
  const start = new Date(); start.setUTCDate(start.getUTCDate() - 21);
  const finish = new Date(start); finish.setUTCDate(finish.getUTCDate() + 120);
  const project = await mgr.post('/api/projects', {
    name: 'Contoso Store Modernization', code: 'CSM', description: 'Replace the legacy order portal with a modern web storefront.', objectives: 'Launch new storefront; reduce checkout drop-off by 20%.',
    customerCompanyId: contoso.id, customerContactIds: [ids.customer], managerId: ids.manager, teamMemberIds: [ids.dev1, ids.dev2, ids.qa],
    plannedStart: start.toISOString().slice(0, 10), plannedFinish: finish.toISOString().slice(0, 10), priority: 'HIGH', status: 'ACTIVE',
    budgetAmount: 120000, budgetCurrency: 'USD', billingEnabled: true, hourlyRate: 85, customerVisible: true,
  });
  const detail = await mgr.get(`/api/projects/${project.id}`);
  const phase = (n) => detail.phases.find((p) => p.name.startsWith(n)).id;
  const d = (off) => { const x = new Date(start); x.setUTCDate(x.getUTCDate() + off); while ([0, 6].includes(x.getUTCDay())) x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const mk = (b) => mgr.post(`/api/projects/${project.id}/work-items`, b);
  const req1 = await mk({ type: 'TASK', title: 'Stakeholder interviews', phaseId: phase('Requirements'), assigneeId: ids.dev2, plannedStart: d(7), plannedFinish: d(10), estimateHours: 16, customerVisible: true });
  const req2 = await mk({ type: 'TASK', title: 'Requirements specification', phaseId: phase('Requirements'), assigneeId: ids.dev2, plannedStart: d(11), plannedFinish: d(16), estimateHours: 24, customerVisible: true, acceptanceCriteria: 'Signed off by Contoso product owner' });
  const mod = await mk({ type: 'MODULE', title: 'Checkout module', phaseId: phase('Development'), assigneeId: ids.dev1, customerVisible: true });
  const t1 = await mk({ type: 'TASK', title: 'Cart service API', parentId: mod.id, assigneeId: ids.dev1, plannedStart: d(40), plannedFinish: d(46), estimateHours: 40 });
  const t2 = await mk({ type: 'TASK', title: 'Payment gateway integration', parentId: mod.id, assigneeId: ids.dev1, plannedStart: d(47), plannedFinish: d(54), estimateHours: 48, labels: ['integration'] });
  await mk({ type: 'SUBTASK', title: 'Sandbox credentials', parentId: t2.id, assigneeId: ids.dev1, estimateHours: 2 });
  const t3 = await mk({ type: 'TASK', title: 'Checkout regression suite', phaseId: phase('Testing'), assigneeId: ids.qa, plannedStart: d(80), plannedFinish: d(86), estimateHours: 30 });
  for (const [p, s] of [[req1, req2], [t1, t2], [t2, t3]]) await mgr.post(`/api/projects/${project.id}/dependencies`, { predecessorId: p.id, successorId: s.id });
  await mgr.post(`/api/projects/${project.id}/baselines`, { name: 'Initial plan' });
  const dev = new ApiClient(base); await dev.login(mail('dev2'), DEMO_PASSWORD);
  const r1 = await dev.get(`/api/projects/${project.id}/work-items/${req1.id}`);
  await dev.patch(`/api/projects/${project.id}/work-items/${req1.id}`, { status: 'DONE', version: r1.version });
  const r2 = await dev.get(`/api/projects/${project.id}/work-items/${req2.id}`);
  await dev.patch(`/api/projects/${project.id}/work-items/${req2.id}`, { percentComplete: 40, version: r2.version });
  await dev.post('/api/comments', { targetType: 'workItem', targetId: req2.id, body: `Draft shared internally — @[Meera Manager](${ids.manager}) please review before we send it.`, visibility: 'INTERNAL' });
  const today = new Date().toISOString().slice(0, 10);
  await dev.post('/api/time/entries', { projectId: project.id, workItemId: req2.id, date: today, hours: 6, billable: true, note: 'Spec drafting' });
  await mgr.post(`/api/projects/${project.id}/updates`, { title: 'Discovery on track', body: 'Interviews complete; specification drafting under way.', health: 'GREEN', customerVisible: true });
  const cust = new ApiClient(base); await cust.login(mail('customer'), DEMO_PASSWORD);
  const t = await cust.post('/api/tickets', { subject: 'Cannot export last month\'s orders', description: 'The export button on the legacy portal times out.', type: 'BUG', priority: 'HIGH', projectId: project.id });
  const tk = await mgr.get(`/api/tickets/${t.id}`);
  await mgr.patch(`/api/tickets/${t.id}`, { assigneeId: ids.dev1, version: tk.version });
  await mgr.post(`/api/tickets/${t.id}/messages`, { body: 'Thanks Carla — we are looking into it today.', visibility: 'PUBLIC' });
  await mgr.post(`/api/tickets/${t.id}/messages`, { body: 'Likely the report query; legacy DB has no index on order_date.', visibility: 'INTERNAL' });
  return { project, ids };
}

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
try {
  await seedDemo(base);
  console.log(`Demo data created. Sign in with any of these${config.isProd ? ' (password: the DEMO_PASSWORD you configured)' : ` (password: ${DEMO_PASSWORD})`}:`);
  for (const u of ['admin', 'manager', 'dev1', 'dev2', 'qa', 'customer', 'fabrikam', 'globex.admin']) console.log('  ' + mail(u));
} catch (e) { console.error('Seed failed:', e.message, JSON.stringify(e.data ?? {})); process.exitCode = 1; }
finally { server.close(); await prisma.$disconnect(); }
