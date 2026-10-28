import { policyDenialStage } from './mission-policy-cues.js';
import { runtimeCodePhase } from './mission-runtime-cues.js';

const cueStages = Object.freeze({
  "effect-observed": "cutting",
  crash: "falling",
  restarted: "rising",
  replay: "sealing",
  complete: "done",
});

/** Projects recorded runtime events into motion; it never invents execution evidence. */
export function missionMotionSnapshot({ state, mission }) {
  if (state?.runtime !== "golem" || !mission) return null;

  const archived = mission.recorded === true;
  const phase = state.golem?.phase;
  let pose = "ready";
  if (state.status === "failed") pose = "failed";
  else if (state.status === "completed") {
    pose = mission.success === true ? "done" : mission.sealed === true ? "finishing" : "ready";
  } else if (state.status === "crashed" || (state.status === "running" && phase === "restarting")) pose = "down";
  else if (state.status === "running" && ["restarted", "recovered", "policy-verified", "verified"].includes(phase)) {
    pose = "finishing";
  } else if (state.status === "running" && phase === "invoking") pose = "preparing";

  const cues = archived ? [] : (Array.isArray(state.events) ? state.events : [])
    .map(event => ({ ...event, stage: Object.hasOwn(cueStages, event?.kind) ? cueStages[event.kind] : policyDenialStage(event) }))
    .filter((event) => {
      if (!Number.isFinite(event?.id) || !event.stage) return false;
      if (event.kind === "replay" && mission.sealed !== true) return false;
      if (event.kind === "complete" && mission.success !== true) return false;
      return true;
    })
    .sort((left, right) => left.id - right.id)
    .map((event) => {
      const cue = {
        id: event.id,
        key: `${state.runId}:${event.id}:${event.kind}`,
        stage: event.stage,
        eventKind: event.kind,
        ...(policyDenialStage(event) ? { policyDenial: event.policyDenial } : {}),
        ...(event.runtimeEvidence ? { runtimeEvidence: event.runtimeEvidence } : {}),
      };
      if (!runtimeCodePhase(cue, { runId: state.runId })) delete cue.runtimeEvidence;
      return cue;
    });

  return {
    runId: state.runId,
    archived,
    status: state.status,
    cut: mission.cut,
    sealed: mission.sealed,
    verified: mission.success,
    cues,
    pose,
  };
}
