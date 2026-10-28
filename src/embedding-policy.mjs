const pageDirectives = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:";

export const standaloneContentSecurityPolicy = `${pageDirectives}; frame-ancestors 'none'`;

/** Embedding grants one exact parent origin; it grants no API authority. */
export function createEmbeddingPolicy({ parentOrigin }) {
  let url;
  try { url = new URL(parentOrigin); }
  catch { throw new TypeError('The embedding parent must be an exact HTTP or HTTPS origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== parentOrigin) {
    throw new TypeError('The embedding parent must be an exact HTTP or HTTPS origin');
  }
  return {
    parentOrigin,
    contentSecurityPolicy: `${pageDirectives}; frame-ancestors ${parentOrigin}`,
  };
}
