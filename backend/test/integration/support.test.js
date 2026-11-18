// Support desk features over the real API: queue views, bulk triage, satisfaction ratings,
// canned replies, knowledge-base visibility, live-event scoping and database file storage.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, startServer, makeOrg, invite, login, expectStatus, prisma } from './helpers.js';
import { visibleTo } from '../../src/services/events.js';
import { DbStorage } from '../../src/storage/dbStorage.js';

let srv, base, A, admin, agent, cust, otherCust, contoso, fabrikam, t1, t2;

beforeAll(async () => {
  await resetDb();
  ({ server: srv, base } = await startServer());
  A = await makeOrg('Support Org', 'sup');
  admin = await login(base, A.adminEmail);
  contoso = await admin.post('/api/org/customers', { name: 'Contoso' });
  fabrikam = await admin.post('/api/org/customers', { name: 'Fabrikam' });
  agent = await invite(base, admin, { email: 'agent@sup.test', name: 'Ann Agent', role: 'EMPLOYEE' });
  cust = await invite(base, admin, { email: 'c@contoso.test', name: 'Cora Client', role: 'CUSTOMER', customerCompanyId: contoso.id });
  otherCust = await invite(base, admin, { email: 'f@fabrikam.test', name: 'Fred Other', role: 'CUSTOMER', customerCompanyId: fabrikam.id });
  t1 = await cust.post('/api/tickets', { subject: 'Login is broken', description: 'Cannot sign in', priority: 'HIGH', type: 'BUG' });
  t2 = await cust.post('/api/tickets', { subject: 'Need a report', description: 'Monthly report please' });
});
afterAll(async () => { srv?.close(); await prisma.$disconnect(); });

describe('queue', () => {
  it('lets every agent see the shared queue and counts saved views', async () => {
    const v = await agent.get('/api/tickets/views');
    expect(v).toMatchObject({ unassigned: 2, open: 2, mine: 0, new: 2 });
    const list = await agent.get('/api/tickets?view=unassigned');
    expect(list.data.map((t) => t.number).sort()).toEqual([t1.number, t2.number].sort());
  });
  it('bulk-assigns, tags and re-prioritises; skips illegal status moves', async () => {
    const r = await agent.post('/api/tickets/bulk', { ids: [t1.id, t2.id], assigneeId: agent.userId, addTag: 'triaged', priority: 'MEDIUM' });
    expect(r.updated).toBe(2);
    const mine = await agent.get('/api/tickets?view=mine');
    expect(mine.data).toHaveLength(2);
    expect(mine.data.every((t) => t.tags.includes('triaged') && t.status === 'OPEN')).toBe(true);
    const r2 = await agent.post('/api/tickets/bulk', { ids: [t1.id], status: 'NEW' });
    expect(r2.updated).toBe(0); expect(r2.skipped).toHaveLength(1);
  });
  it('never exposes tags to clients and blocks clients from bulk actions', async () => {
    const t = await cust.get(`/api/tickets/${t1.id}`);
    expect(t.tags).toBeUndefined();
    await expectStatus(cust.post('/api/tickets/bulk', { ids: [t1.id], priority: 'LOW' }), 403);
  });
  it('reports desk statistics to staff only', async () => {
    const s = await admin.get('/api/tickets/stats');
    expect(s.open).toBe(2);
    expect(s.trend.days).toHaveLength(14);
    await expectStatus(cust.get('/api/tickets/stats'), 403);
  });
});

describe('satisfaction ratings', () => {
  it('only the requester can rate, and only once resolved', async () => {
    await expectStatus(cust.post(`/api/tickets/${t1.id}/csat`, { rating: 5 }), 400);
    const cur = await agent.get(`/api/tickets/${t1.id}`);
    await agent.post(`/api/tickets/${t1.id}/status`, { status: 'RESOLVED', version: cur.version });
    await expectStatus(agent.post(`/api/tickets/${t1.id}/csat`, { rating: 1 }), 403);
    await expectStatus(otherCust.post(`/api/tickets/${t1.id}/csat`, { rating: 1 }), 404);
    const r = await cust.post(`/api/tickets/${t1.id}/csat`, { rating: 4, comment: 'Quick fix' });
    expect(r.rating).toBe(4);
    const s = await admin.get('/api/tickets/stats');
    expect(s.csat).toEqual({ average: 4, count: 1 });
  });
});

describe('canned replies', () => {
  it('agents manage their own; only the author or a manager can edit', async () => {
    const c = await agent.post('/api/canned-responses', { title: 'Hello', body: 'Hi {{requester}}' });
    const other = await invite(base, admin, { email: 'agent2@sup.test', name: 'Bo Agent', role: 'EMPLOYEE' });
    await expectStatus(other.patch(`/api/canned-responses/${c.id}`, { title: 'Hijack' }), 403);
    await admin.patch(`/api/canned-responses/${c.id}`, { title: 'Hello there' });
    expect((await other.get('/api/canned-responses')).data[0].title).toBe('Hello there');
    await expectStatus(cust.get('/api/canned-responses'), 403);
  });
});

describe('knowledge base', () => {
  it('shows clients only published public articles; word-order independent search', async () => {
    await agent.post('/api/kb/articles', { title: 'How to reset your password', body: 'Click forgot password', category: 'Accounts', published: true });
    await agent.post('/api/kb/articles', { title: 'Escalation playbook', body: 'internal steps', category: 'Internal', visibility: 'INTERNAL', published: true });
    const draft = await agent.post('/api/kb/articles', { title: 'Draft tips', body: 'not ready', published: false });
    const forClient = await cust.get('/api/kb/articles');
    expect(forClient.data.map((a) => a.title)).toEqual(['How to reset your password']);
    expect(forClient.data[0].helpfulYes).toBeUndefined();
    await expectStatus(cust.get(`/api/kb/articles/${draft.id}`), 404);
    expect((await cust.get('/api/kb/articles?q=password%20reset')).data).toHaveLength(1);
    expect((await agent.get('/api/kb/articles')).data).toHaveLength(3);
    await expectStatus(cust.post('/api/kb/articles', { title: 'Mine', body: 'x' }), 403);
    await expectStatus(agent.del(`/api/kb/articles/${draft.id}`), 403);
    await admin.del(`/api/kb/articles/${draft.id}`);
  });
});

describe('live events', () => {
  const base = { orgId: 'o1', type: 'ticket.updated', customerCompanyId: 'c1', assigneeId: 'u9', requesterId: 'u8' };
  it('scopes ticket events to the right client company and hides internal notes', () => {
    const client = { orgId: 'o1', userId: 'u8', isCustomer: true, customerCompanyId: 'c1' };
    expect(visibleTo(client, base, { canViewAllTickets: false })).toBe(true);
    expect(visibleTo(client, { ...base, internal: true }, { canViewAllTickets: false })).toBe(false);
    expect(visibleTo({ ...client, customerCompanyId: 'c2' }, base, { canViewAllTickets: false })).toBe(false);
    expect(visibleTo({ ...client, orgId: 'o2' }, base, { canViewAllTickets: false })).toBe(false);
    expect(visibleTo(client, { orgId: 'o1', type: 'work.changed', projectId: 'p' }, {})).toBe(false);
  });
  it('targets notifications at their recipients only', () => {
    const n = { orgId: 'o1', type: 'notification', userIds: ['u1'] };
    expect(visibleTo({ orgId: 'o1', userId: 'u1' }, n, {})).toBe(true);
    expect(visibleTo({ orgId: 'o1', userId: 'u2' }, n, {})).toBe(false);
  });
  it('streams events over SSE to a signed-in user', async () => {
    const res = await fetch(`${base_()}/api/events`, { headers: { cookie: agent.cookie } });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/retry: 5000|event: hello/);
    await cust.post(`/api/tickets/${t2.id}/messages`, { body: 'any update?' });
    let text = '';
    for (let i = 0; i < 5 && !text.includes('ticket.message'); i++) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`"ticketId":"${t2.id}"`);
    expect(text).not.toContain('any update?'); // ids only, never content
    await reader.cancel();
  });
});

describe('database file storage', () => {
  it('stores, streams, lists and removes bytes', async () => {
    const s = new DbStorage();
    const { key, sha256 } = await s.put(Buffer.from('hello world'));
    expect(sha256).toHaveLength(64);
    expect((await s.stat(key)).size).toBe(11);
    const chunks = []; for await (const c of s.open(key)) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe('hello world');
    const keys = []; for await (const f of s.list()) keys.push(f.key);
    expect(keys).toContain(key);
    await s.remove(key);
    expect(await s.stat(key)).toBeNull();
  });
});

function base_() { return base; }
