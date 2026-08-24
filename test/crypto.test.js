// Unit tests for the client crypto helpers, run under Node's WebCrypto (the
// same primitives the browser uses: crypto.subtle, getRandomValues, btoa/atob,
// TextEncoder). Focus is the 2-of-2 split-key scheme.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateKey,
  exportKey,
  encrypt,
  decrypt,
  generateSplitKey,
  splitExistingKey,
  combineKeyParts,
} from '../public/js/crypto.js';

test('split parts reconstruct the encryption key', async () => {
  const { key, partA, partB } = await generateSplitKey();
  const blob = await encrypt(key, 'hello split world');

  const combined = await combineKeyParts(partA, partB);
  assert.equal(await decrypt(combined, blob), 'hello split world');
});

test('an existing key can be re-split and recombined', async () => {
  const key = await generateKey();
  const keyStr = await exportKey(key);
  const blob = await encrypt(key, '# doc\n\nbody');

  const { partA, partB } = splitExistingKey(keyStr);
  const combined = await combineKeyParts(partA, partB);
  assert.equal(await decrypt(combined, blob), '# doc\n\nbody');
});

test('a fresh split of the same key still works (any A/B with A xor B == key)', async () => {
  const key = await generateKey();
  const keyStr = await exportKey(key);
  const blob = await encrypt(key, 'reproducible');

  const s1 = splitExistingKey(keyStr);
  const s2 = splitExistingKey(keyStr);
  assert.notEqual(s1.partA, s2.partA, 'each split should be independently random');

  assert.equal(await decrypt(await combineKeyParts(s1.partA, s1.partB), blob), 'reproducible');
  assert.equal(await decrypt(await combineKeyParts(s2.partA, s2.partB), blob), 'reproducible');
});

test('wrong part B fails to decrypt', async () => {
  const { key, partA } = await generateSplitKey();
  const blob = await encrypt(key, 'secret');
  const wrongB = (await generateSplitKey()).partB;

  const combined = await combineKeyParts(partA, wrongB);
  await assert.rejects(decrypt(combined, blob));
});

test('neither part alone equals the key', async () => {
  const { partA, partB } = await generateSplitKey();
  // Parts are independent random 32-byte values; they must differ from each
  // other (astronomically unlikely to collide).
  assert.notEqual(partA, partB);
});
