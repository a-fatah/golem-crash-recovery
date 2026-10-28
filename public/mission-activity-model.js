const phases = Object.freeze({
  starting: { kind: 'preparing', title: 'Starting Golem', detail: 'The server is warming up. This can take a moment.' },
  deploying: { kind: 'preparing', title: 'Preparing the parcel agent', detail: 'Installing its tool and policy rules.' },
  invoking: { kind: 'preparing', title: 'Waiting for the tool', detail: 'Checking policy and watching for the cut marker.' },
  restarting: { kind: 'restarting', title: 'Restarting Golem', detail: 'Opening the saved runtime data. The call is still unfinished.' },
  restarted: { kind: 'recovering', title: 'Recovering the unfinished call', detail: 'Waiting for its result before checking the parcel.' },
  recovered: { kind: 'checking', title: 'Checking the result', detail: 'Verifying the parcel and fresh policy denials.' },
  'knife-denied-after': { kind: 'checking', title: 'Checking the result', detail: 'Verifying the parcel and fresh policy denials.' },
  'policy-verified': { kind: 'checking', title: 'Checking the result', detail: 'Verifying the final files and recovered invocation.' },
  verified: { kind: 'checking', title: 'Finishing verification', detail: 'Waiting for the runtime to finish the run.' },
});

/** Waiting feedback describes current work, never a completed mission event. */
export function missionActivityState({ state = null, mission = null, pendingAction = null, disconnected = false, activeCue = false, playback = {} } = {}) {
  let activity;
  if (disconnected) {
    return { kind: 'unavailable', title: 'Connection interrupted', detail: 'Retrying automatically. The mission may still be running.', animate: false };
  }
  if (pendingAction === 'start' || pendingAction === 'resume') {
    activity = pendingAction === 'resume'
      ? { kind: 'restarting', title: 'Resuming the mission', detail: 'Contacting the runtime to recover the unfinished call.' }
      : { kind: 'preparing', title: 'Starting the mission', detail: 'Contacting the Golem runtime…' };
  } else if (!state) {
    activity = { kind: 'connecting', title: 'Connecting to the demo', detail: 'Reading the Golem runtime state…' };
  } else {
    if (state.runtime !== 'golem' || mission?.recorded || state.status !== 'running' || activeCue) return null;
    activity = phases[state.golem?.phase]
      ?? { kind: 'preparing', title: 'Preparing the mission', detail: 'Waiting for the next runtime observation.' };
  }
  return { ...activity, animate: playback.paused !== true && playback.stepping !== true };
}
