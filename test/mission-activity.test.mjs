import assert from 'node:assert/strict';
import test from 'node:test';
import { missionActivityState } from '../public/mission-activity-model.js';
import { createMissionActivityView } from '../public/mission-activity-view.js';

function running({ phase = 'starting', runId = 'parcel-current' } = {}) {
  return { runtime: 'golem', runId, status: 'running', golem: { phase } };
}

function fixture() {
  const nodes = new Map(['mission-activity', 'mission-activity-title', 'mission-activity-detail']
    .map(id => [`#${id}`, { hidden: false, textContent: '' }]));
  const scene = {
    dataset: { motion: 'ready', cut: 'false', sealed: 'false', scene: 'ready' },
    querySelector: selector => nodes.get(selector),
  };
  const view = createMissionActivityView({ scene });
  const observe = ({ runId = 'parcel-current', status = 'running', archived = false } = {}) =>
    view.update({ type: 'snapshot', snapshot: { runId, status, archived } });
  const cue = ({ runId = 'parcel-current' } = {}) => view.update({
    type: 'cue', runId,
    cue: { id: 4, key: `${runId}:4:knife-denied-before`, eventKind: 'knife-denied-before', stage: 'blocking-before' },
  });
  const settled = ({ runId = 'parcel-current' } = {}) =>
    view.update({ type: 'settled', snapshot: { runId } });
  return { view, scene, nodes, observe, cue, settled };
}

test('initial connection and explicit start/resume intent provide feedback before fresh runtime state arrives', () => {
  const connecting = missionActivityState();
  assert.equal(connecting.kind, 'connecting');
  assert.match(connecting.title, /Connecting/);
  assert.equal(connecting.animate, true);

  const starting = missionActivityState({
    state: { ...running(), status: 'completed' }, mission: { recorded: true }, pendingAction: 'start',
  });
  assert.equal(starting.kind, 'preparing');
  assert.match(starting.detail, /Contacting/);
  assert.equal(starting.animate, true, 'A new mission must not look like the old archived result while its request is pending');

  const resuming = missionActivityState({ state: { ...running(), status: 'crashed' }, pendingAction: 'resume' });
  assert.equal(resuming.kind, 'restarting');
  assert.match(resuming.detail, /recover the unfinished call/);
  assert.equal(resuming.animate, true);
});

test('each waiting phase describes current work without claiming a completed animation event', () => {
  const phases = [
    ['starting', 'preparing', /Starting Golem/, /warming up/],
    ['deploying', 'preparing', /Preparing the parcel agent/, /tool and policy rules/],
    ['invoking', 'preparing', /Waiting for the tool/, /watching for the cut marker/],
    ['restarting', 'restarting', /Restarting Golem/, /still unfinished/],
    ['restarted', 'recovering', /Recovering the unfinished call/, /Waiting for its result/],
    ['recovered', 'checking', /Checking the result/, /fresh policy denials/],
    ['knife-denied-after', 'checking', /Checking the result/, /fresh policy denials/],
    ['policy-verified', 'checking', /Checking the result/, /final files/],
    ['verified', 'checking', /Finishing verification/, /finish the run/],
  ];
  for (const [phase, kind, title, detail] of phases) {
    const activity = missionActivityState({ state: running({ phase }) });
    assert.equal(activity.kind, kind, phase);
    assert.match(activity.title, title, phase);
    assert.match(activity.detail, detail, phase);
    assert.equal(activity.animate, true, phase);
  }
  for (const phase of ['idle', 'unrecognized-future-phase', undefined]) {
    const activity = missionActivityState({ state: { ...running(), golem: { phase } } });
    assert.match(activity.detail, /Waiting for the next runtime observation/);
    assert.doesNotMatch(activity.title, /complete|sealed|denied/i);
  }
});

test('quiet and terminal states, archived evidence, and other runtimes never look busy', () => {
  for (const status of ['idle', 'crashed', 'completed', 'failed']) {
    assert.equal(missionActivityState({ state: { ...running(), status } }), null, status);
  }
  assert.equal(missionActivityState({ state: running(), mission: { recorded: true } }), null);
  assert.equal(missionActivityState({ state: { ...running(), runtime: 'local' } }), null);
  assert.equal(missionActivityState({ state: running(), activeCue: true }), null);
});

test('pausing or stepping freezes ambient motion while keeping honest waiting feedback readable', () => {
  for (const playback of [{ paused: true }, { stepping: true }, { paused: true, stepping: true }]) {
    const activity = missionActivityState({ state: running({ phase: 'restarted' }), playback });
    assert.match(activity.title, /Recovering/);
    assert.equal(activity.animate, false);
  }
  assert.equal(missionActivityState({ state: running(), playback: { paused: false, stepping: false } }).animate, true);
});

test('disconnect wins over stale running state and pending actions, with static retry feedback', () => {
  for (const pendingAction of [null, 'start', 'resume']) {
    const activity = missionActivityState({ state: running(), disconnected: true, pendingAction });
    assert.equal(activity.kind, 'unavailable');
    assert.match(activity.title, /Connection interrupted/);
    assert.match(activity.detail, /may still be running/);
    assert.equal(activity.animate, false);
  }
});

test('the view hands off to confirmed cues and restores waiting feedback only after settlement', () => {
  const f = fixture();
  assert.equal(f.scene.dataset.activity, 'connecting');
  f.view.setRuntime({ state: running() });
  f.observe();
  f.cue();
  assert.equal(f.nodes.get('#mission-activity').hidden, true);
  assert.equal(f.scene.dataset.activityMotion, 'false');
  f.view.setRuntime({ state: running({ phase: 'restarted' }) });
  f.observe();
  assert.equal(f.nodes.get('#mission-activity').hidden, true, 'Background polls must not cover the observed event currently on screen');
  f.settled();
  assert.equal(f.nodes.get('#mission-activity').hidden, false);
  assert.equal(f.scene.dataset.activity, 'recovering');
  assert.match(f.nodes.get('#mission-activity-title').textContent, /unfinished call/);
  assert.deepEqual(Object.fromEntries(Object.entries(f.scene.dataset).filter(([key]) => !key.startsWith('activity'))),
    { motion: 'ready', cut: 'false', sealed: 'false', scene: 'ready' }, 'Waiting feedback must not advance poses, scene captions, or proof props');
});

test('the view preserves static waiting text during pause/step and restores motion on resume', () => {
  const f = fixture();
  f.view.setRuntime({ state: running({ phase: 'restarted' }) });
  f.observe();
  for (const playback of [{ paused: true }, { paused: true, stepping: true }]) {
    f.view.setPlayback(playback);
    assert.equal(f.nodes.get('#mission-activity').hidden, false);
    assert.equal(f.scene.dataset.activityMotion, 'false');
    assert.match(f.nodes.get('#mission-activity-title').textContent, /Recovering/);
  }
  f.view.setPlayback({ paused: false, stepping: false });
  assert.equal(f.scene.dataset.activityMotion, 'true');
});

test('a fresh run clears the old cursor and ignores delayed cue and settlement callbacks', () => {
  const f = fixture();
  f.view.setRuntime({ state: running() });
  f.observe();
  f.cue();
  assert.equal(f.nodes.get('#mission-activity').hidden, true);

  f.view.setRuntime({ state: running({ runId: 'parcel-new' }) });
  f.observe({ runId: 'parcel-new' });
  assert.equal(f.nodes.get('#mission-activity').hidden, false);
  f.cue();
  assert.equal(f.nodes.get('#mission-activity').hidden, false, 'An old-run cue cannot suppress new preparation feedback');

  f.cue({ runId: 'parcel-new' });
  f.settled();
  assert.equal(f.nodes.get('#mission-activity').hidden, true, 'Old settlement cannot interrupt the new observed event');
  f.settled({ runId: 'parcel-new' });
  assert.equal(f.nodes.get('#mission-activity').hidden, false);
});

test('archive, failure, and null snapshots clear cursor suppression without leaking old activity', () => {
  for (const next of [null, { runId: 'parcel-current', status: 'failed', archived: false }, { runId: 'parcel-current', status: 'completed', archived: true }]) {
    const f = fixture();
    f.view.setRuntime({ state: running() });
    f.observe();
    f.cue();
    const state = next ? { ...running(), status: next.status } : null;
    f.view.setRuntime({ state, mission: { recorded: next?.archived === true } });
    f.view.update({ type: 'snapshot', snapshot: next });
    assert.equal(f.nodes.get('#mission-activity').hidden, next !== null);
    assert.equal(f.scene.dataset.activity, next ? '' : 'connecting');
  }
});

test('the view replaces stale running feedback with static disconnect feedback and clears it after a fresh state', () => {
  const f = fixture();
  f.view.setRuntime({ state: running() });
  f.observe();
  f.cue();
  f.view.setRuntime({ state: running(), disconnected: true });
  assert.equal(f.nodes.get('#mission-activity').hidden, false);
  assert.equal(f.scene.dataset.activity, 'unavailable');
  assert.equal(f.scene.dataset.activityMotion, 'false');
  f.view.setRuntime({ state: running(), disconnected: false });
  assert.equal(f.nodes.get('#mission-activity').hidden, true, 'Reconnect must still respect the proof animation cursor');
  f.settled();
  assert.equal(f.scene.dataset.activity, 'preparing');
  assert.equal(f.scene.dataset.activityMotion, 'true');
});
