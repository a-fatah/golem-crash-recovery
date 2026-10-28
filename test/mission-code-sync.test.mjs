import assert from 'node:assert/strict';
import test from 'node:test';
import { createPolicyCodeModel } from '../public/mission-code-model.js';

function denialCue({ phase = 'before', runId = 'parcel-sync', proof = {}, cue = {} } = {}) {
  const id = phase === 'before' ? 4 : 11;
  return {
    id,
    key: `${runId}:${id}:knife-denied-${phase}`,
    stage: `blocking-${phase}`,
    eventKind: `knife-denied-${phase}`,
    policyDenial: {
      boundary: 'tool-target',
      target: '/protected/safety-cable.txt',
      phase,
      method: phase === 'before' ? 'run' : 'probePolicy',
      startIndex: phase === 'before' ? 31 : 189,
      endIndex: phase === 'before' ? 55 : 213,
      denied: true,
      error: 'Knife policy denies target: /protected/safety-cable.txt',
      ...proof,
    },
    ...cue,
  };
}

function snapshot({ runId = 'parcel-sync', status = 'running', archived = false, cues = [], ...rest } = {}) {
  return { runId, status, archived, cues, pose: 'preparing', verified: false, ...rest };
}

function observe(model, value) {
  model.update({ type: 'snapshot', snapshot: value });
}

function animate(model, cue, { runId = 'parcel-sync', replay = false } = {}) {
  model.update({ type: 'cue', runId, cue, replay });
}

function fullHistory() {
  return [denialCue(), denialCue({ phase: 'after' })];
}

test('a new mission starts in an honest preview with no observed policy evidence', () => {
  const model = createPolicyCodeModel();
  observe(model, snapshot());
  assert.deepEqual(model.state(), {
    runId: 'parcel-sync', phase: null, proof: null, mode: 'preview', active: false,
    following: true, available: { before: false, after: false },
  });
  model.select('before');
  assert.equal(model.state().phase, null, 'A tab cannot invent unavailable evidence');
  assert.equal(model.state().mode, 'preview');
});

test('the active code follows the currently playing denial, not later events already in a poll', () => {
  const model = createPolicyCodeModel();
  const [before, after] = fullHistory();
  observe(model, snapshot());
  observe(model, snapshot({ status: 'completed', cues: [before, after], pose: 'done', verified: true }));
  assert.deepEqual(model.state().available, { before: true, after: true });
  assert.equal(model.state().phase, null, 'Newly queued future cues must not choose code ahead of animation');

  animate(model, before);
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().proof.key, before.key);
  assert.equal(model.state().mode, 'live');
  assert.equal(model.state().active, true);
  for (let poll = 0; poll < 4; poll++) observe(model, snapshot({ status: 'completed', cues: [before, after] }));
  assert.equal(model.state().phase, 'before', 'Polling must not skip to the after-recovery proof');
  assert.equal(model.state().mode, 'live');

  animate(model, { id: 5, key: 'parcel-sync:5:effect-observed', eventKind: 'effect-observed', stage: 'cutting' });
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().active, false);
  assert.equal(model.state().mode, 'observed');

  animate(model, after);
  assert.equal(model.state().phase, 'after');
  assert.equal(model.state().proof.policyDenial.method, 'probePolicy');
  assert.equal(model.state().proof.policyDenial.startIndex, 189);
  assert.equal(model.state().mode, 'live');
  assert.equal(model.state().active, true);
});

test('opening a completed run shows its latest observed proof without pretending it is active', () => {
  const model = createPolicyCodeModel();
  observe(model, snapshot({ status: 'completed', cues: fullHistory(), pose: 'done', verified: true }));
  assert.equal(model.state().phase, 'after');
  assert.equal(model.state().proof.policyDenial.method, 'probePolicy');
  assert.equal(model.state().mode, 'observed');
  assert.equal(model.state().active, false);
  assert.equal(model.state().following, true);
});

test('opening a crashed run shows only the before-crash denial that actually exists', () => {
  const model = createPolicyCodeModel();
  observe(model, snapshot({ status: 'crashed', cues: [denialCue()], pose: 'down' }));
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().mode, 'observed');
  assert.equal(model.state().active, false);
  assert.deepEqual(model.state().available, { before: true, after: false });
  model.select('after');
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().proof.policyDenial.method, 'run');
});

test('explicit replay labels the source as replay while keeping the original event and oplog identity', () => {
  const model = createPolicyCodeModel();
  const [before, after] = fullHistory();
  observe(model, snapshot({ status: 'completed', cues: [before, after] }));
  animate(model, before, { replay: true });
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().mode, 'replay');
  assert.equal(model.state().active, true);
  assert.equal(model.state().proof.key, 'parcel-sync:4:knife-denied-before');
  assert.equal(model.state().proof.policyDenial.startIndex, 31);
  animate(model, after, { replay: true });
  assert.equal(model.state().phase, 'after');
  assert.equal(model.state().mode, 'replay');
  assert.equal(model.state().proof.key, 'parcel-sync:11:knife-denied-after');
  model.update({ type: 'settled', snapshot: snapshot({ status: 'completed', cues: [before, after] }) });
  assert.equal(model.state().active, false);
  assert.equal(model.state().mode, 'observed');
  assert.equal(model.state().phase, 'after');
});

test('manual inspection pauses following and follow restores the animator-selected proof and replay label', () => {
  const model = createPolicyCodeModel();
  const [before, after] = fullHistory();
  observe(model, snapshot({ status: 'completed', cues: [before, after] }));
  animate(model, before, { replay: true });
  model.select('after');
  assert.equal(model.state().phase, 'after');
  assert.equal(model.state().mode, 'inspect');
  assert.equal(model.state().following, false);
  assert.equal(model.state().active, false);
  model.follow();
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().mode, 'replay');
  assert.equal(model.state().active, true);
  assert.equal(model.state().following, true);
});

test('manual inspection is stable while animation proceeds and follow returns to the new active denial', () => {
  const model = createPolicyCodeModel();
  const [before, after] = fullHistory();
  observe(model, snapshot({ status: 'completed', cues: [before, after] }));
  animate(model, before);
  model.select('before');
  animate(model, after);
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().mode, 'inspect');
  assert.equal(model.state().following, false);
  model.follow();
  assert.equal(model.state().phase, 'after');
  assert.equal(model.state().mode, 'live');
  assert.equal(model.state().active, true);
});

test('follow cannot relight a denial that finished while the reader inspected another phase', () => {
  const model = createPolicyCodeModel();
  const [before, after] = fullHistory();
  const result = snapshot({ status: 'completed', cues: [before, after] });
  observe(model, result);
  animate(model, after, { replay: true });
  model.select('before');
  model.update({ type: 'settled', snapshot: result });
  assert.equal(model.state().mode, 'inspect');
  assert.equal(model.state().phase, 'before');
  model.follow();
  assert.equal(model.state().phase, 'after');
  assert.equal(model.state().active, false);
  assert.equal(model.state().mode, 'observed');
});

test('another animation stage ends active highlighting while preserving the relevant policy proof', () => {
  const model = createPolicyCodeModel();
  const before = denialCue();
  observe(model, snapshot({ cues: [before] }));
  animate(model, before);
  animate(model, { id: 6, key: 'parcel-sync:6:crash', eventKind: 'crash', stage: 'falling' });
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().proof.key, before.key);
  assert.equal(model.state().mode, 'observed');
  assert.equal(model.state().active, false);
});

test('run changes discard inspected and active proof instead of leaking evidence into the next mission', () => {
  const model = createPolicyCodeModel();
  observe(model, snapshot({ status: 'completed', cues: fullHistory() }));
  animate(model, denialCue({ phase: 'after' }), { replay: true });
  model.select('before');
  observe(model, snapshot({ runId: 'parcel-next' }));
  assert.deepEqual(model.state(), {
    runId: 'parcel-next', phase: null, proof: null, mode: 'preview', active: false,
    following: true, available: { before: false, after: false },
  });
  animate(model, denialCue());
  assert.equal(model.state().runId, 'parcel-next');
  assert.equal(model.state().phase, null, 'A queued old-run cue cannot populate the next run');
});

test('failure removes active highlighting even when the failed snapshot still includes denial history', () => {
  const model = createPolicyCodeModel();
  const before = denialCue();
  observe(model, snapshot());
  animate(model, before);
  observe(model, snapshot({ status: 'failed', pose: 'failed', cues: [before] }));
  assert.equal(model.state().active, false);
  assert.equal(model.state().mode, 'observed');
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().proof.key, before.key);
});

test('archived metadata cannot create available policy phases or a live highlight', () => {
  const model = createPolicyCodeModel();
  observe(model, snapshot({ archived: true, status: 'completed', cues: fullHistory(), pose: 'done', verified: true }));
  assert.equal(model.state().phase, null);
  assert.equal(model.state().proof, null);
  assert.equal(model.state().mode, 'preview');
  assert.equal(model.state().active, false);
  assert.deepEqual(model.state().available, { before: false, after: false });
  animate(model, denialCue(), { replay: true });
  assert.equal(model.state().phase, null, 'The archived record cannot be promoted into an animated fresh denial');
});

test('generic denial messages and unproved cues cannot activate or replace source code evidence', () => {
  const model = createPolicyCodeModel();
  observe(model, snapshot());
  const invalid = [
    { id: 2, stage: 'blocking-before', eventKind: 'deny', key: 'parcel-sync:2:deny' },
    denialCue({ proof: { denied: false } }),
    denialCue({ proof: { target: '/data/parcel.txt' } }),
    denialCue({ proof: { method: 'probePolicy' } }),
    denialCue({ proof: { endIndex: 31 } }),
    denialCue({ cue: { policyDenial: undefined } }),
    denialCue({ cue: { stage: 'blocking-after' } }),
  ];
  for (const cue of invalid) {
    animate(model, cue);
    assert.equal(model.state().phase, null);
    assert.equal(model.state().proof, null);
    assert.equal(model.state().active, false);
  }
  observe(model, snapshot({ status: 'completed', cues: invalid }));
  assert.deepEqual(model.state().available, { before: false, after: false });
});

test('invalid proof and generic denial messages cannot interrupt an already observed matching denial', () => {
  const model = createPolicyCodeModel();
  observe(model, snapshot());
  animate(model, denialCue());
  const before = structuredClone(model.state());
  for (const cue of [
    denialCue({ phase: 'after', proof: { method: 'run' } }),
    { id: 8, key: 'parcel-sync:8:deny', eventKind: 'deny', message: 'The cable request was denied' },
    { id: 9, key: 'parcel-sync:9:unknown', eventKind: 'unknown', stage: 'unrecognized' },
  ]) {
    animate(model, cue);
    assert.deepEqual(model.state(), before);
  }
});

test('a matching policy payload still needs an exact current-run event identity', () => {
  const model = createPolicyCodeModel();
  observe(model, snapshot());
  const invalid = [
    denialCue({ runId: 'parcel-old' }),
    denialCue({ cue: { key: 'parcel-sync:4:deny' } }),
    denialCue({ cue: { id: undefined } }),
    denialCue({ cue: { id: 4.5, key: 'parcel-sync:4.5:knife-denied-before' } }),
  ];
  observe(model, snapshot({ status: 'completed', cues: invalid }));
  for (const cue of invalid) animate(model, cue);
  assert.equal(model.state().phase, null);
  assert.equal(model.state().proof, null);
  assert.deepEqual(model.state().available, { before: false, after: false });
});
