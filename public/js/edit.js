// Editor page. Creates new documents and updates existing ones. All encryption
// happens here; the server only ever receives ciphertext and a write secret it
// can verify but not reverse.

import {
  generateKey,
  importKey,
  exportKey,
  encrypt,
  decrypt,
  generateWriteSecret,
} from './crypto.js';
import { createDoc, fetchDoc, updateDoc, deleteDoc } from './api.js';
import { renderMarkdown } from './markdown.js';
import { parseEditLocation, buildViewLink, buildEditLink } from './links.js';

const els = {
  editor: document.getElementById('editor'),
  preview: document.getElementById('preview'),
  save: document.getElementById('save'),
  del: document.getElementById('delete'),
  status: document.getElementById('status'),
  links: document.getElementById('links'),
  viewLink: document.getElementById('view-link'),
  editLink: document.getElementById('edit-link'),
  mode: document.getElementById('mode'),
};

// In-memory session state. Secrets never persist beyond the tab.
const state = {
  id: null,
  key: null, // CryptoKey
  keyStr: null, // base64url
  writeSecret: null,
};

function setStatus(msg, kind = '') {
  els.status.textContent = msg;
  els.status.className = `status ${kind}`;
  els.status.hidden = !msg;
}

function renderPreview() {
  els.preview.innerHTML = renderMarkdown(els.editor.value);
}

function showLinks() {
  els.viewLink.value = buildViewLink(state.id, state.keyStr);
  els.editLink.value = buildEditLink(state.id, state.keyStr, state.writeSecret);
  els.links.hidden = false;
}

async function save() {
  els.save.disabled = true;
  try {
    if (!state.id) {
      // New document.
      state.key = await generateKey();
      state.keyStr = await exportKey(state.key);
      state.writeSecret = generateWriteSecret();
      const blob = await encrypt(state.key, els.editor.value);
      const { id } = await createDoc(blob, state.writeSecret);
      state.id = id;
      // Move the tab to the canonical edit URL without a reload.
      history.replaceState(
        null,
        '',
        `/edit/${encodeURIComponent(id)}#${state.keyStr}.${state.writeSecret}`
      );
      els.del.hidden = false;
      els.mode.textContent = 'Editing existing document';
      showLinks();
      setStatus('Created. Save these links — they cannot be recovered.', 'ok');
    } else {
      // Update existing.
      if (!state.writeSecret) {
        setStatus('This link is read-only (no write secret). You cannot save.', 'error');
        return;
      }
      const blob = await encrypt(state.key, els.editor.value);
      await updateDoc(state.id, blob, state.writeSecret);
      setStatus('Saved.', 'ok');
    }
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, 'error');
  } finally {
    els.save.disabled = false;
  }
}

async function removeDoc() {
  if (!state.id || !state.writeSecret) return;
  if (!confirm('Permanently delete this document? This cannot be undone.')) return;
  try {
    await deleteDoc(state.id, state.writeSecret);
    setStatus('Deleted. This document no longer exists.', 'ok');
    els.editor.disabled = true;
    els.save.disabled = true;
    els.del.disabled = true;
  } catch (err) {
    setStatus(`Delete failed: ${err.message}`, 'error');
  }
}

async function loadExisting({ id, key, writeSecret }) {
  state.id = id;
  state.keyStr = key;
  state.writeSecret = writeSecret;
  els.mode.textContent = 'Editing existing document';
  setStatus('Loading…');
  try {
    state.key = await importKey(key);
    const record = await fetchDoc(id);
    els.editor.value = await decrypt(state.key, record.blob);
    renderPreview();
    els.del.hidden = !writeSecret;
    setStatus(writeSecret ? '' : 'Read-only: this link has no write secret.', writeSecret ? '' : 'error');
  } catch (err) {
    setStatus(`Could not open: ${err.message}`, 'error');
  }
}

function main() {
  const loc = parseEditLocation();
  els.editor.addEventListener('input', renderPreview);
  els.save.addEventListener('click', save);
  els.del.addEventListener('click', removeDoc);

  for (const btn of document.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.copy);
      target.select();
      navigator.clipboard?.writeText(target.value).then(
        () => setStatus('Copied to clipboard.', 'ok'),
        () => {}
      );
    });
  }

  if (loc.id && loc.key) {
    loadExisting(loc);
  } else {
    els.mode.textContent = 'New document';
    renderPreview();
  }
}

main();
