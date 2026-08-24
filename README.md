# Mihayon

**Suspiciously encrypted web.** Mihayon hosts markdown documents that are
encrypted in the browser before they are ever uploaded. The server stores
ciphertext and nothing else — it cannot read a document, and it cannot tell who
authored or hosts one. Documents decrypt themselves in the client when someone
opens the right URL.

- **Zero-knowledge host.** Records contain only ciphertext, a hash, and
  timestamps. No accounts, no authors, no plaintext, no linkable metadata.
- **Keys live in the URL fragment.** The decryption key sits after the `#` in a
  link, which browsers never send to the server.
- **Editable anytime.** An edit link carries a write secret; the server verifies
  a hash of it without ever storing the secret.
- **Rendered safely.** Decrypted markdown is sanitized (DOMPurify) and served
  under a strict Content-Security-Policy with no external requests.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the threat model and crypto
design.

## How it works

```
Author (browser)                 Mihayon server                Reader (browser)
────────────────                 ──────────────                ────────────────
write markdown
generate AES-256 key ┐
encrypt in browser   │  POST ciphertext  ┌──────────────┐
generate write secret├───────────────────▶ store blob   │
                     │                    │ + hash(secret)│
        view link ◀──┘   { id }           └──────┬───────┘
   /d/<id>#<key>                                  │  GET /api/docs/<id>
        (key never sent) ────────────────────────┼───────────────▶ fetch ciphertext
                                                  │                 decrypt with <key>
                                                  ▼                 from fragment
                                            (only ciphertext)       render markdown
```

- **View link:** `/d/<id>#<key>` — safe to share; grants read access only.
- **Edit link:** `/edit/<id>#<key>.<writeSecret>` — keep private; grants writes.

The `<id>` is in the path because the server needs it to find the blob. The
`<key>` and `<writeSecret>` are in the fragment, so they never reach the server.

## Quick start

```bash
npm install      # installs deps and vendors the browser libs
npm start        # serves on http://localhost:8787
```

Open <http://localhost:8787/edit>, write some markdown, and click **Save**. You
get a view link and an edit link. That's it — no signup.

### Configuration

All optional, via environment variables:

| Variable                | Default        | Meaning                                  |
| ----------------------- | -------------- | ---------------------------------------- |
| `MIHAYON_HOST`          | `0.0.0.0`      | Bind address                             |
| `MIHAYON_PORT`          | `8787`         | Port                                     |
| `MIHAYON_DATA_DIR`      | `./data`       | Where encrypted blobs are stored         |
| `MIHAYON_MAX_BLOB_BYTES`| `1048576`      | Max ciphertext size (1 MiB)              |
| `MIHAYON_ID_BYTES`      | `12`           | Document id length before base64url      |
| `MIHAYON_TTL_DAYS`      | `0` (disabled) | Delete documents untouched for N days    |

## Development

```bash
npm run dev      # server with --watch
npm test         # server integration tests
npm run vendor   # re-copy marked & DOMPurify into public/vendor
```

## Project layout

```
server/            Node + Express: stores and serves opaque blobs
  index.js         app entry, security headers, routes
  config.js        env-driven configuration
  store/fsStore.js filesystem storage of encrypted records
  routes/docs.js   the CRUD API (create/read/update/delete)
public/            Static client (no build step)
  js/crypto.js     WebCrypto AES-GCM helpers
  js/markdown.js   marked + DOMPurify rendering
  js/view.js       viewer page logic
  js/edit.js       editor page logic
  js/links.js      URL/fragment construction & parsing
  js/commands/     future command system (extension point, not yet active)
  vendor/          marked & DOMPurify (copied from node_modules on install)
docs/ARCHITECTURE.md  threat model and crypto design
test/              server integration tests
```

## Roadmap

- **Commands** — actions a document can offer the reader, such as fetching live
  data through a proxy the reader supplies (so the host never brokers or sees
  that traffic). The extension point exists today
  ([`public/js/commands/`](public/js/commands/)) but no commands are wired in yet.
- **Peer distribution** — while readers are online they serve a document to each
  other, so it survives even if the origin removes its copy; the origin stays the
  always-on fallback. Design: [`docs/P2P.md`](docs/P2P.md).
- **Anonymous comments** — pseudonymous, unforgeable, end-to-end encrypted
  comments with client-side filtering and owner moderation. Design:
  [`docs/COMMENTS.md`](docs/COMMENTS.md).

## License

MIT — see [`LICENSE`](LICENSE).
