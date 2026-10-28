import { createEmbeddingPolicy } from './embedding-policy.mjs';

/** Each dedicated frame route grants exactly one configured parent origin. */
export function createEmbeddingRoutes({ embedding = null, additionalEmbeddings = [] } = {}) {
  if (!Array.isArray(additionalEmbeddings)) {
    throw new TypeError('Additional embeddings must be an array of dedicated routes');
  }
  const routes = new Map();
  if (embedding !== null) routes.set('/embed', createEmbeddingPolicy(embedding));
  for (const entry of additionalEmbeddings) {
    const path = entry?.path;
    if (typeof path !== 'string' || path.length > 64 || !/^\/embed-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)) {
      throw new TypeError('Additional embedding paths must be clean dedicated /embed-* routes');
    }
    if (routes.has(path)) throw new TypeError(`Duplicate embedding route: ${path}`);
    routes.set(path, createEmbeddingPolicy(entry));
  }
  return routes;
}
