import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Read-only, bounded access to saved experiment evidence. */
export function createEvidenceRoute({ evidenceDirectory }) {
  return async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/evidence/')) return false;
    const match = /^\/evidence\/([a-zA-Z0-9_-]+)\/((?:summary|oplog-before|oplog-after|oplog-after-policy|kill|post-recovery-policy|policy-denials|filesystem-denials|wallet|runtime-version|recovered-invocation)\.json|(?:parcel-after|cable-after|cable-after-policy)\.txt)$/.exec(pathname);
    if (request.method !== 'GET' || !match) {
      response.writeHead(404).end('Evidence not found');
      return true;
    }
    try {
      const bytes = await readFile(resolve(evidenceDirectory, match[1], match[2]));
      response.writeHead(200, { 'Content-Type': match[2].endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(bytes);
    } catch {
      response.writeHead(404).end('Evidence is not available yet');
    }
    return true;
  };
}
