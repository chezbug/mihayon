# Peer distribution (design)

Status: **design only — not yet implemented.** This document pins down the
protocol so it can be reviewed before any code is written.

Mihayon's core keeps the server *blind* (it stores only ciphertext and cannot
tell who hosts what). This layer keeps the server *optional*: while readers of a
document are online, they serve it to each other, so the document survives even
if the origin removes its copy or goes down. It is deliberately **not full P2P**
— no full nodes, no port forwarding, no configuration. Anyone with a browser and
any internet connection (shared IP, CGNAT, behind NAT) participates
automatically, and the origin server remains the always-on fallback.

## Goals

- Reduce dependence on the origin; add censorship-resistance for **live**
  documents.
- Zero setup for users: a browser is the only requirement.
- Preserve the core guarantees: the server (now also a signaling relay) still
  cannot read content or link a swarm to a document.

## Non-goals (be honest up front)

- **Not permanent storage.** A document lives in the swarm only while someone
  who holds it is online. The origin copy is the durable one.
- **Not reader anonymity from other readers.** WebRTC exposes peer IPs to each
  other (see Limitations).
- **Not uncensorable.** The origin keeps a removable copy on purpose, so lawful
  takedown and TOS enforcement remain possible. Peers may retain copies while
  online; this is the accepted trade of "Option A."

## Topology

```
                     ┌───────────────────────────────┐
                     │        Mihayon origin         │
                     │  1. blob origin + fallback     │
   signaling  ┌──────┤  2. WebRTC signaling relay     ├──────┐ signaling
   (WebSocket)│      │  3. STUN/TURN (or points to)   │      │
              │      └───────────────────────────────┘      │
              ▼                                              ▼
        ┌───────────┐        WebRTC DataChannel        ┌───────────┐
        │  Browser  │◀════════ (DTLS, direct) ════════▶│  Browser  │
        │  peer A   │         encrypted blob            │  peer B   │
        │ IndexedDB │                                   │ IndexedDB │
        └───────────┘                                   └───────────┘
```

The origin plays three roles: it still serves the encrypted blob (fallback), it
relays WebRTC handshakes between peers, and it provides (or names) STUN/TURN for
NAT traversal. Browsers are ephemeral light peers that cache opened documents in
IndexedDB (opt-in) and serve them while the tab is open.

## Layers

1. **Content** — AES-GCM ciphertext; content key in the URL fragment; immutable
   per version. (Unchanged from core.)
2. **Content address** — `cid = SHA-256(ciphertext)`. Gives blind relays
   integrity and lets peers dedup. The content never changes as it hops, so its
   `cid` is stable and verifiable at every hop.
3. **Blind rendezvous** — peers holding the same URL independently compute a
   rotating swarm topic and meet on it through the signaling relay:

   ```
   epoch = floor(now_seconds / WINDOW)          // e.g. WINDOW = 3600
   topic = base64url( HMAC-SHA256(readKey, "mihayon/swarm/v1|" + epoch) )[:16]
   ```

   The signaling relay sees peers subscribing to opaque, time-rotating topics.
   Without `readKey` it cannot map a topic to a document, nor link the same
   document's topics across epochs. This is "an identifier only usable by those
   on the site right now," done correctly.
4. **Signaling** — a thin WebSocket relay (see wire protocol). It shuttles
   WebRTC offer/answer/ICE between peers on the same topic. In-memory,
   TTL-expired, no persistence, no logging of topics.
5. **Transport** — WebRTC DataChannels (DTLS). Every channel negotiates fresh
   keys, so **the bytes on the wire differ on every hop automatically** — a
   network observer cannot fingerprint the same document as it moves, even
   though the underlying content and its `cid` are fixed. Optional fixed-size
   **padding buckets** on the blob reduce size fingerprinting.
6. **Local storage** — an IndexedDB map `cid → ciphertext`, **opt-in with an
   explicit consent prompt** (a reader must agree to cache and relay encrypted
   content they cannot read). A size cap and a purge control are part of the UI.

## Fetch flow (reader opens `/d/<id>#<key>`)

1. Parse `id` and `key`; compute `topic` for the current epoch.
2. Subscribe to `topic` on the signaling relay; receive the current peer list.
3. Open WebRTC to a few peers; request the blob by `cid`; on arrival verify
   `SHA-256(bytes) == cid`, then AES-GCM-decrypt with `key`.
4. **Fallback:** if no peers answer or verification fails within a short
   timeout, `GET /api/docs/<id>` from the origin (the existing core path).
5. On success, if the reader opted in, store `cid → ciphertext` in IndexedDB and
   begin serving the `topic`.

The origin is therefore the availability floor: the swarm is a best-effort
accelerator and resilience layer on top, never a single point of failure for
reachability.

## Mutable documents in the swarm

The core authorizes edits with a symmetric write secret the server hashes. In a
swarm, peers must independently verify which version is authentic and newest
(a malicious peer could otherwise serve a stale or forged version). The upgrade:

- Derive an **Ed25519 keypair** from the write secret. The **public key** is the
  document's stable identity; the **private key** is the write capability.
- Each version is `{ version:int, cid, prevCid?, sig = Sign(priv, version || cid) }`.
- Readers verify `sig` against the public key and accept only a
  **monotonically increasing** `version`. This makes updates unforgeable and
  **rollback-proof** — exactly how mutable content addressing (e.g. IPNS) works.
- The origin API keeps its symmetric write-secret hash check for the centralized
  path; the signature is the P2P-verifiable proof. The two coexist.

## Origin obfuscation

An original upload is transported **identically** to a relay — same message
shape, no field that marks "I am the author." No hop is recorded anywhere
(see the comments/threat notes: we deliberately keep **no** per-hop trail).
Because publishing is indistinguishable from relaying and nothing is logged,
"who first published this" is not recoverable. Statelessness is the anonymity;
a recorded chain of hops would destroy it, which is why we don't keep one.

## Anti-abuse

- **Proof-of-work** on document creation (and optionally on registering as a
  seeder) raises the cost of flooding without accounts or IP logging.
- Blob **size cap**; **per-topic peer caps**; signaling **rate limits** at the
  edge.

## Wire protocol (signaling)

A WebSocket endpoint, e.g. `GET /api/swarm` (upgrade). All messages are JSON and
carry **no document-identifying fields** — only opaque topics and peer handles:

| Message                               | Direction        | Meaning                                  |
| ------------------------------------- | ---------------- | ---------------------------------------- |
| `{t:"sub", topic}`                    | client → server  | join a topic                             |
| `{t:"peers", ids:[...]}`              | server → client  | current peers on the topic               |
| `{t:"signal", to, data}`              | client → server  | relay WebRTC SDP/ICE to a peer           |
| `{t:"signal", from, data}`            | server → client  | delivered relayed signal                 |
| `{t:"unsub", topic}`                  | client → server  | leave a topic                            |

The server holds `topic → Set(connectionId)` in memory only, expires idle
entries, and persists/logs nothing about topics.

## Limitations (threat model)

- **Code trust is unchanged — arguably worse.** The client JS still ships from
  the origin. A hostile or compromised origin can serve code that exfiltrates
  the fragment key *and* everything the browser is caching/relaying for others.
  Mitigate with a pinned, signed static bundle (Subresource Integrity) or an
  extension/IPFS-hosted client; ultimately, self-host.
- **Peer IP exposure.** WebRTC reveals peer IPs to each other by design. A
  **TURN-only (relayed) mode** hides them at the cost of bandwidth and
  re-centralization; offered as a toggle, not the default.
- **TURN cost.** Symmetric-NAT/CGNAT peers relay through TURN, so the origin
  bears that bandwidth and the P2P offload benefit shrinks for heavily-NAT'd
  populations.
- **Permanence.** Documents persist in the swarm only while a holder is online;
  the origin copy is the durable one.
- **Traffic analysis.** Rotating topics hide document identity from the
  signaling relay, but a global observer can still attempt timing/volume
  correlation.

## Phased plan

- **Phase 0** — this document (protocol + threat model).
- **Phase 1** — signaling relay (in-memory topic pub/sub + signal relay) and a
  client swarm module; two browsers share one document with origin fallback;
  direct WebRTC only.
- **Phase 2** — IndexedDB caching, the consent UI, and seeding.
- **Phase 3** — signed versioning for mutable docs; TURN integration; padding;
  proof-of-work.
