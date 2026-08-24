# Commands (future)

This directory holds the extension point for **commands** — actions a Mihayon
document can offer to the reader when it is opened. Commands are *not*
implemented yet; `index.js` is a stable registry and dispatcher with no
handlers wired in.

## Why it exists now

Adding commands later should not require reshaping the core. So the core already
routes through `runCommand()`, which currently no-ops on any command it doesn't
recognise. Documents authored with future command syntax therefore degrade
gracefully on today's client.

## Planned first command: proxied fetch

The motivating use case is letting a document display live data without the
Mihayon host ever brokering the request:

- The document embeds a command block naming a URL to fetch.
- The **reader** supplies proxy details in the client (never stored in the
  document, never sent to the Mihayon server).
- The client performs the request through the reader's proxy and renders the
  result into the document.

This preserves the core guarantee: the host sees only ciphertext and never the
reader's proxy, targets, or responses.

## Adding a command (future shape)

```js
import { registerCommand } from './index.js';

registerCommand('fetch', async (spec, ctx) => {
  // spec: the parsed ```mihayon block
  // ctx:  reader-supplied config (e.g. proxy), viewer helpers
  // ...perform the action, return content to render
});
```

Security review is required before any command that touches the network or
reader-supplied secrets is enabled by default.
