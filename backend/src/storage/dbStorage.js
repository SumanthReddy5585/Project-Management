// Stores file bytes in Postgres (FileBlob table). For hosts without a persistent disk (e.g. free
// container platforms) this keeps uploads safe across restarts and redeploys. Same interface as LocalStorage.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { prisma } from '../lib/prisma.js';

const KEY = /^[0-9a-f]{2}\/[0-9a-f]{32}$/;
const check = (key) => { if (!KEY.test(key)) throw new Error('Invalid storage key'); return key; };

export class DbStorage {
  async put(buffer) {
    const id = crypto.randomBytes(16).toString('hex');
    const key = `${id.slice(0, 2)}/${id}`;
    await prisma.fileBlob.create({ data: { key, data: buffer, size: buffer.length } });
    return { key, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  }

  open(key) {
    check(key);
    // Lazily read the row and stream it; errors surface as a stream error like a missing file would.
    return Readable.from((async function* () {
      const row = await prisma.fileBlob.findUnique({ where: { key } });
      if (!row) { const e = new Error('ENOENT: file not found'); e.code = 'ENOENT'; throw e; }
      yield Buffer.from(row.data);
    })());
  }

  async stat(key) {
    const row = await prisma.fileBlob.findUnique({ where: { key: check(key) }, select: { size: true, createdAt: true } });
    return row ? { size: row.size, mtime: row.createdAt } : null;
  }

  async remove(key) { await prisma.fileBlob.deleteMany({ where: { key: check(key) } }); }

  async *list() {
    let cursor;
    for (;;) {
      const rows = await prisma.fileBlob.findMany({ select: { key: true, size: true, createdAt: true }, orderBy: { key: 'asc' }, take: 500, ...(cursor && { skip: 1, cursor: { key: cursor } }) });
      for (const r of rows) yield { key: r.key, size: r.size, mtime: r.createdAt };
      if (rows.length < 500) return;
      cursor = rows[rows.length - 1].key;
    }
  }
}
