// REST API for encrypted documents. Every field the client sends is already
// encrypted or a hash — the server validates shape and ownership, never content.

import express from 'express';
import crypto from 'node:crypto';
import { StoreError } from '../store/fsStore.js';

const HEX64 = /^[a-f0-9]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const WRITE_SECRET = /^[A-Za-z0-9_-]{16,256}$/;

function sha256hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// Constant-time comparison of two hex strings of equal length.
function hexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function newId(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// Approximate decoded byte length of a base64 string without decoding it.
function base64Bytes(b64) {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function validateBlob(blob, maxBytes) {
  if (typeof blob !== 'string' || !BASE64.test(blob)) {
    throw new StoreError('blob must be base64', 400);
  }
  if (base64Bytes(blob) > maxBytes) {
    throw new StoreError('blob too large', 413);
  }
}

export function createDocsRouter({ store, config }) {
  const router = express.Router();

  // Create a new encrypted document.
  // Body: { blob: base64(iv||ciphertext), authHash: hex sha-256(writeSecret) }
  router.post('/', async (req, res, next) => {
    try {
      const { blob, authHash } = req.body ?? {};
      validateBlob(blob, config.maxBlobBytes);
      if (typeof authHash !== 'string' || !HEX64.test(authHash)) {
        throw new StoreError('authHash must be hex sha-256', 400);
      }

      const now = Date.now();
      // Retry a few times in the astronomically unlikely event of collision.
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = newId(config.idBytes);
        try {
          await store.create(id, {
            id,
            blob,
            authHash,
            createdAt: now,
            updatedAt: now,
          });
          return res.status(201).json({ id, createdAt: now });
        } catch (err) {
          if (err && err.code === 'EEXIST') continue;
          throw err;
        }
      }
      throw new StoreError('could not allocate id', 500);
    } catch (err) {
      next(err);
    }
  });

  // Fetch a document's ciphertext. Deliberately never returns authHash.
  router.get('/:id', async (req, res, next) => {
    try {
      const rec = await store.get(req.params.id);
      if (!rec) throw new StoreError('not found', 404);
      res.json({
        id: rec.id,
        blob: rec.blob,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      });
    } catch (err) {
      next(err);
    }
  });

  // Update an existing document. Requires proof of the write secret.
  // Body: { blob, writeSecret }
  router.put('/:id', async (req, res, next) => {
    try {
      const { blob, writeSecret } = req.body ?? {};
      validateBlob(blob, config.maxBlobBytes);
      if (typeof writeSecret !== 'string' || !WRITE_SECRET.test(writeSecret)) {
        throw new StoreError('invalid writeSecret', 400);
      }

      const rec = await store.get(req.params.id);
      if (!rec) throw new StoreError('not found', 404);
      if (!hexEqual(sha256hex(writeSecret), rec.authHash)) {
        throw new StoreError('write not authorized', 403);
      }

      const updatedAt = Date.now();
      await store.replace(rec.id, { ...rec, blob, updatedAt });
      res.json({ id: rec.id, updatedAt });
    } catch (err) {
      next(err);
    }
  });

  // Delete a document. Requires proof of the write secret.
  // Body: { writeSecret }
  router.delete('/:id', async (req, res, next) => {
    try {
      const { writeSecret } = req.body ?? {};
      if (typeof writeSecret !== 'string' || !WRITE_SECRET.test(writeSecret)) {
        throw new StoreError('invalid writeSecret', 400);
      }
      const rec = await store.get(req.params.id);
      if (!rec) throw new StoreError('not found', 404);
      if (!hexEqual(sha256hex(writeSecret), rec.authHash)) {
        throw new StoreError('write not authorized', 403);
      }
      await store.delete(rec.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
