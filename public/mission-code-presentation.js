const phaseLabels = Object.freeze({
  before: 'Before crash · original cable request',
  tool: 'Tool in flight · append observed, result pending',
  crash: 'Server killed · tool call still unfinished',
  recovery: 'Server restarted · recover the original invocation',
  finish: 'Tool completed · the waiting agent continues',
  after: 'After recovery · fresh cable request',
});

const runtimeTitles = Object.freeze({
  tool: 'The tool is waiting to return',
  crash: 'Kill the server in the middle of the call',
  recovery: 'Recover with the same invocation key',
  finish: 'Continue after the suspended await',
});

/** Associates observed evidence with explanatory source; it is independent of playback. */
export function missionCodePresentation({ state, bundle, playback }) {
  const policy = !state.phase || ['before', 'after'].includes(state.phase);
  const source = policy ? bundle.policy : bundle.runtime[state.phase];
  const followsPlayback = state.following !== false && typeof state.proof?.key === 'string'
    && state.proof.key === playback?.activeCueKey;
  const playbackMode = followsPlayback ? playback.stepping ? 'stepping' : playback.paused ? 'paused' : 'playing' : 'idle';
  const base = { source, policy, playback: playbackMode, identity: '', title: policy ? 'The policy that stops the knife' : runtimeTitles[state.phase] };
  if (!state.proof) return {
    ...base,
    status: 'Source preview · waiting for observed runtime events',
    proof: 'Run a mission to follow the policy, unfinished tool, crash, and recovery in code.',
    explanation: 'Source highlights follow each observed animation cue. Only the parcel target is allowed; the cable must remain protected.',
  };

  const cue = state.proof;
  const event = state.mode === 'replay' ? 'replayed event' : 'observed event';
  const mode = playbackMode === 'paused' ? `Paused on ${event}`
    : playbackMode === 'stepping' ? `Stepping through ${event}`
    : state.mode === 'replay' ? 'Replaying observed event'
    : state.mode === 'live' ? 'Observed event playing'
    : state.mode === 'inspect' ? 'Inspecting observed event' : 'Observed event';
  const status = `${mode} · ${phaseLabels[state.phase]}`;
  if (policy) {
    const denial = cue.policyDenial;
    return {
      ...base, status,
      proof: `Event ${cue.id} · Golem oplog ${denial.startIndex} → ${denial.endIndex} · target: ${denial.target}`,
      explanation: `The guard at ${source.filename}:${source.focusLines[0]}–${source.focusLines.at(-1)} rejects this cable request. Line ${source.unreachedLine}, underlying.knife(args), is skipped.${state.phase === 'after' ? ' This is a fresh request after recovery.' : ''}`,
    };
  }

  const evidence = cue.runtimeEvidence;
  const identity = `Original invocation key: ${evidence.invocationKey}`;
  const descriptions = {
    tool: {
      proof: `Event ${cue.id} · knife Start ${evidence.toolStartIndex} · post-append marker ${evidence.markerIndex} · no matching End`,
      explanation: 'At this event, the append had happened and the tool was waiting. Its recorded Start had no matching End: the call had not returned when the harness killed the server.',
    },
    crash: {
      proof: `Event ${cue.id} · SIGKILL confirmed · PID ${evidence.oldPid} · knife Start ${evidence.toolStartIndex} unfinished`,
      explanation: 'At this event, the harness confirmed that the whole Golem server exited on SIGKILL. The original tool call remained unfinished in the saved runtime data. Recovery uses that data and the original invocation key.',
    },
    recovery: {
      proof: `Event ${cue.id} · server PID ${evidence.oldPid} → ${evidence.newPid} · original knife Start ${evidence.toolStartIndex}`,
      explanation: 'The replacement server uses the same data directory. The harness invokes run with the original invocation key, reconnecting to the unfinished work. At this event, the tool result was still pending.',
    },
    finish: {
      proof: `Event ${cue.id} · original knife Start ${evidence.toolStartIndex} → matching End ${evidence.toolEndIndex} · one logical call`,
      explanation: 'The recovered tool has one End linked to its original Start. Its receipt resolves the agent’s await; execution continues by reading the cable and sealing the parcel. The verified final ledger contains one cut.',
    },
  };
  return { ...base, status, identity, ...descriptions[state.phase] };
}
