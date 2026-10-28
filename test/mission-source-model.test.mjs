import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeCodePhase } from '../public/mission-runtime-cues.js';
import { createMissionCodeModel } from '../public/mission-source-model.js';

const runId = 'parcel-source-sync';
const phaseCases = [
  { phase: 'tool', id: 5, eventKind: 'effect-observed', stage: 'cutting', evidencePhase: 'in-flight' },
  { phase: 'crash', id: 6, eventKind: 'crash', stage: 'falling', evidencePhase: 'killed' },
  { phase: 'recovery', id: 8, eventKind: 'restarted', stage: 'rising', evidencePhase: 'restarted' },
  { phase: 'finish', id: 9, eventKind: 'replay', stage: 'sealing', evidencePhase: 'recovered' },
];

function runtimeCue(phase = 'tool', { proof = {}, cue = {}, missionId = runId } = {}) {
  const descriptor = phaseCases.find(item => item.phase === phase);
  return {
    id: descriptor.id,
    key: `${missionId}:${descriptor.id}:${descriptor.eventKind}`,
    eventKind: descriptor.eventKind,
    stage: descriptor.stage,
    runtimeEvidence: {
      phase: descriptor.evidencePhase,
      invocationKey: missionId,
      agentId: `ParcelAgent(${JSON.stringify(missionId)})`,
      toolStartIndex: 86,
      markerIndex: 118,
      matchingToolEnds: phase === 'finish' ? 1 : 0,
      oldPid: 64001,
      ...(phase === 'crash' ? { signal: 'SIGKILL' } : {}),
      ...(['recovery', 'finish'].includes(phase) ? { newPid: 64002 } : {}),
      ...(phase === 'finish' ? { toolEndIndex: 149 } : {}),
      ...proof,
    },
    ...cue,
  };
}

function policyCue(phase = 'before') {
  const id = phase === 'before' ? 4 : 11;
  return {
    id, key: `${runId}:${id}:knife-denied-${phase}`,
    eventKind: `knife-denied-${phase}`, stage: `blocking-${phase}`,
    policyDenial: {
      phase, boundary: 'tool-target', target: '/protected/safety-cable.txt',
      method: phase === 'before' ? 'run' : 'probePolicy',
      denied: true, error: 'Knife policy denies target: /protected/safety-cable.txt',
      startIndex: phase === 'before' ? 31 : 189, endIndex: phase === 'before' ? 55 : 213,
    },
  };
}

const emptyAvailable = { before: false, tool: false, crash: false, recovery: false, finish: false, after: false };
const allAvailable = Object.fromEntries(Object.keys(emptyAvailable).map(phase => [phase, true]));
const history = () => [policyCue(), ...phaseCases.map(({ phase }) => runtimeCue(phase)), policyCue('after')];
const snapshot = (options = {}) => ({ runId, status: 'running', archived: false, cues: [], ...options });
const observe = (model, options) => model.update({ type: 'snapshot', snapshot: snapshot(options) });
const animate = (model, cue, options = {}) => model.update({ type: 'cue', runId, cue, ...options });

test('each runtime source phase requires its matching event, pose, invocation and observed oplog evidence', () => {
  for (const { phase } of phaseCases) {
    assert.equal(runtimeCodePhase(runtimeCue(phase), { runId }), phase);
  }
  assert.equal(runtimeCodePhase(runtimeCue('tool', {
    proof: { toolStartIndex: 0, markerIndex: 1, oldPid: 1 },
  }), { runId }), 'tool', 'Index zero is a valid recorded tool start');
});

test('runtime proof rejects wrong mission identity, incomplete starts and generic event text', () => {
  const mutations = [
    { proof: { invocationKey: 'parcel-other' } },
    { proof: { agentId: 'ParcelAgent("parcel-other")' } },
    { proof: { phase: 'recovered' } },
    { proof: { toolStartIndex: -1 } },
    { proof: { toolStartIndex: 86.5 } },
    { proof: { toolStartIndex: Number.MAX_SAFE_INTEGER + 1 } },
    { proof: { markerIndex: 86 } },
    { proof: { markerIndex: 85 } },
    { proof: { markerIndex: 118.5 } },
    { proof: { matchingToolEnds: 1 } },
    { proof: { oldPid: 0 } },
    { proof: { oldPid: 64001.5 } },
    { cue: { runtimeEvidence: undefined } },
    { cue: { stage: 'falling' } },
    { cue: { key: `${runId}:5:crash` } },
    { cue: { id: 5.5, key: `${runId}:5.5:effect-observed` } },
    { cue: { id: undefined } },
    { missionId: 'parcel-other' },
  ];
  for (const mutation of mutations) {
    assert.equal(runtimeCodePhase(runtimeCue('tool', mutation), { runId }), null, JSON.stringify(mutation));
  }
  assert.equal(runtimeCodePhase({
    id: 5, key: `${runId}:5:effect-observed`, stage: 'cutting', eventKind: 'effect-observed',
    message: 'The tool started and is definitely unfinished',
  }, { runId }), null);
  assert.equal(runtimeCodePhase(runtimeCue(), { runId: undefined }), null);
});

test('crash source needs the confirmed SIGKILL while recovery needs a different positive server PID', () => {
  for (const signal of [undefined, 'SIGTERM', 'SIGKILL ', 9]) {
    assert.equal(runtimeCodePhase(runtimeCue('crash', { proof: { signal } }), { runId }), null);
  }
  for (const phase of ['recovery', 'finish']) {
    for (const newPid of [undefined, 0, -1, 64001, 64002.5]) {
      assert.equal(runtimeCodePhase(runtimeCue(phase, { proof: { newPid } }), { runId }), null);
    }
  }
  assert.equal(runtimeCodePhase(runtimeCue('recovery', { proof: { matchingToolEnds: 1 } }), { runId }), null,
    'A ready replacement server does not prove that the interrupted tool finished');
});

test('finish source requires exactly one matching tool terminal strictly after the recorded marker', () => {
  for (const matchingToolEnds of [undefined, 0, 2, '1']) {
    assert.equal(runtimeCodePhase(runtimeCue('finish', { proof: { matchingToolEnds } }), { runId }), null);
  }
  for (const toolEndIndex of [undefined, 0, 117, 118, 149.5]) {
    assert.equal(runtimeCodePhase(runtimeCue('finish', { proof: { toolEndIndex } }), { runId }), null);
  }
  assert.equal(runtimeCodePhase(runtimeCue('finish'), { runId }), 'finish');
});

test('the combined source model starts with six unavailable evidence phases', () => {
  const model = createMissionCodeModel();
  observe(model);
  assert.deepEqual(model.state(), {
    runId, phase: null, proof: null, mode: 'preview', active: false,
    following: true, available: emptyAvailable,
  });
  for (const phase of Object.keys(emptyAvailable)) model.select(phase);
  assert.equal(model.state().phase, null, 'Manual tabs cannot invent runtime or policy evidence');
});

test('the full policy, cut, crash, recovery, finish and policy sequence follows animation instead of future polls', () => {
  const model = createMissionCodeModel();
  const cues = history();
  const phases = Object.keys(emptyAvailable);
  observe(model);
  observe(model, { status: 'completed', cues: [...cues].reverse() });
  assert.deepEqual(model.state().available, allAvailable);
  assert.equal(model.state().phase, null);
  for (const [index, cue] of cues.entries()) {
    animate(model, cue);
    assert.equal(model.state().phase, phases[index]);
    assert.equal(model.state().proof.key, cue.key);
    assert.equal(model.state().mode, 'live');
    assert.equal(model.state().active, true);
    observe(model, { status: 'completed', cues });
    assert.equal(model.state().phase, phases[index], 'A later poll cannot overtake the current animation');
    assert.equal(model.state().proof.key, cue.key);
  }
  animate(model, { id: 12, key: `${runId}:12:complete`, eventKind: 'complete', stage: 'done' });
  assert.equal(model.state().phase, 'after');
  assert.equal(model.state().active, false);
  assert.equal(model.state().mode, 'observed');
});

test('opening a completed or crashed run selects only its latest existing proof without lighting a replay', () => {
  const completed = createMissionCodeModel();
  observe(completed, { status: 'completed', cues: history().reverse() });
  assert.equal(completed.state().phase, 'after');
  assert.equal(completed.state().mode, 'observed');
  assert.equal(completed.state().active, false);

  const crashed = createMissionCodeModel();
  observe(crashed, { status: 'crashed', cues: history().slice(0, 3) });
  assert.equal(crashed.state().phase, 'crash');
  assert.equal(crashed.state().proof.runtimeEvidence.signal, 'SIGKILL');
  assert.deepEqual(crashed.state().available, { ...emptyAvailable, before: true, tool: true, crash: true });
  crashed.select('recovery');
  assert.equal(crashed.state().phase, 'crash');
});

test('manual inspection remains stable as runtime cues advance and following restores the current event', () => {
  const model = createMissionCodeModel();
  observe(model, { status: 'completed', cues: history() });
  animate(model, runtimeCue('tool'), { replay: true });
  model.select('before');
  animate(model, runtimeCue('crash'), { replay: true });
  observe(model, { status: 'completed', cues: history() });
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().mode, 'inspect');
  assert.equal(model.state().active, false);
  model.follow();
  assert.equal(model.state().phase, 'crash');
  assert.equal(model.state().mode, 'replay');
  assert.equal(model.state().proof.key, `${runId}:6:crash`);
  assert.equal(model.state().proof.runtimeEvidence.oldPid, 64001);
});

test('settling while inspecting never relights a runtime source when following resumes', () => {
  const model = createMissionCodeModel();
  observe(model, { status: 'completed', cues: history() });
  animate(model, runtimeCue('recovery'), { replay: true });
  model.select('tool');
  model.update({ type: 'settled', snapshot: snapshot({ status: 'completed' }) });
  model.follow();
  assert.equal(model.state().phase, 'recovery');
  assert.equal(model.state().mode, 'observed');
  assert.equal(model.state().active, false);
});

test('old unproved runtime cues can end a highlight but cannot populate runtime source phases', () => {
  const model = createMissionCodeModel();
  observe(model);
  animate(model, policyCue());
  for (const { phase } of phaseCases) {
    animate(model, runtimeCue(phase, { cue: { runtimeEvidence: undefined } }));
  }
  assert.equal(model.state().phase, 'before');
  assert.equal(model.state().active, false);
  assert.deepEqual(model.state().available, { ...emptyAvailable, before: true });
});

test('failure deactivates source and rejects later queued runtime or policy cues', () => {
  const model = createMissionCodeModel();
  observe(model);
  animate(model, runtimeCue('tool'));
  observe(model, { status: 'failed', cues: [runtimeCue('tool')] });
  const failed = structuredClone(model.state());
  animate(model, runtimeCue('recovery'));
  animate(model, policyCue('after'));
  assert.deepEqual(model.state(), failed);
  assert.equal(model.state().phase, 'tool');
  assert.equal(model.state().active, false);
});

test('new-run and archive boundaries discard source evidence and reject queued cues from the previous mission', () => {
  const model = createMissionCodeModel();
  observe(model, { status: 'completed', cues: history() });
  animate(model, runtimeCue('finish'), { replay: true });
  model.select('before');
  observe(model, { runId: 'parcel-next' });
  animate(model, runtimeCue('recovery'));
  assert.equal(model.state().runId, 'parcel-next');
  assert.deepEqual(model.state().available, emptyAvailable);
  assert.equal(model.state().phase, null);
  assert.equal(model.state().following, true);

  observe(model, { archived: true, status: 'completed', cues: history() });
  animate(model, runtimeCue('finish'), { replay: true });
  assert.deepEqual(model.state().available, emptyAvailable);
  assert.equal(model.state().phase, null);
  assert.equal(model.state().active, false);
});
