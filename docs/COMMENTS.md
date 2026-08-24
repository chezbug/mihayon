# Anonymous comments (design)

Status: **design only — not yet implemented.** This is the more self-contained
of the two design docs and can be built on the current core *before* the P2P
layer exists.

Goal: let readers of a document leave comments under **anonymized but
unforgeable** pseudonyms, with no accounts, while keeping the server
zero-knowledge (it cannot read comments). A **client-side** content filter
(profanity, URLs, etc.) improves the default experience, and the document owner
can moderate.

## Who can comment

Anyone who can *read* the document can comment. Reading requires the read key
(in the URL fragment), so the comment system derives its own key from it:

```
commentKey = HKDF-SHA256(readKey, salt="mihayon/comments/v1")
```

Comments are encrypted under `commentKey`. The server stores ciphertext and,
exactly as with documents, cannot read them. It already knows the document `id`
(it is in the request path), so associating comments with that `id` leaks no new
plaintext.

## Anonymized, unforgeable pseudonyms

Each commenter generates a **per-document Ed25519 keypair** locally, stored in
IndexedDB/localStorage keyed by the document `id`:

- The **display name** is derived *deterministically* from the public key, from
  a fixed wordlist — e.g. `QuietFox·3f2a`. It is **stable within a thread**
  (same keypair → same name), **unlinkable across documents** (a fresh keypair
  per document), and **unforgeable**: posting under a name requires that name's
  private key.
- On read, clients **re-derive** the name from the embedded public key rather
  than trusting a transmitted name, so nobody can spoof another pseudonym.
- A "reset identity" control lets a user mint a new keypair (new pseudonym) for
  the thread.

This gives pseudonymous continuity without identity, and prevents impersonation
of a pseudonym — but note it is **not sybil-resistant**: one person can mint
unlimited identities. Proof-of-work (below) raises the cost of doing so at scale.

## Comment object

Before encryption:

```jsonc
{
  "id":      "<uuid>",
  "pubkey":  "<base64url ed25519 public key>",
  "name":    "<derived name, advisory — re-derived on read>",
  "body":    "<markdown/plain text>",
  "ts":      1700000000000,
  "replyTo": "<comment id | null>",
  "ver":     1
}
```

Signed, then encrypted:

```
sig  = Sign(privkey, canonicalJSON(comment_without_sig))
blob = AES-GCM(commentKey, JSON({ ...comment, sig }))
```

## API

| Endpoint                                   | Body                     | Notes                                                    |
| ------------------------------------------ | ------------------------ | ------------------------------------------------------- |
| `POST /api/docs/:id/comments`              | `{ blob }`               | append an encrypted comment; returns `{ seq }`          |
| `GET  /api/docs/:id/comments?since=<seq>`  | —                        | returns `[{ seq, blob, ts }]` (paged)                   |
| `DELETE /api/docs/:id/comments/:seq`       | `{ writeSecret }`        | **owner moderation** — server checks the doc's authHash |
| `PUT /api/docs/:id/comments-config`        | `{ writeSecret, enabled }` | owner enables/disables comments                        |

The server stores an append-only list of opaque `blob`s per document `id`. It
never learns the author, the pseudonym, or the text.

## Verification on read

For each fetched comment the client:

1. AES-GCM-decrypts with `commentKey` (drop on failure).
2. Verifies `sig` against the embedded `pubkey` (drop on failure).
3. **Re-derives** the display name from `pubkey` (ignores the transmitted name).
4. Renders through the local filter (below) and the same DOMPurify pipeline used
   for documents.

## Local content filter (client-side, best-effort)

Runs on decrypted comment text before display, and optionally warns the author
at compose time. Configurable and user-toggleable:

- **Profanity** — mask against a wordlist.
- **URLs** — detect and either strip or render inert (non-clickable) to curb
  spam and drive-by links.
- **Limits** — max length, max newlines; strip control characters.

**Honest limitation:** because the server cannot read plaintext, filtering can
only happen *client-side* and is therefore **advisory, not enforcement** — a
modified client can bypass it. It improves the default experience; it is not a
security control. The real removal mechanism is **owner moderation** (delete),
which the server *can* perform because deletion needs only the write secret, not
the ability to read.

## Moderation & ownership

- The document owner (holder of the write secret) can delete any comment and can
  disable comments entirely. This keeps a TOS-enforcement story intact without
  the server ever reading content.
- Individual self-deletion is **not** in v1: the server cannot verify who owns a
  pseudonym without reading the (encrypted) comment. Commenters can hide their
  own comments client-side; hard deletion is owner-only for now. (A future
  version could carry an unencrypted, signed delete token to allow verifiable
  self-deletion.)

## Anti-abuse

- **Proof-of-work** on `POST` (no accounts to rate-limit; PoW raises spam and
  sybil cost).
- Per-document **comment count cap**, per-comment **size cap**, and edge **rate
  limiting**.
- Owner can **disable** comments per document.

## Threat model

- **Server** can't read comments (encrypted); it sees only per-`id` counts,
  timing, and sizes — the same metadata caveat as documents.
- **Pseudonyms** are unforgeable (signatures) but not sybil-resistant; PoW
  mitigates, doesn't eliminate.
- **Filtering** is client-side and best-effort; moderation (owner delete) is the
  enforcement mechanism.

## Relationship to P2P

v1 comments are **server-backed** (simple, persistent, consistent with the
core). They could later ride the [swarm](P2P.md) as signed, append-only entries
gossiped between peers, but that adds ordering/merge (CRDT) complexity and is out
of scope for the first implementation.
