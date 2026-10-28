import { policyCodePhase } from './mission-policy-cues.js';
import { createCodeSelectionModel } from './mission-code-selection.js';
import { runtimeCodePhase } from './mission-runtime-cues.js';

/** One selection timeline composes the policy and runtime evidence contracts. */
export function createMissionCodeModel() {
  return createCodeSelectionModel({
    phases: ['before', 'tool', 'crash', 'recovery', 'finish', 'after'],
    phaseForCue: (cue, options) => policyCodePhase(cue) ?? runtimeCodePhase(cue, options),
  });
}
