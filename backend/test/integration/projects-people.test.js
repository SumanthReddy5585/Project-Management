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
