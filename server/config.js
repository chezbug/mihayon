// Central configuration, all overridable via environment variables.
// Nothing here weakens the zero-knowledge property — the server never sees
// plaintext or keys regardless of these values.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  // Network
  host: process.env.MIHAYON_HOST || '0.0.0.0',
  port: int('MIHAYON_PORT', 8787),

  // Where encrypted blobs live on disk.
  dataDir: process.env.MIHAYON_DATA_DIR || path.join(__dirname, '..', 'data'),

  // Static client assets.
  publicDir: path.join(__dirname, '..', 'public'),

  // Largest ciphertext blob we will accept, in bytes. Encrypted markdown is
  // small; this cap just keeps the store from being abused as generic hosting.
  maxBlobBytes: int('MIHAYON_MAX_BLOB_BYTES', 1024 * 1024), // 1 MiB

  // Length of generated document ids, in bytes (before base64url encoding).
  idBytes: int('MIHAYON_ID_BYTES', 12),

  // Optional: if set, delete documents untouched for this many days. 0 = never.
  ttlDays: int('MIHAYON_TTL_DAYS', 0),
};
