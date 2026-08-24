// URL construction and parsing for Mihayon links.
//
// The identifier that lets the *server* find a blob lives in the path.
// The secrets that let the *client* read or edit it live only in the fragment
// (after '#'), which browsers never send to the server. That split is the whole
// game: the host can serve a document without ever being able to open it.
//
//   View link:  /d/<id>#<key>
//   Edit link:  /edit/<id>#<key>.<writeSecret>
//
// <key> and <writeSecret> are base64url, which never contains '.', so a single
// dot cleanly separates them.

export function buildViewLink(id, key) {
  return `${location.origin}/d/${encodeURIComponent(id)}#${key}`;
}

export function buildEditLink(id, key, writeSecret) {
  return `${location.origin}/edit/${encodeURIComponent(id)}#${key}.${writeSecret}`;
}

// From the current view page (/d/<id>#<key>).
export function parseViewLocation() {
  const m = location.pathname.match(/^\/d\/([^/]+)\/?$/);
  const id = m ? decodeURIComponent(m[1]) : null;
  const key = location.hash.replace(/^#/, '') || null;
  return { id, key };
}

// From the current edit page (/edit or /edit/<id>#<key>.<writeSecret>).
export function parseEditLocation() {
  const m = location.pathname.match(/^\/edit\/([^/]+)\/?$/);
  const id = m ? decodeURIComponent(m[1]) : null;
  const frag = location.hash.replace(/^#/, '');
  let key = null;
  let writeSecret = null;
  if (frag) {
    const dot = frag.indexOf('.');
    if (dot >= 0) {
      key = frag.slice(0, dot);
      writeSecret = frag.slice(dot + 1);
    } else {
      key = frag;
    }
  }
  return { id, key, writeSecret };
}
