import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const KEY = /^[0-9a-f]{2}\/[0-9a-f]{32}$/;

export class LocalStorage {
  constructor(root) { this.root = path.resolve(root); }

  #resolve(key) {
    if (!KEY.test(key)) throw new Error('Invalid storage key');
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('Path traversal blocked');
    return p;
  }

  async put(buffer) {
    const id = crypto.randomBytes(16).toString('hex');
    const key = `${id.slice(0, 2)}/${id}`;
    const dest = this.#resolve(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    await fsp.writeFile(tmp, buffer, { mode: 0o600 });
    await fsp.rename(tmp, dest);
    return { key, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  }

  open(key) { return fs.createReadStream(this.#resolve(key)); }
  async stat(key) { try { const s = await fsp.stat(this.#resolve(key)); return { size: s.size, mtime: s.mtime }; } catch { return null; } }
  async remove(key) { await fsp.rm(this.#resolve(key), { force: true }); }

  async *list() {
    let dirs = [];
    try { dirs = await fsp.readdir(this.root); } catch { return; }
    for (const d of dirs) {
      if (!/^[0-9a-f]{2}$/.test(d)) continue;
      for (const f of await fsp.readdir(path.join(this.root, d))) {
        const key = `${d}/${f}`;
        if (KEY.test(key)) yield { key, ...(await this.stat(key)) };
      }
    }
  }
}
