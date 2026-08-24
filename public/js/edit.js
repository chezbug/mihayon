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
  splitExistingKey,
} from './crypto.js';
import { createDoc, fetchDoc, updateDoc, deleteDoc } from './api.js';
import { renderMarkdown } from './markdown.js';
import {
  parseEditLocation,
  buildViewLink,
  buildEditLink,
  buildSplitViewLink,
} from './links.js';

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
  splitToggle: document.getElementById('split-toggle'),
  fullRow: document.getElementById('full-view-row'),
  splitBox: document.getElementById('split-box'),
  splitLink: document.getElementById('split-link'),
  partB: document.getElementById('split-part-b'),
  qr: document.getElementById('qr'),
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

function renderQr(text) {
  // Uses the vendored qrcode-generator global. Output is inline SVG (no script),
  // which is safe under the page CSP.
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    els.qr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    els.qr.textContent = '(could not render QR)';
  }
}

function showLinks() {
  // The edit link always carries the full key so the author can edit easily.
  els.editLink.value = buildEditLink(state.id, state.keyStr, state.writeSecret);

  if (els.splitToggle.checked) {
    // Split the read key into part A (URL) and part B (QR / string).
    const { partA, partB } = splitExistingKey(state.keyStr);
    els.splitLink.value = buildSplitViewLink(state.id, partA);
    els.partB.value = partB;
    renderQr(partB);
    els.fullRow.hidden = true;
    els.splitBox.hidden = false;
  } else {
    els.viewLink.value = buildViewLink(state.id, state.keyStr);
    els.fullRow.hidden = false;
    els.splitBox.hidden = true;
  }
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
  // Re-render the share links when the split toggle changes (only meaningful
  // once the document has been saved and a key exists).
  els.splitToggle.addEventListener('change', () => {
    if (state.id && state.keyStr) showLinks();
  });

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
