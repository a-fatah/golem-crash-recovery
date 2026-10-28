import assert from 'node:assert/strict';
import test from 'node:test';
import { createGolemExperiment } from '../harness/experiment-controller.mjs';

const protectedTarget = '/protected/safety-cable.txt';

function denial(phase) {
  return {
    boundary: 'tool-target', target: protectedTarget, phase, method: phase === 'before' ? 'run' : 'probePolicy',
    startIndex: phase === 'before' ? 31 : 189, endIndex: phase === 'before' ? 55 : 213,
    denied: true, error: `Knife policy denies target: ${protectedTarget}`,
  };
}

test('real denial stages retain their structured source proof and do not replace the recovered result', async () => {
  let report;
  let finish;
  const experiment = createGolemExperiment({ version: 'golem 1.6.1', verify: options => {
    report = detail => options.onProgress({ runId: options.runId, ...detail });
    return new Promise(resolve => { finish = resolve; });
  } });
  experiment.start();
  const before = denial('before');
  report({ stage: 'knife-denied-before', policyDenial: before });
  let state = experiment.state();
  assert.deepEqual(state.events[0].policyDenial, before);
  assert.equal(state.events[0].kind, 'knife-denied-before');
  assert.equal(state.counts.openedParcels, 0);
  assert.equal(state.counts.deniedCalls, 1);
  assert.equal(state.proof.parcelSealed, false);
  assert.equal(state.golem.postRecoveryPolicy, null);
  assert.deepEqual(state.golem.policyDenials.before, before);

  report({ stage: 'effect-observed', startIndex: 86 });
  report({ stage: 'killed' });
  report({ stage: 'restarted', serverPid: 202 });
  const result = {
    parcelCuts: 1, cableContents: 'intact\n', sealed: true,
    middlewareDenied: true, middlewareError: 'actual middleware error',
    directWriteDenied: true, directWriteError: 'actual EACCES error',
  };
  report({ stage: 'recovered', result });
  const postRecoveryPolicy = {
    middlewareDenied: true, middlewareError: 'fresh middleware error',
    directWriteDenied: true, directWriteError: 'fresh EACCES error',
  };
  const after = denial('after');
  report({ stage: 'knife-denied-after', policyDenial: after, postRecoveryPolicy });
  report({ stage: 'policy-verified', result: postRecoveryPolicy });
  state = experiment.state();
  assert.deepEqual(state.golem.postRecoveryPolicy, postRecoveryPolicy);
  assert.deepEqual(state.golem.policyDenials.after, after);
  assert.equal(state.proof.parcelSealed, true);
  assert.equal(state.proof.parcelCutCount, 1);
  assert.equal(state.counts.deniedCalls, 4);
  assert.deepEqual(state.events.filter(event => event.policyDenial).map(event => ({ kind: event.kind, proof: event.policyDenial })), [
    { kind: 'knife-denied-before', proof: before }, { kind: 'knife-denied-after', proof: after },
  ]);
  const stages = state.events.map(event => event.kind);
  assert.ok(stages.indexOf('knife-denied-before') < stages.indexOf('effect-observed'));
  assert.ok(stages.indexOf('replay') < stages.indexOf('knife-denied-after'));
  assert.ok(stages.indexOf('knife-denied-after') < stages.indexOf('policy-verified'));
  assert.ok(state.events.filter(event => event.kind === 'deny').every(event => !event.policyDenial));
  finish();
  await experiment.stop();
});
