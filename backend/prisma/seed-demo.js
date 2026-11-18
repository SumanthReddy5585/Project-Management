// OPTIONAL demo data for local development. Refuses to run in production.
// Creates two organizations, invites users through the real API, and builds a project from a template.
// Usage: npm run seed:demo        (uses DATABASE_URL; requires an empty database or --force)
import { prisma } from '../src/lib/prisma.js';
import { config } from '../src/config.js';
import { hashPassword } from '../src/auth/passwords.js';
import { initializeOrganization } from '../src/services/orgSetup.js';
import { createApp } from '../src/app.js';
import { ApiClient } from '../scripts/api-client.js';
import { addWorkingDays } from '../src/domain/calendar.js';

if (config.isProd && process.env.ALLOW_DEMO_SEED !== 'true') { console.error('Refusing to seed demo data in production (set ALLOW_DEMO_SEED=true to override).'); process.exit(1); }
const UPGRADE = process.argv.includes('--upgrade');
const REGISTERS = process.argv.includes('--registers');
const PLANS = process.argv.includes('--plans');
const SCENARIOS = process.argv.includes('--scenarios');
if ((await prisma.organization.count()) && !process.argv.includes('--force') && !UPGRADE && !REGISTERS && !PLANS && !SCENARIOS) { console.error('Database already has organizations. Re-run with --force to add demo orgs anyway.'); process.exit(1); }

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
  await seedRegisters(base);
  await seedPlans();
  await seedScenarios(base);
  return { project, ids };
}

// Approved original plans for the demo projects, with a realistic mix of on-time, late, delayed, ahead
// and added work so "plan vs original" has something to show. Written directly (as if approved at the
// project start); idempotent: projects that already have an original plan are skipped.
async function seedPlans() {
  const today = new Date().toISOString().slice(0, 10);
  const d = (x) => (x ? x.toISOString().slice(0, 10) : null);
  const D = (x) => (x ? new Date(`${x}T00:00:00Z`) : null);
  const rules = {
    CSM: { goLiveSlip: 5, added: ['Checkout regression suite'] },
    FPP: { goLiveSlip: 8, added: ['Accessibility audit'] },
    HRU: { goLiveSlip: 0, noSlips: true, ahead: ['Provision new servers'] },
  };
  for (const [code, rule] of Object.entries(rules)) {
    const project = await prisma.project.findFirst({ where: { code, organization: { OR: [{ slug: 'northwind' }, { slug: { startsWith: 'o2' } }] } } });
    if (!project || project.planApprovedAt || (await prisma.baseline.findFirst({ where: { projectId: project.id, kind: 'ORIGINAL' } }))) continue;
    const items = await prisma.workItem.findMany({ where: { projectId: project.id }, orderBy: { number: 'asc' } });
    // 1. The original plan = the dates as first planned (captured before the "history" below), with
    //    some open tasks and the go-live having slipped since (so their original dates were earlier).
    let openSeen = 0;
    const orig = [];
    for (const i of items) {
      if (rule.added?.includes(i.title)) continue; // created after approval
      let s = d(i.plannedStart); let f = d(i.plannedFinish);
      if (!rule.noSlips && i.status !== 'DONE' && i.status !== 'CANCELLED' && i.type === 'TASK' && f && f >= today && openSeen++ % 2 === 0) { s = s && addWorkingDays(s, -3); f = addWorkingDays(f, -3); }
      if (rule.ahead?.includes(i.title) && f) { s = s && addWorkingDays(s, 2); f = addWorkingDays(f, 2); }
      if (rule.goLiveSlip && i.type === 'MILESTONE' && f && f >= today && ['Go-live', 'Project closed', 'UAT sign-off'].includes(i.title)) { f = addWorkingDays(f, -rule.goLiveSlip); s = f; }
      orig.push({ workItemId: i.id, title: i.title, type: i.type, assigneeId: i.assigneeId, phaseId: i.phaseId, parentId: i.parentId, plannedStart: D(s), plannedFinish: D(f), estimateHours: i.estimateHours });
    }
    // 2. History since approval: past milestones were met on the day; the first finished task was on time,
    //    later ones finished 2 working days late (the working plan was moved to match).
    let doneSeen = 0;
    for (const i of items) {
      const pf = d(i.plannedFinish);
      if (i.type === 'MILESTONE' && i.status === 'TODO' && pf && pf < today) {
        await prisma.workItem.update({ where: { id: i.id }, data: { status: 'DONE', percentComplete: 100, actualStart: i.plannedFinish, actualFinish: i.plannedFinish, version: { increment: 1 } } });
      } else if (i.status === 'IN_PROGRESS' && !i.percentComplete) {
        await prisma.workItem.update({ where: { id: i.id }, data: { percentComplete: rule.noSlips ? 70 : 40, version: { increment: 1 } } });
      } else if (i.status === 'DONE' && i.type === 'TASK' && pf) {
        const af = doneSeen++ === 0 ? pf : [addWorkingDays(pf, 2), today].sort()[0];
        await prisma.workItem.update({ where: { id: i.id }, data: { actualFinish: D(af), plannedFinish: D(af), version: { increment: 1 } } });
      }
    }
    const approver = project.managerId;
    await prisma.$transaction(async (tx) => {
      const bl = await tx.baseline.create({ data: { projectId: project.id, name: `Original plan (approved ${d(project.plannedStart)})`, note: 'Agreed with the client at kick-off', kind: 'ORIGINAL', createdById: approver } });
      await tx.baselineItem.createMany({ data: orig.map((o) => ({ baselineId: bl.id, ...o })) });
      await tx.project.update({ where: { id: project.id }, data: { planApprovedAt: project.plannedStart, planApprovedById: approver, version: { increment: 1 } } });
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Scenario projects: one per situation the app can show (on track, at risk, badly delayed and over
// budget, completed on time, completed late, plan still in draft, on hold, scope changed, cancelled),
// with history written directly so dates in the past look real. Offsets are WORKING days from today.
// Idempotent: a scenario whose project code already exists is skipped.
// ---------------------------------------------------------------------------------------------
const SCENARIOS_SPEC = [
  { code: 'NPA', name: 'Customer Mobile App', mgr: 'manager', client: 'Contoso Retail', start: -25, finish: 35, status: 'ACTIVE', health: 'GREEN', priority: 'HIGH', budget: 60000, rate: 85, visible: true,
    description: 'Native iOS/Android app for Contoso shoppers: sign-in, account, payments and order tracking.', objectives: 'Launch on both stores with 4.5+ rating target.',
    team: ['dev1', 'dev2', 'design', 'qa', 'ops'],
    tasks: [
      ['Customer research interviews', 0, 'design', -25, -19, 24, { status: 'DONE', done: -19 }],
      ['Requirements sign-off', 0, null, -17, -17, null, { ms: true, status: 'DONE', done: -17 }],
      ['App architecture & setup', 1, 'dev1', -16, -12, 24, { status: 'DONE', done: -12 }],
      ['Login & biometric sign-in', 1, 'dev1', -11, -3, 40, { status: 'DONE', done: -3 }],
      ['Account dashboard screens', 1, 'design', -6, 3, 32, { status: 'IN_PROGRESS', pct: 70 }],
      ['Payments & transfers API', 1, 'dev2', -4, 8, 48, { status: 'IN_PROGRESS', pct: 40 }],
      ['Push notifications', 1, 'dev1', 4, 12, 24],
      ['Security penetration test', 2, 'qa', 13, 18, 24],
      ['UAT with Contoso', 2, 'qa', 19, 26, 32],
      ['App store submission', 3, 'ops', 27, 31, 12],
      ['Go-live', 3, null, 35, 35, null, { ms: true }],
    ], deps: [[2, 3], [3, 5], [5, 7], [7, 8], [8, 9], [9, 10]],
    deliverable: ['UX design pack (v1)', 'IN_REVIEW'], update: ['Sprint 3 complete — on plan', 'Login and biometrics are done. Dashboard screens are in review with Contoso; payments API is 40% done. No blockers.', 'GREEN'] },

  { code: 'CRM', name: 'CRM Data Cleanup', mgr: 'manager', start: -15, finish: 25, status: 'ACTIVE', health: 'AMBER', priority: 'MEDIUM',
    description: 'De-duplicate and cleanse 180k CRM accounts before the sales-territory realignment.', objectives: 'Under 1% duplicates; owners assigned for every active account.',
    team: ['dev1', 'dev2', 'qa'],
    tasks: [
      ['Data quality assessment', 0, 'dev2', -15, -10, 16, { status: 'DONE', done: -9 }],
      ['Duplicate detection rules', 1, 'dev2', -9, -3, 24, { status: 'IN_PROGRESS', pct: 80, cf: 1 }],
      ['Merge & cleanse accounts', 1, 'dev1', -2, 8, 40, { status: 'IN_PROGRESS', pct: 25, cs: 0, cf: 10, origWho: 'dev2' }],
      ['Validation with sales team', 2, 'qa', 11, 16, 20, { cs: 13, cf: 18 }],
      ['Clean data live', 3, null, 20, 20, null, { ms: true, cf: 22 }],
    ], deps: [[1, 2], [2, 3], [3, 4]],
    update: ['Merge work reassigned — 2 days behind', 'Sara is finishing the duplicate rules, so Ravi took over the account merge. Validation moves 2 days; go-live at risk.', 'AMBER'] },

  { code: 'ERP', name: 'ERP Finance Integration', mgr: 'manager', client: 'Contoso Retail', start: -40, finish: 20, status: 'ACTIVE', health: 'RED', priority: 'CRITICAL', budget: 14000, rate: 100, overrun: 1.35,
    description: 'Integrate the store platform with the new ERP general ledger, AP and AR.', objectives: 'Daily automated GL postings; month-end close in 3 days.',
    team: ['dev1', 'dev2', 'qa', 'design'],
    tasks: [
      ['Finance process workshops', 0, 'design', -40, -34, 24, { status: 'DONE', done: -32 }],
      ['Chart of accounts mapping', 0, 'dev2', -33, -25, 32, { status: 'DONE', done: -20 }],
      ['GL interface development', 1, 'dev1', -24, -10, 80, { status: 'IN_PROGRESS', pct: 60, cf: 5 }],
      ['AP/AR interface development', 1, 'dev1', -9, 2, 64, { cs: 6, cf: 18 }],
      ['Reconciliation reports', 1, 'dev2', -5, 5, 40, { status: 'BLOCKED', pct: 20, cf: 12 }],
      ['Integration test complete', 2, null, -3, -3, null, { ms: true, cf: 18 }],
      ['Parallel run (2 cycles)', 2, 'qa', 6, 15, 48, { cs: 19, cf: 30 }],
      ['Go-live', 3, null, 20, 20, null, { ms: true, cf: 35 }],
    ], deps: [[1, 2], [2, 3], [3, 5], [4, 5], [5, 6], [6, 7]],
    risks: [['ERP vendor patch for AP module not released', 5, 4, 'Escalated to vendor account manager; workaround designed.'], ['Finance team unavailable during month-end', 4, 4, 'Book parallel-run slots outside close week.']],
    issues: [['GL posting fails for multi-currency invoices', 5, 3]],
    cr: ['Add multi-currency revaluation', 'Client asks for automatic month-end FX revaluation in the GL interface.', 10, 12000],
    update: ['Red: go-live moves 3 weeks, budget overrun', 'GL interface took twice the estimate because of multi-currency defects. AP/AR has not started. The budget is already overspent. Recovery plan and change request sent to Contoso.', 'RED'] },

  { code: 'INT', name: 'Intranet Redesign', mgr: 'manager', start: -70, finish: -10, status: 'COMPLETED', health: 'GREEN', priority: 'LOW', budget: 25000, rate: 80, underrun: 0.85,
    description: 'New staff intranet with news, policies and a people directory.', objectives: 'Launch before the annual town hall.',
    team: ['design', 'dev1', 'qa'],
    tasks: [
      ['Content audit', 0, 'design', -70, -64, 16, { status: 'DONE', done: -65 }],
      ['Page templates & design', 1, 'design', -63, -48, 40, { status: 'DONE', done: -49 }],
      ['Build & migrate content', 1, 'dev1', -47, -28, 60, { status: 'DONE', done: -28 }],
      ['Accessibility & UAT', 2, 'qa', -27, -18, 24, { status: 'DONE', done: -19 }],
      ['Launch', 3, null, -12, -12, null, { ms: true, status: 'DONE', done: -12 }],
    ], deps: [[0, 1], [1, 2], [2, 3], [3, 4]],
    update: ['Launched on time and under budget', 'The intranet went live on the planned date. 92% of staff logged in during the first week.', 'GREEN'] },

  { code: 'SEC', name: 'Security Audit 2026', mgr: 'pm2', start: -60, finish: -12, status: 'COMPLETED', health: 'AMBER', priority: 'HIGH', budget: 18000, rate: 95,
    description: 'Annual ISO 27001 internal audit and remediation of findings.', objectives: 'No major non-conformities at the external audit.',
    team: ['ops', 'qa', 'dev2'],
    tasks: [
      ['Scope & asset inventory', 0, 'ops', -60, -55, 16, { status: 'DONE', done: -55 }],
      ['Control testing', 1, 'qa', -54, -38, 48, { status: 'DONE', done: -35 }],
      ['Remediate findings', 1, 'ops', -37, -20, 56, { status: 'DONE', done: -12 }],
      ['Audit report sign-off', 2, 'dev2', -19, -14, 12, { status: 'DONE', done: -7 }],
      ['Audit closed', 3, null, -12, -12, null, { ms: true, status: 'DONE', done: -6 }],
    ], deps: [[0, 1], [1, 2], [2, 3], [3, 4]],
    update: ['Closed 6 working days late', 'All findings fixed. Remediation of the firewall rules took longer than planned, so sign-off slipped by 6 working days.', 'AMBER'] },

  { code: 'MKT', name: 'Marketing Website Refresh', mgr: 'manager', start: 5, finish: 50, status: 'DRAFT', health: 'GREEN', priority: 'MEDIUM', draft: true,
    description: 'Refresh the public website with the new brand and a faster CMS.', objectives: 'Page speed under 2 seconds; leads +20%.',
    team: ['design', 'dev1'],
    tasks: [
      ['Brand guidelines review', 0, 'design', 5, 8, 8],
      ['Sitemap & wireframes', 0, 'design', 9, 15, 24],
      ['CMS selection', 1, null, 10, 14, null],
      ['Build page templates', 1, 'dev1', null, null, 60],
      ['SEO migration plan', 2, null, null, null, 16],
    ], deps: [] },

  { code: 'DWH', name: 'Data Warehouse Migration', mgr: 'pm2', start: -30, finish: 30, status: 'ON_HOLD', health: 'AMBER', priority: 'MEDIUM',
    description: 'Move the on-premises data warehouse to the cloud. ON HOLD: waiting for the cloud licence purchase.', objectives: 'Retire the old warehouse servers by year end.',
    team: ['ops', 'dev2'],
    tasks: [
      ['Current workload analysis', 0, 'dev2', -30, -24, 24, { status: 'DONE', done: -24 }],
      ['Target architecture', 0, 'ops', -23, -17, 24, { status: 'DONE', done: -16 }],
      ['Provision cloud warehouse', 1, 'ops', -16, -8, 32, { status: 'IN_PROGRESS', pct: 30 }],
      ['Migrate ETL jobs', 1, 'dev2', -7, 12, 80],
      ['Reconcile reports', 2, 'dev2', 13, 22, 40],
      ['Cut-over', 3, null, 30, 30, null, { ms: true }],
    ], deps: [[2, 3], [3, 4], [4, 5]],
    issues: [['Cloud licence purchase order not approved', 4, 5]],
    update: ['On hold — waiting for licences', 'Procurement has not approved the cloud licences, so provisioning is paused. Work resumes as soon as the PO is signed.', 'AMBER'] },

  { code: 'LMS', name: 'Learning Portal', mgr: 'manager', start: -20, finish: 30, status: 'ACTIVE', health: 'GREEN', priority: 'MEDIUM',
    description: 'Online learning portal for staff onboarding and compliance courses.', objectives: 'All compliance courses online; tracking for HR.',
    team: ['dev1', 'design', 'qa'],
    tasks: [
      ['Course catalogue design', 0, 'design', -20, -15, 16, { status: 'DONE', done: -15 }],
      ['Learner dashboard', 1, 'dev1', -14, -5, 32, { status: 'DONE', done: -6 }],
      ['Video player & progress tracking', 1, 'dev1', -4, 6, 40, { status: 'IN_PROGRESS', pct: 50 }],
      ['Gamification badges', 1, 'design', 7, 12, 16, { cancelled: true }],
      ['Manager reports', 1, 'dev1', 7, 14, 24],
      ['Compliance quiz engine', 1, 'dev1', 8, 15, 24, { added: true }],
      ['SSO with Azure AD', 1, null, 10, 13, 12, { added: true }],
      ['Certificate PDF export', 1, 'design', 12, 16, 8, { added: true }],
      ['UAT with HR', 2, 'qa', 18, 24, 20],
      ['Portal live', 3, null, 30, 30, null, { ms: true }],
    ], deps: [[2, 4], [4, 8], [8, 9]],
    update: ['Scope updated: quiz engine and SSO added', 'HR asked for a compliance quiz engine and Azure AD sign-in; badges were dropped to make room. End date unchanged.', 'GREEN'] },

  { code: 'VEP', name: 'Virtual Events Platform', mgr: 'pm2', client: 'Fabrikam Health', start: -50, finish: 10, status: 'CANCELLED', health: 'RED', priority: 'LOW', noPlan: true,
    description: 'CANCELLED by the client after the business case changed (events moved to an external provider).', objectives: '—',
    team: ['dev1', 'design'],
    tasks: [
      ['Requirements', 0, 'design', -50, -44, 16, { status: 'DONE', done: -44 }],
      ['Streaming prototype', 1, 'dev1', -43, -30, 40, { status: 'DONE', done: -31 }],
      ['Ticketing integration', 1, 'dev1', -29, -10, 40, { status: 'CANCELLED' }],
    ], deps: [] },
];

async function seedScenarios(base) {
  const today = new Date().toISOString().slice(0, 10);
  const W = (n) => (n == null ? null : addWorkingDays(today, n));
  const D = (x) => (x ? new Date(`${x}T00:00:00Z`) : null);
  const mgrUser = await prisma.user.findFirst({ where: { email: mail('manager') } });
  if (!mgrUser) return;
  const membership = await prisma.membership.findFirst({ where: { userId: mgrUser.id } });
  const orgId = membership.organizationId;
  const users = await prisma.user.findMany({ where: { memberships: { some: { organizationId: orgId } } }, select: { id: true, email: true } });
  const ids = {}; for (const u of users) ids[u.email.split('@')[0].replace(sfx, '')] = u.id;
  const clients = { manager: new ApiClient(base), pm2: new ApiClient(base) };
  await clients.manager.login(mail('manager'), DEMO_PASSWORD); await clients.pm2.login(mail('pm2'), DEMO_PASSWORD);
  // A compact 4-phase template the scenarios (and users) can use.
  let tpl = await prisma.projectTemplate.findFirst({ where: { organizationId: orgId, name: 'Agile delivery (4 phases)' } });
  if (!tpl) tpl = await prisma.projectTemplate.create({ data: { organizationId: orgId, name: 'Agile delivery (4 phases)', description: 'Discover, Build, Test, Launch — add your own milestones.',
    phases: { create: [['Discover', 5], ['Build', 15], ['Test', 6], ['Launch', 3]].map(([name, durationDays], i) => ({ name, durationDays, sortOrder: i })) } } });
  const companies = await prisma.customerCompany.findMany({ where: { organizationId: orgId } });
  const weekStart = (iso) => { const d = new Date(`${iso}T00:00:00Z`); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };
  const sheets = new Map();
  const sheetFor = async (userId, date) => {
    const ws = weekStart(date); const key = `${userId}|${ws}`;
    if (!sheets.has(key)) {
      const ex = await prisma.timesheet.findUnique({ where: { userId_weekStart: { userId, weekStart: D(ws) } } });
      sheets.set(key, ex ?? await prisma.timesheet.create({ data: { organizationId: orgId, userId, weekStart: D(ws), status: ws < weekStart(today) ? 'APPROVED' : 'DRAFT', ...(ws < weekStart(today) && { submittedAt: D(ws), reviewedAt: D(ws) }) } }));
    }
    return sheets.get(key);
  };

  for (const sc of SCENARIOS_SPEC) {
    if (await prisma.project.findFirst({ where: { organizationId: orgId, code: sc.code } })) continue;
    const api = clients[sc.mgr];
    const company = sc.client ? companies.find((c) => c.name === sc.client) : null;
    const contacts = company ? (await prisma.membership.findMany({ where: { organizationId: orgId, customerCompanyId: company.id, role: 'CUSTOMER' } })).map((m) => m.userId) : [];
    const p = await api.post('/api/projects', { name: sc.name, code: sc.code, description: sc.description, objectives: sc.objectives, managerId: ids[sc.mgr], templateId: tpl.id,
      plannedStart: W(sc.start), plannedFinish: W(sc.finish), status: sc.status === 'DRAFT' ? 'DRAFT' : 'ACTIVE', priority: sc.priority, health: sc.health,
      ...(company && { customerCompanyId: company.id, customerContactIds: contacts, customerVisible: Boolean(sc.visible) }),
      ...(sc.budget && { budgetAmount: sc.budget, budgetCurrency: 'USD', billingEnabled: true, hourlyRate: sc.rate }),
      team: sc.team.map((u) => ({ userId: ids[u], role: 'MEMBER', allocationPct: 50 })) });
    const phases = await prisma.phase.findMany({ where: { projectId: p.id }, orderBy: { sortOrder: 'asc' } });
    // Work items: current (working-plan) values; original values kept for the baseline.
    let seq = 0; const made = []; const orig = [];
    for (const [title, ph, who, os, of, est, o = {}] of sc.tasks) {
      const cs = o.cs ?? os; const cf = o.cf ?? of; const ms = Boolean(o.ms);
      const status = o.cancelled ? 'CANCELLED' : o.status ?? 'TODO';
      const actualFinish = status === 'DONE' ? W(o.done ?? cf) : null;
      const actualStart = status === 'DONE' || status === 'IN_PROGRESS' || status === 'BLOCKED' ? W(ms ? o.done ?? cf : cs) : null;
      const it = await prisma.workItem.create({ data: { projectId: p.id, phaseId: phases[Math.min(ph, phases.length - 1)].id, type: ms ? 'MILESTONE' : 'TASK', number: ++seq, title, sortOrder: seq,
        assigneeId: who ? ids[who] : null, status, priority: sc.priority === 'CRITICAL' && !ms ? 'HIGH' : 'MEDIUM',
        plannedStart: D(ms ? W(cf) : W(cs)), plannedFinish: D(status === 'DONE' && !ms ? actualFinish : W(cf)), actualStart: D(actualStart), actualFinish: D(actualFinish),
        estimateHours: est, percentComplete: status === 'DONE' ? 100 : o.pct ?? 0, customerVisible: Boolean(sc.visible), createdById: ids[sc.mgr] } });
      made.push(it);
      if (!o.added) orig.push({ workItemId: it.id, title, type: it.type, assigneeId: o.origWho ? ids[o.origWho] : it.assigneeId, phaseId: it.phaseId, parentId: null,
        plannedStart: D(ms ? W(of) : W(os)), plannedFinish: D(W(of)), estimateHours: est });
    }
    await prisma.project.update({ where: { id: p.id }, data: { workItemSeq: seq } });
    for (const [a, b] of sc.deps) await prisma.dependency.create({ data: { projectId: p.id, predecessorId: made[a].id, successorId: made[b].id, type: 'FS' } });
    // Approved original plan (locked), as if approved at the start.
    if (!sc.draft && !sc.noPlan) {
      const bl = await prisma.baseline.create({ data: { projectId: p.id, name: `Original plan (approved ${W(sc.start)})`, note: 'Approved at kick-off', kind: 'ORIGINAL', createdById: ids[sc.mgr] } });
      await prisma.baselineItem.createMany({ data: orig.map((x) => ({ baselineId: bl.id, ...x })) });
      await prisma.project.update({ where: { id: p.id }, data: { planApprovedAt: D(W(sc.start)), planApprovedById: ids[sc.mgr] } });
    }
    // Time logged on finished / running work (scaled for overruns), spread over working days.
    for (const [k, it] of made.entries()) {
      const o = sc.tasks[k][6] || {};
      if (!it.assigneeId || !it.estimateHours || !it.actualStart) continue;
      const frac = it.status === 'DONE' ? 1 : (it.percentComplete || 0) / 100;
      let total = Math.round(Number(it.estimateHours) * frac * (sc.overrun || sc.underrun || 1) * 2) / 2;
      const endD = it.actualFinish ? it.actualFinish.toISOString().slice(0, 10) : addWorkingDays(today, -1);
      let d = it.actualStart.toISOString().slice(0, 10);
      while (total > 0 && d <= endD) {
        const h = Math.min(total, 6);
        const ts = await sheetFor(it.assigneeId, d);
        await prisma.timeEntry.create({ data: { organizationId: orgId, projectId: p.id, workItemId: it.id, userId: it.assigneeId, timesheetId: ts.id, date: D(d), hours: h, billable: Boolean(sc.budget), note: o.status === 'BLOCKED' ? 'Waiting on vendor fix' : null } });
        total -= h; d = addWorkingDays(d, 1);
      }
    }
    for (const [title, probability, impact, mitigation] of sc.risks || []) await prisma.risk.create({ data: { projectId: p.id, title, probability, impact, mitigation, ownerId: ids[sc.mgr] } });
    for (const [title, severity, inDays] of sc.issues || []) await prisma.issue.create({ data: { projectId: p.id, title, severity, targetDate: D(W(inDays)), ownerId: ids[sc.mgr] } });
    if (sc.cr) await prisma.changeRequest.create({ data: { projectId: p.id, title: sc.cr[0], scope: sc.cr[1], scheduleImpactDays: sc.cr[2], costImpact: sc.cr[3], createdById: ids[sc.mgr], status: 'SUBMITTED' } });
    if (sc.deliverable) {
      const dl = await prisma.deliverable.create({ data: { projectId: p.id, phaseId: phases[1].id, name: sc.deliverable[0], customerVisible: true, status: sc.deliverable[1], dueDate: D(W(3)) } });
      await prisma.deliverableVersion.create({ data: { deliverableId: dl.id, versionNumber: 1, note: 'Screens for dashboard, payments and settings — please review.', createdById: ids[sc.mgr] } });
    }
    if (sc.update) await prisma.statusUpdate.create({ data: { projectId: p.id, authorId: ids[sc.mgr], title: sc.update[0], body: sc.update[1], health: sc.update[2], customerVisible: Boolean(sc.visible), createdAt: new Date(Date.now() - 2 * 864e5) } });
    if (['COMPLETED', 'ON_HOLD', 'CANCELLED'].includes(sc.status)) await prisma.project.update({ where: { id: p.id }, data: { status: sc.status, version: { increment: 1 } } });
  }
}

// Risks, issues and decisions so the risk matrix and status report have real content. Idempotent per project.
async function seedRegisters(base) {
  const day = (off) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + off); return x.toISOString().slice(0, 10); };
  const sets = {
    CSM: { who: 'manager', risks: [
      ['Payment provider certification slips', 5, 4, 'Book the certification slot now; keep the legacy gateway as fallback for launch.'],
      ['Legacy order data has duplicates', 4, 3, 'Run the de-duplication script in the second migration rehearsal.'],
      ['Key developer on leave in January', 3, 4, 'Pair a second developer on the cart service before the break.'],
      ['Client UAT testers not available', 3, 3, 'Agree named testers and dates in the next steering meeting.'],
      ['Hosting costs above estimate', 2, 2, 'Review autoscaling limits after load test.'],
    ], issues: [['Staging environment unstable after DB upgrade', 4, 5], ['Brand guidelines not yet received', 2, 8]],
      decisions: [['Use headless commerce API', 'Old storefront cannot be extended.', 'Build the new store on the headless API; keep the legacy admin for 6 months.']] },
    FPP: { who: 'pm2', risks: [
      ['Health-records integration API rate limits', 4, 5, 'Ask Fabrikam IT for a dedicated integration quota.'],
      ['Accessibility audit findings late in the cycle', 3, 3, 'Run an automated audit every sprint.'],
    ], issues: [['SSO metadata from client is expired', 3, 4]], decisions: [] },
  };
  for (const [code, set] of Object.entries(sets)) {
    const c = new ApiClient(base);
    try { await c.login(mail(set.who), DEMO_PASSWORD); } catch { continue; }
    const p = (await c.get(`/api/projects?q=${code}`)).data.find((x) => x.code === code);
    if (!p) continue;
    if ((await c.get(`/api/projects/${p.id}/registers/risks`)).data.length) continue;
    const me = await c.get('/api/auth/me');
    for (const [title, probability, impact, mitigation] of set.risks) await c.post(`/api/projects/${p.id}/registers/risks`, { title, probability, impact, mitigation, ownerId: me.user.id, status: 'OPEN' });
    for (const [title, severity, inDays] of set.issues) await c.post(`/api/projects/${p.id}/registers/issues`, { title, severity, ownerId: me.user.id, targetDate: day(inDays), status: 'OPEN' });
    for (const [title, context, decision] of set.decisions) await c.post(`/api/projects/${p.id}/registers/decisions`, { title, context, decision, decidedById: me.user.id, decidedOn: day(-10) });
  }
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
  await seedRegisters(base);
  await seedPlans();
  await seedScenarios(base);
  console.log('[demo-upgrade] demo data upgraded');
}

const app = createApp();
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
try {
  if (REGISTERS || PLANS || SCENARIOS) {
    if (REGISTERS) { await seedRegisters(base); console.log('[demo-upgrade] registers added'); }
    if (PLANS) { await seedPlans(); console.log('[demo-upgrade] original plans added'); }
    if (SCENARIOS) { await seedScenarios(base); console.log('[demo-upgrade] scenario projects added'); }
    process.exitCode = 0;
  } else if (UPGRADE) { await upgradeDemo(base); process.exitCode = 0; } else await seedDemo(base);
  if (!UPGRADE && !REGISTERS && !PLANS && !SCENARIOS) console.log(`Demo data created. Sign in with any of these${config.isProd ? ' (password: the DEMO_PASSWORD you configured)' : ` (password: ${DEMO_PASSWORD})`}:`);
  if (!UPGRADE && !REGISTERS && !PLANS && !SCENARIOS) for (const u of ['admin', 'manager', 'dev1', 'dev2', 'qa', 'customer', 'fabrikam', 'globex.admin']) console.log('  ' + mail(u));
} catch (e) { console.error('Seed failed:', e.message, JSON.stringify(e.data ?? {})); process.exitCode = 1; }
finally { server.close(); await prisma.$disconnect(); }
