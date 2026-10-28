import assert from 'node:assert/strict';
import { decodeTypedValue } from './typed-value.mjs';

const protectedTarget = '/protected/safety-cable.txt';
const denialMessage = `Knife policy denies target: ${protectedTarget}`;

function isKnifeMiddleware(document, startIndex) {
  const scope = document.attribution?.type === 'Entity' && document.attribution.invocation;
  return scope?.entity?.kind === 'toolMiddleware' && scope.entity.name === 'knife-policy'
    && scope.startIndex === startIndex && scope.operation?.type === 'Tool';
}

/** Prove a denial from its middleware span within one identified method invocation. */
export function assertKnifePolicyDenial(documents, options) {
  const { phase, method, idempotencyKey, afterIndex = -1 } = options;
  assert.ok(phase === 'before' || phase === 'after', 'Policy denial phase must be before or after');
  assert.equal(method, phase === 'before' ? 'run' : 'probePolicy', 'Policy denial must belong to the expected method');
  assert.ok(typeof idempotencyKey === 'string' && idempotencyKey.length > 0, 'Policy denial needs an invocation key');
  assert.ok(documents.every(document => document.$type === 'agent.oplog' && Number.isSafeInteger(document.index)), 'Expected indexed Golem oplog documents');
  const invocations = documents.filter(document => document.entry.type === 'AgentInvocationStarted'
    && document.entry.invocation?.type === 'AgentMethodInvocation'
    && document.entry.invocation.methodName === method
    && document.entry.invocation.idempotencyKey === idempotencyKey);
  assert.equal(invocations.length, 1, 'Expected one identified policy probe invocation');
  const invocation = invocations[0];
  assert.ok(invocation.index > afterIndex, 'Fresh policy probe must start beyond the prior oplog boundary');
  const nextInvocation = documents.find(document => document.index > invocation.index && document.entry.type === 'AgentInvocationStarted');
  const entries = documents.filter(document => document.index > invocation.index
    && (!nextInvocation || document.index < nextInvocation.index));
  const finish = entries.find(document => document.entry.type === 'AgentInvocationFinished');
  if (finish) assert.equal(finish.entry.methodName, method, 'Policy probe method finish must match its start');
  if (phase === 'after') assert.ok(finish, 'The fresh post-recovery policy probe must finish');

  const starts = entries.filter(document => document.entry.type === 'Start'
    && document.entry.functionName === 'golem::entity::invoke'
    && isKnifeMiddleware(document, document.index)
    && decodeTypedValue(document.entry.request)?.target === protectedTarget);
  assert.equal(starts.length, 1, 'Expected one knife middleware call for the exact protected cable');
  const start = starts[0];
  const ends = entries.filter(document => document.entry.type === 'End'
    && document.entry.startIndex === start.index && isKnifeMiddleware(document, start.index));
  assert.equal(ends.length, 1, 'Protected knife middleware call must have one matching terminal');
  const end = ends[0];
  assert.ok(end.index > start.index && (!finish || end.index < finish.index), 'Policy denial terminal must be inside its method invocation');
  const terminal = decodeTypedValue(end.entry.response);
  assert.equal(terminal?.body_execution, 'Executed', 'The knife middleware body must have executed');
  assert.equal(terminal?.result?.tag, 'err', 'The protected knife call must return an error');
  assert.equal(terminal.result.val?.tag, 'RemoteToolError', 'The error must come from the remote knife middleware');
  assert.equal(terminal.result.val.val?.tag, 'ConstraintViolation', 'The knife target policy must reject the call');
  assert.equal(terminal.result.val.val.val, denialMessage, 'The denial must identify the exact protected cable target');
  return {
    boundary: 'tool-target', target: protectedTarget, phase, method,
    startIndex: start.index, endIndex: end.index, denied: true, error: denialMessage,
  };
}
