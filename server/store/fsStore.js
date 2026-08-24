// Filesystem-backed store for encrypted documents.
//
// A document record, as persisted, is deliberately opaque:
//
//   {
//     id:        string,   // random, server-assigned handle
//     blob:      string,   // base64: the client's iv||ciphertext, unreadable here
//     authHash:  string,   // hex SHA-256 of the write secret; never the secret
//     createdAt: number,   // epoch ms
//     updatedAt: number    // epoch ms
//   }
//
// The server can neither decrypt `blob` nor learn who created it. There is no
// author field, no title, no plaintext — nothing linking a document to a person.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export class FsStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  // Ids are base64url; reject anything that could escape the data dir.
  #pathFor(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new StoreError('invalid id', 400);
    }
    return path.join(this.dataDir, `${id}.json`);
  }

  async has(id) {
    try {
      await fs.access(this.#pathFor(id));
      return true;
    } catch {
      return false;
    }
  }

  async get(id) {
    try {
      const raw = await fs.readFile(this.#pathFor(id), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      if (err instanceof StoreError) throw err;
      throw new StoreError('corrupt record', 500);
    }
  }

  async create(id, record) {
    const file = this.#pathFor(id);
    // 'wx' fails if the file already exists, so id collisions can't clobber.
    const handle = await fs.open(file, 'wx');
    try {
      await handle.writeFile(JSON.stringify(record));
    } finally {
      await handle.close();
    }
  }

  async replace(id, record) {
    // Atomic-ish: write to a temp file then rename over the original.
    const file = this.#pathFor(id);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record));
    await fs.rename(tmp, file);
  }

  async delete(id) {
    try {
      await fs.unlink(this.#pathFor(id));
      return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') return false;
      throw err;
    }
  }

  // Used only by optional TTL sweeping.
  async *entries() {
    let names;
    try {
      names = await fs.readdir(this.dataDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      const rec = await this.get(id).catch(() => null);
      if (rec) yield rec;
    }
  }
}

export class StoreError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'StoreError';
    this.status = status;
  }
}
