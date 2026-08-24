// Viewer page. Reads /d/<id>#<key>, fetches the ciphertext, decrypts it in the
// browser, and renders the markdown. If the key is wrong or missing, decryption
// fails and nothing is shown — the server was never able to help either way.

import { importKey, decrypt } from './crypto.js';
import { fetchDoc } from './api.js';
import { renderMarkdown } from './markdown.js';
import { parseViewLocation } from './links.js';

const statusEl = document.getElementById('status');
const contentEl = document.getElementById('content');
const metaEl = document.getElementById('meta');

function fail(message) {
  statusEl.hidden = false;
  statusEl.className = 'status error';
  statusEl.textContent = message;
  contentEl.hidden = true;
}

function fmt(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

async function main() {
  const { id, key } = parseViewLocation();
  if (!id) return fail('No document specified.');
  if (!key) return fail('This link is missing its decryption key (the part after #).');

  statusEl.hidden = false;
  statusEl.textContent = 'Fetching…';

  let record;
  try {
    record = await fetchDoc(id);
  } catch (err) {
    return fail(err.status === 404 ? 'Document not found.' : `Could not load: ${err.message}`);
  }

  let cryptoKey;
  try {
    cryptoKey = await importKey(key);
  } catch {
    return fail('The key in this link is malformed.');
  }

  let markdown;
  try {
    markdown = await decrypt(cryptoKey, record.blob);
  } catch {
    return fail('Decryption failed. The key is incorrect or the document is corrupt.');
  }

  statusEl.hidden = true;
  contentEl.hidden = false;
  contentEl.innerHTML = renderMarkdown(markdown);
  metaEl.textContent = `Updated ${fmt(record.updatedAt)}`;
  document.title = deriveTitle(markdown) || 'Mihayon';
}

// Use the first markdown heading (or line) as the tab title, purely locally.
function deriveTitle(md) {
  const line = md.split('\n').find((l) => l.trim());
  if (!line) return null;
  return line.replace(/^#+\s*/, '').trim().slice(0, 80);
}

main();
