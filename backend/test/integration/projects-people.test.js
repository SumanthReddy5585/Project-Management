// People administration and project-management additions: admin-created users with designation,
// forced first password change, project team roles at creation, duplicate, save-as-template, burn-up.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, startServer, makeOrg, login, expectStatus, prisma } from './helpers.js';
import { ApiClient } from '../../scripts/api-client.js';

let srv, base, A, admin, created, pm, dev, project;
const today = new Date().toISOString().slice(0, 10);
const plus = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  await resetDb();
  ({ server: srv, base } = await startServer());
  A = await makeOrg('People Org', 'ppl');
  admin = await login(base, A.adminEmail);
});
afterAll(async () => { srv?.close(); await prisma.$disconnect(); });

describe('users with designation', () => {
  it('admin adds a user directly; temporary password is returned once and must be changed', async () => {
    created = await admin.post('/api/org/members', { name: 'Paula PM', email: 'Paula@ppl.test', title: 'Project Manager', department: 'PMO', role: 'MANAGER', employeeId: 'E-7' });
    expect(created.temporaryPassword).toMatch(/^O2-/);
    const list = await admin.get('/api/org/members?q=paula');
    expect(list.data[0]).toMatchObject({ title: 'Project Manager', department: 'PMO', employeeId: 'E-7', mustChangePassword: true });
    pm = new ApiClient(base);
    const me = await pm.login('paula@ppl.test', created.temporaryPassword);
    expect(me.mustChangePassword).toBe(true);
    await expectStatus(pm.post('/api/auth/password/change', { currentPassword: 'wrong', newPassword: 'Brand-new-pass-9' }), 400);
    await pm.post('/api/auth/password/change', { currentPassword: created.temporaryPassword, newPassword: 'Brand-new-pass-9' });
    expect((await pm.get('/api/auth/me')).mustChangePassword).toBe(false);
    await expectStatus(new ApiClient(base).login('paula@ppl.test', created.temporaryPassword), 401);
  });
  it('rejects duplicates, enforces admin-only and supports a fresh temporary password', async () => {
    await expectStatus(admin.post('/api/org/members', { name: 'Again', email: 'paula@ppl.test', role: 'EMPLOYEE' }), 409);
    await expectStatus(pm.post('/api/org/members', { name: 'X', email: 'x@ppl.test', role: 'EMPLOYEE' }), 403);
    const d = await admin.post('/api/org/members', { name: 'Dev Dee', email: 'dee@ppl.test', title: 'Developer', department: 'Engineering', role: 'EMPLOYEE' });
    const r = await admin.post(`/api/org/members/${d.userId}/temp-password`);
    expect(r.temporaryPassword).not.toBe(d.temporaryPassword);
    dev = new ApiClient(base); await dev.login('dee@ppl.test', r.temporaryPassword); dev.userId = d.userId;
    await dev.post('/api/auth/password/change', { currentPassword: r.temporaryPassword, newPassword: 'Dee-password-22' });
    await admin.patch(`/api/org/members/${d.userId}`, { title: 'Senior Developer', department: 'Platform', phone: '+1 555' });
    expect((await admin.get('/api/org/members?q=dee')).data[0]).toMatchObject({ title: 'Senior Developer', department: 'Platform', phone: '+1 555' });
  });
});

describe('projects', () => {
  it('creates a project with a chosen team, roles and allocation', async () => {
    const me = await pm.get('/api/auth/me');
    project = await pm.post('/api/projects', { name: 'Apollo', code: 'APL', managerId: me.user.id, plannedStart: today, plannedFinish: plus(60), status: 'ACTIVE',
      team: [{ userId: dev.userId, role: 'MEMBER', allocationPct: 50 }] });
    const d = await pm.get(`/api/projects/${project.id}`);
    const devRow = d.members.find((m) => m.id === dev.userId);
    expect(devRow).toMatchObject({ role: 'MEMBER', allocationPct: 50, title: 'Senior Developer', department: 'Platform' });
    const list = await pm.get('/api/projects');
    expect(list.data[0]).toMatchObject({ teamSize: 2, counts: expect.objectContaining({ open: expect.any(Number) }) });
  });
  it('duplicates the plan to a new start date and saves it as a template', async () => {
    const t = await pm.post(`/api/projects/${project.id}/work-items`, { type: 'TASK', title: 'Build API', plannedStart: plus(2), plannedFinish: plus(6), assigneeId: dev.userId, estimateHours: 8 });
    const copy = await pm.post(`/api/projects/${project.id}/clone`, { name: 'Apollo 2', code: 'APL2', plannedStart: plus(14), includeTeam: true });
    const items = await pm.get(`/api/projects/${copy.id}/work-items?all=true`);
    const built = items.data.find((i) => i.title === 'Build API');
    expect(built.plannedStart).toBe(plus(16));
    expect(built.assigneeId).toBeNull();
    const cd = await pm.get(`/api/projects/${copy.id}`);
    expect(cd.status).toBe('DRAFT');
    expect(cd.members.some((m) => m.id === dev.userId)).toBe(true);
    await expectStatus(pm.post(`/api/projects/${project.id}/clone`, { name: 'Dup', code: 'APL2', plannedStart: today }), 409);
    await expectStatus(dev.post(`/api/projects/${project.id}/clone`, { name: 'Mine', code: 'MINE', plannedStart: today }), 403);
    const tpl = await pm.post(`/api/projects/${project.id}/save-as-template`, { name: 'Apollo plan' });
    const tpls = await pm.get('/api/org/templates');
    expect(tpls.data.find((x) => x.id === tpl.id).phases.length).toBeGreaterThan(0);
    void t;
  });
  it('reports a burn-up series with effort figures for the team', async () => {
    const b = await pm.get(`/api/projects/${project.id}/burnup`);
    expect(b.series.length).toBeGreaterThan(0);
    expect(b.total).toBeGreaterThan(0);
    expect(b.hours).toMatchObject({ estimate: 8, logged: 0 });
  });
});

describe('planning tools', () => {
  it('imports tasks from CSV rows with a dry-run preview, parents, assignees and validation', async () => {
    const rows = [
      { title: 'Payments', type: 'Module' },
      { title: 'Card API', type: 'Task', parent: 'Payments', assignee: 'dee@ppl.test', start: plus(3), due: plus(7), estimate: '16h', priority: 'High', status: 'In progress' },
      { title: 'Card tests', type: 'Subtask', parent: 'Card API', due: plus(7), estimate: '4' },
      { title: 'Go live', type: 'Milestone', due: plus(10) },
      { title: '', type: 'Task' },
      { title: 'Bad dates', start: plus(5), due: plus(2) },
      { title: 'Stranger', assignee: 'nobody@else.test', priority: 'whenever' },
    ];
    const dry = await pm.post(`/api/projects/${project.id}/work-items/import`, { rows, dryRun: true });
    expect(dry.summary).toMatchObject({ total: 7, valid: 5, invalid: 2 });
    expect(dry.rows[6].warnings.length).toBe(2);
    expect(dry.rows[1]).toMatchObject({ assigneeName: 'Dev Dee', estimateHours: 16, priority: 'HIGH', status: 'IN_PROGRESS' });
    const before = (await pm.get(`/api/projects/${project.id}/work-items?all=true`)).data.length;
    expect((await pm.get(`/api/projects/${project.id}/work-items?all=true`)).data.length).toBe(before); // dry run saves nothing
    const done = await pm.post(`/api/projects/${project.id}/work-items/import`, { rows, dryRun: false });
    expect(done.created).toBe(5);
    const items = (await pm.get(`/api/projects/${project.id}/work-items?all=true`)).data;
    const mod = items.find((i) => i.title === 'Payments'); const api = items.find((i) => i.title === 'Card API'); const sub = items.find((i) => i.title === 'Card tests');
    expect(api.parentId).toBe(mod.id); expect(sub.parentId).toBe(api.id); expect(api.assigneeId).toBe(dev.userId);
    expect(items.find((i) => i.title === 'Go live')).toMatchObject({ type: 'MILESTONE', plannedStart: plus(10), plannedFinish: plus(10) });
    await expectStatus(dev.post(`/api/projects/${project.id}/work-items/import`, { rows, dryRun: true }), 403);
  });
  it('returns logged hours per task and a weekly resource plan', async () => {
    const items = (await pm.get(`/api/projects/${project.id}/work-items?all=true`)).data;
    const api = items.find((i) => i.title === 'Card API');
    await dev.post('/api/time/entries', { projectId: project.id, workItemId: api.id, date: today, hours: 3 });
    const again = (await pm.get(`/api/projects/${project.id}/work-items?all=true`)).data.find((i) => i.id === api.id);
    expect(again.loggedHours).toBe(3);
    const plan = await pm.get(`/api/workload/weeks?weeks=4&projectId=${project.id}`);
    expect(plan.weeks.length).toBe(4);
    const row = plan.data.find((p) => p.userId === dev.userId);
    expect(row.weeks.length).toBe(4);
    expect(row.totals.planned).toBeGreaterThan(0);
    expect(row.tasks.some((t) => t.id === api.id)).toBe(true);
    await expectStatus(dev.get('/api/workload/weeks'), 403);
  });
  it('links tasks and refuses dependency cycles', async () => {
    const items = (await pm.get(`/api/projects/${project.id}/work-items?all=true`)).data;
    const api = items.find((i) => i.title === 'Card API'); const live = items.find((i) => i.title === 'Go live');
    const d = await pm.post(`/api/projects/${project.id}/dependencies`, { predecessorId: api.id, successorId: live.id, type: 'FS' });
    await expectStatus(pm.post(`/api/projects/${project.id}/dependencies`, { predecessorId: live.id, successorId: api.id, type: 'FS' }), 400);
    const deps = await pm.get(`/api/projects/${project.id}/dependencies`);
    expect(deps.data.some((x) => x.id === d.id)).toBe(true);
  });
});

describe('original plan: build, approve & lock, compare', () => {
  let P;
  it('refuses to approve an empty or undated plan, then approves and locks it', async () => {
    const me = await pm.get('/api/auth/me');
    P = await pm.post('/api/projects', { name: 'Orion', code: 'ORN', managerId: me.user.id, plannedStart: today, plannedFinish: plus(40), team: [{ userId: dev.userId, role: 'MEMBER' }] });
    let plan = await pm.get(`/api/projects/${P.id}/plan`);
    expect(plan).toMatchObject({ approved: false, canApprove: true });
    expect(plan.readiness.ready).toBe(false);
    await expectStatus(pm.post(`/api/projects/${P.id}/plan/approve`, {}), 400);
    const a = await pm.post(`/api/projects/${P.id}/work-items`, { type: 'TASK', title: 'Design', plannedStart: plus(1), plannedFinish: plus(5), assigneeId: dev.userId, estimateHours: 16 });
    const undated = await pm.post(`/api/projects/${P.id}/work-items`, { type: 'TASK', title: 'Build' });
    await expectStatus(pm.post(`/api/projects/${P.id}/plan/approve`, {}), 400);
    await pm.patch(`/api/projects/${P.id}/work-items/${undated.id}`, { plannedStart: plus(6), plannedFinish: plus(12), estimateHours: 24, version: undated.version });
    await expectStatus(dev.post(`/api/projects/${P.id}/plan/approve`, {}), 403);
    const ok = await pm.post(`/api/projects/${P.id}/plan/approve`, { note: 'Signed off with client' });
    expect(ok.items).toBeGreaterThanOrEqual(2);
    await expectStatus(pm.post(`/api/projects/${P.id}/plan/approve`, {}), 409);
    const d = await pm.get(`/api/projects/${P.id}`);
    expect(d.status).toBe('ACTIVE');
    expect(d.planApprovedAt).toBeTruthy();
    expect(d.schedule).toMatchObject({ status: 'ON_TRACK', finishVariance: 0 });
    const bls = await pm.get(`/api/projects/${P.id}/baselines`);
    expect(bls.data[0]).toMatchObject({ kind: 'ORIGINAL', locked: true });
    // database refuses edits to the original plan
    await expect(prisma.baselineItem.updateMany({ where: { baselineId: ok.baselineId }, data: { title: 'hack' } })).rejects.toThrow(/locked/);
    await expect(prisma.baseline.delete({ where: { id: ok.baselineId } })).rejects.toThrow(/locked/);
    void a;
  });
  it('compares the working plan with the original', async () => {
    const items = (await pm.get(`/api/projects/${P.id}/work-items?all=true`)).data;
    const build = items.find((i) => i.title === 'Build');
    await pm.patch(`/api/projects/${P.id}/work-items/${build.id}`, { plannedFinish: plus(19), version: build.version });
    await pm.post(`/api/projects/${P.id}/work-items`, { type: 'TASK', title: 'Extra reports', plannedStart: plus(13), plannedFinish: plus(15) });
    const v = await pm.get(`/api/projects/${P.id}/plan`);
    expect(v.approved).toBe(true);
    expect(v.baseline.kind).toBe('ORIGINAL');
    const row = v.items.find((i) => i.title === 'Build');
    expect(row.status).toBe('DELAYED');
    expect(row.finishVariance).toBeGreaterThan(0);
    expect(row.originalFinish).toBe(plus(12));
    expect(v.items.find((i) => i.title === 'Extra reports').status).toBe('ADDED');
    expect(v.summary.finishVariance).toBe(0); // the go-live milestone still holds
    expect(v.summary.status).toBe('AT_RISK'); // but a task slipped past its original date
    const list = await pm.get('/api/projects?q=ORN');
    expect(list.data[0].schedule.status).toBe(v.summary.status);
    // deleting a task shows it as removed scope; the original keeps its title
    const design = items.find((i) => i.title === 'Design');
    await pm.del(`/api/projects/${P.id}/work-items/${design.id}`);
    const v2 = await pm.get(`/api/projects/${P.id}/plan`);
    expect(v2.items.find((i) => i.id === design.id)).toMatchObject({ status: 'REMOVED', title: 'Design' });
  });
});

describe('changing task dates', () => {
  let P; let A; let B; let C;
  const addWD = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); let k = n; while (k > 0) { d.setUTCDate(d.getUTCDate() + 1); if (![0, 6].includes(d.getUTCDay())) k--; } return d.toISOString().slice(0, 10); };
  const monday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 14); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  it('sets up a chain A -> B -> C', async () => {
    const me = await pm.get('/api/auth/me');
    P = await pm.post('/api/projects', { name: 'Dates', code: 'DTS', managerId: me.user.id, plannedStart: today, plannedFinish: plus(90), status: 'ACTIVE' });
    A = await pm.post(`/api/projects/${P.id}/work-items`, { type: 'TASK', title: 'A', plannedStart: monday, plannedFinish: addWD(monday, 4) });
    B = await pm.post(`/api/projects/${P.id}/work-items`, { type: 'TASK', title: 'B', plannedStart: addWD(monday, 5), plannedFinish: addWD(monday, 9) });
    C = await pm.post(`/api/projects/${P.id}/work-items`, { type: 'TASK', title: 'C', plannedStart: addWD(monday, 10), plannedFinish: addWD(monday, 12) });
    await pm.post(`/api/projects/${P.id}/dependencies`, { predecessorId: A.id, successorId: B.id, type: 'FS' });
    await pm.post(`/api/projects/${P.id}/dependencies`, { predecessorId: B.id, successorId: C.id, type: 'FS' });
  });
  it('rejects half-typed and impossible dates', async () => {
    await expectStatus(pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedFinish: '0001-12-04', version: A.version }), 422);
    await expectStatus(pm.patch(`/api/projects/${P.id}/work-items/${A.id}`, { plannedFinish: '2026-02-30', version: A.version }), 422);
    await expectStatus(pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedFinish: new Date(Date.parse(`${monday}T00:00:00Z`) - 3 * 864e5).toISOString().slice(0, 10), version: A.version }), 400);
    const still = await pm.get(`/api/projects/${P.id}/work-items/${A.id}`);
    expect([still.plannedStart, still.plannedFinish]).toEqual([monday, addWD(monday, 4)]);
  });
  it('moving the start keeps the length; dependents need confirmation and then move', async () => {
    const newStart = addWD(monday, 2);
    const ask = await pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedStart: newStart, version: A.version });
    expect(ask).toMatchObject({ applied: false, needsConfirmation: true, start: newStart, finish: addWD(monday, 6) });
    expect(ask.adjusted).toMatchObject({ finish: addWD(monday, 6), days: 5 });
    expect(ask.moves.map((m) => m.title).sort()).toEqual(['B', 'C']);
    const unchanged = await pm.get(`/api/projects/${P.id}/work-items/${A.id}`);
    expect(unchanged.version).toBe(A.version);
    const done = await pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedStart: newStart, version: A.version, moveDependents: true, expectedMoves: ask.moves.map((m) => ({ id: m.id, start: m.to.start, finish: m.to.finish })) });
    expect(done).toMatchObject({ applied: true, dependentsStartingTooEarly: 0 });
    expect(done.moved.length).toBe(2);
    const b = await pm.get(`/api/projects/${P.id}/work-items/${B.id}`);
    expect(b.plannedStart > addWD(monday, 6)).toBe(true);
    expect(b.plannedFinish).toBe(addWD(b.plannedStart, 4)); // B keeps its 5 working days
    // stale version is refused
    await expectStatus(pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedFinish: addWD(monday, 20), version: A.version, moveDependents: false }), 409);
  });
  it('"only this task" leaves dependents and reports the clash; earlier dates never need confirmation', async () => {
    const a = await pm.get(`/api/projects/${P.id}/work-items/${A.id}`);
    const r = await pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedFinish: addWD(a.plannedFinish, 10), version: a.version, moveDependents: false });
    expect(r).toMatchObject({ applied: true, moved: [] });
    expect(r.dependentsStartingTooEarly).toBe(1);
    const back = await pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedFinish: a.plannedFinish, version: r.item.version });
    expect(back).toMatchObject({ applied: true, dependentsStartingTooEarly: 0 });
  });
  it('phase dates follow their tasks and the project reports where the work ends', async () => {
    const d = await pm.get(`/api/projects/${P.id}`);
    const all = (await pm.get(`/api/projects/${P.id}/work-items?all=true`)).data.filter((i) => i.type !== 'MODULE');
    expect(d.workFinish).toBe(all.map((i) => i.plannedFinish).filter(Boolean).sort().at(-1));
    for (const ph of d.phases.filter((x) => x.datesFrom === 'tasks')) {
      const own = all.filter((i) => i.phaseId === ph.id);
      expect(ph.plannedStart).toBe(own.map((i) => i.plannedStart || i.plannedFinish).filter(Boolean).sort()[0]);
      expect(ph.plannedFinish).toBe(own.map((i) => i.plannedFinish).filter(Boolean).sort().at(-1));
    }
    await expectStatus(dev.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedFinish: plus(30), version: 99 }), 404); // not on the team
  });
});

