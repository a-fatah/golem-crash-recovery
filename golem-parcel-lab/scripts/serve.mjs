import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createLabServer } from '../../src/http-server.mjs';
import { createGolemExperiment } from '../harness/experiment-controller.mjs';
import { createEvidenceRoute } from '../harness/evidence-route.mjs';
import { verifyParcelRecovery } from './verify.mjs';
import { createIdleShutdown } from '../harness/idle-shutdown.mjs';

let latest = null;
try { latest = JSON.parse(await readFile(new URL('../evidence/latest.json', import.meta.url), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const startupTimeoutMs = Number(process.env.GOLEM_STARTUP_TIMEOUT_MS ?? 180_000);
const observationTimeoutMs = Number(process.env.GOLEM_OBSERVATION_TIMEOUT_MS ?? 25_000);
if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs <= 0) {
  throw new Error('GOLEM_STARTUP_TIMEOUT_MS must be a positive integer');
}
if (!Number.isSafeInteger(observationTimeoutMs) || observationTimeoutMs <= 0) {
  throw new Error('GOLEM_OBSERVATION_TIMEOUT_MS must be a positive integer');
}
const experiment = createGolemExperiment({
  verify: options => verifyParcelRecovery({ ...options, startupTimeoutMs, observationTimeoutMs }),
  version: '1.6.1',
  latest,
});
const dashboard = createLabServer({
  experiment,
  publicDirectory: new URL('../../public/', import.meta.url),
  embedding: { parentOrigin: process.env.ARTICLE_ORIGIN ?? 'http://127.0.0.1:4320' },
  additionalEmbeddings: [
    ...(process.env.ARTICLE_COPY_ORIGIN
      ? [{ path: '/embed-copy', parentOrigin: process.env.ARTICLE_COPY_ORIGIN }]
      : []),
    ...(process.env.ARTICLE_BLOG_ORIGIN
      ? [{ path: '/embed-blog', parentOrigin: process.env.ARTICLE_BLOG_ORIGIN }]
      : []),
  ],
  publicOrigin: process.env.PUBLIC_ORIGIN ?? null,
});
const evidenceRoute = createEvidenceRoute({ evidenceDirectory: fileURLToPath(new URL('../evidence/', import.meta.url)) });
let closing = false;
let requests = 0;
let idleShutdown;
const server = createServer(async (request, response) => {
  if (closing) {
    response.writeHead(503, { Connection: 'close' }).end('The demo is going to sleep. Please retry.');
    return;
  }
  requests += 1;
  let finished = false;
  const finish = () => { if (!finished) { finished = true; requests -= 1; } };
  response.once('finish', finish);
  response.once('close', finish);
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname !== '/api/state') idleShutdown?.touch();
  if (idleShutdown) response.setHeader('X-Lab-Idle-Sleep', 'true');
  if (!await evidenceRoute(request, response)) dashboard.emit('request', request, response);
});
const port = Number(process.env.PORT ?? 4319);
const host = process.env.HOST ?? '127.0.0.1';
server.listen(port, host, () => console.log(`Actual Golem Parcel Lab: http://${host}:${port}`));
if (process.env.IDLE_SHUTDOWN_MS) {
  idleShutdown = createIdleShutdown({
    idleMs: Number(process.env.IDLE_SHUTDOWN_MS),
    isActive: () => experiment.active,
    isBusy: () => requests > 0,
    onIdle: () => {
      console.log('No active mission; idle timeout reached. Shutting down cleanly.');
      void close();
    },
  });
}
async function close() {
  if (closing) return;
  closing = true;
  idleShutdown?.stop();
  server.close();
  server.closeAllConnections();
  await experiment.stop();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
server.on('error', async error => { console.error(error.message); await close(); process.exitCode = 1; });
