// Client-side cryptography for Mihayon.
//
// Everything here runs in the browser. Keys are generated locally, live only in
// the URL fragment, and never touch the network. The server sees ciphertext.
//
// Scheme: AES-GCM with a 256-bit key and a fresh 96-bit IV per encryption.
// The stored blob is `iv (12 bytes) || ciphertext+tag`, base64-encoded.

const enc = new TextEncoder();
const dec = new TextDecoder();

// --- base64 / base64url helpers -------------------------------------------

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return base64ToBytes(b64);
}

// --- keys ------------------------------------------------------------------

export async function generateKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function exportKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToBase64Url(new Uint8Array(raw));
}

export async function importKey(b64url) {
  const raw = base64UrlToBytes(b64url);
  if (raw.length !== 32) throw new Error('bad key length');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ]);
}

// --- encryption ------------------------------------------------------------

// Returns the storage blob as a base64 string of iv||ciphertext.
export async function encrypt(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  );
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv, 0);
  blob.set(ct, iv.length);
  return bytesToBase64(blob);
}

export async function decrypt(key, blobBase64) {
  const blob = base64ToBytes(blobBase64);
  if (blob.length < 13) throw new Error('blob too short');
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}

// --- write secrets ---------------------------------------------------------

// A random capability that authorizes future edits. The server only ever
// stores its SHA-256, so possession of this string is the sole edit credential.
export function generateWriteSecret() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export async function sha256hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
