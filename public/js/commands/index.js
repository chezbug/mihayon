// Command system — extension point for future Mihayon capabilities.
//
// The idea: a decrypted document may embed fenced ```mihayon blocks that
// declare *commands* the viewer can run — for example, issuing an HTTP request
// through a proxy the reader supplies, so the document can show live data
// without the Mihayon host ever brokering (or seeing) that traffic.
//
// None of that is implemented yet. This module only establishes the shape so
// the core stays stable when commands land. Registering handlers and wiring a
// UI is deliberately left for a follow-up.
//
// Planned command envelope (inside a document, after decryption):
//
//   ```mihayon
//   { "command": "fetch",
//     "url": "https://api.example.com/data",
//     "via": "proxy" }        // proxy details are entered by the reader,
//   ```                       // never stored in the document or on the server.

const registry = new Map();

// Future API: plugins call this to add a handler.
export function registerCommand(name, handler) {
  if (typeof name !== 'string' || typeof handler !== 'function') {
    throw new Error('registerCommand(name, handler)');
  }
  registry.set(name, handler);
}

export function hasCommand(name) {
  return registry.has(name);
}

// Future API: the viewer calls this for each embedded command block.
// For now it is intentionally inert — unknown/unregistered commands are ignored
// so that documents using future syntax degrade gracefully on older clients.
export async function runCommand(spec, context = {}) {
  if (!spec || typeof spec.command !== 'string') return null;
  const handler = registry.get(spec.command);
  if (!handler) return null; // not yet implemented — no-op by design
  return handler(spec, context);
}

export const commandNames = () => [...registry.keys()];
