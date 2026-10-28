import assert from 'node:assert/strict';
import test from 'node:test';
import { createMissionAnimator } from '../public/mission-motion.js';
import { createPolicyCodeModel } from '../public/mission-code-model.js';
import { createMissionCodeModel } from '../public/mission-source-model.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const isUnavailable = control => control.disabled || control.getAttribute('aria-disabled') === 'true';
const observedEvents = [
  { id: 4, kind: 'effect-observed' }, { id: 5, kind: 'crash' },
  { id: 7, kind: 'restarted' }, { id: 8, kind: 'replay' }, { id: 10, kind: 'complete' },
];

function observation({ runId = 'parcel-first', status = 'running', phase = 'invoking', events = [], cut = false, sealed = false, verified = false, archived = false } = {}) {
  return {
    state: { runtime: 'golem', runId, status, events, golem: { phase } },
    mission: { cut, sealed, success: verified, recorded: archived },
  };
}

/** Supplies only the DOM and animation boundary used by the controller. */
function createMotionFixture(t, { reducedMotion = false, blockedStages = [], onMotion, onPlayback, mirroredControls = false, onSceneChange = () => {} } = {}) {
  class Element {
    dataset = {};
    children = [];
    textContent = '';
    hidden = false;
    _disabled = false;
    listeners = new Map();
    attributes = new Map();
    get disabled() { return this._disabled; }
    set disabled(value) {
      this._disabled = value;
      if (value && globalThis.document?.activeElement === this) globalThis.document.activeElement = null;
    }
    style = { properties: new Map(), setProperty(name, value) { this.properties.set(name, value); } };
    offsetWidth = 80;
    rectangle = { left: 0, width: 80 };
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    focus() { globalThis.document.activeElement = this; }
    getBoundingClientRect() { return this.rectangle; }
    click() { this.listeners.get('click')?.(); }
  }

  const previousDocument = globalThis.document;
  const previousObserver = globalThis.ResizeObserver;
  globalThis.document = { createElement: () => new Element() };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousObserver;
  });

  const scene = new Element();
  const readout = new Element();
  const receipts = new Element();
  const replayButton = new Element();
  const pauseButton = new Element();
  const stepButton = new Element();
  const secondaryPauseButton = new Element();
  const secondaryStepButton = new Element();
  const playbackStatus = new Element();
  const playbackGroup = new Element();
  const panel = new Element();
  const blocked = new Set(blockedStages);
  const pending = [];
  const enteredStages = [];
  let animations = [];
  const persistentAnimations = [];
  let finishedReads = 0;
  const selectors = new Map([
    ['.courier-station', new Element()], ['.courier-rig', new Element()],
    ['.parcel-station', new Element()], ['.courier-knife', new Element()],
  ]);
  scene.querySelector = selector => selectors.get(selector);
  readout.closest = () => panel;
  pauseButton.closest = () => playbackGroup;
  scene.getAnimations = () => [...animations, ...persistentAnimations];
  scene.dataset = new Proxy({}, {
    set(target, property, value) {
      if (property === 'motion' && target[property] !== value) {
        enteredStages.push(value);
        animations = [];
        if (blocked.has(value)) {
          let resolve;
          const finished = new Promise(accept => { resolve = accept; });
          const record = { stage: value, cancelled: false, pauseCalls: 0, playCalls: 0, finishCalls: 0 };
          const animation = {
            playState: 'running',
            effect: { getTiming: () => ({ iterations: 1 }) },
            get finished() { finishedReads++; return finished; },
            pause() { record.pauseCalls++; this.playState = 'paused'; },
            play() { record.playCalls++; this.playState = 'running'; },
            finish() { record.finishCalls++; this.playState = 'finished'; resolve(); },
            cancel() { record.cancelled = true; this.playState = 'idle'; resolve(); },
          };
          record.resolve = () => { animation.playState = 'finished'; resolve(); };
          animations = [animation];
          pending.push(record);
        }
      }
      target[property] = value;
      onSceneChange({ property, value });
      return true;
    },
  });
  const animator = createMissionAnimator({ scene, readout, receipts, replayButton, pauseButton, stepButton,
    pauseButtons: mirroredControls ? [secondaryPauseButton, pauseButton] : [],
    stepButtons: mirroredControls ? [secondaryStepButton, stepButton] : [],
    playbackStatus, motionPreference: { matches: reducedMotion }, onMotion, onPlayback });
  return { animator, scene, readout, receipts, replayButton, pauseButton, stepButton, secondaryPauseButton, secondaryStepButton, playbackStatus, playbackGroup, panel, blocked, pending, enteredStages, persistentAnimations, elements: selectors, get animations() { return animations; }, get finishedReads() { return finishedReads; } };
}

test('repeated polls neither restart an active cut nor duplicate the queued fall', async t => {
  const f = createMotionFixture(t, { blockedStages: ['cutting', 'falling'] });
  f.animator.update(observation());
  const crashed = observation({ status: 'crashed', phase: 'killed', events: observedEvents.slice(0, 2), cut: true });
  f.animator.update(crashed);
  for (let poll = 0; poll < 8; poll++) f.animator.update(crashed);
  assert.equal(f.pending.length, 1);
  assert.equal(f.scene.dataset.motion, 'cutting');
  assert.equal(f.receipts.children.length, 1);
  f.pending[0].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'falling');
  assert.equal(f.pending.length, 2);
  f.pending[1].resolve();
  await settle();
  f.animator.update(crashed);
  assert.equal(f.scene.dataset.motion, 'down');
  assert.deepEqual(f.receipts.children.map(row => row.dataset.status), ['played', 'played']);
  assert.equal(new Set(f.receipts.children.map(row => row.dataset.eventKey)).size, 2);
});

function completedPolicyObservation() {
  const denial = ({ id, phase, method, startIndex, endIndex }) => ({
    id, kind: `knife-denied-${phase}`,
    policyDenial: { boundary: 'tool-target', target: '/protected/safety-cable.txt', phase, method, startIndex, endIndex, denied: true, error: 'Knife policy denies target: /protected/safety-cable.txt' },
  });
  return observation({ status: 'completed', phase: 'verified', cut: true, sealed: true, verified: true, events: [
    denial({ id: 4, phase: 'before', method: 'run', startIndex: 31, endIndex: 55 }),
    { id: 5, kind: 'effect-observed' }, { id: 6, kind: 'crash' }, { id: 7, kind: 'restarted' }, { id: 8, kind: 'replay' },
    denial({ id: 11, phase: 'after', method: 'probePolicy', startIndex: 189, endIndex: 213 }),
    { id: 13, kind: 'complete' },
  ] });
}

function completedRuntimeObservation() {
  const result = completedPolicyObservation();
  const runtimeProofs = {
    'effect-observed': { phase: 'in-flight', matchingToolEnds: 0 },
    crash: { phase: 'killed', matchingToolEnds: 0, signal: 'SIGKILL' },
    restarted: { phase: 'restarted', matchingToolEnds: 0, newPid: 64002 },
    replay: { phase: 'recovered', matchingToolEnds: 1, newPid: 64002, toolEndIndex: 149 },
  };
  result.state.events = result.state.events.map(event => ({
    ...event,
    ...(runtimeProofs[event.kind] ? {
      runtimeEvidence: {
        invocationKey: result.state.runId,
        agentId: `ParcelAgent(${JSON.stringify(result.state.runId)})`,
        toolStartIndex: 86, markerIndex: 118, oldPid: 64001,
        ...runtimeProofs[event.kind],
      },
    } : {}),
  }));
  return result;
}

test('actual animator callbacks advance runtime source only as each proved animation begins, despite a complete future snapshot', async t => {
  const code = createMissionCodeModel();
  const messages = [];
  const f = createMotionFixture(t, {
    blockedStages: ['cutting', 'falling', 'rising', 'sealing', 'blocking-after'],
    onMotion(message) { messages.push(message); code.update(message); },
  });
  f.animator.update(observation());
  const completed = completedRuntimeObservation();
  f.animator.update(completed);
  const latestSnapshot = messages.filter(message => message.type === 'snapshot').at(-1).snapshot;
  assert.equal(latestSnapshot.cues.filter(cue => cue.runtimeEvidence).length, 4);
  assert.deepEqual(code.state().available, { before: true, tool: true, crash: true, recovery: true, finish: true, after: true });
  assert.equal(code.state().phase, 'before', 'The full future snapshot must not jump directly to completion');
  await settle();

  const stages = ['cutting', 'falling', 'rising', 'sealing'];
  const phases = ['tool', 'crash', 'recovery', 'finish'];
  for (const [index, stage] of stages.entries()) {
    assert.equal(f.scene.dataset.motion, stage);
    assert.equal(f.pending[index].stage, stage);
    assert.equal(code.state().phase, phases[index]);
    assert.equal(code.state().mode, 'live');
    assert.equal(code.state().active, true);
    const proof = code.state().proof;
    assert.equal(proof.runtimeEvidence.invocationKey, 'parcel-first');
    assert.equal(proof.runtimeEvidence.agentId, 'ParcelAgent("parcel-first")');
    assert.equal(proof.runtimeEvidence.toolStartIndex, 86);
    assert.equal(proof.runtimeEvidence.markerIndex, 118);
    assert.equal(proof.runtimeEvidence.matchingToolEnds, stage === 'sealing' ? 1 : 0);
    if (stage === 'sealing') assert.equal(proof.runtimeEvidence.toolEndIndex, 149);
    for (let poll = 0; poll < 3; poll++) f.animator.update(completed);
    assert.equal(code.state().phase, phases[index], 'Polling cannot advance source while the matching animation promise is held');
    assert.equal(code.state().proof.key, proof.key);
    assert.equal(messages.filter(message => message.type === 'cue' && message.cue.stage === stage).length, 1);
    f.pending[index].resolve();
    await settle();
  }

  assert.equal(f.scene.dataset.motion, 'blocking-after');
  assert.equal(code.state().phase, 'after');
  assert.equal(code.state().proof.policyDenial.startIndex, 189);
  assert.equal(code.state().proof.policyDenial.endIndex, 213);
  f.pending[4].resolve();
  await settle();
  assert.equal(code.state().phase, 'after');
  assert.equal(code.state().mode, 'observed');
  assert.equal(code.state().active, false);
  assert.deepEqual(messages.filter(message => message.type === 'cue' && message.cue.runtimeEvidence)
    .map(message => [message.cue.key, message.cue.runtimeEvidence.invocationKey]), [
    ['parcel-first:5:effect-observed', 'parcel-first'], ['parcel-first:6:crash', 'parcel-first'],
    ['parcel-first:7:restarted', 'parcel-first'], ['parcel-first:8:replay', 'parcel-first'],
  ]);
});

test('a proof-less legacy runtime event still animates without activating that source phase', async t => {
  const code = createMissionCodeModel();
  const f = createMotionFixture(t, {
    blockedStages: ['cutting'],
    onMotion: message => code.update(message),
  });
  const completed = completedRuntimeObservation();
  delete completed.state.events.find(event => event.kind === 'effect-observed').runtimeEvidence;
  f.animator.update(observation());
  f.animator.update(completed);
  await settle();
  assert.equal(f.scene.dataset.motion, 'cutting', 'Legacy animation timing remains driven by the real marker event');
  assert.equal(code.state().phase, 'before');
  assert.equal(code.state().active, false);
  assert.equal(code.state().available.tool, false, 'The code panel cannot claim structured tool evidence that this event lacks');
  assert.equal(code.state().available.recovery, true, 'Other independently proved phases remain inspectable');
  f.pending[0].resolve();
  await settle();
  assert.equal(code.state().phase, 'after');
  assert.equal(code.state().mode, 'observed');
});

test('motion callbacks synchronize code to each started denial while the snapshot already contains both proofs', async t => {
  const code = createPolicyCodeModel();
  const messages = [];
  const f = createMotionFixture(t, {
    blockedStages: ['blocking-before', 'blocking-after'],
    onMotion(message) { messages.push(message); code.update(message); },
  });
  f.animator.update(observation());
  const completed = completedPolicyObservation();
  f.animator.update(completed);
  const latestSnapshot = messages.filter(message => message.type === 'snapshot').at(-1).snapshot;
  assert.deepEqual(latestSnapshot.cues.filter(cue => cue.policyDenial).map(cue => cue.policyDenial.phase), ['before', 'after']);
  assert.equal(f.scene.dataset.motion, 'blocking-before');
  assert.equal(code.state().phase, 'before');
  assert.equal(code.state().mode, 'live');
  assert.equal(code.state().active, true, 'The callback must activate code before waiting for the blocked animation promise');
  assert.equal(code.state().proof.policyDenial.startIndex, 31);
  assert.deepEqual(messages.filter(message => message.type === 'cue').map(message => message.cue.stage), ['blocking-before']);
  for (let poll = 0; poll < 4; poll++) f.animator.update(completed);
  assert.equal(code.state().phase, 'before', 'Repeated future-proof snapshots must not advance the code');
  assert.equal(messages.filter(message => message.type === 'cue').length, 1);

  f.pending[0].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'blocking-after');
  assert.equal(code.state().phase, 'after');
  assert.equal(code.state().mode, 'live');
  assert.equal(code.state().active, true);
  assert.equal(code.state().proof.policyDenial.startIndex, 189);
  assert.deepEqual(messages.filter(message => message.type === 'cue').map(message => message.cue.stage), [
    'blocking-before', 'cutting', 'falling', 'rising', 'sealing', 'blocking-after',
  ]);

  f.pending[1].resolve();
  await settle();
  assert.equal(messages.at(-1).type, 'settled');
  assert.equal(messages.at(-1).snapshot.runId, 'parcel-first');
  assert.equal(code.state().phase, 'after');
  assert.equal(code.state().mode, 'observed');
  assert.equal(code.state().active, false);
});

test('explicit replay callbacks retain replay labels and settle the code after the recovered policy denial', async t => {
  const code = createPolicyCodeModel();
  const messages = [];
  const f = createMotionFixture(t, {
    blockedStages: ['blocking-before', 'blocking-after'],
    onMotion(message) { messages.push(message); code.update(message); },
  });
  f.animator.update(completedPolicyObservation());
  assert.equal(code.state().mode, 'observed');
  assert.equal(code.state().active, false);
  assert.equal(messages.some(message => message.type === 'cue'), false, 'Loading historical evidence must not emit live animation cues');
  f.replayButton.click();
  assert.equal(code.state().phase, 'before');
  assert.equal(code.state().mode, 'replay');
  assert.equal(code.state().active, true);
  assert.equal(messages.find(message => message.type === 'cue').replay, true);
  f.pending[0].resolve();
  await settle();
  assert.equal(code.state().phase, 'after');
  assert.equal(code.state().mode, 'replay');
  assert.equal(code.state().active, true);
  const cues = messages.filter(message => message.type === 'cue');
  assert.equal(cues.every(message => message.replay === true), true);
  assert.equal(cues.at(-1).cue.policyDenial.method, 'probePolicy');
  f.pending[1].resolve();
  await settle();
  assert.equal(messages.at(-1).type, 'settled');
  assert.equal(code.state().mode, 'observed');
  assert.equal(code.state().active, false);
});

test('changing runs cancels pending motion and prevents the old fall from reaching the new scene', async t => {
  const f = createMotionFixture(t, { blockedStages: ['cutting'] });
  f.animator.update(observation());
  f.animator.update(observation({ status: 'crashed', phase: 'killed', events: observedEvents.slice(0, 2), cut: true }));
  const oldMotion = f.pending[0];
  f.animator.update(observation({ runId: 'parcel-second' }));
  await settle();
  assert.equal(oldMotion.cancelled, true);
  assert.equal(f.scene.dataset.motion, 'preparing');
  assert.equal(f.receipts.children.length, 0);
  assert.equal(f.enteredStages.includes('falling'), false);

  f.animator.update(observation({ runId: 'parcel-second', events: observedEvents.slice(0, 1), cut: true }));
  assert.equal(f.pending.length, 2, 'The new run may animate its own independently observed cut');
  assert.equal(f.receipts.children[0].dataset.eventKey, 'parcel-second:4:effect-observed');
  f.pending[1].resolve();
  await settle();
});

test('failure interrupts recovery motion without playing a queued seal or successful finish', async t => {
  const f = createMotionFixture(t, { blockedStages: ['rising'] });
  f.animator.update(observation());
  const recovering = observation({ phase: 'recovered', events: observedEvents.slice(2), cut: true, sealed: true });
  f.animator.update(recovering);
  assert.equal(f.scene.dataset.motion, 'rising');
  f.animator.update(observation({ status: 'failed', phase: 'failed', events: observedEvents, cut: true, sealed: true }));
  await settle();
  assert.equal(f.pending[0].cancelled, true);
  assert.equal(f.scene.dataset.motion, 'failed');
  assert.equal(f.enteredStages.includes('sealing'), false);
  assert.equal(f.enteredStages.includes('done'), false);
  assert.equal(f.replayButton.hidden, true);
  assert.match(f.readout.textContent, /failure/);
});

test('manual replay is labeled as playback and repeated result polls cannot enqueue it twice', async t => {
  const f = createMotionFixture(t);
  f.animator.update(observation());
  const completed = observation({ status: 'completed', phase: 'verified', events: observedEvents, cut: true, sealed: true, verified: true });
  f.animator.update(completed);
  await settle();
  assert.equal(f.scene.dataset.motion, 'done');
  assert.equal(f.replayButton.hidden, false);
  assert.equal(f.replayButton.disabled, false);

  f.blocked.add('cutting');
  f.replayButton.click();
  assert.match(f.readout.textContent, /^Replay of observed events/);
  assert.equal(f.receipts.children[0].dataset.playback, 'replay');
  for (let poll = 0; poll < 8; poll++) f.animator.update(completed);
  assert.equal(f.pending.length, 1);
  assert.equal(f.replayButton.disabled, true);
  f.pending[0].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'done');
  assert.equal(f.receipts.children.length, 5);
  assert.equal(f.receipts.children.every(row => row.dataset.playback === 'replay'), true);
  f.animator.update(completed);
  assert.equal(f.pending.length, 1);
});

test('loading archived evidence settles directly without presenting its history as live motion', t => {
  const f = createMotionFixture(t, { blockedStages: ['cutting', 'falling', 'rising', 'sealing'] });
  f.animator.update(observation({ status: 'completed', phase: 'verified', events: observedEvents, cut: true, sealed: true, verified: true, archived: true }));
  assert.equal(f.scene.dataset.motion, 'done');
  assert.equal(f.scene.dataset.playback, 'settled');
  assert.equal(f.pending.length, 0);
  assert.equal(f.receipts.children.length, 0);
  assert.equal(f.replayButton.hidden, true);
  assert.match(f.readout.textContent, /^Saved real result/);
});

test('reduced motion reaches the verified state without waiting on CSS animation promises', async t => {
  const f = createMotionFixture(t, { reducedMotion: true, blockedStages: ['cutting', 'falling', 'rising', 'sealing'] });
  f.animator.update(observation());
  f.animator.update(observation({ status: 'completed', phase: 'verified', events: observedEvents, cut: true, sealed: true, verified: true }));
  await settle();
  assert.equal(f.finishedReads, 0);
  assert.equal(f.scene.dataset.motion, 'done');
  assert.equal(f.scene.dataset.cut, 'true');
  assert.equal(f.scene.dataset.sealed, 'true');
  assert.deepEqual(f.receipts.children.map(row => row.dataset.status), Array(5).fill('played'));
});

test('SVG actor geometry without offsetWidth still produces a finite reach toward the parcel', t => {
  const f = createMotionFixture(t);
  f.elements.get('.courier-station').rectangle = { left: 0, width: 180 };
  f.elements.get('.parcel-station').rectangle = { left: 260, width: 120 };
  f.elements.get('.courier-rig').offsetWidth = undefined;
  f.elements.get('.courier-rig').rectangle = { left: 50, width: 80 };
  f.elements.get('.courier-knife').offsetWidth = undefined;
  f.elements.get('.courier-knife').rectangle = { left: 130, width: 20 };
  f.animator.update(observation());
  const reach = f.scene.style.properties.get('--courier-step');
  assert.match(reach, /^\d+(?:\.\d+)?px$/, 'CSS reach must be a finite pixel length');
  assert.ok(Number.parseFloat(reach) > 0, 'Valid SVG bounds must allow a step toward the parcel');
});

test('unavailable layout dimensions cannot write NaN or infinity into the CSS transform', t => {
  const f = createMotionFixture(t);
  f.elements.get('.courier-station').rectangle = { left: NaN, width: Infinity };
  f.elements.get('.parcel-station').rectangle = { left: 260, width: NaN };
  f.elements.get('.courier-rig').offsetWidth = undefined;
  f.elements.get('.courier-knife').offsetWidth = undefined;
  f.animator.update(observation());
  assert.match(f.scene.style.properties.get('--courier-step'), /^\d+(?:\.\d+)?px$/);
});

test('both proved cable denials play once in real event order and retain their oplog spans', async t => {
  const f = createMotionFixture(t, { blockedStages: ['blocking-before', 'blocking-after'] });
  f.animator.update(observation());
  const completed = completedPolicyObservation();
  f.animator.update(completed);
  for (let poll = 0; poll < 8; poll++) f.animator.update(completed);
  assert.equal(f.pending.length, 1);
  assert.equal(f.scene.dataset.motion, 'blocking-before');
  assert.match(f.readout.textContent, /run · Golem oplog 31 → 55/);
  f.pending[0].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'blocking-after');
  assert.equal(f.pending.length, 2);
  assert.match(f.readout.textContent, /fresh knife request after recovery/);
  assert.match(f.readout.textContent, /probePolicy · Golem oplog 189 → 213/);
  assert.equal(f.scene.dataset.cut, 'true');
  assert.equal(f.scene.dataset.sealed, 'true');
  f.pending[1].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'done');
  assert.deepEqual(f.receipts.children.map(row => row.dataset.motionStage), ['blocking-before', 'cutting', 'falling', 'rising', 'sealing', 'blocking-after', 'done']);
  assert.equal(f.receipts.children[0].dataset.oplogStart, '31');
  assert.equal(f.receipts.children[5].dataset.oplogStart, '189');
});

test('Pause freezes finite and infinite animation while future polls cannot advance its pose or source', async t => {
  const code = createMissionCodeModel();
  const playback = [];
  const messages = [];
  const f = createMotionFixture(t, {
    blockedStages: ['cutting', 'falling'],
    onMotion(message) { messages.push(message); code.update(message); },
    onPlayback: value => playback.push(value),
  });
  f.animator.update(observation());
  const completed = completedRuntimeObservation();
  f.animator.update(completed);
  await settle();
  const infinite = {
    playState: 'running', pauseCalls: 0, playCalls: 0,
    effect: { getTiming: () => ({ iterations: Infinity }) },
    pause() { this.pauseCalls++; this.playState = 'paused'; },
    play() { this.playCalls++; this.playState = 'running'; },
    cancel() {},
  };
  const cancelled = {
    playState: 'running', playCalls: 0,
    effect: { getTiming: () => ({ iterations: Infinity }) },
    pause() { this.playState = 'paused'; },
    play() { this.playCalls++; this.playState = 'running'; },
    cancel() { this.playState = 'idle'; },
  };
  f.animations.push(infinite);
  f.animations.push(cancelled);
  f.pauseButton.click();
  cancelled.cancel();
  assert.equal(f.pending[0].pauseCalls, 1);
  assert.equal(infinite.pauseCalls, 1);
  assert.equal(code.state().phase, 'tool');
  assert.equal(playback.at(-1).activeCueKey, 'parcel-first:5:effect-observed');
  assert.equal(playback.at(-1).paused, true);
  assert.equal(f.pauseButton.textContent, 'Resume animation');
  assert.match(f.playbackStatus.textContent, /Animation paused/);
  assert.match(f.playbackStatus.textContent, /real runtime continues/);
  for (let poll = 0; poll < 4; poll++) f.animator.update(completed);
  assert.equal(f.scene.dataset.motion, 'cutting');
  assert.equal(code.state().phase, 'tool');
  assert.equal(f.pending.length, 1);

  // Even an already-resolved animation cannot pass the paused cue boundary.
  f.pending[0].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'cutting');
  assert.equal(code.state().phase, 'tool');
  assert.equal(messages.at(-1).type, 'snapshot');
  assert.equal(f.enteredStages.includes('falling'), false);
  f.pauseButton.click();
  await settle();
  assert.equal(infinite.playCalls, 1);
  assert.equal(cancelled.playCalls, 0, 'Resume must not revive an animation cancelled while playback was paused');
  assert.equal(f.scene.dataset.motion, 'falling');
  assert.equal(code.state().phase, 'crash');
  f.pending[1].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'done');
  assert.equal(code.state().mode, 'observed');
});

test('Next finishes an interrupted active cue, plays exactly one next event, and holds its matching code', async t => {
  const code = createMissionCodeModel();
  const messages = [];
  const playback = [];
  const f = createMotionFixture(t, {
    blockedStages: ['cutting', 'falling', 'rising'],
    onMotion(message) { messages.push(message); code.update(message); },
    onPlayback: value => playback.push(value),
  });
  f.animator.update(observation());
  const completed = completedRuntimeObservation();
  f.animator.update(completed);
  await settle();
  f.pauseButton.click();
  assert.equal(isUnavailable(f.stepButton), false);
  f.stepButton.click();
  assert.equal(f.pending[0].finishCalls, 1, 'The paused current animation is completed before moving to the next event');
  await settle();
  assert.equal(f.scene.dataset.cut, 'true');
  assert.equal(f.scene.dataset.motion, 'falling');
  assert.equal(code.state().phase, 'crash');
  assert.equal(isUnavailable(f.stepButton), true, 'One in-progress step cannot be started twice');
  assert.equal(playback.at(-1).stepping, true);
  f.stepButton.click();
  f.pending[1].resolve();
  await settle();
  for (let poll = 0; poll < 3; poll++) f.animator.update(completed);
  assert.equal(f.scene.dataset.motion, 'down');
  assert.equal(code.state().phase, 'crash');
  assert.equal(code.state().proof.runtimeEvidence.toolStartIndex, 86);
  assert.equal(playback.at(-1).paused, true);
  assert.equal(playback.at(-1).stepping, false);
  assert.equal(playback.at(-1).activeCueKey, 'parcel-first:6:crash');
  assert.equal(f.pending.length, 2, 'Rising must wait for another click');
  assert.equal(messages.some(message => message.type === 'settled'), false);
  f.stepButton.click();
  await settle();
  assert.equal(f.scene.dataset.motion, 'rising');
  assert.equal(code.state().phase, 'recovery');
  f.pending[2].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'finishing');
  assert.equal(code.state().phase, 'recovery');
  assert.equal(f.scene.dataset.sealed, 'false', 'Future completed evidence cannot seal the held recovery frame');
  f.pauseButton.click();
  await settle();
  assert.equal(f.scene.dataset.motion, 'done');
});

test('Next finishes a paused post-commit transition before the next cue can wait on that old transition', async t => {
  const code = createMissionCodeModel();
  const playback = [];
  let transition;
  let f;
  f = createMotionFixture(t, {
    blockedStages: ['falling'],
    onMotion: message => code.update(message),
    onPlayback: value => playback.push(value),
    onSceneChange({ property, value }) {
      if (property !== 'cut' || value !== 'true' || transition || f?.scene.dataset.playback !== 'replay') return;
      let resolve;
      const finished = new Promise(accept => { resolve = accept; });
      transition = {
        playState: 'running', pauseCalls: 0, finishCalls: 0,
        effect: { getTiming: () => ({ iterations: 1 }) },
        finished,
        pause() { this.pauseCalls++; this.playState = 'paused'; },
        play() { this.playState = 'running'; },
        finish() { this.finishCalls++; this.playState = 'finished'; resolve(); },
        cancel() { this.playState = 'idle'; resolve(); },
      };
      // CSS can create parcel transitions only when the finished cut commits.
      // They remain discoverable across the following scene stage change.
      f.persistentAnimations.push(transition);
    },
  });
  const completed = completedRuntimeObservation();
  f.animator.update(completed);
  f.stepButton.click();
  await settle();
  f.stepButton.click();
  await settle();
  assert.equal(code.state().phase, 'tool');
  assert.equal(transition.playState, 'paused');
  assert.equal(transition.pauseCalls, 1);
  assert.equal(transition.finishCalls, 0, 'The post-commit transition appeared after the original cut finished');
  f.stepButton.click();
  await settle();
  assert.equal(transition.finishCalls, 1, 'Next must finish old transitions even though the current cue had completed');
  assert.equal(f.scene.dataset.motion, 'falling');
  f.pending[0].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'down');
  assert.equal(code.state().phase, 'crash');
  assert.equal(playback.at(-1).stepping, false, 'A resolved fall cannot remain stuck awaiting the previous paused parcel transition');
  assert.equal(playback.at(-1).paused, true);
  assert.equal(isUnavailable(f.stepButton), false);
  f.pauseButton.click();
  await settle();
});

test('Step through events starts a clearly labeled recorded replay and holds its very first event', async t => {
  const code = createMissionCodeModel();
  const messages = [];
  const playback = [];
  const f = createMotionFixture(t, {
    blockedStages: ['blocking-before'],
    onMotion(message) { messages.push(message); code.update(message); },
    onPlayback: value => playback.push(value),
  });
  const completed = completedRuntimeObservation();
  f.animator.update(completed);
  assert.equal(f.stepButton.textContent, 'Step through events');
  assert.equal(isUnavailable(f.stepButton), false);
  assert.equal(code.state().phase, 'after');
  f.stepButton.click();
  await settle();
  assert.equal(f.scene.dataset.motion, 'blocking-before');
  assert.equal(code.state().phase, 'before');
  assert.equal(code.state().mode, 'replay');
  assert.match(f.readout.textContent, /^Replay of observed events/);
  assert.equal(f.receipts.children[0].dataset.playback, 'replay');
  f.pending[0].resolve();
  await settle();
  f.animator.update(completed);
  assert.equal(f.scene.dataset.motion, 'blocking-before');
  assert.equal(playback.at(-1).activeCueKey, 'parcel-first:4:knife-denied-before');
  assert.equal(playback.at(-1).paused, true);
  assert.equal(playback.at(-1).stepping, false);
  assert.deepEqual(messages.filter(message => message.type === 'cue').map(message => message.cue.stage), ['blocking-before']);
  assert.equal(code.state().proof.policyDenial.startIndex, 31);
  f.pauseButton.click();
  await settle();
});

test('pausing before new evidence queues it without starting a cue and waits honestly when the queue runs dry', async t => {
  const code = createMissionCodeModel();
  const messages = [];
  const playback = [];
  const f = createMotionFixture(t, {
    onMotion(message) { messages.push(message); code.update(message); },
    onPlayback: value => playback.push(value),
  });
  f.animator.update(observation());
  f.pauseButton.click();
  assert.equal(isUnavailable(f.stepButton), true);
  assert.equal(playback.at(-1).waiting, true);
  const cut = completedRuntimeObservation().state.events.find(event => event.kind === 'effect-observed');
  const cutOnly = observation({ events: [cut], cut: true });
  f.animator.update(cutOnly);
  await settle();
  assert.equal(messages.some(message => message.type === 'cue'), false);
  assert.equal(f.scene.dataset.cut, 'false');
  assert.equal(isUnavailable(f.stepButton), false);
  assert.equal(playback.at(-1).waiting, false);
  f.stepButton.click();
  await settle();
  assert.equal(f.scene.dataset.cut, 'true');
  assert.equal(code.state().phase, 'tool');
  assert.equal(isUnavailable(f.stepButton), true);
  assert.equal(playback.at(-1).waiting, true);
  assert.match(f.playbackStatus.textContent, /Waiting for the next observed event/);
  assert.equal(messages.some(message => message.type === 'settled'), false);
  const crash = completedRuntimeObservation().state.events.find(event => event.kind === 'crash');
  f.animator.update(observation({ status: 'crashed', phase: 'killed', events: [cut, crash], cut: true }));
  await settle();
  assert.equal(f.scene.dataset.motion, 'cutting');
  assert.equal(code.state().phase, 'tool');
  assert.equal(isUnavailable(f.stepButton), false);
  f.stepButton.click();
  await settle();
  assert.equal(f.scene.dataset.motion, 'down');
  assert.equal(code.state().phase, 'crash');
  assert.equal(playback.at(-1).activeCueKey, 'parcel-first:6:crash');
  assert.equal(isUnavailable(f.stepButton), true);
  f.pauseButton.click();
  await settle();
});

test('reduced motion still advances one observed cue per step instead of draining the completed snapshot', async t => {
  const messages = [];
  const code = createMissionCodeModel();
  const f = createMotionFixture(t, {
    reducedMotion: true,
    blockedStages: ['blocking-before', 'cutting', 'falling', 'rising', 'sealing', 'blocking-after'],
    onMotion(message) { messages.push(message); code.update(message); },
  });
  f.animator.update(completedRuntimeObservation());
  f.stepButton.click();
  await settle();
  assert.equal(code.state().phase, 'before');
  assert.equal(messages.filter(message => message.type === 'cue').length, 1);
  assert.equal(f.finishedReads, 0);
  f.stepButton.click();
  await settle();
  assert.equal(code.state().phase, 'tool');
  assert.equal(messages.filter(message => message.type === 'cue').length, 2);
  assert.equal(f.finishedReads, 0);
  f.stepButton.click();
  await settle();
  assert.equal(code.state().phase, 'crash');
  assert.equal(messages.filter(message => message.type === 'cue').length, 3);
  assert.equal(f.scene.dataset.sealed, 'false');
  f.pauseButton.click();
  await settle();
  assert.equal(f.scene.dataset.motion, 'done');
});

test('the source-panel playback controls mirror the scene controls and use the same single cue gate', async t => {
  const messages = [];
  const f = createMotionFixture(t, { mirroredControls: true, onMotion: message => messages.push(message) });
  f.animator.update(completedRuntimeObservation());
  assert.equal(f.secondaryStepButton.textContent, f.stepButton.textContent);
  assert.equal(isUnavailable(f.secondaryStepButton), isUnavailable(f.stepButton));
  f.secondaryStepButton.click();
  await settle();
  assert.equal(f.pauseButton.textContent, 'Resume animation');
  assert.equal(f.secondaryPauseButton.textContent, f.pauseButton.textContent);
  assert.equal(f.secondaryPauseButton.attributes.get('aria-pressed'), 'true');
  assert.equal(messages.filter(message => message.type === 'cue').length, 1);
  f.secondaryStepButton.click();
  await settle();
  assert.equal(messages.filter(message => message.type === 'cue').length, 2);
  assert.equal(isUnavailable(f.secondaryStepButton), isUnavailable(f.stepButton));
  f.secondaryPauseButton.click();
  await settle();
  assert.equal(f.pauseButton.textContent, 'Pause animation');
  assert.equal(f.secondaryPauseButton.textContent, f.pauseButton.textContent);
  assert.equal(f.scene.dataset.motion, 'done');
});

test('Next remains keyboard focused while aria-disabled guards a busy step and ignores rapid repeated clicks', async t => {
  const messages = [];
  const f = createMotionFixture(t, {
    mirroredControls: true,
    blockedStages: ['blocking-before'],
    onMotion: message => messages.push(message),
  });
  f.animator.update(completedRuntimeObservation());
  f.secondaryStepButton.focus();
  f.secondaryStepButton.click();
  assert.equal(f.secondaryStepButton.disabled, false, 'Temporary playback busy state must not disable the focused native button');
  assert.equal(f.stepButton.disabled, false);
  assert.equal(f.secondaryStepButton.getAttribute('aria-disabled'), 'true');
  assert.equal(f.stepButton.getAttribute('aria-disabled'), 'true');
  assert.equal(globalThis.document.activeElement, f.secondaryStepButton);
  f.secondaryStepButton.click();
  f.stepButton.click();
  f.secondaryStepButton.click();
  await settle();
  assert.equal(messages.filter(message => message.type === 'cue').length, 1);
  assert.equal(f.pending.length, 1);
  assert.equal(globalThis.document.activeElement, f.secondaryStepButton);
  f.pending[0].resolve();
  await settle();
  assert.equal(f.secondaryStepButton.getAttribute('aria-disabled'), 'false');
  assert.equal(f.stepButton.getAttribute('aria-disabled'), 'false');
  assert.equal(globalThis.document.activeElement, f.secondaryStepButton);
  f.secondaryStepButton.click();
  await settle();
  assert.equal(messages.filter(message => message.type === 'cue').length, 2);
  assert.equal(globalThis.document.activeElement, f.secondaryStepButton);
  f.pauseButton.click();
  await settle();
});

test('the final stepped event holds its end pose and offers Replay instead of claiming to wait for more evidence', async t => {
  const code = createMissionCodeModel();
  const playback = [];
  const f = createMotionFixture(t, {
    onMotion: message => code.update(message),
    onPlayback: value => playback.push(value),
  });
  const completed = completedRuntimeObservation();
  f.animator.update(completed);
  for (let cue = 0; cue < 7; cue++) {
    f.stepButton.click();
    await settle();
  }
  f.animator.update(completed);
  assert.equal(f.scene.dataset.motion, 'done');
  assert.equal(code.state().phase, 'after');
  assert.equal(playback.at(-1).activeCueKey, 'parcel-first:13:complete');
  assert.equal(playback.at(-1).paused, true);
  assert.equal(playback.at(-1).waiting, false);
  assert.equal(isUnavailable(f.stepButton), true);
  assert.equal(f.replayButton.disabled, false);
  assert.match(f.playbackStatus.textContent, /End of observed mission/);
  assert.doesNotMatch(f.playbackStatus.textContent, /Waiting/);
  assert.equal(f.receipts.children.length, 7);

  f.blocked.add('cutting');
  f.replayButton.click();
  await settle();
  assert.equal(f.scene.dataset.motion, 'cutting');
  assert.equal(playback.at(-1).paused, false, 'Explicit Replay restarts automatic recorded playback');
  assert.equal(f.replayButton.disabled, true, 'An active automatic replay cannot be started twice');
  assert.match(f.readout.textContent, /^Replay of observed events/);
  assert.equal(code.state().phase, 'tool');
  assert.equal(code.state().mode, 'replay');
  f.pending[0].resolve();
  await settle();
  assert.equal(f.scene.dataset.motion, 'done');
  assert.equal(f.receipts.children.length, 7);
});

for (const reset of ['new-run', 'failure', 'archive', 'unavailable']) {
  test(`${reset} cancels a paused cue and cannot release old queued events into the reset scene`, async t => {
    const messages = [];
    const playback = [];
    const f = createMotionFixture(t, {
      blockedStages: ['cutting'],
      onMotion: message => messages.push(message),
      onPlayback: value => playback.push(value),
    });
    f.animator.update(observation());
    const cutAndCrash = completedRuntimeObservation().state.events.filter(event => ['effect-observed', 'crash'].includes(event.kind));
    f.animator.update(observation({ status: 'crashed', phase: 'killed', events: cutAndCrash, cut: true }));
    f.pauseButton.click();
    const options = reset === 'new-run' ? observation({ runId: 'parcel-next' })
      : reset === 'failure' ? observation({ status: 'failed', phase: 'failed', events: cutAndCrash })
      : reset === 'archive' ? observation({ archived: true, status: 'completed', verified: true, sealed: true, cut: true, events: observedEvents })
      : { state: { runtime: 'local' }, mission: null };
    f.animator.update(options);
    await settle();
    assert.equal(f.pending[0].cancelled, true);
    assert.equal(f.enteredStages.includes('falling'), false);
    assert.equal(playback.at(-1).activeCueKey, null);
    assert.equal(playback.at(-1).stepping, false);
    assert.equal(playback.at(-1).paused, true, 'Pause preference survives a reset');
    assert.equal(messages.filter(message => message.type === 'cue').length, 1);
    if (reset !== 'new-run') assert.equal(f.pauseButton.disabled, true);
    assert.equal(isUnavailable(f.stepButton), true);
    assert.equal(f.playbackGroup.hidden, reset === 'unavailable');
  });
}
