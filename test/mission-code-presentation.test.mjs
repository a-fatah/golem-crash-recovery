import assert from 'node:assert/strict';
import test from 'node:test';
import { missionCodePresentation } from '../public/mission-code-presentation.js';

const bundle = {
  policy: { filename: 'src/knife-policy.ts', focusLines: [8, 9, 10, 11, 12], unreachedLine: 15 },
  runtime: {
    tool: { filename: 'src/knife-tool.ts' },
    crash: { filename: 'scripts/verify.mjs' },
    recovery: { filename: 'scripts/verify.mjs' },
    finish: { filename: 'src/parcel-agent-implementation.ts' },
  },
};

function runtimeState(phase, { mode = 'live', following = true } = {}) {
  const id = { tool: 5, crash: 6, recovery: 7, finish: 8 }[phase];
  const eventKind = { tool: 'effect-observed', crash: 'crash', recovery: 'restarted', finish: 'replay' }[phase];
  return {
    phase, mode, following,
    proof: {
      id, key: `parcel-presentation:${id}:${eventKind}`,
      runtimeEvidence: {
        invocationKey: 'parcel-presentation', toolStartIndex: 86, markerIndex: 118,
        oldPid: 64001, newPid: 64002,
        ...(phase === 'finish' ? { toolEndIndex: 149 } : {}),
      },
    },
  };
}

test('the preview describes source without displaying invented process or oplog evidence', () => {
  const content = missionCodePresentation({ state: { phase: null, proof: null, mode: 'preview' }, bundle });
  assert.equal(content.source, bundle.policy);
  assert.equal(content.source.filename, 'src/knife-policy.ts');
  assert.equal(content.policy, true);
  assert.equal(content.identity, '');
  assert.match(content.status, /Source preview/);
  assert.match(content.proof, /Run a mission/);
  assert.doesNotMatch(content.proof, /Start \d|End \d|PID \d|oplog \d/);
});

test('the tool source distinguishes the observed append marker from a completed tool result', () => {
  const content = missionCodePresentation({ state: runtimeState('tool'), bundle });
  assert.equal(content.source, bundle.runtime.tool);
  assert.equal(content.source.filename, 'src/knife-tool.ts');
  assert.equal(content.policy, false);
  assert.equal(content.identity, 'Original invocation key: parcel-presentation');
  assert.match(content.proof, /knife Start 86/);
  assert.match(content.proof, /post-append marker 118/);
  assert.match(content.proof, /no matching End/);
  assert.match(content.explanation, /At this event/);
  assert.match(content.explanation, /call had not returned/);
  assert.doesNotMatch(content.explanation, /call has not returned/);
  assert.doesNotMatch(content.explanation, /one cut|parcel sealed/);
});

test('the crash source shows the confirmed server kill and a still-unfinished original tool start', () => {
  const content = missionCodePresentation({ state: runtimeState('crash'), bundle });
  assert.equal(content.source, bundle.runtime.crash);
  assert.equal(content.source.filename, 'scripts/verify.mjs');
  assert.match(content.proof, /SIGKILL confirmed · PID 64001/);
  assert.match(content.proof, /knife Start 86 unfinished/);
  assert.match(content.explanation, /whole Golem server exited/);
  assert.match(content.explanation, /At this event.*confirmed/);
  assert.match(content.explanation, /original tool call remained unfinished/);
  assert.match(content.explanation, /Recovery uses that data and the original invocation key/);
  assert.doesNotMatch(content.explanation, /Choose Resume Golem|click.*resume|resume.*now/i);
});

test('the recovery source says the original invocation is pending rather than claiming a matching End', () => {
  const content = missionCodePresentation({ state: runtimeState('recovery'), bundle });
  assert.equal(content.source, bundle.runtime.recovery);
  assert.equal(content.source.filename, 'scripts/verify.mjs');
  assert.match(content.title, /same invocation key/);
  assert.match(content.proof, /server PID 64001 → 64002/);
  assert.match(content.proof, /original knife Start 86/);
  assert.match(content.explanation, /same data directory/);
  assert.match(content.explanation, /original invocation key/);
  assert.match(content.explanation, /At this event, the tool result was still pending/);
  assert.doesNotMatch(content.explanation, /tool result is still pending/);
  assert.doesNotMatch(content.proof, /matching End|one logical call|sealed/);
  assert.doesNotMatch(content.explanation, /one cut|has one End|verified final ledger/);
});

test('the finish source shows the original matching End and explains continuation after the await', () => {
  const content = missionCodePresentation({ state: runtimeState('finish'), bundle });
  assert.equal(content.source, bundle.runtime.finish);
  assert.equal(content.source.filename, 'src/parcel-agent-implementation.ts');
  assert.match(content.title, /suspended await/);
  assert.match(content.proof, /original knife Start 86 → matching End 149/);
  assert.match(content.proof, /one logical call/);
  assert.match(content.explanation, /receipt resolves the agent’s await/);
  assert.match(content.explanation, /sealing the parcel/);
  assert.match(content.explanation, /verified final ledger contains one cut/);
  assert.doesNotMatch(content.explanation, /still pending/);
});

test('both policy phases reference the same guard and distinguish a fresh post-recovery request', () => {
  for (const phase of ['before', 'after']) {
    const content = missionCodePresentation({ state: {
      phase, mode: 'live', proof: {
        id: phase === 'before' ? 4 : 11,
        policyDenial: { startIndex: phase === 'before' ? 31 : 189, endIndex: phase === 'before' ? 55 : 213, target: '/protected/safety-cable.txt' },
      },
    }, bundle });
    assert.equal(content.source, bundle.policy);
    assert.match(content.explanation, /src\/knife-policy\.ts:8–12/);
    assert.match(content.explanation, /Line 15, underlying\.knife\(args\), is skipped/);
    assert.equal(content.policy, true);
    assert.equal(content.identity, '');
    assert.equal(content.explanation.includes('fresh request after recovery'), phase === 'after');
  }
});

test('presentation labels observed playback and manual inspection without changing the saved source proof', () => {
  const modes = { replay: 'Replaying observed event', live: 'Observed event playing', inspect: 'Inspecting observed event', observed: 'Observed event' };
  for (const [mode, label] of Object.entries(modes)) {
    const content = missionCodePresentation({ state: runtimeState('recovery', { mode }), bundle });
    assert.equal(content.status, `${label} · Server restarted · recover the original invocation`);
    assert.equal(content.source, bundle.runtime.recovery);
    assert.match(content.proof, /PID 64001 → 64002/);
    assert.equal(content.identity, 'Original invocation key: parcel-presentation');
  }
});

test('pause and step labels follow the matching observed or replayed event without changing source evidence', () => {
  for (const mode of ['live', 'replay']) {
    const state = runtimeState('recovery', { mode });
    const baseline = missionCodePresentation({ state, bundle });
    const eventLabel = mode === 'replay' ? 'replayed event' : 'observed event';
    for (const [playback, expected, label] of [
      [{ paused: true, stepping: false }, 'paused', `Paused on ${eventLabel}`],
      [{ paused: true, stepping: true }, 'stepping', `Stepping through ${eventLabel}`],
      [{ paused: false, stepping: false }, 'playing', mode === 'replay' ? 'Replaying observed event' : 'Observed event playing'],
    ]) {
      const content = missionCodePresentation({ state, bundle, playback: { ...playback, activeCueKey: state.proof.key } });
      assert.equal(content.playback, expected);
      assert.equal(content.status, `${label} · Server restarted · recover the original invocation`);
      assert.equal(content.source, baseline.source);
      assert.equal(content.proof, baseline.proof);
      assert.equal(content.identity, baseline.identity);
      assert.equal(content.explanation, baseline.explanation);
      assert.match(content.explanation, /At this event.*was still pending/);
    }
  }
});

test('manual inspection and a different active cue cannot borrow playback pause or step labels', () => {
  for (const state of [runtimeState('crash', { mode: 'inspect', following: false }), runtimeState('crash')]) {
    const baseline = missionCodePresentation({ state, bundle });
    const playback = {
      activeCueKey: state.following ? 'parcel-presentation:7:restarted' : state.proof.key,
      paused: true, stepping: true,
    };
    const content = missionCodePresentation({ state, bundle, playback });
    assert.equal(content.playback, 'idle');
    assert.equal(content.status, baseline.status);
    assert.equal(content.proof, baseline.proof);
    assert.doesNotMatch(content.status, /Paused|Stepping/);
  }
});

test('preview and unkeyed legacy evidence cannot claim an active playback cursor', () => {
  const state = runtimeState('tool');
  delete state.proof.key;
  const legacy = missionCodePresentation({ state, bundle, playback: { paused: true } });
  assert.equal(legacy.playback, 'idle');
  assert.doesNotMatch(legacy.status, /Paused|Stepping/);
  const preview = missionCodePresentation({
    state: { phase: null, proof: null, mode: 'preview' }, bundle,
    playback: { activeCueKey: 'parcel-presentation:5:effect-observed', paused: true },
  });
  assert.equal(preview.playback, 'idle');
  assert.match(preview.status, /Source preview/);
});
