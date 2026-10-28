/** Page lifecycle: poll host state and dispatch explicit user actions. */
import { readState, runAction } from "./api-client.js";
import { bindActions, renderDisconnected, renderError, renderState } from "./dashboard-view.js";
import { localRuntimeCopy } from "./local-runtime-copy.js";
import { golemRuntimeCopy } from "./golem-runtime-copy.js";
import { createMissionAnimator } from "./mission-motion.js";
import { createMissionCodeView } from "./mission-code-view.js";
import { loadMissionCodeSource } from "./mission-code-source.js";
import { createMissionSceneView } from "./mission-scene-view.js";
import { createMissionActivityView } from "./mission-activity-view.js";

const missionCode = createMissionCodeView({ panel: document.getElementById("mission-code-panel") });
loadMissionCodeSource().then(source => missionCode.setSource(source)).catch(() => missionCode.unavailable());
const missionScene = createMissionSceneView({ scene: document.getElementById("mission-scene") });
const missionActivity = createMissionActivityView({ scene: document.getElementById("mission-scene") });

const missionAnimator = createMissionAnimator({
  scene: document.getElementById("mission-scene"),
  readout: document.getElementById("motion-readout"),
  receipts: document.getElementById("motion-event-receipts"),
  replayButton: document.getElementById("motion-replay"),
  pauseButton: document.getElementById("motion-pause"),
  stepButton: document.getElementById("motion-step"),
  pauseButtons: [document.getElementById("code-motion-pause")],
  stepButtons: [document.getElementById("code-motion-step")],
  playbackStatus: document.getElementById("motion-playback-status"),
  onMotion: message => { missionCode.update(message); missionScene.update(message); missionActivity.update(message); },
  onPlayback: value => { missionCode.setPlayback(value); missionScene.setPlayback(value); missionActivity.setPlayback(value); },
});

let currentState = null;
let busy = false;
let revision = 0;
let disconnected = false;
let pendingAction = null;
let pollTimer;

function schedulePoll() {
  window.clearTimeout(pollTimer);
  // Hosted idle tabs must not wake a sleeping Machine with background reads.
  if (currentState?.sleepWhenIdle && !['running', 'crashed'].includes(currentState.status)) return;
  pollTimer = window.setTimeout(poll, 550);
}

function displayState(state, options = {}) {
  const copy = state.runtime === "golem" ? golemRuntimeCopy(state) : localRuntimeCopy(state);
  renderState(state, { ...options, busy, copy });
  missionScene.setMission(copy.mission);
  missionAnimator.update({ state, mission: copy.mission });
  missionActivity.setRuntime({ state, mission: copy.mission, pendingAction, disconnected });
}

function acceptState(state) {
  const announce = !currentState || currentState.status !== state.status;
  currentState = state;
  displayState(state, { announce });
}

async function perform(action) {
  if (busy) return;
  busy = true;
  pendingAction = action;
  disconnected = false;
  revision += 1;
  renderError("");
  if (currentState) displayState(currentState);
  try {
    acceptState(await runAction(action));
  } catch (error) {
    renderError(error.message);
  } finally {
    busy = false;
    pendingAction = null;
    if (currentState) displayState(currentState);
    schedulePoll();
  }
}

async function poll() {
  const requestedRevision = revision;
  if (!busy) {
    try {
      const state = await readState();
      if (!busy && requestedRevision === revision) {
        if (disconnected) renderError("");
        disconnected = false;
        acceptState(state);
      }
    } catch (error) {
      if (!busy && requestedRevision === revision) {
        disconnected = true;
        renderDisconnected(error.message);
        missionActivity.setRuntime({ state: currentState, disconnected });
      }
    }
  }
  schedulePoll();
}

bindActions({
  primary: () => {
    const shouldResume = currentState?.status === "crashed"
      || (currentState?.status === "failed" && currentState.runtime !== "golem");
    perform(shouldResume ? "resume" : "start");
  },
  reset: () => perform("reset"),
  crash: () => perform("crash"),
});

window.addEventListener('focus', () => { window.clearTimeout(pollTimer); void poll(); });
window.addEventListener('pagehide', event => { if (!event.persisted) missionActivity.disconnect(); });
poll();
