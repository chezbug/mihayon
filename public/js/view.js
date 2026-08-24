// Viewer page. Reads /d/<id>#<key> (full) or /d/<id>#s.<partA> (split), fetches
// the ciphertext, decrypts it in the browser, and renders the markdown.
//
// For split links the fragment carries only part A of the read key; the viewer
// asks the reader for part B (a pasted string, or read from a QR with their
// phone camera) and reconstructs the key locally. Part B is never placed in the
// URL, so the two halves stay on separate channels.

import { importKey, combineKeyParts, decrypt } from './crypto.js';
import { fetchDoc } from './api.js';
import { renderMarkdown } from './markdown.js';
import { parseViewLocation } from './links.js';

const statusEl = document.getElementById('status');
const contentEl = document.getElementById('content');
const metaEl = document.getElementById('meta');
const splitEl = document.getElementById('split-prompt');
const partBInput = document.getElementById('part-b');
const unlockBtn = document.getElementById('unlock');

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

function deriveTitle(md) {
  const line = md.split('\n').find((l) => l.trim());
  if (!line) return null;
  return line.replace(/^#+\s*/, '').trim().slice(0, 80);
}

function render(markdown, record) {
  statusEl.hidden = true;
  splitEl.hidden = true;
  contentEl.hidden = false;
  contentEl.innerHTML = renderMarkdown(markdown);
  metaEl.textContent = `Updated ${fmt(record.updatedAt)}`;
  document.title = deriveTitle(markdown) || 'Mihayon';
}

async function main() {
  const loc = parseViewLocation();
  if (!loc.id) return fail('No document specified.');

  statusEl.hidden = false;
  statusEl.textContent = 'Fetching…';

  let record;
  try {
    record = await fetchDoc(loc.id);
  } catch (err) {
    return fail(err.status === 404 ? 'Document not found.' : `Could not load: ${err.message}`);
  }

  if (loc.mode === 'split') {
    if (!loc.partA) return fail('This split link is missing its first key part.');
    // Ask for part B, then combine and decrypt.
    statusEl.hidden = true;
    splitEl.hidden = false;
    partBInput.focus();

    const attempt = async () => {
      const partB = partBInput.value.trim();
      if (!partB) return;
      let key;
      try {
        key = await combineKeyParts(loc.partA, partB);
      } catch {
        statusEl.hidden = false;
        statusEl.className = 'status error';
        statusEl.textContent = 'That second key part is malformed.';
        return;
      }
      try {
        const markdown = await decrypt(key, record.blob);
        render(markdown, record);
      } catch {
        statusEl.hidden = false;
        statusEl.className = 'status error';
        statusEl.textContent = 'Decryption failed — the second key part is incorrect.';
      }
    };

    unlockBtn.addEventListener('click', attempt);
    partBInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attempt();
    });
    return;
  }

  // Full link.
  if (!loc.key) return fail('This link is missing its decryption key (the part after #).');
  let key;
  try {
    key = await importKey(loc.key);
  } catch {
    return fail('The key in this link is malformed.');
  }
  try {
    const markdown = await decrypt(key, record.blob);
    render(markdown, record);
  } catch {
    fail('Decryption failed. The key is incorrect or the document is corrupt.');
  }
}

main();
