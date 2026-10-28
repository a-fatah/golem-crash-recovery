const denialStages = Object.freeze({
  'knife-denied-before': { phase: 'before', method: 'run', stage: 'blocking-before' },
  'knife-denied-after': { phase: 'after', method: 'probePolicy', stage: 'blocking-after' },
});

/** A blocked swing needs a matching protected-target middleware terminal in the oplog. */
export function policyDenialStage(event) {
  const expected = Object.hasOwn(denialStages, event?.kind) ? denialStages[event.kind] : null;
  const proof = event?.policyDenial;
  if (!expected || !proof || proof.boundary !== 'tool-target'
    || proof.target !== '/protected/safety-cable.txt' || proof.denied !== true
    || proof.phase !== expected.phase || proof.method !== expected.method
    || !Number.isSafeInteger(proof.startIndex) || proof.startIndex < 0
    || !Number.isSafeInteger(proof.endIndex) || proof.endIndex <= proof.startIndex
    || typeof proof.error !== 'string' || !proof.error.trim()) return null;
  return expected.stage;
}

/** A source phase additionally has to match the animator's selected denial stage. */
export function policyCodePhase(cue) {
  const stage = policyDenialStage({ kind: cue?.eventKind, policyDenial: cue?.policyDenial });
  return stage && stage === cue?.stage ? cue.policyDenial.phase : null;
}
