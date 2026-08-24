// Markdown rendering with strict sanitization.
//
// Decrypted content is authored by whoever holds a document's write secret, but
// it is still rendered defensively: marked produces HTML, DOMPurify strips
// anything that could execute script or exfiltrate data. The page CSP is the
// second line of defence.
//
// marked and DOMPurify are loaded as globals from /vendor by the host page.

const { marked } = window;
const DOMPurify = window.DOMPurify;

marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: true,
  mangle: false,
});

// Force links to open safely: no referrer, no window.opener access.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  // Disallow anything that reaches the network implicitly or runs code.
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'link'],
  FORBID_ATTR: ['style', 'srcset'],
  ALLOW_DATA_ATTR: false,
};

export function renderMarkdown(md) {
  const rawHtml = marked.parse(md ?? '');
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
}
