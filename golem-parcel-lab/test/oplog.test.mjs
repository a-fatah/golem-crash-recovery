import assert from 'node:assert/strict';
import test from 'node:test';
import { assertInFlightTool, assertRecoveredTool, summarizeOplog } from '../harness/oplog.mjs';

function trace({ completed = false, toolName = 'knife', startIndex = 10 } = {}) {
  const scope = { startIndex, entity: { kind: 'tool', name: toolName } };
  const document = (index, entry, attribution = { type: 'Entity', invocation: scope, ancestors: [] }) => ({
    $type: 'agent.oplog', index, attribution, entry,
  });
  const documents = [
    document(startIndex, { type: 'Start', functionName: 'tool.invoke', request: { target: '/workspace/parcel.cuts' } }),
    document(startIndex + 1, { type: 'Log', message: 'PARCEL_CUT_IN_FLIGHT' }),
  ];
  if (completed) documents.push(
    document(startIndex + 2, { type: 'Restart' }, { type: 'System' }),
    document(startIndex + 3, { type: 'End', startIndex, response: { target: '/workspace/parcel.cuts', cuts: 1 } }),
    document(startIndex + 4, { type: 'AgentInvocationFinished', methodName: 'run' }, { type: 'System' }),
  );
  return documents;
}

test('a post-effect tool marker and an unmatched Start establish the in-flight call', () => {
  const summary = summarizeOplog(trace());
  const call = assertInFlightTool(summary);
  assert.equal(call.startIndex, 10);
  assert.equal(call.markers.length, 1);
  assert.deepEqual(call.ends, []);
});

test('a completed tool or agent invocation cannot be presented as a mid-call kill', () => {
  assert.throws(() => assertInFlightTool(summarizeOplog(trace({ completed: true }))), /completed before the kill/);
  const documents = trace();
  documents.push({
    $type: 'agent.oplog', index: 20, attribution: { type: 'System' },
    entry: { type: 'AgentInvocationFinished', methodName: 'run' },
  });
  assert.throws(() => assertInFlightTool(summarizeOplog(documents)), /Agent method already completed/);
});

test('a marker from another tool cannot establish a knife call', () => {
  assert.throws(() => assertInFlightTool(summarizeOplog(trace({ toolName: 'spoon' }))), /one logical parcel tool invocation/);
});

test('a parcel request without the post-cut marker does not establish an applied effect', () => {
  const documents = trace().filter(document => document.entry.type !== 'Log');
  assert.throws(() => assertInFlightTool(summarizeOplog(documents)), /Missing tool effect-written marker/);
});

test('a marker outside the selected tool scope cannot establish its applied effect', () => {
  const documents = trace();
  documents[1].attribution.invocation = { startIndex: 99, entity: { kind: 'tool', name: 'spoon' } };
  assert.throws(() => assertInFlightTool(summarizeOplog(documents)), /Missing tool effect-written marker/);
});

test('recovery pairs the terminal with the original tool start identity', () => {
  const before = assertInFlightTool(summarizeOplog(trace()));
  const recovered = assertRecoveredTool(summarizeOplog(trace({ completed: true })), { startIndex: before.startIndex });
  assert.equal(recovered.startIndex, before.startIndex);
  assert.equal(recovered.ends[0].entry.startIndex, before.startIndex);
});

test('an unrelated terminal or changed recovery identity cannot prove completion', () => {
  const documents = trace({ completed: true });
  documents.find(document => document.entry.type === 'End').entry.startIndex = 99;
  assert.throws(() => assertRecoveredTool(summarizeOplog(documents), { startIndex: 10 }), /exactly one End/);
  assert.throws(() => assertRecoveredTool(summarizeOplog(trace({ completed: true, startIndex: 30 })), { startIndex: 10 }), /logical tool identity/);
});

test('recovery must retain the original recorded Start and post-effect marker', () => {
  const withoutStart = trace({ completed: true }).filter(document => document.entry.type !== 'Start');
  assert.throws(() => assertRecoveredTool(summarizeOplog(withoutStart), { startIndex: 10 }), /recorded Start/);
  const withoutMarker = trace({ completed: true }).filter(document => document.entry.type !== 'Log');
  assert.throws(() => assertRecoveredTool(summarizeOplog(withoutMarker), { startIndex: 10 }), /effect-written marker/);
});

test('duplicate logical calls or terminals cannot masquerade as exactly-once recovery', () => {
  assert.throws(() => assertRecoveredTool(summarizeOplog([
    ...trace({ completed: true }), ...trace({ completed: true, startIndex: 30 }),
  ]), { startIndex: 10 }), /second logical parcel tool invocation/);
  const documents = trace({ completed: true });
  documents.push({
    ...documents.find(document => document.entry.type === 'End'), index: 40,
  });
  assert.throws(() => assertRecoveredTool(summarizeOplog(documents), { startIndex: 10 }), /exactly one End/);
});
