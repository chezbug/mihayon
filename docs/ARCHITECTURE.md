# Architecture & threat model

Mihayon's single design goal: **the server can neither read a document nor tell
who is behind it.** Everything else follows from that.

## Data flow

1. **Author** writes markdown in the browser.
2. The client generates a random 256-bit AES-GCM key and a random write secret.
3. The client encrypts the markdown (`iv || ciphertext+tag`, base64) and uploads
   it together with `SHA-256(writeSecret)` — never the secret itself.
4. The server assigns a random `id`, stores the record, and returns the `id`.
5. The client builds two links:
   - **view:** `/d/<id>#<key>`
   - **edit:** `/edit/<id>#<key>.<writeSecret>`
6. A **reader** opens a view link. The client fetches the ciphertext by `id`,
   reads the key from the URL fragment, decrypts locally, and renders.

The `id` is in the URL **path** (the server needs it to locate the blob). The
`key` and `writeSecret` are in the URL **fragment**, which per the HTTP spec is
never transmitted to the server.

## What the server stores

```json
{
  "id": "loTOGo7pvZp-qPgB",
  "blob": "<base64 of iv||ciphertext>",
  "authHash": "<hex SHA-256 of the write secret>",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
```

There is no author, title, tag, IP, or session tied to a record. The `blob` is
opaque bytes. `authHash` is one-way. Timestamps are the only non-random
metadata, and they reveal nothing about content or identity.

## Cryptography

- **Cipher:** AES-GCM, 256-bit key, fresh 96-bit random IV per encryption.
  GCM provides confidentiality and integrity (a tampered blob or wrong key fails
  authentication and decryption cleanly).
- **Key generation:** `crypto.subtle.generateKey` (CSPRNG).
- **Key transport:** base64url in the URL fragment. Never sent to the server,
  never logged server-side.
- **Write authorization:** the client holds a random write secret. The server
  stores only `SHA-256(writeSecret)` and, on update/delete, recomputes the hash
  and compares in constant time (`timingSafeEqual`). The server sees the raw
  secret only transiently during an authorized write, over TLS, and never
  persists it.

## Guarantees

- **Confidentiality vs. the host:** without the fragment key, the host (and
  anyone who compromises the host's storage) has only ciphertext.
- **Unlinkability:** records carry no identity, so the host cannot attribute a
  document to a person or determine "who hosts what."
- **Integrity:** AES-GCM authentication means a modified blob will not decrypt.
- **Write control:** only holders of the write secret can change a document.

## Non-goals / known limitations

- **The server operator controls the code it serves.** Like all
  "encrypt-in-the-browser" web apps, a malicious or compromised host could ship
  JavaScript that exfiltrates the fragment key. Mihayon minimizes this surface
  (strict CSP, no external requests, self-hosted libraries, no inline scripts),
  but browser-delivered crypto cannot fully defend against a hostile server.
  For maximum assurance, self-host and pin the deployed assets.
- **Link custody is everything.** The key and write secret exist only in the
  links. Losing them means the document is unrecoverable; leaking the view link
  discloses the content; leaking the edit link grants write access.
- **Traffic analysis.** Mihayon does not hide that *a* request for a given `id`
  occurred, its size, or its timing. It hides content and authorship, not the
  existence of an access. Front with a CDN/Tor if that matters to you.
- **No anti-abuse by default.** There is a blob size cap and optional TTL, but no
  rate limiting or content moderation (the host cannot see content to moderate).
  Deployments should add rate limiting at the edge.

## Content rendering safety

Decrypted markdown is untrusted (it may have been authored by anyone with the
write secret). It is rendered through:

1. **marked** → HTML.
2. **DOMPurify** with a restrictive profile: no `<script>`, `<style>`,
   `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, `<link>`; no `style`
   attributes; no `javascript:` URLs; links forced to
   `rel="noopener noreferrer nofollow" target="_blank"`.
3. A page **Content-Security-Policy**: `default-src 'none'`, `script-src 'self'`,
   `img-src 'self' data:` (external images cannot beacon), `connect-src 'self'`,
   framing denied.

## Future: commands

A planned extension lets a document embed ```` ```mihayon ```` blocks describing
actions — first up, fetching live data through a **reader-supplied proxy** so the
Mihayon host never brokers or sees that traffic. The dispatcher exists
(`public/js/commands/index.js`) and no-ops on unrecognized commands, so
documents using future syntax degrade gracefully. No command is enabled yet;
each will require its own security review before shipping.
