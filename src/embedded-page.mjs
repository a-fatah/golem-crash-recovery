function attribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Reuses the dashboard document while adding only its embedded presentation. */
export function renderEmbeddedPage({ html, parentOrigin }) {
  if (!/<\/head\s*>/i.test(html) || !/<body(?=[\s>])/i.test(html)) {
    throw new Error('The dashboard document is missing its head or body');
  }
  return html
    .replace(/<\/head\s*>/i, '<link rel="stylesheet" href="/mission-embed.css" />\n    <script type="module" src="/mission-embed.js"></script>\n  </head>')
    .replace(/<body(?=[\s>])/i, `<body data-presentation="embedded" data-parent-origin="${attribute(parentOrigin)}"`);
}
