import { missionActivityState } from './mission-activity-model.js';
import { hasCurrentCueIdentity } from './mission-cue-identity.js';
import { createMissionActivityTimer } from './mission-activity-timer.js';

/** A scene-local waiting indicator; it never changes event poses, captions, or proof. */
export function createMissionActivityView({ scene }) {
  const panel = scene.querySelector('#mission-activity');
  const title = scene.querySelector('#mission-activity-title');
  const detail = scene.querySelector('#mission-activity-detail');
  const elapsed = scene.querySelector('#mission-activity-elapsed');
  const timer = elapsed ? createMissionActivityTimer({ element: elapsed }) : null;
  let runtime = {};
  let snapshot = null;
  let activeCue = false;
  let playback = {};

  function render() {
    const activity = missionActivityState({ ...runtime, activeCue, playback });
    panel.hidden = !activity;
    scene.dataset.activity = activity?.kind ?? '';
    scene.dataset.activityMotion = String(activity?.animate === true);
    timer?.update({ ...runtime, activity });
    if (!activity) return;
    if (title.textContent !== activity.title) title.textContent = activity.title;
    if (detail.textContent !== activity.detail) detail.textContent = activity.detail;
  }

  render();
  return {
    setRuntime(value) { runtime = value; render(); },
    setPlayback(value) { playback = value; render(); },
    update(message) {
      if (message.type === 'snapshot') {
        const next = message.snapshot;
        if (!next || next.runId !== snapshot?.runId || next.archived !== snapshot?.archived || next.status === 'failed') activeCue = false;
        snapshot = next;
      } else if (message.type === 'cue') {
        if (!snapshot || snapshot.archived || snapshot.status === 'failed'
          || message.runId !== snapshot.runId
          || !hasCurrentCueIdentity(message.cue, { runId: snapshot.runId })) return;
        activeCue = true;
      } else if (message.type === 'settled') {
        if (message.snapshot?.runId !== snapshot?.runId) return;
        activeCue = false;
      }
      render();
    },
    disconnect() { timer?.disconnect(); },
  };
}
