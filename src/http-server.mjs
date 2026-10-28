import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { standaloneContentSecurityPolicy } from './embedding-policy.mjs';
import { createEmbeddingRoutes } from './embedding-routes.mjs';
import { renderEmbeddedPage } from './embedded-page.mjs';

/** Loopback HTTP adapter. The API exposes experiment controls, never raw tools. */
export function createLabServer({ experiment, publicDirectory, embedding = null, additionalEmbeddings = [], publicOrigin = null }) {
  const embeddingRoutes = createEmbeddingRoutes({ embedding, additionalEmbeddings });
  const staticFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/api-client.js', ['api-client.js', 'text/javascript; charset=utf-8']],
    ['/dashboard-view.js', ['dashboard-view.js', 'text/javascript; charset=utf-8']],
    ['/local-runtime-copy.js', ['local-runtime-copy.js', 'text/javascript; charset=utf-8']],
    ['/golem-runtime-copy.js', ['golem-runtime-copy.js', 'text/javascript; charset=utf-8']],
    ['/mission-motion.js', ['mission-motion.js', 'text/javascript; charset=utf-8']],
    ['/mission-playback-gate.js', ['mission-playback-gate.js', 'text/javascript; charset=utf-8']],
    ['/mission-playback.css', ['mission-playback.css', 'text/css; charset=utf-8']],
    ['/mission-scene-view.js', ['mission-scene-view.js', 'text/javascript; charset=utf-8']],
    ['/mission-scene-copy.js', ['mission-scene-copy.js', 'text/javascript; charset=utf-8']],
    ['/mission-activity-model.js', ['mission-activity-model.js', 'text/javascript; charset=utf-8']],
    ['/mission-activity-view.js', ['mission-activity-view.js', 'text/javascript; charset=utf-8']],
    ['/mission-activity-timer.js', ['mission-activity-timer.js', 'text/javascript; charset=utf-8']],
    ['/mission-activity.css', ['mission-activity.css', 'text/css; charset=utf-8']],
    ['/mission-motion-model.js', ['mission-motion-model.js', 'text/javascript; charset=utf-8']],
    ['/mission-motion.css', ['mission-motion.css', 'text/css; charset=utf-8']],
    ['/mission-policy-motion.css', ['mission-policy-motion.css', 'text/css; charset=utf-8']],
    ['/mission-policy-cues.js', ['mission-policy-cues.js', 'text/javascript; charset=utf-8']],
    ['/mission-code-model.js', ['mission-code-model.js', 'text/javascript; charset=utf-8']],
    ['/mission-code-selection.js', ['mission-code-selection.js', 'text/javascript; charset=utf-8']],
    ['/mission-cue-identity.js', ['mission-cue-identity.js', 'text/javascript; charset=utf-8']],
    ['/mission-runtime-cues.js', ['mission-runtime-cues.js', 'text/javascript; charset=utf-8']],
    ['/mission-source-model.js', ['mission-source-model.js', 'text/javascript; charset=utf-8']],
    ['/mission-code-presentation.js', ['mission-code-presentation.js', 'text/javascript; charset=utf-8']],
    ['/mission-code-view.js', ['mission-code-view.js', 'text/javascript; charset=utf-8']],
    ['/mission-code-source.js', ['mission-code-source.js', 'text/javascript; charset=utf-8']],
    ['/mission-code-snippets.json', ['mission-code-snippets.json', 'application/json; charset=utf-8']],
    ['/mission-code.css', ['mission-code.css', 'text/css; charset=utf-8']],
    ['/mission-code-tokens.css', ['mission-code-tokens.css', 'text/css; charset=utf-8']],
    ['/mission-embed.js', ['mission-embed.js', 'text/javascript; charset=utf-8']],
    ['/mission-embed-controller.js', ['mission-embed-controller.js', 'text/javascript; charset=utf-8']],
    ['/mission-embed-protocol.js', ['mission-embed-protocol.js', 'text/javascript; charset=utf-8']],
    ['/mission-scene-navigation.js', ['mission-scene-navigation.js', 'text/javascript; charset=utf-8']],
    ['/mission-embed.css', ['mission-embed.css', 'text/css; charset=utf-8']],
    ['/assets/golem-logo.png', ['assets/golem-logo.png', 'image/png']],
    ['/assets/golem-stone.png', ['assets/golem-stone.png', 'image/png']],
    ['/assets/golem-halloween.png', ['assets/golem-halloween.png', 'image/png']],
  ]);
  const controls = new Map([
    ['/api/start', () => experiment.start()],
    ['/api/resume', () => experiment.resume()],
    ['/api/crash', () => experiment.crash()],
    ['/api/reset', () => experiment.reset()],
  ]);

  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const embeddingPolicy = request.method === 'GET' ? embeddingRoutes.get(url.pathname) : null;
    const embedded = Boolean(embeddingPolicy);
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': embedded ? embeddingPolicy.contentSecurityPolicy : standaloneContentSecurityPolicy,
    };
    const json = (status, body) => {
      response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    if (request.method === 'GET' && url.pathname === '/api/state') {
      json(200, experiment.state());
      return;
    }
    if (request.method === 'POST' && controls.has(url.pathname)) {
      // A browser on another origin cannot silently drive this local process.
      const origin = request.headers.origin;
      if (origin && origin !== (publicOrigin ?? `http://${request.headers.host}`)) {
        json(403, { error: 'Experiment controls require the same origin' });
        return;
      }
      try {
        controls.get(url.pathname)();
        json(200, experiment.state());
      } catch (error) {
        json(409, { error: error.message });
      }
      return;
    }
    const asset = staticFiles.get(embedded ? '/' : url.pathname);
    if (request.method !== 'GET' || !asset) {
      json(404, { error: 'Not found' });
      return;
    }
    try {
      const bytes = await readFile(new URL(asset[0], publicDirectory));
      const content = embedded
        ? renderEmbeddedPage({ html: bytes.toString('utf8'), parentOrigin: embeddingPolicy.parentOrigin })
        : bytes;
      response.writeHead(200, { ...headers, 'Content-Type': asset[1] });
      response.end(content);
    } catch {
      json(500, { error: 'The dashboard asset is unavailable' });
    }
  });
}
