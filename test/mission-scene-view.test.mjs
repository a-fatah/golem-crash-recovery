import assert from 'node:assert/strict';
import test from 'node:test';
import { createMissionSceneView } from '../public/mission-scene-view.js';

const ready = {
  scene: 'ready', courier: 'Ready for dispatch', parcelCaption: 'Ribbon waiting to be cut',
  houseCaption: 'Verification pending · rule already applies', banner: '',
};
const completed = {
  scene: 'completed', courier: 'Mission complete', parcelCaption: 'Sealed · one cut in the final file',
  houseCaption: 'Intact · both fresh attempts blocked', banner: '',
};

function createFixture() {
  const nodes = new Map(['courier-caption', 'parcel-caption', 'house-caption', 'scene-status']
    .map(id => [`#${id}`, { textContent: '', hidden: false }]));
  const scene = {
    dataset: { scene: 'ready', motion: 'falling', cut: 'true', sealed: 'false' },
    querySelector: selector => nodes.get(selector),
  };
  const view = createMissionSceneView({ scene });
  view.setMission(ready);
  const observe = ({ runId = 'parcel-scene', status = 'running', archived = false } = {}) =>
    view.update({ type: 'snapshot', snapshot: { runId, status, archived } });
  const cue = (stage, eventKind, { runId = 'parcel-scene', id = 6, ...extra } = {}) =>
    view.update({ type: 'cue', runId, cue: { id, eventKind, stage, key: `${runId}:${id}:${eventKind}`, ...extra } });
  return { view, scene, nodes, observe, cue };
}

test('future completed polls cannot replace the paused crash captions or mutate animated props', () => {
  const f = createFixture();
  f.observe();
  f.cue('falling', 'crash');
  for (let poll = 0; poll < 5; poll++) {
    f.view.setMission(completed);
    f.observe({ status: 'completed' });
  }
  assert.equal(f.scene.dataset.scene, 'crashed');
  assert.match(f.nodes.get('#courier-caption').textContent, /offline.*unfinished/);
  assert.match(f.nodes.get('#parcel-caption').textContent, /not yet sealed/);
  assert.doesNotMatch(f.nodes.get('#courier-caption').textContent, /Mission complete/);
  assert.match(f.nodes.get('#scene-status').textContent, /Observed event #6.*unfinished call/);
  assert.equal(f.nodes.get('#scene-status').hidden, false);
  assert.equal(f.scene.dataset.motion, 'falling');
  assert.equal(f.scene.dataset.cut, 'true');
  assert.equal(f.scene.dataset.sealed, 'false');
  f.view.update({ type: 'settled', snapshot: { runId: 'parcel-scene' } });
  assert.equal(f.scene.dataset.scene, 'completed');
  assert.equal(f.nodes.get('#courier-caption').textContent, 'Mission complete');
  assert.equal(f.nodes.get('#scene-status').hidden, true);
});

test('scene captions advance only with their current-run cues through both denials and recovery', () => {
  const f = createFixture();
  f.observe();
  f.view.setMission(completed);
  f.cue('blocking-before', 'knife-denied-before', { id: 4 });
  assert.equal(f.nodes.get('#parcel-caption').textContent, 'Ribbon waiting to be cut');
  assert.match(f.nodes.get('#house-caption').textContent, /request blocked/);
  f.cue('cutting', 'effect-observed', { id: 5 });
  assert.match(f.nodes.get('#parcel-caption').textContent, /tool still unfinished/);
  f.cue('rising', 'restarted', { id: 7 });
  assert.equal(f.scene.dataset.scene, 'recovering');
  assert.match(f.nodes.get('#parcel-caption').textContent, /pending at this event/);
  f.cue('sealing', 'replay', { id: 8 });
  assert.match(f.nodes.get('#parcel-caption').textContent, /Parcel sealed/);
  assert.match(f.nodes.get('#house-caption').textContent, /checks follow/);
  f.cue('blocking-after', 'knife-denied-after', { id: 11 });
  assert.match(f.nodes.get('#courier-caption').textContent, /Fresh cable request blocked/);
  assert.match(f.nodes.get('#house-caption').textContent, /fresh knife request blocked/);
  f.cue('done', 'complete', { id: 13 });
  assert.equal(f.scene.dataset.scene, 'completed');
  assert.equal(f.nodes.get('#courier-caption').textContent, 'Mission complete');
});

test('new missions clear the cursor and ignore delayed old-run cue and settlement messages', () => {
  const f = createFixture();
  f.observe();
  f.cue('falling', 'crash');
  f.view.setMission(ready);
  f.observe({ runId: 'parcel-next' });
  assert.equal(f.scene.dataset.scene, 'ready');
  f.cue('falling', 'crash');
  assert.equal(f.scene.dataset.scene, 'ready');
  f.cue('cutting', 'effect-observed', { runId: 'parcel-next' });
  f.view.update({ type: 'settled', snapshot: { runId: 'parcel-scene' } });
  assert.equal(f.scene.dataset.scene, 'working');
  assert.match(f.nodes.get('#parcel-caption').textContent, /tool still unfinished/);
});

test('archive and failure snapshots use runtime fallback and refuse new cursor events', () => {
  for (const { status, archived } of [{ status: 'completed', archived: true }, { status: 'failed', archived: false }]) {
    const f = createFixture();
    f.observe();
    f.cue('falling', 'crash');
    const fallback = { ...completed, scene: status, courier: status === 'failed' ? 'Needs investigation' : 'Recorded successful Golem run' };
    f.view.setMission(fallback);
    f.observe({ status, archived });
    f.cue('rising', 'restarted');
    assert.equal(f.scene.dataset.scene, status);
    assert.equal(f.nodes.get('#courier-caption').textContent, fallback.courier);
  }
});

test('legacy observations keep event-relative captions without inventing detailed process or oplog proof', () => {
  const f = createFixture();
  f.observe();
  f.cue('falling', 'crash');
  const banner = f.nodes.get('#scene-status').textContent;
  assert.match(banner, /server exited/);
  assert.doesNotMatch(banner, /PID|SIGKILL|Start \d|End \d/);
  f.cue('sealing', 'crash');
  assert.equal(f.nodes.get('#scene-status').textContent, banner, 'A stage cannot borrow another event kind');
  f.cue('rising', 'restarted', { key: 'parcel-other:6:restarted' });
  assert.equal(f.nodes.get('#scene-status').textContent, banner, 'An event key cannot borrow another run identity');
});

test('pausing before the first cue holds ready captions while future crash evidence arrives', () => {
  const f = createFixture();
  f.observe();
  f.view.setPlayback({ paused: true, stepping: false, activeCueKey: null });
  const crashed = {
    ...ready, scene: 'crashed', courier: 'Courier offline · job unfinished',
    parcelCaption: 'Cut marker observed · not yet sealed', banner: 'REAL SERVER CRASH',
  };
  for (let poll = 0; poll < 4; poll++) {
    f.view.setMission(crashed);
    f.observe({ status: 'crashed' });
    f.view.setPlayback({ paused: true, stepping: false, activeCueKey: null });
  }
  assert.equal(f.scene.dataset.scene, 'ready');
  assert.equal(f.nodes.get('#courier-caption').textContent, ready.courier);
  assert.equal(f.nodes.get('#parcel-caption').textContent, ready.parcelCaption);
  assert.equal(f.nodes.get('#scene-status').hidden, true);
  assert.equal(f.scene.dataset.motion, 'falling', 'Caption holding must never mutate the animation props');
});

test('stepping the first observed event replaces the held baseline and keeps that cue across later polls', () => {
  const f = createFixture();
  f.observe();
  f.view.setPlayback({ paused: true, stepping: false, activeCueKey: null });
  f.view.setMission(completed);
  f.observe({ status: 'completed' });
  f.view.setPlayback({ paused: true, stepping: true, activeCueKey: null });
  assert.equal(f.scene.dataset.scene, 'ready', 'Waiting for the first observed cue must keep the baseline');
  f.cue('blocking-before', 'knife-denied-before', { id: 4 });
  f.view.setPlayback({ paused: true, stepping: false, activeCueKey: 'parcel-scene:4:knife-denied-before' });
  f.view.setMission(completed);
  f.observe({ status: 'completed' });
  assert.equal(f.scene.dataset.scene, 'working');
  assert.match(f.nodes.get('#courier-caption').textContent, /Cable request blocked/);
  assert.equal(f.nodes.get('#parcel-caption').textContent, ready.parcelCaption);
  assert.match(f.nodes.get('#scene-status').textContent, /Observed event #4/);
});

test('resuming before any cue releases the held baseline to the latest runtime fallback', () => {
  const f = createFixture();
  f.observe();
  f.view.setPlayback({ paused: true, activeCueKey: null });
  f.view.setMission(completed);
  f.observe({ status: 'completed' });
  assert.equal(f.scene.dataset.scene, 'ready');
  f.view.setPlayback({ paused: false, stepping: false, activeCueKey: null });
  assert.equal(f.scene.dataset.scene, 'completed');
  assert.equal(f.nodes.get('#courier-caption').textContent, completed.courier);
});

test('a retained pause preference captures the new run baseline without leaking the prior mission captions', () => {
  const f = createFixture();
  f.observe();
  f.view.setPlayback({ paused: true, activeCueKey: null });
  f.view.setMission(completed);
  f.observe({ status: 'completed' });
  const nextReady = { ...ready, scene: 'working', courier: 'Preparing a new mission' };
  f.view.setMission(nextReady);
  f.observe({ runId: 'parcel-next' });
  assert.equal(f.scene.dataset.scene, 'working');
  assert.equal(f.nodes.get('#courier-caption').textContent, nextReady.courier);
  f.view.setMission(completed);
  f.observe({ runId: 'parcel-next', status: 'completed' });
  assert.equal(f.nodes.get('#courier-caption').textContent, nextReady.courier);
  f.cue('falling', 'crash');
  assert.equal(f.nodes.get('#courier-caption').textContent, nextReady.courier, 'An old-run cue must not release the new held baseline');
});

test('failure, archive, and null snapshots clear pre-cue baseline holds despite a retained pause preference', () => {
  for (const next of [null, { status: 'failed', archived: false }, { status: 'completed', archived: true }]) {
    const f = createFixture();
    f.observe();
    f.view.setPlayback({ paused: true, activeCueKey: null });
    f.view.setMission(completed);
    if (next) f.observe(next);
    else f.view.update({ type: 'snapshot', snapshot: null });
    f.view.setPlayback({ paused: true, activeCueKey: null });
    assert.equal(f.nodes.get('#courier-caption').textContent, completed.courier);
    assert.equal(f.scene.dataset.scene, 'completed');
  }
});
