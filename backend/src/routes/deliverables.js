import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, dateOnly, toDate, fmtDate, uuid, partialNoDefaults } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { projectAccess } from '../policies/access.js';
import * as S from '../policies/serializers.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';

const r = Router({ mergeParams: true });

// Documents are approved by the project director. A document shared with the client is approved by the
// director first and then by the client; the client only sees it once the director has approved it.
async function customerIds(projectId) {
  return new Set((await prisma.projectMember.findMany({ where: { projectId, role: 'CUSTOMER' }, select: { userId: true } })).map((m) => m.userId));
}
/** Who has to act next on a document in review: 'DIRECTOR' or 'CUSTOMER' (null when not in review). */
function stage(d, current, clients, project) {
  if (d.status !== 'IN_REVIEW') return null;
  if (!d.customerVisible) return 'DIRECTOR';
  const internalOk = (current?.approvals || []).some((a) => a.decision === 'APPROVED' && !clients.has(a.reviewerId));
  return internalOk || !project.directorId ? 'CUSTOMER' : 'DIRECTOR';
}

async function serialize(d, access, clients = null) {
  clients ??= await customerIds(access.project.id);
  const versions = await prisma.deliverableVersion.findMany({ where: { deliverableId: d.id }, orderBy: { versionNumber: 'desc' }, include: { approvals: { orderBy: { createdAt: 'asc' } }, files: { where: { deletedAt: null } } } });
  const users = await prisma.user.findMany({ where: { id: { in: versions.flatMap((v) => [v.createdById, ...v.approvals.map((a) => a.reviewerId)]) } }, select: { id: true, name: true } });
  const un = new Map(users.map((u) => [u.id, u.name]));
  const awaiting = stage(d, versions[0], clients, access.project);
  return {
    id: d.id, name: d.name, description: d.description, status: d.status, dueDate: fmtDate(d.dueDate), phaseId: d.phaseId, awaiting,
    canReviewNow: awaiting != null && (awaiting === 'CUSTOMER' ? access.isCustomer || access.role === 'ADMIN' : access.can('deliverable.review') && !access.isCustomer),
    ...(access.internal && { customerVisible: d.customerVisible, version: d.version }),
    currentVersion: versions[0]?.versionNumber ?? 0,
    versions: versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, note: v.note, createdAt: v.createdAt, createdBy: un.get(v.createdById),
      files: v.files.map((f) => S.file(f, access.isCustomer)),
      approvals: v.approvals.filter((a) => access.internal || clients.has(a.reviewerId) || a.decision === 'APPROVED')
        .map((a) => ({ reviewer: un.get(a.reviewerId), reviewerId: a.reviewerId, by: clients.has(a.reviewerId) ? 'CLIENT' : 'DIRECTOR', decision: a.decision,
          comment: access.internal || clients.has(a.reviewerId) ? a.comment : null, createdAt: a.createdAt })) })),
  };
}

const visibleWhere = (access) => (access.isCustomer ? { customerVisible: true, status: { not: 'DRAFT' } } : {});
// a client sees a document in review only after the director approved it
const clientCanSee = async (d, access) => {
  if (!access.isCustomer || d.status !== 'IN_REVIEW' || !access.project.directorId) return true;
  const v = await prisma.deliverableVersion.findFirst({ where: { deliverableId: d.id }, orderBy: { versionNumber: 'desc' }, include: { approvals: true } });
  const clients = await customerIds(access.project.id);
  return (v?.approvals || []).some((a) => a.decision === 'APPROVED' && !clients.has(a.reviewerId));
};

r.get('/deliverables', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  const rows = await prisma.deliverable.findMany({ where: { projectId: access.project.id, ...visibleWhere(access) }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });
  const clients = await customerIds(access.project.id);
  const shown = [];
  for (const d of rows) if (await clientCanSee(d, access)) shown.push(d);
  const director = access.project.directorId ? await prisma.user.findUnique({ where: { id: access.project.directorId }, select: { id: true, name: true } }) : null;
  res.json({ data: await Promise.all(shown.map((d) => serialize(d, access, clients))), canManage: access.can('deliverable.manage'), canReview: access.can('deliverable.review'), director });
});

const body = z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(5000).nullable().optional(), customerVisible: z.boolean().optional(), dueDate: dateOnly.nullable().optional(), phaseId: uuid.nullable().optional() });

r.post('/deliverables', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('deliverable.manage');
  const b = parse(body, req.body);
  if (b.phaseId && !(await prisma.phase.findFirst({ where: { id: b.phaseId, projectId: access.project.id } }))) throw badRequest('Phase not found');
  if (b.customerVisible && !access.project.customerVisible) throw badRequest('Share the project with the customer first');
  const d = await prisma.deliverable.create({ data: { ...b, dueDate: toDate(b.dueDate), projectId: access.project.id } });
  await audit(prisma, req.auth, { action: 'deliverable.created', entityType: 'Deliverable', entityId: d.id, projectId: access.project.id }, req.ip);
  res.status(201).json(await serialize(d, access));
});

async function load(access, id) {
  const d = await prisma.deliverable.findFirst({ where: { id, projectId: access.project.id, ...visibleWhere(access) } });
  if (!d || !(await clientCanSee(d, access))) throw notFound('Deliverable');
  return d;
}

r.patch('/deliverables/:id', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('deliverable.manage');
  const d = await load(access, req.params.id);
  const { version, ...b } = parse(partialNoDefaults(body).extend({ version: z.number().int() }), req.body);
  if (b.customerVisible && !access.project.customerVisible) throw badRequest('Share the project with the customer first');
  const n = await prisma.deliverable.updateMany({ where: { id: d.id, version }, data: { ...b, ...('dueDate' in b && { dueDate: toDate(b.dueDate) }), version: { increment: 1 } } });
  if (!n.count) throw conflict('This deliverable changed meanwhile. Reload and try again.');
  res.json(await serialize(await prisma.deliverable.findUnique({ where: { id: d.id } }), access));
});

// A new version always starts unapproved. Earlier approvals stay attached to the version they reviewed.
r.post('/deliverables/:id/versions', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('deliverable.manage');
  const d = await load(access, req.params.id);
  const { note } = parse(z.object({ note: z.string().max(2000).optional() }), req.body);
  const v = await prisma.$transaction(async (tx) => {
    const last = await tx.deliverableVersion.aggregate({ where: { deliverableId: d.id }, _max: { versionNumber: true } });
    const row = await tx.deliverableVersion.create({ data: { deliverableId: d.id, versionNumber: (last._max.versionNumber ?? 0) + 1, note, createdById: req.auth.userId } });
    await tx.deliverable.update({ where: { id: d.id }, data: { status: 'DRAFT', version: { increment: 1 } } });
    await audit(tx, req.auth, { action: 'deliverable.version_created', entityType: 'Deliverable', entityId: d.id, projectId: access.project.id, metadata: { versionNumber: row.versionNumber, previousStatus: d.status } }, req.ip);
    return row;
  });
  res.status(201).json({ id: v.id, versionNumber: v.versionNumber });
});

r.post('/deliverables/:id/submit', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('deliverable.manage');
  const d = await load(access, req.params.id);
  const v = await prisma.deliverableVersion.findFirst({ where: { deliverableId: d.id }, orderBy: { versionNumber: 'desc' }, include: { files: { where: { deletedAt: null } } } });
  if (!v) throw badRequest('Create a version and attach files first');
  if (!v.files.length) throw badRequest('Attach at least one file to the current version');
  if (d.status !== 'DRAFT' && d.status !== 'CHANGES_REQUESTED') throw conflict('This version is already in review or approved. Create a new version to resubmit.');
  if (d.status === 'CHANGES_REQUESTED' && (await prisma.approval.count({ where: { deliverableVersionId: v.id } }))) throw badRequest('Changes were requested on this version. Create a new version first.');
  await prisma.$transaction(async (tx) => {
    await tx.deliverable.update({ where: { id: d.id }, data: { status: 'IN_REVIEW', version: { increment: 1 } } });
    await audit(tx, req.auth, { action: 'deliverable.submitted', entityType: 'Deliverable', entityId: d.id, projectId: access.project.id, visibility: d.customerVisible ? 'PUBLIC' : 'INTERNAL', metadata: { versionNumber: v.versionNumber } }, req.ip);
    // the director reviews first; without a director a shared document goes straight to the client
    const reviewers = access.project.directorId ? [access.project.directorId]
      : d.customerVisible ? (await tx.projectMember.findMany({ where: { projectId: access.project.id, role: 'CUSTOMER' } })).map((m) => m.userId) : [];
    await notify(tx, { orgId: req.auth.orgId, userIds: reviewers, exclude: req.auth.userId, type: 'deliverable.review_requested', title: `Approval requested: ${d.name} (v${v.versionNumber})`, link: `/projects/${access.project.id}/approvals` });
  });
  res.json({ ok: true });
});

r.post('/deliverables/:id/review', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('deliverable.review');
  const d = await load(access, req.params.id);
  const b = parse(z.object({ versionNumber: z.number().int().min(1), decision: z.enum(['APPROVED', 'CHANGES_REQUESTED']), comment: z.string().max(5000).optional() }), req.body);
  if (b.decision === 'CHANGES_REQUESTED' && !b.comment) throw badRequest('Describe the changes you need');
  if (d.status !== 'IN_REVIEW') throw conflict('This deliverable is not awaiting review');
  const v = await prisma.deliverableVersion.findFirst({ where: { deliverableId: d.id }, orderBy: { versionNumber: 'desc' } });
  if (v.versionNumber !== b.versionNumber) throw conflict(`Version ${b.versionNumber} is no longer current; please review version ${v.versionNumber}`);
  const clients = await customerIds(access.project.id);
  const full = await prisma.deliverableVersion.findUnique({ where: { id: v.id }, include: { approvals: true } });
  const step = stage(d, full, clients, access.project);
  if (step === 'DIRECTOR' && access.isCustomer) throw forbidden('This document is waiting for the project director');
  if (step === 'CUSTOMER' && access.internal && access.role !== 'ADMIN') throw forbidden('The project director has approved this document; it is now with the client');
  if (access.internal && access.role !== 'ADMIN' && full.createdById === req.auth.userId) throw forbidden('You uploaded this version, so someone else has to approve it');
  // director approval of a client document keeps it in review and hands it to the client
  const handOver = step === 'DIRECTOR' && d.customerVisible && b.decision === 'APPROVED';
  const next = handOver ? 'IN_REVIEW' : b.decision;
  await prisma.$transaction(async (tx) => {
    const n = await tx.deliverable.updateMany({ where: { id: d.id, status: 'IN_REVIEW' }, data: { status: next, version: { increment: 1 } } });
    if (!n.count) throw conflict('This deliverable was reviewed meanwhile');
    await tx.approval.create({ data: { deliverableVersionId: v.id, reviewerId: req.auth.userId, decision: b.decision, comment: b.comment } });
    await audit(tx, req.auth, { action: `deliverable.${b.decision.toLowerCase()}`, entityType: 'Deliverable', entityId: d.id, projectId: access.project.id, visibility: d.customerVisible && step === 'CUSTOMER' ? 'PUBLIC' : 'INTERNAL', metadata: { versionNumber: v.versionNumber, comment: b.comment, by: step } }, req.ip);
    const mgrs = await tx.projectMember.findMany({ where: { projectId: access.project.id, role: 'MANAGER' } });
    const who = step === 'DIRECTOR' ? 'the project director' : 'the client';
    await notify(tx, { orgId: req.auth.orgId, userIds: mgrs.map((m) => m.userId), exclude: req.auth.userId, type: 'deliverable.reviewed', title: `${d.name} v${v.versionNumber}: ${b.decision === 'APPROVED' ? 'approved' : 'changes requested'} by ${who} (${req.auth.user.name})`, body: b.comment, link: `/projects/${access.project.id}/approvals` });
    if (handOver) await notify(tx, { orgId: req.auth.orgId, userIds: [...clients], exclude: req.auth.userId, type: 'deliverable.review_requested', title: `Approval requested: ${d.name} (v${v.versionNumber})`, link: `/projects/${access.project.id}/approvals` });
  });
  res.json(await serialize(await prisma.deliverable.findUnique({ where: { id: d.id } }), access));
});

export default r;
