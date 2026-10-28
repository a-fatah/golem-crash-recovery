import assert from 'node:assert/strict';
import test from 'node:test';
import { createGolemExperiment } from '../harness/experiment-controller.mjs';

const result = {
  parcelCuts: 1, cableContents: 'intact\n', sealed: true,
  middlewareDenied: true, middlewareError: 'actual middleware denial',
  directWriteDenied: true, directWriteError: 'actual filesystem denial',
};

function createFixture() {
  let report;
  let finish;
  const experiment = createGolemExperiment({ version: 'golem 1.6.1', verify: options => {
    report = detail => options.onProgress({ runId: options.runId, ...detail });
    return new Promise(resolve => { finish = resolve; });
  } });
  return { experiment, report: detail => report(detail), finish: () => finish() };
}

test('runtime lifecycle evidence reaches the exact dashboard events without changing event IDs', async () => {
  const fixture = createFixture();
  const { experiment } = fixture;
  const { runId } = experiment.start();
  const common = {
    invocationKey: runId, agentId: `ParcelAgent(${JSON.stringify(runId)})`,
    toolStartIndex: 86, markerIndex: 118, oldPid: 101, matchingToolEnds: 0,
  };
  const proofs = [
    { ...common, phase: 'in-flight' },
    { ...common, phase: 'killed', signal: 'SIGKILL' },
    { ...common, phase: 'restarted', newPid: 202 },
    { ...common, phase: 'recovered', newPid: 202, matchingToolEnds: 1, toolEndIndex: 149 },
  ];
  fixture.report({ stage: 'starting' });
  fixture.report({ stage: 'invoking', serverPid: 101 });
  fixture.report({ stage: 'effect-observed', startIndex: 86, runtimeEvidence: proofs[0] });
  assert.deepEqual(experiment.state().golem.runtimeEvidence, proofs[0]);
  fixture.report({ stage: 'killed', runtimeEvidence: proofs[1] });
  assert.equal(experiment.state().status, 'crashed');
  assert.deepEqual(experiment.state().golem.runtimeEvidence, proofs[1]);
  fixture.report({ stage: 'restarted', serverPid: 202, runtimeEvidence: proofs[2] });
  assert.deepEqual(experiment.state().golem.runtimeEvidence, proofs[2]);
  fixture.report({ stage: 'recovered', result, runtimeEvidence: proofs[3] });
  const state = experiment.state();
  assert.deepEqual(state.events.map(event => [event.id, event.kind]), [
    [1, 'starting'], [2, 'invoking'], [3, 'effect-observed'], [4, 'crash'],
    [5, 'restarted'], [6, 'replay'], [7, 'deny'], [8, 'deny'],
  ]);
  assert.deepEqual(state.events.filter(event => event.runtimeEvidence).map(event => event.runtimeEvidence), proofs);
  assert.deepEqual(state.golem.runtimeEvidence, proofs[3]);
  assert.equal(state.golem.oldPid, 101);
  assert.equal(state.golem.newPid, 202);
  assert.equal(state.golem.toolStartIndex, 86);
  assert.ok(state.events.filter(event => event.kind === 'deny').every(event => !event.runtimeEvidence));
  fixture.finish();
  await experiment.stop();
  experiment.reset();
  assert.equal(experiment.state().golem.runtimeEvidence, null);
  assert.deepEqual(experiment.state().events, []);
});

test('lifecycle stage names and narrative text do not manufacture structured runtime proof', async () => {
  const fixture = createFixture();
  fixture.experiment.start();
  fixture.report({ stage: 'invoking', serverPid: 101 });
  fixture.report({ stage: 'effect-observed', startIndex: 86 });
  fixture.report({ stage: 'killed' });
  fixture.report({ stage: 'restarted', serverPid: 202 });
  fixture.report({ stage: 'recovered', result });
  const state = fixture.experiment.state();
  assert.ok(state.events.every(event => !Object.hasOwn(event, 'runtimeEvidence')));
  assert.equal(state.golem.runtimeEvidence, null);
  fixture.finish();
  await fixture.experiment.stop();
});

test('loading a historical summary never synthesizes runtime events or adopts its proof as a new observation', () => {
  const experiment = createGolemExperiment({
    version: 'golem 1.6.1', verify: () => { throw new Error('No new run expected'); },
    latest: {
      passed: true, runId: 'parcel-saved', beforeServer: { pid: 101 }, afterServer: { pid: 202 },
      logicalTool: { startIndex: 86, starts: 1, ends: 1 }, result,
      runtimeEvidence: {
        phase: 'recovered', invocationKey: 'parcel-saved', agentId: 'ParcelAgent("parcel-saved")',
        toolStartIndex: 86, markerIndex: 118, oldPid: 101, newPid: 202, matchingToolEnds: 1, toolEndIndex: 149,
      },
    },
  });
  const state = experiment.state();
  assert.equal(state.status, 'completed');
  assert.equal(state.golem.runtimeEvidence, null);
  assert.ok(state.events.every(event => !Object.hasOwn(event, 'runtimeEvidence')));
  assert.deepEqual(state.events.map(event => event.kind), ['complete', 'deny', 'deny']);
});
