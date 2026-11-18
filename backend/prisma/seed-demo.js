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
const UPGRADE = process.argv.includes('--upgrade');
if ((await prisma.organization.count()) && !process.argv.includes('--force') && !UPGRADE) { console.error('Database already has organizations. Re-run with --force to add demo orgs anyway.'); process.exit(1); }

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

async function ensurePeople(base, admin, contoso, fabrikam) {
  const people = [
    ['manager', 'Meera Manager', 'MANAGER', null, 'Senior Project Manager', 'Project Management', ['planning', 'stakeholders']],
    ['pm2', 'Daniel Brooks', 'MANAGER', null, 'Delivery Manager', 'Project Management', ['agile', 'budgeting']],
    ['dev1', 'Ravi Developer', 'EMPLOYEE', null, 'Full-stack Engineer', 'Engineering', ['react', 'node']],
    ['dev2', 'Sara Analyst', 'EMPLOYEE', null, 'Business Analyst', 'Business Analysis', ['requirements', 'uat']],
    ['qa', 'Omar Tester', 'EMPLOYEE', null, 'QA Engineer', 'Quality Assurance', ['testing', 'automation']],
    ['design', 'Priya Designer', 'EMPLOYEE', null, 'UI/UX Designer', 'Design', ['figma', 'research']],
    ['ops', 'Karan Ops', 'EMPLOYEE', null, 'DevOps Engineer', 'Engineering', ['aws', 'ci/cd']],
    ['customer', 'Carla Customer', 'CUSTOMER', contoso.id, null, null, []],
    ['fabrikam', 'Frank Fabrikam', 'CUSTOMER', fabrikam.id, null, null, []],
  ];
  const ids = {};
  const existing = new Map((await admin.get('/api/org/members?pageSize=200')).data.map((m) => [m.email, m.userId]));
  for (const [u, name, role, customerCompanyId, title, department, skills] of people) {
    if (existing.has(mail(u))) {
      ids[u] = existing.get(mail(u));
      if (title) await admin.patch(`/api/org/members/${ids[u]}`, { title, department, skills });
      continue;
    }
    const inv = await admin.post('/api/org/invitations', { email: mail(u), name, role, ...(customerCompanyId && { customerCompanyId }), ...(title && { title, department }) });
    const c = new ApiClient(base);
    const me = await c.post('/api/auth/invitations/accept', { token: new URL(inv.url).searchParams.get('token'), name, password: DEMO_PASSWORD });
    ids[u] = me.user.id;
    if (title) await admin.patch(`/api/org/members/${me.user.id}`, { title, department, skills, employeeId: `O2-${100 + Object.keys(ids).length}` });
  }
  return ids;
}

export async function seedDemo(base) {
  await bootstrapOrg('O2 Digital Services', 'o2', mail('admin'), 'Asha Admin', 'Asia/Kolkata');
  await bootstrapOrg('Globex Consulting', 'globex', mail('globex.admin'), 'Gary Globex', 'UTC');
  const admin = new ApiClient(base); await admin.login(mail('admin'), DEMO_PASSWORD);
  const contoso = await admin.post('/api/org/customers', { name: 'Contoso Retail', domain: 'contoso.example' });
  const fabrikam = await admin.post('/api/org/customers', { name: 'Fabrikam Health', domain: 'fabrikam.example' });
  const ids = await ensurePeople(base, admin, contoso, fabrikam);
  const adminMe = await admin.get('/api/auth/me');
  await admin.patch(`/api/org/members/${adminMe.user.id}`, { title: 'Operations Director', department: 'Operations', employeeId: 'O2-100' });
  await admin.post('/api/org/teams', { name: 'Delivery Team A', memberIds: [ids.manager, ids.dev1, ids.dev2, ids.qa] });
  const mgr = new ApiClient(base); await mgr.login(mail('manager'), DEMO_PASSWORD);
  const start = new Date(); start.setUTCDate(start.getUTCDate() - 21);
  const finish = new Date(start); finish.setUTCDate(finish.getUTCDate() + 120);
  const project = await mgr.post('/api/projects', {
    name: 'Contoso Store Modernization', code: 'CSM', description: 'Replace the legacy order portal with a modern web storefront.', objectives: 'Launch new storefront; reduce checkout drop-off by 20%.',
    customerCompanyId: contoso.id, customerContactIds: [ids.customer], managerId: ids.manager,
    team: [{ userId: ids.dev1, role: 'MEMBER', allocationPct: 100 }, { userId: ids.dev2, role: 'MEMBER', allocationPct: 50 }, { userId: ids.qa, role: 'MEMBER', allocationPct: 50 }, { userId: ids.design, role: 'MEMBER', allocationPct: 50 }],
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
  await seedMoreProjects(base, { mgr, ids, fabrikam });
  await seedSupportDesk(base, { mgr, cust, ids, project });
  return { project, ids };
}

// Two more projects so the portfolio, capacity and timeline views have something to show.
async function seedMoreProjects(base, { mgr, ids, fabrikam }) {
  const pm2 = new ApiClient(base); await pm2.login(mail('pm2'), DEMO_PASSWORD);
  const day = (off) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + off); while ([0, 6].includes(x.getUTCDay())) x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const make = async (client, body, tasks, health) => {
    const p = await client.post('/api/projects', body);
    const det = await client.get(`/api/projects/${p.id}`);
    for (const [title, phaseIdx, who, s, f, est, status] of tasks) {
      const t = await client.post(`/api/projects/${p.id}/work-items`, { type: 'TASK', title, phaseId: det.phases[Math.min(phaseIdx, det.phases.length - 1)].id, assigneeId: ids[who], plannedStart: day(s), plannedFinish: day(f), estimateHours: est });
      if (status) { const cur = await client.get(`/api/projects/${p.id}/work-items/${t.id}`); await client.patch(`/api/projects/${p.id}/work-items/${t.id}`, { status, version: cur.version }); }
    }
    if (health) { const cur = await client.get(`/api/projects/${p.id}`); await client.patch(`/api/projects/${p.id}`, { health, version: cur.version }); }
    return p;
  };
  await make(pm2, { name: 'Fabrikam Patient Portal', code: 'FPP', description: 'Self-service portal for Fabrikam patients: appointments, results and billing.', objectives: 'Go live before the end of Q1 with 3 core journeys.',
    customerCompanyId: fabrikam.id, customerContactIds: [ids.fabrikam], managerId: ids.pm2, plannedStart: day(-30), plannedFinish: day(75), status: 'ACTIVE', priority: 'HIGH', customerVisible: true,
    budgetAmount: 80000, budgetCurrency: 'USD', billingEnabled: true, hourlyRate: 90,
    team: [{ userId: ids.dev1, role: 'MEMBER', allocationPct: 50 }, { userId: ids.design, role: 'MEMBER', allocationPct: 50 }, { userId: ids.ops, role: 'MEMBER', allocationPct: 50 }, { userId: ids.qa, role: 'MEMBER', allocationPct: 50 }] }, [
    ['Patient journey workshops', 1, 'design', -28, -20, 16, 'DONE'], ['Wireframes for appointments', 2, 'design', -19, -8, 24, 'DONE'],
    ['Auth with hospital SSO', 3, 'dev1', -10, 6, 40, 'IN_PROGRESS'], ['Appointments API', 3, 'dev1', 2, 14, 48], ['CI/CD pipeline and staging', 3, 'ops', -12, -2, 20, 'IN_PROGRESS'],
    ['Accessibility audit', 4, 'qa', 20, 26, 16], ['Results viewer UI', 3, 'design', -5, 4, 24],
  ], 'AMBER');
  await make(mgr, { name: 'HR System Upgrade', code: 'HRU', description: 'Upgrade the internal HR system and migrate leave records.', objectives: 'Zero data loss; staff self-service for leave.',
    managerId: ids.manager, plannedStart: day(-10), plannedFinish: day(50), status: 'ACTIVE', priority: 'MEDIUM',
    team: [{ userId: ids.dev2, role: 'MEMBER', allocationPct: 50 }, { userId: ids.ops, role: 'MEMBER', allocationPct: 50 }] }, [
    ['Current-state process mapping', 1, 'dev2', -9, -4, 12, 'DONE'], ['Data migration plan', 2, 'dev2', -3, 3, 16, 'IN_PROGRESS'], ['Provision new servers', 3, 'ops', 4, 9, 12], ['UAT with HR team', 4, 'dev2', 30, 36, 20],
  ]);
}

// A realistic support queue: a mix of ages, priorities, owners and outcomes, plus canned replies and help articles.
async function seedSupportDesk(base, { mgr, cust, ids, project }) {
  const fab = new ApiClient(base); await fab.login(mail('fabrikam'), DEMO_PASSWORD);
  const H = 3600000;
  const shift = async (id, hours, extra = {}) => {
    const t = await prisma.ticket.findUnique({ where: { id } });
    const back = (d) => (d ? new Date(d.getTime() - hours * H) : d);
    const created = back(t.createdAt);
    const firstResponseAt = t.firstResponseAt ? new Date(created.getTime() + Math.min(hours * 0.15, 5) * H + 7 * 60000) : null;
    await prisma.ticket.update({ where: { id }, data: { createdAt: created, responseDueAt: back(t.responseDueAt), resolutionDueAt: back(t.resolutionDueAt), firstResponseAt, ...extra(t) } });
    await prisma.comment.updateMany({ where: { ticketId: id }, data: { createdAt: new Date(Date.now() - (hours - 0.5) * H) } });
  };
  const rows = [
    [cust, 'Checkout page shows a blank screen on Safari', 'Customers on iPhone report the payment step goes blank after entering the card number.', 'BUG', 'CRITICAL', 'Defect', ['safari', 'checkout'], 'dev1', 'IN_PROGRESS', 30],
    [cust, 'Need two more admin accounts for the store team', 'Please add accounts for Priya and Tom in the merchandising team.', 'SERVICE_REQUEST', 'MEDIUM', 'Access & accounts', ['access'], null, 'NEW', 3],
    [fab, 'Patient portal login loop after password change', 'After changing my password I keep getting sent back to the login page.', 'BUG', 'HIGH', 'Access & accounts', ['login'], 'dev2', 'OPEN', 20],
    [fab, 'Invoice for October shows the wrong VAT rate', 'The October invoice was charged at 20% instead of 5% for medical supplies.', 'QUESTION', 'MEDIUM', 'Billing', ['billing'], 'manager', 'WAITING_ON_CUSTOMER', 50],
    [cust, 'Add a "Reorder" button to past orders', 'It would save our customers time if they could repeat an order in one click.', 'CHANGE_REQUEST', 'LOW', 'Enhancement', ['feature-request'], null, 'NEW', 6],
    [cust, 'Product images load slowly on category pages', 'Category pages take 6-8 seconds to show product photos on mobile data.', 'BUG', 'HIGH', 'Defect', ['performance'], 'qa', 'OPEN', 70],
    [fab, 'How do I export appointment reports?', 'Where can I download last quarter\'s appointment report as a spreadsheet?', 'QUESTION', 'LOW', 'General', [], 'dev2', 'RESOLVED', 96, 5, 'Quick and clear answer, thank you!'],
    [cust, 'Discount code SUMMER25 not applying', 'The code is accepted but the total does not change.', 'BUG', 'HIGH', 'Defect', ['promotions'], 'dev1', 'RESOLVED', 140, 4, 'Fixed fast, but we lost a few orders first.'],
    [cust, 'Password reset email never arrives', 'Two of our staff did not receive the reset email.', 'BUG', 'MEDIUM', 'Access & accounts', ['email'], 'qa', 'CLOSED', 220, 5, null],
    [fab, 'Request: monthly uptime report', 'Our compliance team needs a monthly availability report.', 'SERVICE_REQUEST', 'MEDIUM', 'General', ['reporting'], 'manager', 'IN_PROGRESS', 12],
    [cust, 'Search returns out-of-stock items first', 'Searching "chair" shows sold-out items at the top of the results.', 'BUG', 'MEDIUM', 'Defect', ['search'], null, 'OPEN', 9],
    [fab, 'SSL certificate warning on staging site', 'Our testers see a certificate warning on the staging URL.', 'BUG', 'CRITICAL', 'Defect', ['security'], 'dev1', 'RESOLVED', 30, 3, 'Took longer than expected.'],
  ];
  const agents = await prisma.user.findMany({ where: { id: { in: Object.values(ids) } }, select: { id: true } });
  for (const [client, subject, description, type, priority, category, tags, who, status, ageH, rating, comment] of rows) {
    const t = await client.post('/api/tickets', { subject, description, type, priority, category, ...(client === cust && subject.length % 2 === 0 && { projectId: project.id }) });
    let cur = await mgr.get(`/api/tickets/${t.id}`);
    if (who) cur = { ...cur, ...(await mgr.patch(`/api/tickets/${t.id}`, { assigneeId: ids[who], tags, version: cur.version })) };
    else cur = { ...cur, ...(await mgr.patch(`/api/tickets/${t.id}`, { tags, version: cur.version })) };
    if (status !== 'NEW') {
      await mgr.post(`/api/tickets/${t.id}/messages`, { body: `Hi, thanks for reporting this. ${who ? 'I\'ve picked it up and' : 'We'} will update you shortly.`, visibility: 'PUBLIC' });
      const walk = { OPEN: [], IN_PROGRESS: ['IN_PROGRESS'], WAITING_ON_CUSTOMER: ['WAITING_ON_CUSTOMER'], RESOLVED: ['IN_PROGRESS', 'RESOLVED'], CLOSED: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'] }[status];
      for (const st of walk) { const x = await mgr.get(`/api/tickets/${t.id}`); await mgr.post(`/api/tickets/${t.id}/status`, { status: st, version: x.version }); }
      if (status === 'WAITING_ON_CUSTOMER') await mgr.post(`/api/tickets/${t.id}/messages`, { body: 'Could you send us the invoice number so we can correct it?', visibility: 'PUBLIC' });
      if (['RESOLVED', 'CLOSED'].includes(status)) await mgr.post(`/api/tickets/${t.id}/messages`, { body: 'Root cause found and fixed in today\'s release.', visibility: 'INTERNAL' }).catch(() => {});
    }
    if (rating) await client.post(`/api/tickets/${t.id}/csat`, { rating, comment });
    await shift(t.id, ageH, (row) => (row.resolvedAt ? { resolvedAt: new Date(row.createdAt.getTime() - ageH * H + Math.min(ageH - 1, 6 + ageH / 4) * H), csatAt: row.csatAt ? new Date() : null } : {}));
  }
  void agents;
  for (const [title, body] of [
    ['Acknowledge — investigating', 'Hi {{requester}},\n\nThanks for getting in touch. I\'ve picked up ticket #{{number}} and I\'m looking into it now. I\'ll update you within the next few hours.\n\nRegards,\n{{agent}}'],
    ['Need more information', 'Hi {{requester}},\n\nTo move this forward, could you send:\n• the exact steps you took\n• a screenshot of the error\n• the time it happened\n\nThanks,\n{{agent}}'],
    ['Fixed — please confirm', 'Hi {{requester}},\n\nGood news: we\'ve released a fix for this. Could you check on your side and let us know it\'s working? If we don\'t hear back in 3 days we\'ll close the ticket.\n\n{{agent}}'],
    ['Passed to engineering', 'Hi {{requester}},\n\nI\'ve passed this to our engineering team as a priority task. You\'ll get an update here as soon as there\'s progress.\n\n{{agent}}'],
    ['Closing — no response', 'Hi {{requester}},\n\nWe haven\'t heard back, so we\'re closing this ticket for now. Just reply here if you still need help and it will reopen.\n\n{{agent}}'],
  ]) await mgr.post('/api/canned-responses', { title, body });
  for (const [title, category, body] of [
    ['How to reset your password', 'Accounts & access', 'If you have forgotten your password:\n\n1. Go to the sign-in page and click "Forgot your password?".\n2. Enter the email address you use to sign in.\n3. Open the email we send you and click the link. It works once and expires after 1 hour.\n4. Choose a new password of at least 10 characters.\n\nIf the email does not arrive within 5 minutes, check your spam folder or raise a ticket.'],
    ['Adding or removing users on your account', 'Accounts & access', 'To add a colleague, raise a Service request ticket with their name and email. We usually set up accounts within one working day.\n\nTo remove someone who has left, raise a ticket with "Remove user" in the subject. Their access is removed the same day.'],
    ['How our support hours and response times work', 'Getting started', 'Our team works Monday to Friday, 9:00 to 18:00.\n\nTarget first response times:\n• Urgent: 1 working hour\n• High: 4 working hours\n• Normal: 1 working day\n• Low: 2 working days\n\nThe clock pauses while we are waiting for information from you.'],
    ['Writing a ticket that gets solved fast', 'Getting started', 'Good tickets include:\n\n• What you were trying to do\n• What happened instead (copy any error message)\n• When it happened and how often\n• A screenshot if you can\n\nOne problem per ticket keeps things moving.'],
    ['Understanding your invoice', 'Billing', 'Invoices are issued on the 1st of each month for the previous month\'s work. Each line shows the project, hours and rate.\n\nQuestions about an invoice? Raise a ticket in the Billing category and quote the invoice number.'],
    ['Exporting reports to Excel', 'How-to guides', 'Most lists in the portal have an Export button at the top right. It downloads a CSV file that opens in Excel or Google Sheets.\n\nTip: apply filters first — the export follows the filters on screen.'],
    ['Browser support', 'Troubleshooting', 'We support the latest two versions of Chrome, Edge, Firefox and Safari.\n\nIf a page looks wrong, try a hard refresh (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac) before raising a ticket.'],
    ['Internal: escalation path for P1 incidents', 'Internal playbooks', 'For CRITICAL tickets:\n1. Acknowledge within 15 minutes.\n2. Page the on-call engineer.\n3. Post an internal note every 30 minutes until resolved.\n4. Write a short incident summary within 2 working days.'],
  ]) await mgr.post('/api/kb/articles', { title, category, body, published: true, visibility: category.startsWith('Internal') ? 'INTERNAL' : 'PUBLIC' });
}

// Adds the newer demo content (designations, more people, projects, support desk) to an older demo
// database without touching anything that already exists. Runs once (skipped when project FPP exists).
async function upgradeDemo(base) {
  const org = await prisma.organization.findFirst({ where: { slug: 'northwind' } });
  if (!org) { console.log('[demo-upgrade] no original demo organization; nothing to do'); return; }
  await prisma.organization.update({ where: { id: org.id }, data: { name: 'O2 Digital Services' } });
  const admin = new ApiClient(base); await admin.login(mail('admin'), DEMO_PASSWORD);
  const customers = (await admin.get('/api/org/customers')).data;
  const contoso = customers.find((c) => c.name === 'Contoso Retail'); const fabrikam = customers.find((c) => c.name === 'Fabrikam Health');
  const ids = await ensurePeople(base, admin, contoso, fabrikam);
  const adminMe = await admin.get('/api/auth/me');
  await admin.patch(`/api/org/members/${adminMe.user.id}`, { title: 'Operations Director', department: 'Operations', employeeId: 'O2-100' });
  const mgr = new ApiClient(base); await mgr.login(mail('manager'), DEMO_PASSWORD);
  const cust = new ApiClient(base); await cust.login(mail('customer'), DEMO_PASSWORD);
  const project = (await mgr.get('/api/projects?q=CSM')).data[0];
  if (project) for (const u of ['design']) await mgr.put(`/api/projects/${project.id}/members/${ids[u]}`, { role: 'MEMBER', allocationPct: 50 }).catch(() => {});
  await seedMoreProjects(base, { mgr, ids, fabrikam });
  if (project) await seedSupportDesk(base, { mgr, cust, ids, project });
  console.log('[demo-upgrade] demo data upgraded');
}

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
try {
  if (UPGRADE) { await upgradeDemo(base); process.exitCode = 0; } else await seedDemo(base);
  if (!UPGRADE) console.log(`Demo data created. Sign in with any of these${config.isProd ? ' (password: the DEMO_PASSWORD you configured)' : ` (password: ${DEMO_PASSWORD})`}:`);
  for (const u of ['admin', 'manager', 'dev1', 'dev2', 'qa', 'customer', 'fabrikam', 'globex.admin']) console.log('  ' + mail(u));
} catch (e) { console.error('Seed failed:', e.message, JSON.stringify(e.data ?? {})); process.exitCode = 1; }
finally { server.close(); await prisma.$disconnect(); }
