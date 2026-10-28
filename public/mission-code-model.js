import { createCodeSelectionModel } from './mission-code-selection.js';
import { policyCodePhase } from './mission-policy-cues.js';

/** Keeps the original policy-only import and state contract available. */
export function createPolicyCodeModel() {
  return createCodeSelectionModel({ phases: ['before', 'after'], phaseForCue: policyCodePhase });
}
