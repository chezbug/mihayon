// Copies the browser builds of marked and DOMPurify from node_modules into
// public/vendor, so the client is fully self-hosted and needs no CDN.
//
// Run automatically on `npm install` (via the "prepare" script) and manually
// with `npm run vendor`.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const vendorDir = path.join(root, 'public', 'vendor');

// For each package, the UMD/browser build that exposes a global, tried in order.
const targets = [
  {
    pkg: 'marked',
    out: 'marked.min.js',
    candidates: ['marked.min.js', 'marked.umd.js', 'lib/marked.umd.js', 'lib/marked.umd.min.js'],
  },
  {
    pkg: 'dompurify',
    out: 'purify.min.js',
    candidates: ['dist/purify.min.js', 'dist/purify.js'],
  },
];

async function exists(p) {
  return fs.access(p).then(() => true).catch(() => false);
}

async function resolvePkgDir(pkg) {
  // Preferred: resolve the package's own package.json and take its directory.
  try {
    return path.dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    // Some packages hide package.json behind "exports". Fall back to the
    // conventional install location under node_modules.
    const dir = path.join(root, 'node_modules', pkg);
    if (await exists(dir)) return dir;
    throw new Error(`cannot locate installed package: ${pkg}`);
  }
}

async function main() {
  await fs.mkdir(vendorDir, { recursive: true });
  for (const { pkg, out, candidates } of targets) {
    const dir = await resolvePkgDir(pkg);
    let copied = false;
    for (const rel of candidates) {
      const src = path.join(dir, rel);
      if (await exists(src)) {
        await fs.copyFile(src, path.join(vendorDir, out));
        console.log(`[vendor] ${pkg}: ${rel} -> public/vendor/${out}`);
        copied = true;
        break;
      }
    }
    if (!copied) {
      console.error(
        `[vendor] could not find a browser build for ${pkg}. Looked for: ${candidates.join(', ')}`
      );
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
