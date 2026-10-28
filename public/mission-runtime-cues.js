import { hasCurrentCueIdentity } from './mission-cue-identity.js';

const runtimePhases = Object.freeze({
  'effect-observed': { phase: 'tool', stage: 'cutting', evidencePhase: 'in-flight', matchingToolEnds: 0 },
  crash: { phase: 'crash', stage: 'falling', evidencePhase: 'killed', matchingToolEnds: 0 },
  restarted: { phase: 'recovery', stage: 'rising', evidencePhase: 'restarted', matchingToolEnds: 0 },
  replay: { phase: 'finish', stage: 'sealing', evidencePhase: 'recovered', matchingToolEnds: 1 },
});

const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

/** Runtime source activates only for the harness's structured oplog/process evidence. */
export function runtimeCodePhase(cue, { runId }) {
  if (!hasCurrentCueIdentity(cue, { runId })) return null;
  const expected = Object.hasOwn(runtimePhases, cue.eventKind) ? runtimePhases[cue.eventKind] : null;
  const proof = cue.runtimeEvidence;
  if (!expected || cue.stage !== expected.stage || !proof
    || proof.phase !== expected.evidencePhase
    || proof.invocationKey !== runId
    || proof.agentId !== `ParcelAgent(${JSON.stringify(runId)})`
    || !nonnegativeInteger(proof.toolStartIndex)
    || !nonnegativeInteger(proof.markerIndex) || proof.markerIndex <= proof.toolStartIndex
    || proof.matchingToolEnds !== expected.matchingToolEnds
    || !positiveInteger(proof.oldPid)) return null;
  if (expected.phase === 'crash' && proof.signal !== 'SIGKILL') return null;
  if (['recovery', 'finish'].includes(expected.phase)
    && (!positiveInteger(proof.newPid) || proof.newPid === proof.oldPid)) return null;
  if (expected.phase === 'finish'
    && (!nonnegativeInteger(proof.toolEndIndex) || proof.toolEndIndex <= proof.markerIndex)) return null;
  return expected.phase;
}
