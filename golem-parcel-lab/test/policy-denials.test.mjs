import assert from 'node:assert/strict';
import test from 'node:test';
import { assertKnifePolicyDenial } from '../harness/policy-denials.mjs';
import { policyTrace as trace } from './fixtures/policy-trace.mjs';

const target = '/protected/safety-cable.txt';
const error = `Knife policy denies target: ${target}`;
const runKey = 'parcel-test';


function prove(documents, options = {}) {
  return assertKnifePolicyDenial(documents, {
    phase: 'before', method: 'run', idempotencyKey: runKey, ...options,
  });
}

test('matches the exact middleware request and typed constraint terminal by schema names', () => {
  assert.deepEqual(prove(trace()), {
    boundary: 'tool-target', target, phase: 'before', method: 'run',
    startIndex: 10, endIndex: 13, denied: true, error,
  });
});

test('generic denial logs and a completed invocation result cannot establish a policy span', () => {
  const documents = trace().filter(document => document.entry.type !== 'Start');
  documents.push({ $type: 'agent.oplog', index: 25, attribution: { type: 'Agent' }, entry: {
    type: 'Log', message: `MIDDLEWARE_RESULT ${error}`,
  } });
  assert.throws(() => prove(documents), /one knife middleware call/);
});

test('another target, middleware, method, or key cannot prove a cable denial', () => {
  assert.throws(() => prove(trace({ targetPath: '/protected/safety-cable.txt.extra' })), /exact protected cable/);
  assert.throws(() => prove(trace({ middleware: 'other-policy' })), /one knife middleware call/);
  assert.throws(() => prove(trace(), { method: 'probePolicy' }), /expected method/);
  assert.throws(() => prove(trace(), { idempotencyKey: 'different-key' }), /identified policy probe/);
});

test('a missing, mismatched, duplicate, or unrelated terminal is insufficient', () => {
  const without = trace().filter(document => document.entry.type !== 'End');
  assert.throws(() => prove(without), /matching terminal/);
  const mismatched = trace();
  mismatched[2].entry.startIndex = 99;
  assert.throws(() => prove(mismatched), /matching terminal/);
  const unrelated = trace();
  unrelated[2].attribution = { type: 'Agent' };
  assert.throws(() => prove(unrelated), /matching terminal/);
  const duplicate = trace();
  duplicate.push({ ...duplicate[2], index: 14 });
  assert.throws(() => prove(duplicate), /one matching terminal/);
});

test('an allowed result or a different error cannot become a policy-denied event', () => {
  const allowed = trace();
  allowed[2].entry.response.value.value.fields[1] = {
    kind: 'result', value: { tag: 'ok', value: { kind: 'string', value: 'allowed' } },
  };
  assert.throws(() => prove(allowed), /must return an error/);
  const other = trace();
  other[2].entry.response.value.value.fields[1].value.value.value.payload.value.case = 0;
  assert.throws(() => prove(other), /target policy must reject/);
  const wrongErrorTarget = trace();
  wrongErrorTarget[2].entry.response.value.value.fields[1].value.value.value.payload.value.payload.value = 'Knife policy denies target: /another-file';
  assert.throws(() => prove(wrongErrorTarget), /exact protected cable target/);
});

test('after recovery requires a fresh probePolicy invocation beyond the prior oplog boundary', () => {
  const documents = [...trace(), ...trace({ phase: 'after', startIndex: 40 })];
  const options = { phase: 'after', method: 'probePolicy', idempotencyKey: `${runKey}-post-recovery-policy`, afterIndex: 20 };
  const proof = prove(documents, options);
  assert.equal(proof.startIndex, 40);
  assert.equal(proof.endIndex, 43);
  assert.equal(proof.phase, 'after');
  assert.throws(() => prove(documents, { ...options, afterIndex: 39 }), /beyond the prior oplog boundary/);
  assert.throws(() => prove(trace(), options), /identified policy probe/);
  assert.throws(() => prove(documents.filter(document => document.entry.type !== 'AgentInvocationFinished'), options), /probe must finish/);
});

test('a terminal from a subsequent invocation cannot complete the selected policy span', () => {
  const documents = trace();
  documents.splice(2, 0, {
    $type: 'agent.oplog', index: 11, attribution: { type: 'Agent' }, entry: {
      type: 'AgentInvocationStarted', invocation: { type: 'AgentMethodInvocation', methodName: 'unrelated', idempotencyKey: 'another' },
    },
  });
  assert.throws(() => prove(documents), /matching terminal/);
});
