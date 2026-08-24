// Integration tests for the Mihayon API. These exercise the server's contract:
// it stores and returns opaque blobs, enforces write authorization, and never
// exposes the stored auth hash.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { buildApp, FsStore } from '../server/index.js';

let server;
let base;
let dataDir;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mihayon-test-'));
  const store = new FsStore(dataDir);
  await store.init();
  const app = await buildApp(store);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function post(pathname, body) {
  return fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('create returns an id and stores only opaque data', async () => {
  const secret = 'write-secret-abcdefghij';
  const res = await post('/api/docs', {
    blob: Buffer.from('iv+ciphertext').toString('base64'),
    authHash: sha256hex(secret),
  });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.match(id, /^[A-Za-z0-9_-]+$/);

  // The persisted record must contain no plaintext and no raw secret.
  const raw = await fs.readFile(path.join(dataDir, `${id}.json`), 'utf8');
  assert.ok(!raw.includes(secret), 'raw write secret must not be stored');
  const rec = JSON.parse(raw);
  assert.equal(rec.authHash, sha256hex(secret));
});

test('get never exposes the auth hash', async () => {
  const secret = 'another-secret-1234567';
  const created = await (
    await post('/api/docs', {
      blob: Buffer.from('data').toString('base64'),
      authHash: sha256hex(secret),
    })
  ).json();

  const res = await fetch(`${base}/api/docs/${created.id}`);
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(doc.id, created.id);
  assert.ok(doc.blob);
  assert.equal(doc.authHash, undefined, 'authHash must not leak to readers');
});

test('update requires the correct write secret', async () => {
  const secret = 'correct-secret-7654321';
  const created = await (
    await post('/api/docs', {
      blob: Buffer.from('v1').toString('base64'),
      authHash: sha256hex(secret),
    })
  ).json();

  // Wrong secret is rejected.
  const bad = await fetch(`${base}/api/docs/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: Buffer.from('v2').toString('base64'), writeSecret: 'wrong-secret-000000' }),
  });
  assert.equal(bad.status, 403);

  // Correct secret succeeds and changes the blob.
  const good = await fetch(`${base}/api/docs/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: Buffer.from('v2').toString('base64'), writeSecret: secret }),
  });
  assert.equal(good.status, 200);

  const doc = await (await fetch(`${base}/api/docs/${created.id}`)).json();
  assert.equal(Buffer.from(doc.blob, 'base64').toString(), 'v2');
});

test('delete requires the correct write secret', async () => {
  const secret = 'delete-secret-98765432';
  const created = await (
    await post('/api/docs', {
      blob: Buffer.from('x').toString('base64'),
      authHash: sha256hex(secret),
    })
  ).json();

  const bad = await fetch(`${base}/api/docs/${created.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writeSecret: 'nope-nope-nope-nope' }),
  });
  assert.equal(bad.status, 403);

  const good = await fetch(`${base}/api/docs/${created.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writeSecret: secret }),
  });
  assert.equal(good.status, 204);

  const gone = await fetch(`${base}/api/docs/${created.id}`);
  assert.equal(gone.status, 404);
});

test('rejects malformed input', async () => {
  const noBlob = await post('/api/docs', { authHash: sha256hex('s') });
  assert.equal(noBlob.status, 400);

  const badHash = await post('/api/docs', { blob: Buffer.from('x').toString('base64'), authHash: 'notahash' });
  assert.equal(badHash.status, 400);
});

test('unknown document is 404', async () => {
  const res = await fetch(`${base}/api/docs/doesnotexist`);
  assert.equal(res.status, 404);
});
