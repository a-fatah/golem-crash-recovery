import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');

async function fixture(initialState) {
  let state = initialState;
  let reads = 0;
  let actions;
  let timerId = 0;
  const timers = new Map();
  const events = new Map();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const noop = () => {};
  vm.runInNewContext(source, {
    document: { getElementById: () => ({}) },
    window: {
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(name, callback) { events.set(name, callback); },
    },
    readState: async () => { reads++; return state; },
    runAction: async () => { state = { ...state, status: 'running' }; return state; },
    bindActions: value => { actions = value; },
    renderDisconnected: noop, renderError: noop, renderState: noop,
    localRuntimeCopy: () => ({}), golemRuntimeCopy: () => ({}),
    createMissionAnimator: () => ({ update: noop }),
    createMissionCodeView: () => ({ update: noop, setPlayback: noop, setSource: noop, unavailable: noop }),
    loadMissionCodeSource: async () => ({}),
    createMissionSceneView: () => ({ update: noop, setPlayback: noop, setMission: noop }),
    createMissionActivityView: () => ({ update: noop, setPlayback: noop, setRuntime: noop, disconnect: noop }),
  });
  await flush();
  return {
    get reads() { return reads; },
    get pending() { return timers.size; },
    async start() { actions.primary(); await flush(); },
    async focus() { events.get('focus')(); await flush(); },
    async tick(nextState) {
      state = nextState;
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
      await flush();
    },
  };
}

test('hosted tabs stop passive polling, restart on an action, and pause again after completion', async () => {
  const base = { runtime: 'golem', sleepWhenIdle: true };
  const page = await fixture({ ...base, status: 'completed' });
  assert.equal(page.reads, 1);
  assert.equal(page.pending, 0);
  await page.start();
  assert.equal(page.pending, 1);
  await page.tick({ ...base, status: 'crashed' });
  assert.equal(page.pending, 1, 'waiting for resume remains a live mission');
  await page.tick({ ...base, status: 'completed' });
  assert.equal(page.pending, 0);
  const previous = page.reads;
  await page.focus();
  assert.equal(page.reads, previous + 1, 'returning to the tab refreshes saved state');
  assert.equal(page.pending, 0);
});

test('local demos retain their existing continuous polling', async () => {
  const page = await fixture({ runtime: 'golem', status: 'completed' });
  assert.equal(page.pending, 1);
  await page.tick({ runtime: 'golem', status: 'idle' });
  assert.equal(page.pending, 1);
});
