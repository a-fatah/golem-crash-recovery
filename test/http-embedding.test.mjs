import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createLabServer } from '../src/http-server.mjs';

const parentOrigin = 'http://127.0.0.1:4320';
const labOrigin = 'http://127.0.0.1:4319';
const document = '<!doctype html><html><head><title>Shared mission</title><script type="module" src="/app.js"></script></head><body class="dashboard"><main id="mission">One mission</main></body></html>';
const presentationAssets = [
  ...['mission-code-selection.js', 'mission-cue-identity.js', 'mission-runtime-cues.js', 'mission-source-model.js', 'mission-code-presentation.js', 'mission-playback-gate.js', 'mission-scene-copy.js', 'mission-scene-view.js', 'mission-embed-controller.js', 'mission-scene-navigation.js', 'mission-activity-model.js', 'mission-activity-view.js', 'mission-activity-timer.js'].map(filename => ({
    path: `/${filename}`, type: 'text/javascript; charset=utf-8', content: `export {}; // ${filename}`,
  })),
  { path: '/mission-code-model.js', type: 'text/javascript; charset=utf-8', content: 'export const model = true;' },
  { path: '/mission-code-view.js', type: 'text/javascript; charset=utf-8', content: 'export const view = true;' },
  { path: '/mission-code-source.js', type: 'text/javascript; charset=utf-8', content: 'export const source = true;' },
  { path: '/mission-code.css', type: 'text/css; charset=utf-8', content: '.mission-code-panel { display: block; }' },
  { path: '/mission-code-tokens.css', type: 'text/css; charset=utf-8', content: '.mission-code-panel .mission-token-1 { color: #fff; }' },
  { path: '/mission-playback.css', type: 'text/css; charset=utf-8', content: '.mission-playback { display: flex; }' },
  { path: '/mission-activity.css', type: 'text/css; charset=utf-8', content: '.mission-activity { display: flex; }' },
  { path: '/mission-code-snippets.json', type: 'application/json; charset=utf-8', content: '{"version":1,"policy":{"filename":"src/knife-policy.ts"}}' },
];

/** In-memory HTTP requests exercise the real adapter without binding a port. */
async function createFixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'golem-embedding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    writeFile(join(directory, 'index.html'), document),
    writeFile(join(directory, 'mission-embed.js'), 'export {};'),
    writeFile(join(directory, 'mission-embed-protocol.js'), 'export {};'),
    writeFile(join(directory, 'mission-embed.css'), 'body {}'),
    ...presentationAssets.map(asset => writeFile(join(directory, asset.path.slice(1)), asset.content)),
  ]);
  let status = 'idle';
  let runId = null;
  const calls = [];
  const experiment = {
    state: () => ({ status, runId }),
    start() {
      if (status !== 'idle') throw new Error('A mission is already active');
      calls.push('start');
      status = 'running';
      runId = 'same-real-mission';
    },
    crash() { calls.push('crash'); status = 'crashed'; },
    resume() { calls.push('resume'); status = 'completed'; },
    reset() { calls.push('reset'); status = 'idle'; runId = null; },
  };
  const server = createLabServer({
    experiment,
    publicDirectory: pathToFileURL(directory + '/'),
    ...options,
  });
  const handler = server.listeners('request')[0];
  return {
    calls,
    async request(path, requestOptions = {}) {
      const response = {};
      await handler({
        method: requestOptions.method ?? 'GET',
        url: path,
        headers: { host: '127.0.0.1:4319', ...requestOptions.headers },
      }, {
        writeHead(statusCode, headers) { response.status = statusCode; response.headers = headers; },
        end(body) { response.body = body == null ? '' : String(body); },
      });
      return response;
    },
  };
}

test('generic lab disables embedding and leaves its dashboard unchanged', async t => {
  const lab = await createFixture(t);
  const normal = await lab.request('/');
  assert.equal(normal.status, 200);
  assert.equal(normal.body, document);
  assert.match(normal.headers['Content-Security-Policy'], /frame-ancestors 'none'$/);
  const embedded = await lab.request('/embed');
  assert.equal(embedded.status, 404);
  assert.match(embedded.headers['Content-Security-Policy'], /frame-ancestors 'none'$/);
  assert.deepEqual(lab.calls, []);
});

test('only the configured embed route grants the exact article framing origin', async t => {
  const lab = await createFixture(t, { embedding: { parentOrigin } });
  const embedded = await lab.request('/embed?parentOrigin=https://untrusted.example', {
    headers: { origin: 'https://untrusted.example' },
  });
  assert.equal(embedded.status, 200);
  assert.equal(embedded.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.match(embedded.headers['Content-Security-Policy'], /frame-ancestors http:\/\/127\.0\.0\.1:4320$/);
  assert.doesNotMatch(embedded.headers['Content-Security-Policy'], /untrusted|\*/);
  assert.match(embedded.body, /<body data-presentation="embedded" data-parent-origin="http:\/\/127\.0\.0\.1:4320" class="dashboard">/);
  assert.match(embedded.body, /<link rel="stylesheet" href="\/mission-embed\.css" \/>/);
  assert.match(embedded.body, /<script type="module" src="\/mission-embed\.js"><\/script>/);
  assert.match(embedded.body, /<main id="mission">One mission<\/main>/);
  assert.equal(embedded.body.match(/src="\/app\.js"/g).length, 1);
  assert.deepEqual(lab.calls, [], 'rendering a frame must not start the mission');

  for (const path of ['/', '/api/state', '/mission-embed.js', '/embed/']) {
    const response = await lab.request(path);
    assert.match(response.headers['Content-Security-Policy'], /frame-ancestors 'none'$/, path);
  }
  assert.equal((await lab.request('/embed', { method: 'POST' })).status, 404);
});

test('embedding never authorizes parent-origin controls and reuses the existing experiment', async t => {
  const lab = await createFixture(t, { embedding: { parentOrigin } });
  await lab.request('/embed');
  const forbidden = await lab.request('/api/start', { method: 'POST', headers: { origin: parentOrigin } });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(lab.calls, []);
  assert.equal(forbidden.headers['Access-Control-Allow-Origin'], undefined);

  const started = await lab.request('/api/start', { method: 'POST', headers: { origin: labOrigin } });
  assert.equal(started.status, 200);
  assert.deepEqual(JSON.parse(started.body), { status: 'running', runId: 'same-real-mission' });
  const duplicate = await lab.request('/api/start', { method: 'POST', headers: { origin: labOrigin } });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(lab.calls, ['start']);
  await lab.request('/api/crash', { method: 'POST', headers: { origin: labOrigin } });
  await lab.request('/embed');
  const resumed = await lab.request('/api/resume', { method: 'POST', headers: { origin: labOrigin } });
  assert.equal(resumed.status, 200);
  assert.deepEqual(JSON.parse(resumed.body), { status: 'completed', runId: 'same-real-mission' });
  assert.deepEqual(lab.calls, ['start', 'crash', 'resume']);
  assert.match(resumed.headers['Content-Security-Policy'], /frame-ancestors 'none'$/);
});

test('hosted controls accept the configured HTTPS origin and reject forged forwarding headers', async t => {
  const publicOrigin = 'https://mission.example.com';
  const lab = await createFixture(t, { publicOrigin });
  const rejected = await lab.request('/api/start', {
    method: 'POST',
    headers: { origin: 'https://untrusted.example', 'x-forwarded-host': 'untrusted.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(rejected.status, 403);
  assert.deepEqual(lab.calls, []);
  const started = await lab.request('/api/start', { method: 'POST', headers: { origin: publicOrigin } });
  assert.equal(started.status, 200);
  assert.deepEqual(lab.calls, ['start']);
});

test('the hosted article can frame the mission without gaining control authority', async t => {
  const articleOrigin = 'https://golem-in-practice-crash-recovery.astraguardian.chatgpt.site';
  const publicOrigin = 'https://golem-candy-mission-afatah.fly.dev';
  const lab = await createFixture(t, { embedding: { parentOrigin: articleOrigin }, publicOrigin });
  const embedded = await lab.request('/embed');
  assert.equal(embedded.status, 200);
  assert.equal(embedded.headers['Content-Security-Policy'].split('frame-ancestors ')[1], articleOrigin);
  assert.ok(embedded.body.includes(`data-parent-origin="${articleOrigin}"`));
  assert.doesNotMatch(embedded.body, /127\.0\.0\.1:4320/);

  for (const origin of [articleOrigin, parentOrigin]) {
    const rejected = await lab.request('/api/start', { method: 'POST', headers: { origin } });
    assert.equal(rejected.status, 403);
  }
  assert.deepEqual(lab.calls, []);
  const started = await lab.request('/api/start', { method: 'POST', headers: { origin: publicOrigin } });
  assert.equal(started.status, 200);
  assert.deepEqual(lab.calls, ['start']);
});

test('article, duplicate, and custom-domain frame routes keep separate exact origins without API authority', async t => {
  const copyOrigin = 'https://golem-in-practice.new-name.chatgpt.site';
  const blogOrigin = 'https://lab.a-fatah.com';
  const lab = await createFixture(t, {
    embedding: { parentOrigin },
    additionalEmbeddings: [
      { path: '/embed-copy', parentOrigin: copyOrigin },
      { path: '/embed-blog', parentOrigin: blogOrigin },
    ],
  });
  for (const [path, origin, otherOrigin] of [
    ['/embed', parentOrigin, copyOrigin],
    ['/embed-copy', copyOrigin, blogOrigin],
    ['/embed-blog', blogOrigin, parentOrigin],
  ]) {
    const frame = await lab.request(`${path}?parentOrigin=${otherOrigin}`, { headers: { origin: otherOrigin } });
    assert.equal(frame.status, 200, path);
    assert.equal(frame.headers['Content-Security-Policy'].split('frame-ancestors ')[1], origin, path);
    assert.ok(frame.body.includes(`data-parent-origin="${origin}"`), path);
    assert.ok(!frame.body.includes(`data-parent-origin="${otherOrigin}"`), path);
    const post = await lab.request(path, { method: 'POST' });
    assert.equal(post.status, 404, path);
    assert.match(post.headers['Content-Security-Policy'], /frame-ancestors 'none'$/, path);
    const forbidden = await lab.request('/api/start', { method: 'POST', headers: { origin } });
    assert.equal(forbidden.status, 403, origin);
    assert.equal(forbidden.headers['Access-Control-Allow-Origin'], undefined, origin);
  }
  for (const path of ['/', '/api/state', '/mission-embed.js', '/embed-copy/', '/embed-blog/', '/embed-other']) {
    const response = await lab.request(path);
    assert.match(response.headers['Content-Security-Policy'], /frame-ancestors 'none'$/, path);
  }
  assert.equal((await lab.request('/embed-other')).status, 404);
  assert.deepEqual(lab.calls, [], 'rendering any frame never starts the shared mission');
  const started = await lab.request('/api/start', { method: 'POST', headers: { origin: labOrigin } });
  assert.equal(started.status, 200);
  assert.deepEqual(lab.calls, ['start']);
});

test('a dedicated additional frame does not enable the original embed route implicitly', async t => {
  const lab = await createFixture(t, {
    additionalEmbeddings: [{ path: '/embed-copy', parentOrigin }],
  });
  assert.equal((await lab.request('/embed-copy')).status, 200);
  const original = await lab.request('/embed');
  assert.equal(original.status, 404);
  assert.match(original.headers['Content-Security-Policy'], /frame-ancestors 'none'$/);
});

test('embedded presentation modules are served as executable modules, without framing grants', async t => {
  const lab = await createFixture(t, { embedding: { parentOrigin } });
  for (const path of ['/mission-embed.js', '/mission-embed-protocol.js']) {
    const response = await lab.request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], 'text/javascript; charset=utf-8');
    assert.match(response.headers['Content-Security-Policy'], /frame-ancestors 'none'$/);
  }
  const styles = await lab.request('/mission-embed.css');
  assert.equal(styles.status, 200);
  assert.equal(styles.headers['Content-Type'], 'text/css; charset=utf-8');
});

test('mission code, playback, and scene assets keep exact MIME types without granting article framing', async t => {
  const lab = await createFixture(t, { embedding: { parentOrigin } });
  for (const asset of presentationAssets) {
    const response = await lab.request(asset.path, { headers: { origin: parentOrigin } });
    assert.equal(response.status, 200, asset.path);
    assert.equal(response.body, asset.content, asset.path);
    assert.equal(response.headers['Content-Type'], asset.type, asset.path);
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff', asset.path);
    assert.match(response.headers['Content-Security-Policy'], /frame-ancestors 'none'$/, asset.path);
  }
  assert.deepEqual(lab.calls, [], 'loading source and highlighting assets must not control the mission');
});

test('embedding configuration rejects wildcard, non-origin, and executable policy values', () => {
  for (const invalidOrigin of [
    '*', 'null', 'javascript:alert(1)', 'data:text/html,hello',
    'https://example.com/', 'https://example.com/path', 'https://user@example.com',
    'https://example.com?query=1', 'https://example.com#fragment',
    "https://example.com; frame-ancestors *", undefined,
  ]) {
    assert.throws(() => createLabServer({
      experiment: {}, publicDirectory: new URL('../public/', import.meta.url),
      embedding: { parentOrigin: invalidOrigin },
    }), /exact HTTP or HTTPS origin/);
    assert.throws(() => createLabServer({
      experiment: {}, publicDirectory: new URL('../public/', import.meta.url),
      additionalEmbeddings: [{ path: '/embed-copy', parentOrigin: invalidOrigin }],
    }), /exact HTTP or HTTPS origin/);
  }
});

test('additional frame configuration rejects duplicate, unsafe, and reserved paths', () => {
  const options = { experiment: {}, publicDirectory: new URL('../public/', import.meta.url) };
  for (const path of [
    '/', '/embed', '/api/start', '/assets/golem-logo.png', '/styles.css',
    '/embed-copy/', '/embed-copy?origin=other', '/embed-copy#fragment',
    '/embed-../api/start', '/embed-%63opy', '//embed-copy', '/embed-Copy',
    '/embed-copy--extra', '/embed-', '/embed-' + 'a'.repeat(58), undefined, null,
  ]) {
    assert.throws(() => createLabServer({
      ...options, additionalEmbeddings: [{ path, parentOrigin }],
    }), /clean dedicated \/embed-\* routes/, String(path));
  }
  assert.throws(() => createLabServer({
    ...options,
    additionalEmbeddings: [
      { path: '/embed-copy', parentOrigin },
      { path: '/embed-copy', parentOrigin: 'https://copy.example.com' },
    ],
  }), /Duplicate embedding route/);
  for (const additionalEmbeddings of [null, {}, '/embed-copy']) {
    assert.throws(() => createLabServer({ ...options, additionalEmbeddings }), /must be an array/);
  }
});
