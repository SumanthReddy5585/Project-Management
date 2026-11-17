import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { parse, uuid } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { storage } from '../storage/index.js';
import { resolveTarget } from '../services/targets.js';
import { audit } from '../services/audit.js';
import * as S from '../policies/serializers.js';

const r = Router();
// Allowlist by extension; the stored content type is derived from the extension, never trusted from the client.
const TYPES = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.txt': 'text/plain', '.csv': 'text/csv', '.md': 'text/markdown', '.json': 'application/json', '.zip': 'application/zip',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
// Types that may be shown inline. Everything else downloads as an attachment.
const INLINE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAGIC = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/gif': [0x47, 0x49, 0x46], 'application/zip': [0x50, 0x4b] };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 5 } });
const TARGETS = z.enum(['workItem', 'ticket', 'project', 'deliverableVersion']);
const safeName = (n) => path.basename(n).replace(/[\u0000-\u001f\u007f"\\/]/g, '_').slice(0, 200) || 'file';

r.post('/', upload.array('files', 5), async (req, res) => {
  const b = parse(z.object({ targetType: TARGETS, targetId: uuid, visibility: z.enum(['INTERNAL', 'PUBLIC']).default('INTERNAL') }), req.body);
  if (!req.files?.length) throw badRequest('Attach at least one file');
  const t = await resolveTarget(req.auth, b.targetType, b.targetId);
  const visibility = t.isCustomer || b.targetType === 'deliverableVersion' ? 'PUBLIC' : b.visibility;
  if (visibility === 'INTERNAL' && !t.canUploadInternal) throw forbidden();
  if (visibility === 'PUBLIC' && !t.canUploadPublic) throw forbidden(b.targetType === 'workItem' ? 'This item is not shared with the customer; upload as internal' : undefined);
  const out = [];
  for (const f of req.files) {
    const name = safeName(Buffer.from(f.originalname, 'latin1').toString('utf8'));
    const mime = TYPES[path.extname(name).toLowerCase()];
    if (!mime) throw badRequest(`${name}: file type not allowed`);
    const sig = MAGIC[mime];
    if (sig && !sig.every((byte, i) => f.buffer[i] === byte) && !(mime.includes('officedocument') )) throw badRequest(`${name}: content does not match its extension`);
    if (/officedocument/.test(mime) && !(f.buffer[0] === 0x50 && f.buffer[1] === 0x4b)) throw badRequest(`${name}: content does not match its extension`);
    const { key, sha256 } = await storage.put(f.buffer);
    try {
      const row = await prisma.fileObject.create({ data: { organizationId: req.auth.orgId, ...t.fk, storageKey: key, originalName: name, mimeType: mime, size: f.size, sha256, visibility, uploadedById: req.auth.userId } });
      await audit(prisma, req.auth, { action: 'file.uploaded', entityType: b.targetType, entityId: b.targetId, projectId: t.projectId, visibility, metadata: { fileId: row.id, name } }, req.ip);
      out.push(S.file(row, t.isCustomer));
    } catch (e) { await storage.remove(key); throw e; }
  }
  res.status(201).json({ data: out });
});

r.get('/', async (req, res) => {
  const q = parse(z.object({ targetType: TARGETS, targetId: uuid }), req.query);
  const t = await resolveTarget(req.auth, q.targetType, q.targetId);
  const where = { organizationId: req.auth.orgId, ...t.fk, deletedAt: null, ...(t.isCustomer && { visibility: 'PUBLIC' }) };
  if (q.targetType === 'project') Object.assign(where, { workItemId: null, ticketId: null, deliverableVersionId: null });
  else delete where.projectId;
  const rows = await prisma.fileObject.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ data: rows.map((f) => S.file(f, t.isCustomer)), canUploadInternal: Boolean(t.canUploadInternal), canUploadPublic: Boolean(t.canUploadPublic) });
});

async function authorizedFile(auth, id) {
  const f = await prisma.fileObject.findFirst({ where: { id, organizationId: auth.orgId, deletedAt: null } });
  if (!f) throw notFound('File');
  const [type, tid] = f.workItemId ? ['workItem', f.workItemId] : f.ticketId ? ['ticket', f.ticketId] : f.deliverableVersionId ? ['deliverableVersion', f.deliverableVersionId] : ['project', f.projectId];
  const t = await resolveTarget(auth, type, tid); // throws 404 when the parent is not accessible
  if (t.isCustomer && f.visibility !== 'PUBLIC') throw notFound('File');
  return { f, t };
}

r.get('/:id/download', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound('File');
  const { f } = await authorizedFile(req.auth, req.params.id);
  if (!(await storage.stat(f.storageKey))) { req.log.error({ fileId: f.id }, 'file bytes missing from storage'); throw notFound('File content'); }
  const inline = req.query.inline === '1' && INLINE.has(f.mimeType);
  res.set({
    'Content-Type': inline ? f.mimeType : 'application/octet-stream', 'Content-Length': String(f.size), 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${f.originalName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.originalName)}`,
  });
  storage.open(f.storageKey).on('error', (e) => { req.log.error({ err: e }, 'stream failed'); res.destroy(); }).pipe(res);
});

r.delete('/:id', async (req, res) => {
  const { f, t } = await authorizedFile(req.auth, req.params.id);
  if (f.uploadedById !== req.auth.userId && !t.canDeleteAny) throw forbidden();
  if (f.deliverableVersionId) {
    const approvals = await prisma.approval.count({ where: { deliverableVersionId: f.deliverableVersionId } });
    if (approvals) throw badRequest('Files on a reviewed deliverable version are retained as the review record');
  }
  // Soft delete now; the cleanup job removes bytes after the retention window.
  await prisma.fileObject.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
  await audit(prisma, req.auth, { action: 'file.deleted', entityType: 'FileObject', entityId: f.id, projectId: f.projectId, metadata: { name: f.originalName } }, req.ip);
  res.status(204).end();
});

export default r;
