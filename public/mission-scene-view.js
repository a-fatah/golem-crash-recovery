import { hasCurrentCueIdentity } from './mission-cue-identity.js';
import { missionSceneCopy } from './mission-scene-copy.js';

/** Keeps scene-local captions at the animation cursor while runtime facts remain live. */
export function createMissionSceneView({ scene }) {
  const nodes = {
    courier: scene.querySelector('#courier-caption'),
    parcelCaption: scene.querySelector('#parcel-caption'),
    houseCaption: scene.querySelector('#house-caption'),
    banner: scene.querySelector('#scene-status'),
  };
  let mission = null;
  let snapshot = null;
  let cursor = null;
  let paused = false;
  let heldBaseline = null;

  function captureBaseline() {
    if (mission && snapshot && !snapshot.archived && snapshot.status !== 'failed') {
      heldBaseline = missionSceneCopy({ mission });
    }
  }

  function render() {
    if (!mission) return;
    const copy = heldBaseline ?? missionSceneCopy({ mission, cue: cursor });
    if (!copy) return;
    scene.dataset.scene = copy.scene;
    for (const [field, node] of Object.entries(nodes)) node.textContent = copy[field] ?? '';
    nodes.banner.hidden = !copy.banner;
  }

  return {
    setMission(value) {
      mission = value;
      if (!mission) heldBaseline = null;
      render();
    },
    setPlayback(playback) {
      paused = playback?.paused === true;
      if (!paused) heldBaseline = null;
      else if (!cursor && !heldBaseline) captureBaseline();
      render();
    },
    update(message) {
      if (message.type === 'snapshot') {
        const next = message.snapshot;
        const reset = !next || next.runId !== snapshot?.runId || next.archived !== snapshot?.archived
          || next.status === 'failed';
        if (reset) { cursor = null; heldBaseline = null; }
        snapshot = next;
        if (reset && paused) captureBaseline();
      } else if (message.type === 'cue') {
        if (!snapshot || snapshot.archived || snapshot.status === 'failed'
          || message.runId !== snapshot.runId
          || !hasCurrentCueIdentity(message.cue, { runId: snapshot.runId })
          || !missionSceneCopy({ mission, cue: message.cue })) return;
        cursor = message.cue;
        heldBaseline = null;
      } else if (message.type === 'settled' && message.snapshot?.runId === snapshot?.runId) {
        cursor = null;
        heldBaseline = null;
      }
      render();
    },
  };
}
