import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parse, dateOnly, toDate, fmtDate, uuid } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { projectAccess } from '../policies/access.js';
import * as S from '../policies/serializers.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';

const r = Router({ mergeParams: true });

async function serialize(d, access) {
  const versions = await prisma.deliverableVersion.findMany({ where: { deliverableId: d.id }, orderBy: { versionNumber: 'desc' }, include: { approvals: true, files: { where: { deletedAt: null } } } });
  const users = await prisma.user.findMany({ where: { id: { in: versions.flatMap((v) => [v.createdById, ...v.approvals.map((a) => a.reviewerId)]) } }, select: { id: true, name: true } });
  const un = new Map(users.map((u) => [u.id, u.name]));
  return {
    id: d.id, name: d.name, description: d.description, status: d.status, dueDate: fmtDate(d.dueDate), phaseId: d.phaseId,
    ...(access.internal && { customerVisible: d.customerVisible, version: d.version }),
    currentVersion: versions[0]?.versionNumber ?? 0,
    versions: versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, note: v.note, createdAt: v.createdAt, createdBy: un.get(v.createdById),
      files: v.files.map((f) => S.file(f, access.isCustomer)),
      approvals: v.approvals.map((a) => ({ reviewer: un.get(a.reviewerId), reviewerId: a.reviewerId, decision: a.decision, comment: a.comment, createdAt: a.createdAt })) })),
  };
}

const visibleWhere = (access) => (access.isCustomer ? { customerVisible: true, status: { not: 'DRAFT' } } : {});

r.get('/deliverables', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  const rows = await prisma.deliverable.findMany({ where: { projectId: access.project.id, ...visibleWhere(access) }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });
  res.json({ data: await Promise.all(rows.map((d) => serialize(d, access))), canManage: access.can('deliverable.manage'), canReview: access.can('deliverable.review') });
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
  if (!d) throw notFound('Deliverable');
  return d;
}

r.patch('/deliverables/:id', async (req, res) => {
  const access = await projectAccess(req.auth, req.params.projectId);
  access.require('deliverable.manage');
  const d = await load(access, req.params.id);
  const { version, ...b } = parse(body.partial().extend({ version: z.number().int() }), req.body);
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
    const reviewers = await tx.projectMember.findMany({ where: { projectId: access.project.id, role: d.customerVisible ? 'CUSTOMER' : 'MANAGER' } });
    await notify(tx, { orgId: req.auth.orgId, userIds: reviewers.map((m) => m.userId), exclude: req.auth.userId, type: 'deliverable.review_requested', title: `Review requested: ${d.name} (v${v.versionNumber})`, link: `/projects/${access.project.id}/deliverables` });
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
  if (access.internal && d.customerVisible && access.role !== 'ADMIN') throw forbidden('Customer-facing deliverables are approved by the customer');
  await prisma.$transaction(async (tx) => {
    const n = await tx.deliverable.updateMany({ where: { id: d.id, status: 'IN_REVIEW' }, data: { status: b.decision, version: { increment: 1 } } });
    if (!n.count) throw conflict('This deliverable was reviewed meanwhile');
    await tx.approval.create({ data: { deliverableVersionId: v.id, reviewerId: req.auth.userId, decision: b.decision, comment: b.comment } });
    await audit(tx, req.auth, { action: `deliverable.${b.decision.toLowerCase()}`, entityType: 'Deliverable', entityId: d.id, projectId: access.project.id, visibility: d.customerVisible ? 'PUBLIC' : 'INTERNAL', metadata: { versionNumber: v.versionNumber, comment: b.comment } }, req.ip);
    const mgrs = await tx.projectMember.findMany({ where: { projectId: access.project.id, role: 'MANAGER' } });
    await notify(tx, { orgId: req.auth.orgId, userIds: mgrs.map((m) => m.userId), exclude: req.auth.userId, type: 'deliverable.reviewed', title: `${d.name} v${v.versionNumber}: ${b.decision === 'APPROVED' ? 'approved' : 'changes requested'} by ${req.auth.user.name}`, body: b.comment, link: `/projects/${access.project.id}/deliverables` });
  });
  res.json(await serialize(await prisma.deliverable.findUnique({ where: { id: d.id } }), access));
});

export default r;
