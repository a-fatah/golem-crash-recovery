import assert from 'node:assert/strict';
import test from 'node:test';
import { missionMotionSnapshot } from '../public/mission-motion-model.js';

function snapshot({ runId = 'parcel-first', status = 'running', phase = 'invoking', events = [], mission = {} } = {}) {
  return missionMotionSnapshot({
    state: { runtime: 'golem', runId, status, golem: { phase }, events },
    mission: { recorded: false, cut: false, sealed: false, success: false, ...mission },
  });
}

test('the marker and crash observed in one poll retain their causal order and source identity', () => {
  const events = Object.freeze([
    Object.freeze({ id: 5, kind: 'crash', message: 'Server exited on SIGKILL.' }),
    Object.freeze({ id: 4, kind: 'effect-observed', message: 'Observed the post-append marker.' }),
  ]);
  const motion = snapshot({ status: 'crashed', phase: 'killed', events, mission: { cut: true } });
  assert.deepEqual(motion.cues, [
    { id: 4, key: 'parcel-first:4:effect-observed', stage: 'cutting', eventKind: 'effect-observed' },
    { id: 5, key: 'parcel-first:5:crash', stage: 'falling', eventKind: 'crash' },
  ]);
  assert.equal(events[0].id, 5, 'Projection must not reorder the host event list');
  assert.equal(motion.pose, 'down');
});

test('an archived verified run renders its final pose without reenacting historical events', () => {
  const motion = snapshot({
    status: 'completed', phase: 'verified',
    events: [{ id: 4, kind: 'effect-observed' }, { id: 5, kind: 'crash' }, { id: 8, kind: 'replay' }, { id: 10, kind: 'complete' }],
    mission: { recorded: true, cut: true, sealed: true, success: true },
  });
  assert.equal(motion.archived, true);
  assert.equal(motion.pose, 'done');
  assert.deepEqual(motion.cues, []);
});

test('a recovered event cannot animate sealing until the mission actually reports a seal', () => {
  const events = [{ id: 6, kind: 'restarted' }, { id: 8, kind: 'replay' }];
  const unsealed = snapshot({ phase: 'recovered', events });
  assert.deepEqual(unsealed.cues.map(cue => cue.stage), ['rising']);
  assert.equal(unsealed.sealed, false);

  const sealed = snapshot({ phase: 'recovered', events, mission: { cut: true, sealed: true } });
  assert.deepEqual(sealed.cues.map(cue => cue.stage), ['rising', 'sealing']);
  assert.equal(sealed.pose, 'finishing');
  assert.equal(sealed.verified, false, 'A seal alone does not verify the fresh policy probes');
});

test('a completed event or status cannot fabricate a verified win', () => {
  const motion = snapshot({
    status: 'completed', phase: 'verified', events: [{ id: 10, kind: 'complete' }],
    mission: { cut: true, sealed: true },
  });
  assert.equal(motion.pose, 'finishing');
  assert.equal(motion.verified, false);
  assert.deepEqual(motion.cues, []);
});

test('the first snapshot after a crash rests down without synthesizing a fall or cut', () => {
  const motion = snapshot({ status: 'crashed', phase: 'killed' });
  assert.equal(motion.pose, 'down');
  assert.equal(motion.cut, false);
  assert.deepEqual(motion.cues, []);
  const restarting = snapshot({ phase: 'restarting', mission: { cut: true } });
  assert.equal(restarting.pose, 'down', 'Requesting restart does not prove a replacement server started');
});

test('a new run cannot collide with previous event keys, while repeated polls preserve keys', () => {
  const events = [{ id: 4, kind: 'effect-observed' }, { id: 5, kind: 'crash' }];
  const first = snapshot({ events });
  const repeated = snapshot({ events });
  const second = snapshot({ runId: 'parcel-second', events });
  assert.deepEqual(repeated.cues.map(cue => cue.key), first.cues.map(cue => cue.key));
  const firstKeys = new Set(first.cues.map(cue => cue.key));
  assert.equal(second.cues.some(cue => firstKeys.has(cue.key)), false);
});

test('unknown or missing events cannot advance the story or become implicit evidence', () => {
  const motion = missionMotionSnapshot({
    state: { runtime: 'golem', runId: 'parcel-first', status: 'running', golem: { phase: 'unrecognized' }, events: [
      { id: 2, kind: 'deploying' }, { id: 3, kind: 'an-event-named-cut' },
      { kind: 'crash' }, { id: '4', kind: 'restarted' }, { id: Infinity, kind: 'complete' },
    ] },
    mission: { cut: false, sealed: false, success: false },
  });
  assert.equal(motion.pose, 'ready');
  assert.equal(motion.cut, false);
  assert.deepEqual(motion.cues, []);
  assert.deepEqual(missionMotionSnapshot({ state: { runtime: 'golem', status: 'idle' }, mission: {} }).cues, []);
});

test('a verified live completion preserves one ordered cut, fall, rise, seal, and win', () => {
  const motion = snapshot({
    status: 'completed', phase: 'verified',
    events: [
      { id: 4, kind: 'effect-observed' }, { id: 5, kind: 'crash' },
      { id: 7, kind: 'restarted' }, { id: 8, kind: 'replay' }, { id: 10, kind: 'complete' },
    ],
    mission: { cut: true, sealed: true, success: true },
  });
  assert.equal(motion.pose, 'done');
  assert.equal(motion.verified, true);
  assert.deepEqual(motion.cues.map(cue => cue.stage), ['cutting', 'falling', 'rising', 'sealing', 'done']);
});

test('failure remains a failure pose even when the recovered parcel was already sealed', () => {
  const motion = snapshot({ status: 'failed', phase: 'policy-verified', mission: { cut: true, sealed: true } });
  assert.equal(motion.pose, 'failed');
  assert.equal(motion.sealed, true);
  assert.equal(motion.verified, false);
});

test('the model leaves the standalone runtime and absent mission outside its motion contract', () => {
  assert.equal(missionMotionSnapshot({ state: { runtime: 'local' }, mission: {} }), null);
  assert.equal(missionMotionSnapshot({ state: { runtime: 'golem' }, mission: null }), null);
});
