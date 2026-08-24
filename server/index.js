#!/usr/bin/env node
// Mihayon server. Serves the static client and a small API for storing and
// retrieving encrypted blobs. It has no capacity to read what it stores.

import express from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { config } from './config.js';
import { FsStore, StoreError } from './store/fsStore.js';
import { createDocsRouter } from './routes/docs.js';

async function buildApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  // Security headers. The client is fully self-contained: no external scripts,
  // styles, fonts, or network calls. Images are limited to same-origin and
  // data: URIs so that viewing a document can never beacon a third-party host.
  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: config.maxBlobBytes + 4096 }));

  app.use('/api/docs', createDocsRouter({ store, config }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Client routes. The id lives in the path; the decryption key lives only in
  // the URL fragment, which the browser never transmits — so these handlers
  // never receive it.
  const sendPage = (file) => (_req, res) =>
    res.sendFile(path.join(config.publicDir, file));

  app.get('/', sendPage('index.html'));
  app.get('/d/:id', sendPage('view.html'));
  app.get('/edit', sendPage('edit.html'));
  app.get('/edit/:id', sendPage('edit.html'));

  app.use(express.static(config.publicDir, { index: false }));

  // JSON error handler.
  app.use((err, _req, res, _next) => {
    const status = err instanceof StoreError ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'error' });
  });

  return app;
}

// Optional background sweep for expiring old documents.
function startTtlSweep(store) {
  if (!config.ttlDays || config.ttlDays <= 0) return;
  const ms = config.ttlDays * 24 * 60 * 60 * 1000;
  const sweep = async () => {
    const cutoff = Date.now() - ms;
    for await (const rec of store.entries()) {
      if (rec.updatedAt < cutoff) await store.delete(rec.id).catch(() => {});
    }
  };
  sweep().catch(() => {});
  setInterval(() => sweep().catch(() => {}), 60 * 60 * 1000).unref();
}

async function main() {
  // Warn (don't fail) if vendored browser libs are missing.
  const vendored = path.join(config.publicDir, 'vendor', 'marked.min.js');
  if (!(await fs.access(vendored).then(() => true).catch(() => false))) {
    console.warn(
      '[mihayon] vendored client libs missing — run `npm run vendor` first.'
    );
  }

  const store = new FsStore(config.dataDir);
  await store.init();
  startTtlSweep(store);

  const app = await buildApp(store);
  app.listen(config.port, config.host, () => {
    console.log(`[mihayon] listening on http://${config.host}:${config.port}`);
    console.log(`[mihayon] data dir: ${config.dataDir}`);
  });
}

// Only run when invoked directly, so tests can import buildApp.
if (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('index.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { buildApp, FsStore };
