// End-to-end acceptance workflow over the real HTTP API + test database, including
// negative authorization checks (cross-org, guessed IDs, customer/internal separation).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, startServer, makeOrg, invite, login, expectStatus, prisma, PW } from './helpers.js';
import { ApiClient } from '../../scripts/api-client.js';

let srv, base, A, B, admin, mgr, dev, dev2, cust, otherCust, bAdmin, project, contoso, fabrikam, task1, task2, secretTask, ticket;
const today = new Date().toISOString().slice(0, 10);
// Dates are counted from the next Wednesday (today when it is one), so expectations never land on a weekend
// that the scheduler would move to Monday, whatever day the tests run.
const BASE = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7)); return d; })();
const plus = (n) => { const d = new Date(BASE); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  await resetDb();
  ({ server: srv, base } = await startServer());
  A = await makeOrg('Alpha Org', 'alpha');
  B = await makeOrg('Beta Org', 'beta');
  admin = await login(base, A.adminEmail);
  bAdmin = await login(base, B.adminEmail);
});
afterAll(async () => { srv?.close(); await prisma.$disconnect(); });

describe('authentication & sessions', () => {
  it('rejects bad credentials with a generic message', async () => {
    const e = await expectStatus(new ApiClient(base).login(A.adminEmail, 'wrong-password-1'), 401);
    expect(e.error.message).toBe('Invalid email or password');
    await expectStatus(new ApiClient(base).login('nobody@x.test', 'whatever-1'), 401);
  });
  it('requires a session and a CSRF token for writes', async () => {
    await expectStatus(new ApiClient(base).get('/api/projects'), 401);
    const c = await login(base, A.adminEmail);
    c.csrf = 'forged';
    await expectStatus(c.post('/api/org/customers', { name: 'X' }), 403);
  });
  it('accepts same-origin requests from any hostname but rejects foreign origins', async () => {
    const host = new URL(base).host;
    const login = (origin, hostHeader) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...(hostHeader && { host: hostHeader }) }, body: JSON.stringify({ email: A.adminEmail, password: PW }) });
    expect((await login(`http://${host}`)).status).toBe(200);
    expect((await login('http://evil.example')).status).toBe(403);
    expect((await login(`http://localhost:${new URL(base).port}`)).status).toBe(403); // different host than the request's
  });
  it('never returns password hashes or token hashes', async () => {
    const me = await admin.get('/api/auth/me');
    expect(JSON.stringify(me)).not.toMatch(/passwordHash|tokenHash|\$argon2/);
    const inv = await admin.post('/api/org/invitations', { email: 'probe@alpha.test', role: 'EMPLOYEE' });
    const list = await admin.get('/api/org/invitations');
    expect(JSON.stringify(list)).not.toMatch(/tokenHash/);
    await admin.del(`/api/org/invitations/${inv.id}`);
  });
  it('rate-limits repeated failed sign-ins but not successful ones', async () => {
    for (let i = 0; i < 12; i++) await login(base, A.adminEmail); // successes never count
    const c = new ApiClient(base);
    for (let i = 0; i < 10; i++) await expectStatus(c.login('target@alpha.test', `wrong-${i}-pw`), 401);
    await expectStatus(c.login('target@alpha.test', 'wrong-again-pw'), 429);
  });
  it('logout invalidates the session server-side', async () => {
    const c = await login(base, A.adminEmail);
    const saved = c.cookie;
    await c.post('/api/auth/logout');
    c.cookie = saved;
    await expectStatus(c.get('/api/auth/me'), 401);
  });
});

describe('1. admin invites manager, employees and customer', () => {
  it('onboards users through single-use invitations', async () => {
    contoso = await admin.post('/api/org/customers', { name: 'Contoso' });
    fabrikam = await admin.post('/api/org/customers', { name: 'Fabrikam' });
    await expectStatus(admin.post('/api/org/invitations', { email: 'c@x.test', role: 'CUSTOMER' }), 400);
    mgr = await invite(base, admin, { email: 'mgr@alpha.test', name: 'Mia Manager', role: 'MANAGER' });
    dev = await invite(base, admin, { email: 'dev@alpha.test', name: 'Dev One', role: 'EMPLOYEE' });
    dev2 = await invite(base, admin, { email: 'dev2@alpha.test', name: 'Dev Two', role: 'EMPLOYEE' });
    cust = await invite(base, admin, { email: 'carla@contoso.test', name: 'Carla', role: 'CUSTOMER', customerCompanyId: contoso.id });
    otherCust = await invite(base, admin, { email: 'fred@fabrikam.test', name: 'Fred', role: 'CUSTOMER', customerCompanyId: fabrikam.id });
    expect((await mgr.get('/api/auth/me')).role).toBe('MANAGER');
  });
  it('invitation tokens are single use', async () => {
    const inv = await admin.post('/api/org/invitations', { email: 'once@alpha.test', role: 'EMPLOYEE' });
    const token = new URL(inv.url).searchParams.get('token');
    await new ApiClient(base).post('/api/auth/invitations/accept', { token, name: 'Once', password: PW });
    await expectStatus(new ApiClient(base).post('/api/auth/invitations/accept', { token, name: 'Twice', password: PW }), 400);
  });
  it('non-admins cannot invite or manage the org', async () => {
    await expectStatus(mgr.post('/api/org/invitations', { email: 'z@alpha.test', role: 'ADMIN' }), 403);
    await expectStatus(dev.patch(`/api/org/members/${dev.userId}`, { role: 'ADMIN' }), 403);
    await expectStatus(cust.get('/api/org/members'), 403);
  });
});

describe('2–3. manager creates a project from a template', () => {
  it('generates phases, milestones and deliverables', async () => {
    project = await mgr.post('/api/projects', { name: 'Store revamp', code: 'STR', customerCompanyId: contoso.id, customerContactIds: [cust.userId], managerId: mgr.userId,
      teamMemberIds: [dev.userId, dev2.userId], plannedStart: plus(-10), plannedFinish: plus(110), status: 'ACTIVE', customerVisible: true, budgetAmount: 50000, budgetCurrency: 'USD', billingEnabled: true, hourlyRate: 100 });
    // work starts on an approved plan (the plan approval flow itself is covered in projects-people)
    await prisma.project.update({ where: { id: project.id }, data: { planApprovedAt: new Date() } });
    const d = await mgr.get(`/api/projects/${project.id}`);
    expect(d.phases).toHaveLength(10);
    expect(d.phases[0].name).toMatch(/Initiation/);
    expect(d.phases.at(-1).plannedFinish <= plus(110)).toBe(true);
    for (let i = 1; i < d.phases.length; i++) expect(d.phases[i].plannedStart > d.phases[i - 1].plannedFinish).toBe(true);
    expect(d.milestones.total).toBeGreaterThanOrEqual(8);
    const dl = await mgr.get(`/api/projects/${project.id}/deliverables`);
    expect(dl.data.length).toBeGreaterThan(5);
  });
  it('rejects duplicate codes and employees creating projects', async () => {
    await expectStatus(mgr.post('/api/projects', { name: 'Dup', code: 'STR', managerId: mgr.userId, plannedStart: today, plannedFinish: plus(60) }), 409);
    await expectStatus(dev.post('/api/projects', { name: 'Nope', code: 'NOPE', managerId: mgr.userId, plannedStart: today, plannedFinish: plus(60) }), 403);
  });
});

describe('4. modules, tasks, dates, dependencies, assignments', () => {
  let mod;
  it('enforces the hierarchy', async () => {
    const d = await mgr.get(`/api/projects/${project.id}`);
    const dev = d.phases.find((p) => p.name.startsWith('Development'));
    mod = await mgr.post(`/api/projects/${project.id}/work-items`, { type: 'MODULE', title: 'Checkout', phaseId: dev.id, customerVisible: true });
    task1 = await mgr.post(`/api/projects/${project.id}/work-items`, { type: 'TASK', title: 'API', parentId: mod.id, plannedStart: plus(1), plannedFinish: plus(3), estimateHours: 30, assigneeId: dev.id ?? undefined }).catch(() => null);
    task1 = await mgr.post(`/api/projects/${project.id}/work-items`, { type: 'TASK', title: 'API', parentId: mod.id, plannedStart: plus(1), plannedFinish: plus(3), estimateHours: 30, assigneeId: (await mgr.get('/api/auth/me')).user.id });
    expect(task1.phaseId).toBe(dev.id);
    await expectStatus(mgr.post(`/api/projects/${project.id}/work-items`, { type: 'SUBTASK', title: 'Bad', parentId: mod.id }), 400);
    await expectStatus(mgr.post(`/api/projects/${project.id}/work-items`, { type: 'TASK', title: 'Bad dates', plannedStart: plus(5), plannedFinish: plus(2) }), 400);
  });
  it('assigns employees, links dependencies and rejects cycles', async () => {
    const fresh = await mgr.get(`/api/projects/${project.id}/work-items/${task1.id}`);
    await mgr.patch(`/api/projects/${project.id}/work-items/${task1.id}`, { assigneeId: dev.userId, version: fresh.version });
    task2 = await mgr.post(`/api/projects/${project.id}/work-items`, { type: 'TASK', title: 'UI', parentId: mod.id, plannedStart: plus(2), plannedFinish: plus(6), estimateHours: 10, assigneeId: dev2.userId });
    const dep = await mgr.post(`/api/projects/${project.id}/dependencies`, { predecessorId: task1.id, successorId: task2.id });
    // task2 started before task1 finished: linking them moves task2 straight after task1 (same length)
    expect(dep.rescheduled.moved.map((m) => m.id)).toContain(task2.id);
    await expectStatus(mgr.post(`/api/projects/${project.id}/dependencies`, { predecessorId: task2.id, successorId: task1.id }), 400);
    await expectStatus(dev.post(`/api/projects/${project.id}/dependencies`, { predecessorId: task1.id, successorId: task2.id }), 403);
    const t1 = await mgr.get(`/api/projects/${project.id}/work-items/${task1.id}`);
    const t2 = await mgr.get(`/api/projects/${project.id}/work-items/${task2.id}`);
    expect(t2.plannedStart > t1.plannedFinish).toBe(true);
    expect(t2.scheduleConflicts).toHaveLength(0);
    const m = dep.rescheduled.moved.find((x) => x.id === task2.id);
    const wd = (a, b) => { let n = 0; for (let d = new Date(`${a}T00:00:00Z`); d <= new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) if (![0, 6].includes(d.getUTCDay())) n++; return n; };
    expect(wd(m.to.start, m.to.finish)).toBe(wd(m.from.start, m.from.finish));
  });
  it('previews downstream impact and applies only after explicit confirmation', async () => {
    const before = await mgr.get(`/api/projects/${project.id}/work-items/${task2.id}`);
    const pv = await mgr.post(`/api/projects/${project.id}/schedule/preview`, { itemId: task1.id, plannedStart: plus(1), plannedFinish: plus(8) });
    expect(pv.moves.map((m) => m.id)).toContain(task2.id);
    const still = await mgr.get(`/api/projects/${project.id}/work-items/${task2.id}`);
    expect(still.plannedStart).toBe(before.plannedStart); // preview persisted nothing
    await expectStatus(mgr.post(`/api/projects/${project.id}/schedule/apply`, { itemId: task1.id, plannedStart: plus(1), plannedFinish: plus(8), includeDownstream: true, expectedMoves: [] }), 409);
    await mgr.post(`/api/projects/${project.id}/schedule/apply`, { itemId: task1.id, plannedStart: plus(1), plannedFinish: plus(8), includeDownstream: true, expectedMoves: pv.moves.map((m) => ({ id: m.id, start: m.to.start, finish: m.to.finish })) });
    const after = await mgr.get(`/api/projects/${project.id}/work-items/${task2.id}`);
    expect(after.plannedStart).toBe(pv.moves.find((m) => m.id === task2.id).to.start);
    expect(after.scheduleConflicts).toHaveLength(0);
  });
  it('creates an internal-only task the customer must never see', async () => {
    secretTask = await mgr.post(`/api/projects/${project.id}/work-items`, { type: 'TASK', title: 'Internal margin review', estimateHours: 4 });
    expect(secretTask.customerVisible).toBe(false);
  });
});

describe('5–6. employees update work, comment, attach, log time; progress rolls up', () => {
  it('lets assignees update their own work but not others\'', async () => {
    const t = await dev.get(`/api/projects/${project.id}/work-items/${task1.id}`);
    const upd = await dev.patch(`/api/projects/${project.id}/work-items/${task1.id}`, { percentComplete: 50, version: t.version });
    expect(upd.status).toBe('IN_PROGRESS');
    const t2 = await dev.get(`/api/projects/${project.id}/work-items/${task2.id}`);
    await expectStatus(dev.patch(`/api/projects/${project.id}/work-items/${task2.id}`, { percentComplete: 10, version: t2.version }), 403);
    await expectStatus(dev.patch(`/api/projects/${project.id}/work-items/${task1.id}`, { plannedFinish: plus(30), version: upd.version }), 403);
  });
  it('detects concurrent edits', async () => {
    const t = await dev.get(`/api/projects/${project.id}/work-items/${task1.id}`);
    await mgr.patch(`/api/projects/${project.id}/work-items/${task1.id}`, { priority: 'HIGH', version: t.version });
    await expectStatus(dev.patch(`/api/projects/${project.id}/work-items/${task1.id}`, { percentComplete: 60, version: t.version }), 409);
  });
  it('comments with mentions notify only people who can see them', async () => {
    await dev.post('/api/comments', { targetType: 'workItem', targetId: task1.id, body: `Ping @[Mia](${mgr.userId}) and @[Carla](${cust.userId})`, visibility: 'INTERNAL' });
    const mn = await mgr.get('/api/notifications');
    expect(mn.data.some((n) => n.type === 'mention')).toBe(true);
    const cn = await cust.get('/api/notifications');
    expect(cn.data.some((n) => n.type === 'mention')).toBe(false);
    await dev.post('/api/comments', { targetType: 'workItem', targetId: task1.id, body: 'Public note for customer', visibility: 'PUBLIC' });
  });
  it('stores private attachments and serves them only through authorization', async () => {
    const form = new FormData();
    form.append('targetType', 'workItem'); form.append('targetId', task1.id); form.append('visibility', 'INTERNAL');
    form.append('files', new Blob(['%PDF-1.4 internal spec']), 'spec.pdf');
    const up = await dev.req('POST', '/api/files', undefined, { form });
    const fileId = up.data[0].id;
    const ok = await dev.req('GET', `/api/files/${fileId}/download`, undefined, { raw: true });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toMatch(/attachment/);
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await cust.req('GET', `/api/files/${fileId}/download`, undefined, { raw: true })).status).toBe(404);
    expect((await bAdmin.req('GET', `/api/files/${fileId}/download`, undefined, { raw: true })).status).toBe(404);
    const bad = new FormData(); bad.append('targetType', 'workItem'); bad.append('targetId', task1.id); bad.append('files', new Blob(['MZ...']), 'tool.exe');
    await expectStatus(dev.req('POST', '/api/files', undefined, { form: bad }), 400);
    const spoof = new FormData(); spoof.append('targetType', 'workItem'); spoof.append('targetId', task1.id); spoof.append('files', new Blob(['<script>alert(1)</script>']), 'x.png');
    await expectStatus(dev.req('POST', '/api/files', undefined, { form: spoof }), 400);
  });
  it('logs time, submits, and prevents duplicate approval and edits after approval', async () => {
    const e = await dev.post('/api/time/entries', { projectId: project.id, workItemId: task1.id, date: today, hours: 6, billable: true });
    await expectStatus(dev.post('/api/time/entries', { projectId: project.id, date: today, hours: 20 }), 400);
    await expectStatus(cust.post('/api/time/entries', { projectId: project.id, date: today, hours: 1 }), 403);
    const wk = await dev.get('/api/time/week');
    await dev.post(`/api/time/timesheets/${wk.timesheet.id}/submit`, { version: wk.timesheet.version });
    await expectStatus(dev.patch(`/api/time/entries/${e.id}`, { hours: 7 }), 409);
    const ap = await mgr.get('/api/time/approvals');
    const sheet = ap.data.find((s) => s.id === wk.timesheet.id);
    expect(sheet.canReview).toBe(true);
    await expectStatus(dev.post(`/api/time/timesheets/${sheet.id}/approve`, { version: sheet.version }), 403);
    const [r1, r2] = await Promise.allSettled([mgr.post(`/api/time/timesheets/${sheet.id}/approve`, { version: sheet.version }), admin.post(`/api/time/timesheets/${sheet.id}/approve`, { version: sheet.version })]);
    expect([r1.status, r2.status].sort()).toEqual(['fulfilled', 'rejected']);
    await expectStatus(dev.del(`/api/time/entries/${e.id}`), 409);
  });
  it('rolls progress up using effort weights', async () => {
    const t = await mgr.get(`/api/projects/${project.id}/work-items/${task1.id}`);
    await mgr.patch(`/api/projects/${project.id}/work-items/${task1.id}`, { status: 'DONE', version: t.version });
    const pr = await mgr.get(`/api/projects/${project.id}/progress`);
    // leaves: task1 30h DONE, task2 10h 0%, secret 4h 0% -> 30/44
    expect(pr.project.percent).toBeCloseTo(68.2, 1);
    expect(pr.modules[0].percent).toBe(75);
    const dash = await mgr.get('/api/dashboard');
    expect(dash.portfolio.find((p) => p.id === project.id).progress).toBeCloseTo(68.2, 1);
  });
});

describe('7. customers see only explicitly shared information', () => {
  it('hides internal work, financials and internal comments', async () => {
    const p = await cust.get(`/api/projects/${project.id}`);
    expect(p.budgetAmount).toBeUndefined(); expect(p.hourlyRate).toBeUndefined();
    const items = await cust.get(`/api/projects/${project.id}/work-items?all=true`);
    expect(items.data.find((i) => i.id === secretTask.id)).toBeUndefined();
    expect(items.data.every((i) => i.estimateHours === undefined && i.assigneeId === undefined)).toBe(true);
    await expectStatus(cust.get(`/api/projects/${project.id}/work-items/${secretTask.id}`), 404);
    const t1 = await mgr.get(`/api/projects/${project.id}/work-items/${task1.id}`);
    if (!t1.customerVisible) await mgr.patch(`/api/projects/${project.id}/work-items/${task1.id}`, { customerVisible: true, version: t1.version });
    const c = await cust.get(`/api/comments?targetType=workItem&targetId=${task1.id}`);
    expect(c.data.every((x) => x.visibility === 'PUBLIC')).toBe(true);
    expect(c.data.some((x) => /Public note/.test(x.body))).toBe(true);
    const f = await cust.get(`/api/files?targetType=workItem&targetId=${task1.id}`);
    expect(f.data).toHaveLength(0);
    await expectStatus(cust.get(`/api/projects/${project.id}/registers/risks`), 403);
    await expectStatus(cust.get(`/api/projects/${project.id}/baselines`), 403);
    const act = await cust.get(`/api/projects/${project.id}/activity`);
    expect(JSON.stringify(act)).not.toMatch(/Internal margin review/);
    const s = await cust.get('/api/search?q=margin');
    expect(s.workItems).toHaveLength(0);
  });
  it('blocks other customers and unshared projects entirely', async () => {
    await expectStatus(otherCust.get(`/api/projects/${project.id}`), 404);
    expect((await otherCust.get('/api/projects')).data).toHaveLength(0);
    const d = await mgr.get(`/api/projects/${project.id}`);
    await mgr.patch(`/api/projects/${project.id}`, { customerVisible: false, version: d.version });
    await expectStatus(cust.get(`/api/projects/${project.id}`), 404);
    const d2 = await mgr.get(`/api/projects/${project.id}`);
    await mgr.patch(`/api/projects/${project.id}`, { customerVisible: true, version: d2.version });
  });
  it('an org role alone does not grant project access', async () => {
    const outsider = await invite(base, admin, { email: 'outsider@alpha.test', name: 'Out Sider', role: 'MANAGER' });
    await expectStatus(outsider.get(`/api/projects/${project.id}`), 404);
  });
});

describe('8–10. tickets: public replies, internal notes, links to work', () => {
  it('customer raises a ticket and exchanges public replies', async () => {
    ticket = await cust.post('/api/tickets', { subject: 'Checkout error on mobile', description: 'Payment page crashes', type: 'BUG', priority: 'HIGH', projectId: project.id });
    expect(ticket.number).toBe(1);
    expect(ticket.responseDueAt).toBeTruthy();
    const t = await mgr.get(`/api/tickets/${ticket.id}`);
    await mgr.patch(`/api/tickets/${ticket.id}`, { assigneeId: dev.userId, version: t.version });
    await dev.post(`/api/tickets/${ticket.id}/messages`, { body: 'Can you share the device model?', visibility: 'PUBLIC' });
    await dev.post(`/api/tickets/${ticket.id}/messages`, { body: 'INTERNAL: probably the Safari bug', visibility: 'INTERNAL' });
    const t2 = await dev.get(`/api/tickets/${ticket.id}`);
    expect(t2.firstResponseAt).toBeTruthy();
    await dev.post(`/api/tickets/${ticket.id}/status`, { status: 'WAITING_ON_CUSTOMER', version: t2.version });
    await cust.post(`/api/tickets/${ticket.id}/messages`, { body: 'iPhone 15', visibility: 'PUBLIC' });
    const t3 = await dev.get(`/api/tickets/${ticket.id}`);
    expect(t3.status).toBe('OPEN'); // customer reply resumes the clock
  });
  it('internal notes stay invisible to the customer everywhere', async () => {
    const t = await cust.get(`/api/tickets/${ticket.id}`);
    expect(t.messages.some((m) => /INTERNAL/.test(m.body))).toBe(false);
    expect(t.assigneeId).toBeUndefined();
    expect(JSON.stringify(t.history)).not.toMatch(/internal_note/);
    await expectStatus(cust.post(`/api/tickets/${ticket.id}/messages`, { body: 'sneaky', visibility: 'INTERNAL' }), 403);
    const notes = await cust.get('/api/notifications');
    expect(notes.data.some((n) => /Internal note/.test(n.title))).toBe(false);
    const csv = await cust.req('GET', '/api/tickets/export.csv', undefined, { raw: true });
    expect(await csv.text()).not.toMatch(/Assignee/);
    await expectStatus(cust.post(`/api/tickets/${ticket.id}/status`, { status: 'RESOLVED', version: t.version }), 400);
  });
  it('other customers and other orgs cannot read the ticket by guessing its id', async () => {
    await expectStatus(otherCust.get(`/api/tickets/${ticket.id}`), 404);
    await expectStatus(bAdmin.get(`/api/tickets/${ticket.id}`), 404);
    expect((await otherCust.get('/api/tickets')).data).toHaveLength(0);
  });
  it('manager links the ticket to work and creates a task without losing the conversation', async () => {
    await mgr.post(`/api/tickets/${ticket.id}/links`, { workItemId: task2.id });
    const task = await mgr.post(`/api/tickets/${ticket.id}/create-task`, { assigneeId: dev.userId });
    expect(task.title).toBe('Checkout error on mobile');
    const t = await mgr.get(`/api/tickets/${ticket.id}`);
    expect(t.links).toHaveLength(2);
    expect(t.messages.length).toBeGreaterThanOrEqual(3);
    expect(t.status).toBe('OPEN'); // statuses are independent
    const wi = await mgr.get(`/api/projects/${project.id}/work-items/${task.id}`);
    expect(wi.tickets[0].number).toBe(ticket.number);
  });
});

describe('11. deliverable review and approval', () => {
  it('records approvals per version and never carries them to new versions', async () => {
    const dl = (await mgr.get(`/api/projects/${project.id}/deliverables`)).data[0];
    await mgr.patch(`/api/projects/${project.id}/deliverables/${dl.id}`, { customerVisible: true, version: dl.version });
    expect((await cust.get(`/api/projects/${project.id}/deliverables`)).data.find((d) => d.id === dl.id)).toBeUndefined(); // drafts are hidden
    const v1 = await mgr.post(`/api/projects/${project.id}/deliverables/${dl.id}/versions`, { note: 'first cut' });
    await expectStatus(mgr.post(`/api/projects/${project.id}/deliverables/${dl.id}/submit`), 400);
    const f = new FormData(); f.append('targetType', 'deliverableVersion'); f.append('targetId', v1.id); f.append('files', new Blob(['%PDF-1.4 charter']), 'charter.pdf');
    await mgr.req('POST', '/api/files', undefined, { form: f });
    await mgr.post(`/api/projects/${project.id}/deliverables/${dl.id}/submit`);
    await expectStatus(mgr.post(`/api/projects/${project.id}/deliverables/${dl.id}/review`, { versionNumber: 1, decision: 'APPROVED' }), 403);
    await expectStatus(otherCust.post(`/api/projects/${project.id}/deliverables/${dl.id}/review`, { versionNumber: 1, decision: 'APPROVED' }), 404);
    const rev = await cust.post(`/api/projects/${project.id}/deliverables/${dl.id}/review`, { versionNumber: 1, decision: 'APPROVED', comment: 'Looks good' });
    expect(rev.status).toBe('APPROVED');
    await expectStatus(cust.post(`/api/projects/${project.id}/deliverables/${dl.id}/review`, { versionNumber: 1, decision: 'APPROVED' }), 409);
    await mgr.post(`/api/projects/${project.id}/deliverables/${dl.id}/versions`, { note: 'revised' });
    const after = (await mgr.get(`/api/projects/${project.id}/deliverables`)).data.find((d) => d.id === dl.id);
    expect(after.status).toBe('DRAFT');
    expect(after.versions[0].approvals).toHaveLength(0);
    expect(after.versions[1].approvals[0]).toMatchObject({ decision: 'APPROVED', comment: 'Looks good', reviewer: 'Carla' });
  });
});

describe('12. guessed identifiers across organizations are rejected', () => {
  it('returns 404 for every cross-org project/work-item/ticket access and write', async () => {
    await expectStatus(bAdmin.get(`/api/projects/${project.id}`), 404);
    await expectStatus(bAdmin.get(`/api/projects/${project.id}/work-items/${task1.id}`), 404);
    await expectStatus(bAdmin.patch(`/api/projects/${project.id}/work-items/${task1.id}`, { title: 'pwned', version: 1 }), 404);
    await expectStatus(bAdmin.post('/api/comments', { targetType: 'workItem', targetId: task1.id, body: 'x' }), 404);
    await expectStatus(bAdmin.get(`/api/comments?targetType=workItem&targetId=${task1.id}`), 404);
    await expectStatus(bAdmin.post(`/api/tickets/${ticket.id}/messages`, { body: 'x' }), 404);
    await expectStatus(bAdmin.patch(`/api/org/members/${dev.userId}`, { role: 'ADMIN' }), 404);
    await expectStatus(bAdmin.post('/api/time/entries', { projectId: project.id, date: today, hours: 1 }), 404);
    expect((await bAdmin.get('/api/projects')).data).toHaveLength(0);
    expect((await bAdmin.get('/api/search?q=Store')).projects).toHaveLength(0);
  });
  it('a work item id from another project in the same org is not reachable through the wrong project', async () => {
    const p2 = await mgr.post('/api/projects', { name: 'Other', code: 'OTH', managerId: mgr.userId, plannedStart: today, plannedFinish: plus(60), templateId: null });
    await expectStatus(mgr.get(`/api/projects/${p2.id}/work-items/${task1.id}`), 404);
    await expectStatus(dev.get(`/api/projects/${p2.id}`), 404);
  });
});

describe('13. data persists across restarts', () => {
  it('reads the same data through a fresh server instance', async () => {
    srv.close();
    ({ server: srv, base } = await startServer());
    const c = await login(base, 'mgr@alpha.test');
    const p = await c.get(`/api/projects/${project.id}`);
    expect(p.code).toBe('STR');
    expect((await c.get(`/api/tickets/${ticket.id}`)).messages.length).toBeGreaterThanOrEqual(3);
  });
});

describe('CSV exports neutralize spreadsheet formulas', () => {
  it('prefixes dangerous cells', async () => {
    const c = await login(base, 'mgr@alpha.test');
    await c.post(`/api/projects/${project.id}/work-items`, { type: 'TASK', title: '=HYPERLINK("http://evil","x")' });
    const res = await c.req('GET', `/api/projects/${project.id}/export/work-items.csv`, undefined, { raw: true });
    const text = await res.text();
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });
});
