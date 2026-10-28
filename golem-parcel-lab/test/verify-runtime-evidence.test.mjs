import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyParcelRecovery } from '../scripts/verify.mjs';
import { policyTrace } from './fixtures/policy-trace.mjs';

const runId = 'parcel-runtime-evidence';
const result = {
  parcelCuts: 1, cableContents: 'intact\n', sealed: true,
  middlewareDenied: true, middlewareError: 'Knife policy denies target: /protected/safety-cable.txt',
  directWriteDenied: true, directWriteError: 'EACCES: permission denied',
};

/** Exercises the production verifier with typed oplogs and owned-process observations, without a server. */
async function createFixture(t, options = {}) {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'golem-runtime-evidence-'));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  const scope = { startIndex: 86, entity: { kind: 'tool', name: 'knife' } };
  const document = (index, entry, attribution = { type: 'Entity', invocation: scope, ancestors: [] }) => ({
    $type: 'agent.oplog', index, attribution, entry,
  });
  const before = [
    ...policyTrace({ runKey: runId, startIndex: 31 }),
    document(86, { type: 'Start', functionName: 'tool.invoke', request: { target: '/workspace/parcel.cuts' } }),
    document(118, { type: 'Log', message: 'PARCEL_CUT_IN_FLIGHT', timestamp: '2026-10-27T12:00:00Z' }),
  ];
  const after = structuredClone([
    ...before,
    document(130, { type: 'Restart' }, { type: 'System' }),
    document(149, { type: 'End', startIndex: 86, response: { target: '/workspace/parcel.cuts', cuts: 1 } }),
    document(160, { type: 'AgentInvocationFinished', methodName: 'run' }, { type: 'System' }),
  ]);
  if (options.unpairedEnd) after.find(entry => entry.index === 149).entry.startIndex = 99;
  const afterPolicy = [...after, ...policyTrace({ runKey: runId, phase: 'after', startIndex: 189 })];
  const traces = [before, after, afterPolicy, afterPolicy];
  const calls = [];
  const events = [];
  let captures = 0;
  let pid = null;
  let running = false;
  const server = {
    get pid() { return pid; },
    get running() { return running; },
    async start({ label }) {
      pid = label === 'before' ? 101 : 202;
      running = true;
      calls.push(`start:${label}`);
      return { pid };
    },
    async stop({ signal = 'SIGINT' } = {}) {
      calls.push(`stop:${signal}`);
      if (signal === 'SIGINT' && options.gracefulStopFails) throw new Error('Owned server did not exit after SIGINT');
      running = false;
      return { pid, signal: signal === 'SIGKILL' && options.killSignal ? options.killSignal : signal };
    },
  };
  const cli = {
    async run(args) {
      if (args[0] === '--version') return { stdout: 'golem 1.6.1\n' };
      if (args[0] === 'agent' && args[1] === 'oplog') {
        calls.push('oplog');
        return { documents: traces[Math.min(captures++, traces.length - 1)] };
      }
      return { documents: [] };
    },
    async invoke(agentId, method, invocationOptions) {
      calls.push({ agentId, method, ...invocationOptions });
      return { value: method === 'probePolicy' ? { ...result } : result };
    },
    async readGuestFile(agentId, path) {
      calls.push(`read:${path}`);
      return { contents: path === '/workspace/parcel.cuts' ? options.parcelContents ?? 'cut\n' : options.cableContents ?? 'intact\n' };
    },
  };
  return {
    calls, events,
    run: () => verifyParcelRecovery({
      cli, server, runId, deploy: false, evidenceRoot,
      onProgress(event) { events.push(event); calls.push(`event:${event.stage}`); },
    }),
  };
}

test('cleanup kills an owned server when graceful shutdown times out', async t => {
  const fixture = await createFixture(t, { gracefulStopFails: true });
  const summary = await fixture.run();
  assert.equal(summary.passed, true);
  assert.match(summary.shutdownError, /did not exit after SIGINT/);
  assert.deepEqual(fixture.calls.filter(call => typeof call === 'string' && call.startsWith('stop:')).slice(-2), ['stop:SIGINT', 'stop:SIGKILL']);
  assert.equal(summary.stopped.signal, 'SIGKILL');
});

test('runtime evidence comes from the same original Start, confirmed kill, replacement PID, and paired recovered End', async t => {
  const fixture = await createFixture(t);
  const summary = await fixture.run();
  assert.equal(summary.passed, true);
  const common = {
    invocationKey: runId, agentId: `ParcelAgent(${JSON.stringify(runId)})`,
    toolStartIndex: 86, oldPid: 101, markerIndex: 118, matchingToolEnds: 0,
  };
  assert.deepEqual(fixture.events.filter(event => event.runtimeEvidence).map(event => ({ stage: event.stage, proof: event.runtimeEvidence })), [
    { stage: 'effect-observed', proof: { ...common, phase: 'in-flight' } },
    { stage: 'killed', proof: { ...common, phase: 'killed', signal: 'SIGKILL' } },
    { stage: 'restarted', proof: { ...common, phase: 'restarted', newPid: 202 } },
    { stage: 'recovered', proof: { ...common, phase: 'recovered', newPid: 202, matchingToolEnds: 1, toolEndIndex: 149 } },
  ]);
  assert.deepEqual(fixture.events.map(event => event.stage), [
    'starting', 'invoking', 'knife-denied-before', 'effect-observed', 'killed', 'restarted',
    'recovered', 'knife-denied-after', 'policy-verified', 'verified',
  ], 'Adding structured evidence must preserve the existing observation order');
  assert.ok(fixture.calls.indexOf('stop:SIGKILL') < fixture.calls.indexOf('event:killed'));
  assert.ok(fixture.calls.indexOf('start:after') < fixture.calls.indexOf('event:restarted'));
  for (const path of ['/workspace/parcel.cuts', '/protected/safety-cable.txt']) {
    assert.ok(fixture.calls.indexOf(`read:${path}`) < fixture.calls.indexOf('event:recovered'));
  }
  const originalCalls = fixture.calls.filter(call => typeof call === 'object' && call.method === 'run');
  assert.equal(originalCalls.length, 3);
  assert.ok(originalCalls.every(call => call.idempotencyKey === runId && call.agentId === common.agentId));
  assert.deepEqual(summary.logicalTool, { startIndex: 86, starts: 1, ends: 1 });
});

test('a result cannot emit recovered evidence without a terminal paired to the original tool Start', async t => {
  const fixture = await createFixture(t, { unpairedEnd: true });
  await assert.rejects(fixture.run(), /exactly one End/);
  assert.equal(fixture.events.some(event => event.stage === 'recovered'), false);
  assert.equal(fixture.events.some(event => event.runtimeEvidence?.phase === 'recovered'), false);
  assert.equal(fixture.events.at(-1).stage, 'failed');
});

for (const [name, options] of [
  ['a duplicate parcel write', { parcelContents: 'cut\ncut\n' }],
  ['a modified protected cable', { cableContents: 'cut\n' }],
]) {
  test(`recovered evidence waits for actual files and rejects ${name}`, async t => {
    const fixture = await createFixture(t, options);
    await assert.rejects(fixture.run(), /Expected values to be strictly equal/);
    assert.equal(fixture.events.some(event => event.stage === 'recovered'), false);
    assert.equal(fixture.events.at(-1).stage, 'failed');
  });
}

test('requesting SIGKILL is insufficient if the owned process did not actually exit on SIGKILL', async t => {
  const fixture = await createFixture(t, { killSignal: 'SIGINT' });
  await assert.rejects(fixture.run(), /server must die from SIGKILL/);
  assert.equal(fixture.events.some(event => event.stage === 'effect-observed'), true);
  assert.equal(fixture.events.some(event => event.stage === 'killed'), false);
  assert.equal(fixture.events.some(event => event.stage === 'restarted'), false);
});
