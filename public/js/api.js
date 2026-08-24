// Thin wrapper over the Mihayon HTTP API. All payloads are already encrypted
// or hashed before they reach these functions.

import { sha256hex } from './crypto.js';

async function json(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const msg = (body && body.error) || `${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Create a document from an already-encrypted blob and a write secret.
// Returns { id, createdAt }.
export async function createDoc(blob, writeSecret) {
  const authHash = await sha256hex(writeSecret);
  const res = await fetch('/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob, authHash }),
  });
  return json(res);
}

// Fetch a document's ciphertext blob. Returns { id, blob, createdAt, updatedAt }.
export async function fetchDoc(id) {
  const res = await fetch(`/api/docs/${encodeURIComponent(id)}`);
  return json(res);
}

// Replace a document's ciphertext. Returns { id, updatedAt }.
export async function updateDoc(id, blob, writeSecret) {
  const res = await fetch(`/api/docs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob, writeSecret }),
  });
  return json(res);
}

export async function deleteDoc(id, writeSecret) {
  const res = await fetch(`/api/docs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writeSecret }),
  });
  if (res.status === 204) return true;
  return json(res);
}
