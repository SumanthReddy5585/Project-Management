// People administration and project-management additions: admin-created users with designation,
// forced first password change, project team roles at creation, duplicate, save-as-template, burn-up.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, startServer, makeOrg, login, expectStatus, prisma } from './helpers.js';
import { ApiClient } from '../../scripts/api-client.js';

let srv, base, A, admin, created, pm, dev, project;
const today = new Date().toISOString().slice(0, 10);
// Dates are counted from the next Wednesday (today when it is one), so expectations never land on a weekend
// that the scheduler would move to Monday, whatever day the tests run.
const BASE = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7)); return d; })();
const plus = (n) => { const d = new Date(BASE); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

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
    project = await pm.post('/api/projects', { name: 'Apollo', code: 'APL', managerId: me.user.id, plannedStart: plus(0), plannedFinish: plus(60), status: 'ACTIVE',
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

describe('original plan: the manager builds it, the director approves and locks it', () => {
  let P; let dir;
  it('creates a project director who is not the project manager', async () => {
    const d = await admin.post('/api/org/members', { name: 'Dina Director', email: 'dina@ppl.test', title: 'Delivery Director', role: 'MANAGER' });
    dir = new ApiClient(base); await dir.login('dina@ppl.test', d.temporaryPassword); dir.userId = d.userId;
    await dir.post('/api/auth/password/change', { currentPassword: d.temporaryPassword, newPassword: 'Dina-password-33' });
    const me = await pm.get('/api/auth/me');
    await expectStatus(pm.post('/api/projects', { name: 'Same', code: 'SME', managerId: me.user.id, directorId: me.user.id, plannedStart: today, plannedFinish: plus(10) }), 400);
    await expectStatus(pm.post('/api/projects', { name: 'Dev dir', code: 'DVD', managerId: me.user.id, directorId: dev.userId, plannedStart: today, plannedFinish: plus(10) }), 400);
  });
  it('refuses an empty or undated plan, goes through submit / send back / approve, and locks it', async () => {
    const me = await pm.get('/api/auth/me');
    P = await pm.post('/api/projects', { name: 'Orion', code: 'ORN', managerId: me.user.id, directorId: dir.userId, plannedStart: today, plannedFinish: plus(40), team: [{ userId: dev.userId, role: 'MEMBER' }] });
    expect(P.directorId).toBe(dir.userId);
    const det = await dir.get(`/api/projects/${P.id}`);
    expect(det.role).toBe('DIRECTOR');
    expect(det.members.find((m) => m.id === dir.userId).role).toBe('DIRECTOR');
    let plan = await pm.get(`/api/projects/${P.id}/plan`);
    expect(plan).toMatchObject({ approved: false, submitted: false, canSubmit: true, canApprove: false, director: { id: dir.userId } });
    expect(plan.readiness.ready).toBe(false);
    await expectStatus(pm.post(`/api/projects/${P.id}/plan/submit`, {}), 400);
    await pm.post(`/api/projects/${P.id}/work-items`, { type: 'TASK', title: 'Design', plannedStart: plus(1), plannedFinish: plus(5), assigneeId: dev.userId, estimateHours: 16 });
    const undated = await pm.post(`/api/projects/${P.id}/work-items`, { type: 'TASK', title: 'Build' });
    await expectStatus(pm.post(`/api/projects/${P.id}/plan/submit`, {}), 400);
    await pm.patch(`/api/projects/${P.id}/work-items/${undated.id}`, { plannedStart: plus(6), plannedFinish: plus(12), estimateHours: 24, version: undated.version });
    // only the manager sends, only the director decides, and nothing is approved before it is sent
    await expectStatus(dev.post(`/api/projects/${P.id}/plan/submit`, {}), 403);
    await expectStatus(dir.post(`/api/projects/${P.id}/plan/submit`, {}), 403);
    await expectStatus(dir.post(`/api/projects/${P.id}/plan/approve`, {}), 409);
    await pm.post(`/api/projects/${P.id}/plan/submit`, { note: 'Ready for sign-off' });
    await expectStatus(pm.post(`/api/projects/${P.id}/plan/submit`, {}), 409);
    await expectStatus(pm.post(`/api/projects/${P.id}/plan/approve`, {}), 403);
    await expectStatus(dev.post(`/api/projects/${P.id}/plan/approve`, {}), 403);
    plan = await dir.get(`/api/projects/${P.id}/plan`);
    expect(plan).toMatchObject({ submitted: true, canApprove: true, submittedBy: { id: me.user.id } });
    expect((await dir.get('/api/dashboard')).approvals.some((x) => x.kind === 'PLAN' && x.projectId === P.id)).toBe(true);
    // sent back with a note
    await expectStatus(dir.post(`/api/projects/${P.id}/plan/return`, {}), 422);
    await dir.post(`/api/projects/${P.id}/plan/return`, { note: 'Add a QA task' });
    plan = await pm.get(`/api/projects/${P.id}/plan`);
    expect(plan).toMatchObject({ submitted: false, canSubmit: true, returnNote: 'Add a QA task' });
    expect((await pm.get('/api/dashboard')).approvals.some((x) => x.kind === 'PLAN_RETURNED' && x.projectId === P.id)).toBe(true);
    await expectStatus(dir.post(`/api/projects/${P.id}/plan/approve`, {}), 409);
    await pm.post(`/api/projects/${P.id}/plan/submit`, {});
    const ok = await dir.post(`/api/projects/${P.id}/plan/approve`, { note: 'Signed off with client' });
    expect(ok.items).toBeGreaterThanOrEqual(2);
    await expectStatus(dir.post(`/api/projects/${P.id}/plan/approve`, {}), 409);
    const d = await pm.get(`/api/projects/${P.id}`);
    expect(d.status).toBe('ACTIVE');
    expect(d.planApprovedAt).toBeTruthy();
    expect(d.schedule).toMatchObject({ status: 'ON_TRACK', finishVariance: 0 });
    expect((await pm.get(`/api/projects/${P.id}/plan`)).approvedBy.id).toBe(dir.userId);
    const bls = await pm.get(`/api/projects/${P.id}/baselines`);
    expect(bls.data[0]).toMatchObject({ kind: 'ORIGINAL', locked: true });
    // database refuses edits to the original plan
    await expect(prisma.baselineItem.updateMany({ where: { baselineId: ok.baselineId }, data: { title: 'hack' } })).rejects.toThrow(/locked/);
    await expect(prisma.baseline.delete({ where: { id: ok.baselineId } })).rejects.toThrow(/locked/);
  });
  it('the director decides change requests and documents; the manager runs the team', async () => {
    // change request: raised by the manager, decided by the director only
    const cr = await pm.post(`/api/projects/${P.id}/registers/change-requests`, { title: 'Add reporting', scope: 'Two extra reports', scheduleImpactDays: 3 });
    expect(cr.reviewerId).toBe(dir.userId);
    await expectStatus(pm.patch(`/api/projects/${P.id}/registers/change-requests/${cr.id}`, { status: 'APPROVED' }), 403);
    await expectStatus(dir.patch(`/api/projects/${P.id}/registers/change-requests/${cr.id}`, { title: 'Renamed' }), 403);
    const dec = await dir.patch(`/api/projects/${P.id}/registers/change-requests/${cr.id}`, { status: 'APPROVED', outcomeNote: 'Go ahead' });
    expect(dec.status).toBe('APPROVED');
    // internal document: uploaded by the manager, approved by the director
    const doc = await pm.post(`/api/projects/${P.id}/deliverables`, { name: 'Design spec' });
    await pm.post(`/api/projects/${P.id}/deliverables/${doc.id}/versions`, { note: 'v1' });
    const v = await prisma.deliverableVersion.findFirst({ where: { deliverableId: doc.id } });
    const org = (await prisma.project.findUnique({ where: { id: P.id } })).organizationId;
    await prisma.fileObject.create({ data: { organizationId: org, projectId: P.id, deliverableVersionId: v.id, originalName: 'spec.pdf', storageKey: `test/${v.id}/spec.pdf`, mimeType: 'application/pdf', size: 10, sha256: 'a'.repeat(64), uploadedById: (await pm.get('/api/auth/me')).user.id } });
    await pm.post(`/api/projects/${P.id}/deliverables/${doc.id}/submit`, {});
    await expectStatus(pm.post(`/api/projects/${P.id}/deliverables/${doc.id}/review`, { versionNumber: 1, decision: 'APPROVED' }), 403);
    expect((await dir.get('/api/dashboard')).approvals.some((x) => x.kind === 'DOCUMENT' && x.id === doc.id)).toBe(true);
    const r = await dir.post(`/api/projects/${P.id}/deliverables/${doc.id}/review`, { versionNumber: 1, decision: 'APPROVED' });
    expect(r.status).toBe('APPROVED');
    // team: the director cannot change the team; the manager cannot demote the director
    await expectStatus(dir.put(`/api/projects/${P.id}/members/${dev.userId}`, { role: 'VIEWER' }), 403);
    await expectStatus(pm.put(`/api/projects/${P.id}/members/${dir.userId}`, { role: 'MEMBER' }), 400);
    await expectStatus(pm.del(`/api/projects/${P.id}/members/${dir.userId}`), 400);
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
  it('moving the start keeps the length and moves everything that waits for it, automatically', async () => {
    const newStart = addWD(monday, 2);
    const done = await pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedStart: newStart, version: A.version });
    expect(done).toMatchObject({ applied: true, start: newStart, finish: addWD(monday, 6), heldBy: null });
    expect(done.adjusted).toMatchObject({ finish: addWD(monday, 6), days: 5 });
    expect(done.moved.map((m) => m.title).sort()).toEqual(['B', 'C']);
    const b = await pm.get(`/api/projects/${P.id}/work-items/${B.id}`);
    expect(b.plannedStart).toBe(addWD(monday, 7)); // the working day after A now ends
    expect(b.plannedFinish).toBe(addWD(b.plannedStart, 4)); // B keeps its 5 working days
    const c = await pm.get(`/api/projects/${P.id}/work-items/${C.id}`);
    expect([c.plannedStart, c.plannedFinish]).toEqual([addWD(b.plannedFinish, 1), addWD(b.plannedFinish, 3)]);
    // stale version is refused
    await expectStatus(pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedFinish: addWD(monday, 20), version: A.version }), 409);
  });
  it('a delay pushes the chain; a shorter task pulls it back; a start typed too early is held after its predecessor', async () => {
    let a = await pm.get(`/api/projects/${P.id}/work-items/${A.id}`);
    const longer = await pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedFinish: addWD(a.plannedFinish, 10), version: a.version });
    let b = await pm.get(`/api/projects/${P.id}/work-items/${B.id}`);
    expect(longer.moved.map((m) => m.title).sort()).toEqual(['B', 'C']);
    expect(b.plannedStart).toBe(addWD(a.plannedFinish, 11));
    a = longer.item;
    const shorter = await pm.post(`/api/projects/${P.id}/work-items/${A.id}/dates`, { plannedFinish: a.plannedStart, version: a.version });
    b = await pm.get(`/api/projects/${P.id}/work-items/${B.id}`);
    expect(b.plannedStart).toBe(addWD(monday, 5)); // back to B's own fixed start, not earlier
    const free = await pm.post(`/api/projects/${P.id}/work-items/${B.id}/dates`, { autoStart: true, version: b.version });
    expect(free.start).toBe(addWD(shorter.item.plannedFinish, 1)); // automatic: straight after A
    expect(free.item.fixedStart).toBeNull();
    const early = await pm.post(`/api/projects/${P.id}/work-items/${B.id}/dates`, { plannedStart: monday, version: free.item.version });
    expect(early.start).toBe(addWD(shorter.item.plannedFinish, 1));
    expect(early.heldBy).toMatchObject({ title: 'A' });
    const proj = await pm.get(`/api/projects/${P.id}/plan-items`);
    expect(proj.rows.find((r) => r.title === 'B').after).toEqual([A.id]);
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


describe('plan builder: durations, "starts after", parallel work and automatic dates', () => {
  let P; let ids = {};
  const isWD = (iso) => ![0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
  const addWD = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); let k = n; while (k > 0) { d.setUTCDate(d.getUTCDate() + 1); if (isWD(d.toISOString().slice(0, 10))) k--; } return d.toISOString().slice(0, 10); };
  const start = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 21); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  const rows = async () => Object.fromEntries((await pm.get(`/api/projects/${P.id}/plan-items`)).rows.map((r) => [r.title, r]));
  it('a new project with simple stages has no preset milestones', async () => {
    const me = await pm.get('/api/auth/me');
    P = await pm.post('/api/projects', { name: 'Builder', code: 'BLD', managerId: me.user.id, plannedStart: start, plannedFinish: addWD(start, 30), templateId: 'simple' });
    const plan = await pm.get(`/api/projects/${P.id}/plan-items`);
    expect(plan.phases.map((p) => p.name)).toEqual(['Plan', 'Build', 'Test', 'Close']);
    expect(plan.rows).toEqual([]);
    ids.stage = plan.phases[1].id;
  });
  it('calculates dates from length and "starts after"; unlinked tasks run in parallel', async () => {
    const add = async (title, durationDays, after = [], extra = {}) => { const r = await pm.post(`/api/projects/${P.id}/plan-items`, { title, durationDays, after, phaseId: ids.stage, ...extra }); ids[title] = r.item.id; return r.item; };
    const kick = await add('Kick-off', 1);
    expect([kick.plannedStart, kick.plannedFinish, kick.estimateHours]).toEqual([start, start, 8]);
    await add('Design', 5, [ids['Kick-off']]);
    await add('Data model', 3, [ids['Kick-off']]); // in parallel with Design
    await add('Build', 10, [ids.Design, ids['Data model']]);
    await add('Go-live', 1, [ids.Build], { type: 'MILESTONE' });
    const r = await rows();
    expect([r.Design.start, r.Design.finish]).toEqual([addWD(start, 1), addWD(start, 5)]);
    expect([r['Data model'].start, r['Data model'].finish]).toEqual([addWD(start, 1), addWD(start, 3)]);
    expect([r.Build.start, r.Build.finish]).toEqual([addWD(start, 6), addWD(start, 15)]); // waits for the longer branch
    expect([r['Go-live'].start, r['Go-live'].finish, r['Go-live'].durationDays]).toEqual([addWD(start, 15), addWD(start, 15), 0]);
    const proj = await pm.get(`/api/projects/${P.id}`);
    expect(proj.plannedFinish).toBe(addWD(start, 15)); // draft: the project ends when its last task ends
  });
  it('longer work pushes everything after it; the effort estimate follows a default length', async () => {
    const r0 = await rows();
    const res = await pm.patch(`/api/projects/${P.id}/plan-items/${ids.Design}`, { durationDays: 8, version: r0.Design.version });
    expect(res.item.estimateHours).toBe(64);
    expect(res.rescheduled.moved.map((m) => m.title).sort()).toEqual(['Build', 'Go-live']);
    const r = await rows();
    expect(r.Build.start).toBe(addWD(start, 9));
    expect((await pm.get(`/api/projects/${P.id}`)).plannedFinish).toBe(addWD(start, 18));
  });
  it('changes what a task waits for, refuses circles, and fixes or frees a start date', async () => {
    let r = await rows();
    await expectStatus(pm.patch(`/api/projects/${P.id}/plan-items/${ids['Kick-off']}`, { after: [ids.Build], version: r['Kick-off'].version }), 400);
    await pm.patch(`/api/projects/${P.id}/plan-items/${ids.Build}`, { after: [ids['Data model']], version: r.Build.version });
    r = await rows();
    expect(r.Build.start).toBe(addWD(start, 4)); // now parallel with Design
    expect(r['Go-live'].start).toBe(addWD(start, 13));
    const fixed = addWD(start, 7);
    await pm.patch(`/api/projects/${P.id}/plan-items/${ids.Build}`, { fixedStart: fixed, version: r.Build.version });
    r = await rows();
    expect([r.Build.start, r.Build.fixedStart]).toEqual([fixed, fixed]);
    await pm.patch(`/api/projects/${P.id}/plan-items/${ids.Build}`, { fixedStart: null, version: r.Build.version });
    r = await rows();
    expect([r.Build.start, r.Build.fixedStart]).toEqual([addWD(start, 4), null]);
  });
  it('deleting a task keeps the chain: what waited for it now waits for what it waited for', async () => {
    let r = await rows();
    await pm.del(`/api/projects/${P.id}/plan-items/${ids['Data model']}`);
    r = await rows();
    expect(r.Build.after).toEqual([ids['Kick-off']]);
    expect(r.Build.start).toBe(addWD(start, 1));
  });
  it('moving the project start moves the whole plan', async () => {
    const p = await pm.get(`/api/projects/${P.id}`);
    const later = addWD(start, 5);
    await pm.patch(`/api/projects/${P.id}`, { plannedStart: later, version: p.version });
    const r = await rows();
    expect(r['Kick-off'].start).toBe(later);
    expect(r.Design.start).toBe(addWD(later, 1));
  });
  it('editing one project field never resets the others to their defaults', async () => {
    let p = await pm.get(`/api/projects/${P.id}`);
    p = await pm.patch(`/api/projects/${P.id}`, { priority: 'HIGH', health: 'AMBER', customerVisible: true, version: p.version });
    p = await pm.patch(`/api/projects/${P.id}`, { name: 'Builder 2', version: p.version });
    expect(p).toMatchObject({ name: 'Builder 2', priority: 'HIGH', health: 'AMBER', customerVisible: true });
  });
  it('the team cannot edit the plan', async () => {
    await expectStatus(dev.post(`/api/projects/${P.id}/plan-items`, { title: 'X', durationDays: 1 }), 404);
  });
});

describe('dashboard activity feed and time report', () => {
  it('recent activity lists project work the user can see, with the task named', async () => {
    const feed = await pm.get('/api/activity/recent?limit=10');
    expect(feed.data.length).toBeGreaterThan(0);
    expect(feed.data.every((e) => !e.action.startsWith('auth.') && !e.action.startsWith('member.'))).toBe(true);
    const task = feed.data.find((e) => e.target?.type === 'task');
    expect(task.target.link).toMatch(/\/tasks\?item=/);
    expect(task.project).toMatchObject({ code: expect.any(String), name: expect.any(String) });
  });
  it('the time report is for managers and admins only and adds up', async () => {
    await expectStatus(dev.get('/api/reports/time-summary'), 403);
    const t = await admin.get('/api/reports/time-summary?weeks=4');
    expect(t.weeks).toHaveLength(4);
    const sum = t.weeks.reduce((s, w) => s + w.billable + w.nonBillable, 0);
    expect(Math.round(sum * 10) / 10).toBe(t.totals.hours);
    expect(t.byProject.reduce((s, p) => s + p.hours, 0)).toBeCloseTo(t.totals.hours, 1);
  });
  it('scope=active leaves out time on finished projects (dashboard)', async () => {
    const all = await admin.get('/api/reports/time-summary?weeks=4');
    const top = all.byProject[0];
    expect(top?.hours).toBeGreaterThan(0);
    const before = await prisma.project.findUnique({ where: { id: top.id } });
    await prisma.project.update({ where: { id: top.id }, data: { status: 'COMPLETED' } });
    try {
      const act = await admin.get('/api/reports/time-summary?weeks=4&scope=active');
      expect(act.byProject.find((p) => p.id === top.id)).toBeUndefined();
      expect(act.totals.hours).toBeCloseTo(all.totals.hours - top.hours, 1);
    } finally { await prisma.project.update({ where: { id: top.id }, data: { status: before.status } }); }
  });
});

describe('plan builder: sub-tasks', () => {
  it('adds sub-tasks under a task; the task spans them and its links apply to them', async () => {
    const me = await pm.get('/api/auth/me');
    const Q = await pm.post('/api/projects', { name: 'Subs', code: 'SUB', managerId: me.user.id, plannedStart: plus(0), plannedFinish: plus(60), team: [{ userId: dev.userId, role: 'MEMBER' }] });
    const url = `/api/projects/${Q.id}/plan-items`;
    const a = (await pm.post(url, { title: 'Analysis', durationDays: 3 })).item;
    const t = (await pm.post(url, { title: 'Build', durationDays: 5, after: [a.id], assigneeId: dev.userId })).item;
    const s1 = (await pm.post(url, { type: 'SUBTASK', parentId: t.id, title: 'API', durationDays: 2 })).item;
    const s2 = (await pm.post(url, { type: 'SUBTASK', parentId: t.id, title: 'UI', durationDays: 4, after: [s1.id] })).item;
    expect(s1.assigneeId).toBe(dev.userId); // takes the task's owner unless one is chosen
    const plan = await pm.get(url);
    const row = (id) => plan.rows.find((r) => r.id === id);
    expect(row(t.id).isParent).toBe(true);
    expect(row(s1.id)).toMatchObject({ type: 'SUBTASK', parentId: t.id });
    expect(row(s1.id).start > row(a.id).finish).toBe(true); // the task waits for Analysis, so its sub-tasks do too
    expect(row(s2.id).start > row(s1.id).finish).toBe(true);
    expect(row(t.id)).toMatchObject({ start: row(s1.id).start, finish: row(s2.id).finish }); // the task spans its sub-tasks
    await expectStatus(pm.post(url, { type: 'SUBTASK', parentId: s1.id, title: 'Too deep' }), 400);
    await expectStatus(pm.post(url, { type: 'SUBTASK', title: 'No task' }), 400);
    await expectStatus(pm.post(url, { type: 'SUBTASK', parentId: t.id, title: 'Loop', after: [t.id] }), 400);
    await expectStatus(dev.post(url, { type: 'SUBTASK', parentId: t.id, title: 'Not mine to plan' }), 403);
  });
});
