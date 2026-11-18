// Support desk extras: canned replies for agents and a knowledge base that clients can search.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, uuid } from '../lib/http.js';
import { forbidden, notFound } from '../lib/errors.js';
import { orgCan } from '../policies/permissions.js';
import { audit } from '../services/audit.js';
import { publish } from '../services/events.js';

const r = Router();
const staff = (auth) => { if (auth.isCustomer || !orgCan(auth, 'ticket.work')) throw forbidden(); };
const lead = (auth) => ['ADMIN', 'MANAGER'].includes(auth.orgRole);
const id = (v) => { if (!uuid.safeParse(v).success) throw notFound(); return v; };

// ---------- Canned replies ----------
const cannedBody = z.object({ title: z.string().trim().min(2).max(120), body: z.string().trim().min(1).max(10000) });

r.get('/canned-responses', async (req, res) => {
  staff(req.auth);
  const rows = await prisma.cannedResponse.findMany({ where: { organizationId: req.auth.orgId }, orderBy: { title: 'asc' } });
  res.json({ data: rows.map((c) => ({ id: c.id, title: c.title, body: c.body, canEdit: lead(req.auth) || c.createdById === req.auth.userId, updatedAt: c.updatedAt })) });
});

r.post('/canned-responses', async (req, res) => {
  staff(req.auth);
  const b = parse(cannedBody, req.body);
  const c = await prisma.cannedResponse.create({ data: { ...b, organizationId: req.auth.orgId, createdById: req.auth.userId } });
  await audit(prisma, req.auth, { action: 'canned.created', entityType: 'CannedResponse', entityId: c.id }, req.ip);
  res.status(201).json({ id: c.id, title: c.title, body: c.body, canEdit: true });
});

async function ownCanned(req) {
  staff(req.auth);
  const c = await prisma.cannedResponse.findFirst({ where: { id: id(req.params.id), organizationId: req.auth.orgId } });
  if (!c) throw notFound('Canned reply');
  if (!lead(req.auth) && c.createdById !== req.auth.userId) throw forbidden('Only the author or a manager can change this reply');
  return c;
}

r.patch('/canned-responses/:id', async (req, res) => {
  const c = await ownCanned(req);
  const b = parse(cannedBody.partial(), req.body);
  const u = await prisma.cannedResponse.update({ where: { id: c.id }, data: b });
  res.json({ id: u.id, title: u.title, body: u.body, canEdit: true });
});

r.delete('/canned-responses/:id', async (req, res) => {
  const c = await ownCanned(req);
  await prisma.cannedResponse.delete({ where: { id: c.id } });
  await audit(prisma, req.auth, { action: 'canned.deleted', entityType: 'CannedResponse', entityId: c.id }, req.ip);
  res.status(204).end();
});

// ---------- Knowledge base ----------
const articleWhere = (auth) => (auth.isCustomer ? { organizationId: auth.orgId, published: true, visibility: 'PUBLIC' } : { organizationId: auth.orgId });
const articleOut = (a, auth, names, full = false) => ({
  id: a.id, title: a.title, category: a.category, published: a.published, updatedAt: a.updatedAt, views: a.views,
  excerpt: a.body.replace(/\s+/g, ' ').slice(0, 180),
  ...(full && { body: a.body }),
  ...(!auth.isCustomer && { visibility: a.visibility, authorName: names?.get(a.authorId) ?? null, helpfulYes: a.helpfulYes, helpfulNo: a.helpfulNo }),
});
const articleBody = z.object({ title: z.string().trim().min(3).max(200), body: z.string().trim().min(1).max(50000), category: z.string().trim().min(1).max(60).default('General'),
  visibility: z.enum(['PUBLIC', 'INTERNAL']).default('PUBLIC'), published: z.boolean().default(false) });

async function authorNames(rows) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((a) => a.authorId))] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

r.get('/kb/articles', async (req, res) => {
  const q = parse(z.object({ q: z.string().max(100).optional(), category: z.string().max(60).optional() }), req.query);
  const where = { ...articleWhere(req.auth), ...(q.category && { category: q.category }),
    // every word must appear in the title or body, in any order ("password reset" finds "How to reset your password")
    ...(q.q && { AND: q.q.trim().split(/\s+/).slice(0, 6).map((w) => ({ OR: [{ title: { contains: w, mode: 'insensitive' } }, { body: { contains: w, mode: 'insensitive' } }] })) }) };
  const rows = await prisma.knowledgeArticle.findMany({ where, orderBy: [{ published: 'desc' }, { visibility: 'desc' }, { views: 'desc' }, { updatedAt: 'desc' }], take: 200 });
  const all = await prisma.knowledgeArticle.groupBy({ by: ['category'], where: articleWhere(req.auth), _count: { _all: true } });
  const names = req.auth.isCustomer ? null : await authorNames(rows);
  res.json({ data: rows.map((a) => articleOut(a, req.auth, names)), categories: all.map((c) => ({ name: c.category, count: c._count._all })).sort((a, b) => a.name.localeCompare(b.name)) });
});

r.get('/kb/articles/:id', async (req, res) => {
  const a = await prisma.knowledgeArticle.findFirst({ where: { id: id(req.params.id), ...articleWhere(req.auth) } });
  if (!a) throw notFound('Article');
  if (a.published) await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { views: { increment: 1 } } });
  res.json({ ...articleOut(a, req.auth, await authorNames([a]), true), canEdit: !req.auth.isCustomer && orgCan(req.auth, 'ticket.work') });
});

r.post('/kb/articles', async (req, res) => {
  staff(req.auth);
  const b = parse(articleBody, req.body);
  const a = await prisma.knowledgeArticle.create({ data: { ...b, organizationId: req.auth.orgId, authorId: req.auth.userId } });
  await audit(prisma, req.auth, { action: 'kb.created', entityType: 'KnowledgeArticle', entityId: a.id, metadata: { title: a.title } }, req.ip);
  publish({ orgId: req.auth.orgId, type: 'kb.changed', actorId: req.auth.userId });
  res.status(201).json(articleOut(a, req.auth, null, true));
});

r.patch('/kb/articles/:id', async (req, res) => {
  staff(req.auth);
  const a = await prisma.knowledgeArticle.findFirst({ where: { id: id(req.params.id), organizationId: req.auth.orgId } });
  if (!a) throw notFound('Article');
  const b = parse(articleBody.partial(), req.body);
  const u = await prisma.knowledgeArticle.update({ where: { id: a.id }, data: b });
  await audit(prisma, req.auth, { action: 'kb.updated', entityType: 'KnowledgeArticle', entityId: a.id, metadata: { fields: Object.keys(b) } }, req.ip);
  publish({ orgId: req.auth.orgId, type: 'kb.changed', actorId: req.auth.userId });
  res.json(articleOut(u, req.auth, null, true));
});

r.delete('/kb/articles/:id', async (req, res) => {
  if (!lead(req.auth)) throw forbidden('Only managers can delete articles');
  const a = await prisma.knowledgeArticle.findFirst({ where: { id: id(req.params.id), organizationId: req.auth.orgId } });
  if (!a) throw notFound('Article');
  await prisma.knowledgeArticle.delete({ where: { id: a.id } });
  await audit(prisma, req.auth, { action: 'kb.deleted', entityType: 'KnowledgeArticle', entityId: a.id, metadata: { title: a.title } }, req.ip);
  res.status(204).end();
});

r.post('/kb/articles/:id/feedback', async (req, res) => {
  const { helpful } = parse(z.object({ helpful: z.boolean() }), req.body);
  const a = await prisma.knowledgeArticle.findFirst({ where: { id: id(req.params.id), ...articleWhere(req.auth), published: true } });
  if (!a) throw notFound('Article');
  await prisma.knowledgeArticle.update({ where: { id: a.id }, data: helpful ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } } });
  res.json({ ok: true });
});

export default r;
