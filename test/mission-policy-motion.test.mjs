import assert from 'node:assert/strict';
import test from 'node:test';
import { policyDenialStage } from '../public/mission-policy-cues.js';
import { missionMotionSnapshot } from '../public/mission-motion-model.js';

function denialEvent({ phase = 'before', proof = {}, event = {} } = {}) {
  return {
    id: phase === 'before' ? 3 : 10,
    kind: `knife-denied-${phase}`,
    message: 'The cable-target request was rejected.',
    policyDenial: {
      boundary: 'tool-target',
      target: '/protected/safety-cable.txt',
      phase,
      method: phase === 'before' ? 'run' : 'probePolicy',
      startIndex: 12,
      endIndex: 19,
      denied: true,
      error: 'knife target denied by tool policy',
      ...proof,
    },
    ...event,
  };
}

function snapshot({ events = [], mission = {}, state = {} } = {}) {
  return missionMotionSnapshot({
    state: { runtime: 'golem', runId: 'parcel-policy', status: 'running', golem: { phase: 'invoking' }, events, ...state },
    mission: { recorded: false, cut: false, sealed: false, success: false, ...mission },
  });
}

test('each cable attempt is animated only with its matching invocation denial proof', () => {
  assert.equal(policyDenialStage(denialEvent()), 'blocking-before');
  assert.equal(policyDenialStage(denialEvent({ phase: 'after' })), 'blocking-after');
});

const mismatches = [
  ['a different policy boundary', { proof: { boundary: 'filesystem' } }],
  ['a parcel target', { proof: { target: '/data/parcel.txt' } }],
  ['a similar but different cable path', { proof: { target: '/protected/safety-cable.txt.backup' } }],
  ['a missing boundary', { proof: { boundary: undefined } }],
  ['a missing target', { proof: { target: undefined } }],
  ['a before event with an after phase', { proof: { phase: 'after' } }],
  ['an after event with a before phase', { phase: 'after', proof: { phase: 'before' } }],
  ['a before attempt attributed to the fresh probe', { proof: { method: 'probePolicy' } }],
  ['a fresh probe attributed to the original run', { phase: 'after', proof: { method: 'run' } }],
  ['an unrecognized phase', { proof: { phase: 'during' } }],
  ['an unrecognized method', { proof: { method: 'knife' } }],
  ['a missing start index', { proof: { startIndex: undefined } }],
  ['a missing end index', { proof: { endIndex: undefined } }],
  ['a negative start index', { proof: { startIndex: -1 } }],
  ['a negative end index', { proof: { endIndex: -1 } }],
  ['equal oplog bounds', { proof: { endIndex: 12 } }],
  ['reversed oplog bounds', { proof: { endIndex: 11 } }],
  ['a fractional start index', { proof: { startIndex: 12.5 } }],
  ['a fractional end index', { proof: { endIndex: 19.5 } }],
  ['a string start index', { proof: { startIndex: '12' } }],
  ['a string end index', { proof: { endIndex: '19' } }],
  ['an infinite start index', { proof: { startIndex: Infinity } }],
  ['a NaN end index', { proof: { endIndex: NaN } }],
  ['an unsuccessful denial', { proof: { denied: false } }],
  ['a truthy denial string', { proof: { denied: 'true' } }],
  ['a truthy denial number', { proof: { denied: 1 } }],
  ['a missing denial flag', { proof: { denied: undefined } }],
  ['an empty error', { proof: { error: '' } }],
  ['a whitespace-only error', { proof: { error: ' \n\t ' } }],
  ['a non-string error', { proof: { error: { message: 'denied' } } }],
  ['a missing error', { proof: { error: undefined } }],
];

for (const [description, options] of mismatches) {
  test(`denial motion rejects ${description}`, () => {
    const event = denialEvent(options);
    assert.equal(policyDenialStage(event), null);
    assert.deepEqual(snapshot({ events: [event] }).cues, []);
  });
}

test('zero is a valid invocation start index when an end proves the call finished', () => {
  const event = denialEvent({ proof: { startIndex: 0, endIndex: 1 } });
  assert.equal(policyDenialStage(event), 'blocking-before');
});

test('generic denial text and old event records cannot fabricate an attempted cable cut', () => {
  const events = [
    { id: 1, kind: 'deny', message: 'knife safety-cable denied' },
    { id: 2, kind: 'policy-verified', message: 'Both policy checks denied the call.' },
    { id: 3, kind: 'knife-denied-before', message: 'Denied before the crash.' },
    { id: 4, kind: 'knife-denied-after', policyDenial: null, message: 'Denied after recovery.' },
    denialEvent({ event: { id: 5, kind: 'filesystem-denied-after' } }),
    denialEvent({ event: { id: 6, kind: 'policy-denied' } }),
  ];
  for (const event of events) assert.equal(policyDenialStage(event), null);
  assert.deepEqual(snapshot({ events }).cues, []);
  assert.equal(policyDenialStage(null), null);
  assert.equal(policyDenialStage(undefined), null);
});

test('denial cues retain their evidence and source identity in causal runtime order', () => {
  const before = denialEvent();
  const after = denialEvent({ phase: 'after' });
  const events = Object.freeze([
    Object.freeze({ id: 11, kind: 'complete' }),
    Object.freeze(after),
    Object.freeze({ id: 8, kind: 'replay' }),
    Object.freeze({ id: 7, kind: 'restarted' }),
    Object.freeze({ id: 5, kind: 'crash' }),
    Object.freeze({ id: 4, kind: 'effect-observed' }),
    Object.freeze(before),
  ]);
  const motion = snapshot({ events, mission: { cut: true, sealed: true, success: true } });
  assert.deepEqual(motion.cues.map(cue => cue.stage), [
    'blocking-before', 'cutting', 'falling', 'rising', 'sealing', 'blocking-after', 'done',
  ]);
  assert.equal(events[0].id, 11, 'Projection must not mutate the runtime event order');
  const [beforeCue] = motion.cues;
  const afterCue = motion.cues.find(cue => cue.stage === 'blocking-after');
  assert.equal(beforeCue.key, 'parcel-policy:3:knife-denied-before');
  assert.equal(afterCue.key, 'parcel-policy:10:knife-denied-after');
  assert.deepEqual(beforeCue.policyDenial, before.policyDenial);
  assert.deepEqual(afterCue.policyDenial, after.policyDenial);
  for (const cue of motion.cues.filter(cue => !cue.stage.startsWith('blocking-'))) {
    assert.equal(Object.hasOwn(cue, 'policyDenial'), false, 'Unrelated cues must not borrow denial evidence');
  }
});

test('archived results retain their final pose without replaying old policy denials', () => {
  const motion = snapshot({
    events: [denialEvent(), denialEvent({ phase: 'after' })],
    state: { status: 'completed' },
    mission: { recorded: true, cut: true, sealed: true, success: true },
  });
  assert.deepEqual(motion.cues, []);
  assert.equal(motion.pose, 'done');
});

test('a post-recovery denial is useful evidence without fabricating a verified mission', () => {
  const motion = snapshot({ events: [denialEvent({ phase: 'after' })] });
  assert.deepEqual(motion.cues.map(cue => cue.stage), ['blocking-after']);
  assert.equal(motion.verified, false);
  assert.equal(motion.cut, false);
  assert.equal(motion.sealed, false);
});

test('unidentified events cannot acquire replayable denial cues from otherwise valid proof', () => {
  for (const id of [undefined, '3', Infinity, NaN]) {
    assert.deepEqual(snapshot({ events: [denialEvent({ event: { id } })] }).cues, []);
  }
});
