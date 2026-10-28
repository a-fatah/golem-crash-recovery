import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdleShutdown } from '../harness/idle-shutdown.mjs';
import { createGolemExperiment } from '../harness/experiment-controller.mjs';

function clock(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  return seconds => { for (let i = 0; i < seconds; i++) t.mock.timers.tick(1000); };
}

test('an active mission, including its resume gate, outlives the idle deadline', async t => {
  const advance = clock(t);
  let stopped = 0;
  const experiment = createGolemExperiment({ version: 'test', verify: async options => {
    options.onProgress({ stage: 'killed', runId: options.runId });
    await options.beforeRestart();
  } });
  const idle = createIdleShutdown({ idleMs: 60_000, isActive: () => experiment.active, onIdle: () => stopped++ });
  t.after(() => idle.stop());
  experiment.start();
  assert.equal(experiment.state().status, 'crashed');
  advance(180);
  assert.equal(stopped, 0);
  assert.equal(experiment.active, true);
  experiment.resume();
  await experiment.stop();
  await Promise.resolve();
  assert.equal(experiment.active, false);
  advance(60);
  assert.equal(stopped, 0, 'completion receives a full idle interval');
  advance(1);
  assert.equal(stopped, 1);
  advance(120);
  assert.equal(stopped, 1, 'shutdown is issued only once');
});

test('visitor activity resets the deadline; passive reads only delay until their response finishes', t => {
  const advance = clock(t);
  let busy = false;
  let stopped = 0;
  const idle = createIdleShutdown({ idleMs: 60_000, isActive: () => false, isBusy: () => busy, onIdle: () => stopped++ });
  t.after(() => idle.stop());
  advance(50);
  idle.touch();
  advance(59);
  assert.equal(stopped, 0);
  busy = true;
  advance(10);
  assert.equal(stopped, 0);
  busy = false;
  advance(1);
  assert.equal(stopped, 1, 'passive reads do not grant another idle interval');
});

test('stopping the idle monitor cancels its shutdown callback', t => {
  const advance = clock(t);
  const idle = createIdleShutdown({ idleMs: 60_000, isActive: () => false, onIdle: () => assert.fail('monitor is stopped') });
  idle.stop();
  advance(120);
});
