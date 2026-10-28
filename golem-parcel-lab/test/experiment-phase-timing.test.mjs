import assert from 'node:assert/strict';
import test from 'node:test';
import { createGolemExperiment } from '../harness/experiment-controller.mjs';

const initialTime = Date.parse('2026-10-28T08:00:00.000Z');

test('phase timing starts with a mission and changes only on a new observed phase', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: initialTime });
  let report;
  let finish;
  const experiment = createGolemExperiment({ version: 'golem 1.6.1', verify: options => {
    report = stage => options.onProgress({ stage, runId: options.runId });
    return new Promise(resolve => { finish = resolve; });
  } });

  assert.equal(experiment.state().golem.phaseStartedAt, null);
  const started = experiment.start();
  assert.equal(started.golem.phase, 'idle');
  assert.equal(started.golem.phaseStartedAt, '2026-10-28T08:00:00.000Z');

  t.mock.timers.tick(1_500);
  report('starting');
  assert.equal(experiment.state().golem.phaseStartedAt, '2026-10-28T08:00:01.500Z');
  t.mock.timers.tick(8_000);
  assert.equal(experiment.state().golem.phaseStartedAt, '2026-10-28T08:00:01.500Z', 'polling does not restart the phase clock');
  report('starting');
  assert.equal(experiment.state().golem.phaseStartedAt, '2026-10-28T08:00:01.500Z', 'repeated progress for the same phase keeps its original start');
  report('deploying');
  assert.equal(experiment.state().golem.phaseStartedAt, '2026-10-28T08:00:09.500Z');

  finish();
  await experiment.stop();
  experiment.reset();
  assert.equal(experiment.state().golem.phaseStartedAt, null);
});

test('resuming timestamps the recovery checkpoint before the verifier continues', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: initialTime });
  let report;
  let finish;
  const experiment = createGolemExperiment({ version: 'golem 1.6.1', verify: async options => {
    report = stage => options.onProgress({ stage, runId: options.runId });
    report('killed');
    await options.beforeRestart();
    await new Promise(resolve => { finish = resolve; });
  } });

  experiment.start();
  t.mock.timers.tick(30_000);
  const resumed = experiment.resume();
  assert.equal(resumed.golem.phase, 'restarting');
  assert.equal(resumed.golem.phaseStartedAt, '2026-10-28T08:00:30.000Z');
  assert.deepEqual(resumed.events.map(event => event.kind), ['crash'], 'the timer does not add runtime events');
  t.mock.timers.tick(4_000);
  assert.equal(experiment.state().golem.phaseStartedAt, resumed.golem.phaseStartedAt);
  report('restarted');
  assert.equal(experiment.state().golem.phaseStartedAt, '2026-10-28T08:00:34.000Z');

  await Promise.resolve();
  finish();
  await experiment.stop();
});

test('a historical summary has no active phase clock', () => {
  const experiment = createGolemExperiment({
    version: 'golem 1.6.1', verify: () => assert.fail('A saved result must not start a mission'),
    latest: {
      passed: true, runId: 'parcel-saved', beforeServer: { pid: 101 }, afterServer: { pid: 202 },
      logicalTool: { startIndex: 86 },
      result: { parcelCuts: 1, sealed: true, cableContents: 'intact\n' },
    },
  });
  assert.equal(experiment.state().status, 'completed');
  assert.equal(experiment.state().golem.phaseStartedAt, null);
});
