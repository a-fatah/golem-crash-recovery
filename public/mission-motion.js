import { missionMotionSnapshot } from './mission-motion-model.js';
import { createPlaybackGate } from './mission-playback-gate.js';

const labels = Object.freeze({ 'blocking-before': 'Cable attempt blocked · before crash', 'blocking-after': 'Cable attempt blocked · after recovery', cutting: 'Cut marker', falling: 'Server exited', rising: 'Server restarted', sealing: 'Parcel sealed', done: 'Policy checks verified' });
const descriptions = Object.freeze({
  'blocking-before': 'The original knife request for the cable was denied. Showing the attempted swing stopped at the policy boundary.',
  'blocking-after': 'A fresh knife request after recovery was denied again. The cable stays intact.',
  cutting: 'The harness observed the tool’s post-append marker. Showing the ribbon cut.',
  falling: 'The server actually exited on SIGKILL. Golem collapses.',
  rising: 'The replacement server is ready. Golem comes back to the same job.',
  sealing: 'The recovered invocation reports the parcel sealed. Showing the finishing step.',
  done: 'Final files and both fresh policy checks passed.',
});

/** Plays each newly observed event once; animation completion only controls visual pacing. */
export function createMissionAnimator({ scene, readout, receipts, replayButton, pauseButton, stepButton, pauseButtons = [], stepButtons = [], playbackStatus, onMotion = () => {}, onPlayback = () => {}, motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)') }) {
  let latest = null;
  let seen = new Set();
  let queue = [];
  let generation = 0;
  let pumping = false;
  let replaying = false;
  let abortPlayback = null;
  const panel = readout.closest('.motion-panel');
  const courier = scene.querySelector('.courier-station');
  const rig = scene.querySelector('.courier-rig');
  const parcel = scene.querySelector('.parcel-station');
  const knife = scene.querySelector('.courier-knife');
  const cable = scene.querySelector('.cable-boundary');
  const pauseControls = [...new Set([pauseButton, ...pauseButtons].filter(Boolean))];
  const stepControls = [...new Set([stepButton, ...stepButtons].filter(Boolean))];
  const playbackGroup = pauseButton?.closest?.('.mission-playback-controls')
    ?? playbackStatus?.closest?.('.mission-playback-controls');
  const gate = createPlaybackGate({
    getAnimations: () => scene.getAnimations({ subtree: true }),
    onChange(value) { updateButton(); onPlayback(value); },
  });

  function placeReach() {
    const actor = courier.getBoundingClientRect();
    const target = parcel.getBoundingClientRect();
    // SVG tools have no offsetWidth. Their rendered bounds still provide a width.
    const rigWidth = rig.offsetWidth ?? rig.getBoundingClientRect().width;
    const knifeWidth = knife.getBoundingClientRect().width;
    const distance = target.left + target.width / 2 - actor.left - actor.width / 2 - rigWidth / 2 - knifeWidth * .65;
    scene.style.setProperty('--courier-step', `${Number.isFinite(distance) ? Math.max(0, distance) : 0}px`);
    if (cable) {
      const cableReach = cable.getBoundingClientRect().left - actor.left - actor.width / 2 - rigWidth * .4 - knifeWidth * .65;
      scene.style.setProperty('--courier-cable-step', `${Number.isFinite(cableReach) ? Math.max(0, cableReach) : 0}px`);
    }
  }
  const resizeObserver = new ResizeObserver(placeReach);
  resizeObserver.observe(scene);

  function canReplay() {
    return latest?.status !== 'failed' && !latest?.archived && latest?.verified
      && ['cutting', 'falling', 'rising', 'sealing'].every(stage => latest.cues.some(cue => cue.stage === stage));
  }
  function heldAtEnd() {
    const playback = gate.state();
    return playback.paused && !playback.stepping && queue.length === 0
      && scene.dataset.motion === 'done' && canReplay();
  }
  function stepAvailability() {
    const playback = gate.state();
    const replay = !pumping && !playback.activeCueKey && Boolean(canReplay());
    const allowed = Boolean(latest && !latest.archived && latest.status !== 'failed'
      && !playback.stepping && (playback.paused && queue.length > 0 || replay));
    return { replay, allowed };
  }
  function updateButton() {
    const playback = gate.state();
    const step = stepAvailability();
    const canStepReplay = step.replay;
    if (playbackGroup) playbackGroup.hidden = !latest;
    replayButton.hidden = !canReplay();
    replayButton.disabled = pumping && !heldAtEnd() || !canReplay();
    for (const control of pauseControls) {
      control.disabled = !latest || latest.archived || latest.status === 'failed';
      const label = playback.paused ? 'Resume animation' : 'Pause animation';
      if (control.textContent !== label) control.textContent = label;
      control.setAttribute?.('aria-pressed', String(playback.paused));
    }
    for (const control of stepControls) {
      // A temporary busy state must keep keyboard focus on the reader's Next
      // button; the click handler enforces the same availability contract.
      control.disabled = !latest || latest.archived || latest.status === 'failed';
      control.setAttribute?.('aria-disabled', String(!step.allowed));
      const label = canStepReplay ? 'Step through events' : 'Next observed event';
      if (control.textContent !== label) control.textContent = label;
    }
    if (playbackStatus) {
      const context = replaying ? 'Replay of observed events' : 'Observed event playback';
      const description = !latest ? 'Visual playback controls. The real runtime continues independently.'
        : latest.archived ? 'Saved result. Start a new mission to control visual playback.'
        : heldAtEnd() ? 'End of observed mission. Replay these observed events to start again, or resume animation. The real runtime is independent of visual playback.'
        : playback.stepping ? `${context}: playing one event, then holding its code. The real runtime continues.`
        : playback.paused && playback.activeCueKey ? `Animation paused · ${context} at this event.${queue.length ? ' Choose Next observed event or Resume animation.' : ' Waiting for the next observed event.'} The real runtime continues.`
        : playback.paused && canStepReplay ? 'Visual playback paused. Step through the recorded mission or resume animation. The real runtime continues.'
        : playback.paused ? `Visual playback paused.${queue.length ? ' Observed events are queued.' : ' Waiting for the next observed event.'} The real runtime continues.`
        : `${context}: automatic animation and synchronized code. Pausing affects visual playback only; the real runtime continues.`;
      if (playbackStatus.textContent !== description) playbackStatus.textContent = description;
    }
    scene.dataset.playbackPaused = String(playback.paused);
    scene.dataset.playbackStepping = String(playback.stepping);
  }
  function stop() {
    generation += 1;
    abortPlayback?.abort();
    for (const animation of scene.getAnimations({ subtree: true })) animation.cancel();
    queue = [];
    pumping = false;
    replaying = false;
    gate.clear();
  }
  function pose(snapshot) {
    scene.dataset.motion = snapshot.pose;
    scene.dataset.cut = String(snapshot.cut === true);
    scene.dataset.sealed = String(snapshot.sealed === true);
    scene.dataset.playback = 'settled';
  }
  function receipt(cue, status) {
    let row = [...receipts.children].find(node => node.dataset.eventKey === cue.key);
    if (!row) {
      row = document.createElement('li');
      row.dataset.eventKey = cue.key;
      row.dataset.sourceEvent = String(cue.id);
      row.dataset.motionStage = cue.stage;
      row.textContent = `${labels[cue.stage]} · event ${cue.id}`;
      if (cue.policyDenial) {
        row.textContent += ` · oplog ${cue.policyDenial.startIndex}–${cue.policyDenial.endIndex}`;
        row.dataset.denialPhase = cue.policyDenial.phase;
        row.dataset.oplogStart = String(cue.policyDenial.startIndex);
        row.dataset.oplogEnd = String(cue.policyDenial.endIndex);
      }
      if (cue.runtimeEvidence) {
        const proof = cue.runtimeEvidence;
        row.textContent += ` · tool Start ${proof.toolStartIndex}${proof.toolEndIndex !== undefined ? ` → End ${proof.toolEndIndex}` : ''}`;
        row.dataset.toolStart = String(proof.toolStartIndex);
        if (proof.toolEndIndex !== undefined) row.dataset.toolEnd = String(proof.toolEndIndex);
      }
      receipts.append(row);
    }
    row.dataset.status = status;
    row.dataset.playback = replaying ? 'replay' : 'live';
    return row;
  }
  async function finishMotion(signal) {
    // Read CSS-created animation promises instead of guessing runtime timing with a clock.
    const animations = scene.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity);
    if (!animations.length || motionPreference.matches) return;
    await new Promise(resolve => {
      const aborted = () => resolve();
      signal.addEventListener('abort', aborted, { once: true });
      Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
        signal.removeEventListener('abort', aborted);
        resolve();
      });
    });
  }
  function pump() {
    if (pumping || queue.length === 0) return;
    pumping = true;
    const epoch = generation;
    const controller = new AbortController();
    abortPlayback = controller;
    updateButton();
    void (async () => {
      try {
        while (epoch === generation) {
          // Pause holds both the current pose and source, even if the real server
          // has already produced later events or completed the mission.
          if (gate.state().paused && !await gate.boundary(controller.signal)) return;
          if (controller.signal.aborted || epoch !== generation || queue.length === 0) break;
          const cue = queue.shift();
          gate.setQueued(queue.length);
          scene.dataset.motion = cue.stage;
          scene.dataset.playback = replaying ? 'replay' : 'live';
          onMotion({ type: 'cue', runId: latest.runId, cue, replay: replaying });
          gate.start(cue.key);
          readout.textContent = `${replaying ? 'Replay of observed events' : 'Observed event'} #${cue.id}: ${descriptions[cue.stage]}`;
          if (cue.policyDenial) readout.textContent += ` ${cue.policyDenial.method} · Golem oplog ${cue.policyDenial.startIndex} → ${cue.policyDenial.endIndex}.`;
          const row = receipt(cue, 'playing');
          if (cue.stage !== 'done') await finishMotion(controller.signal);
          if (controller.signal.aborted || epoch !== generation) return;
          row.dataset.status = 'played';
          if (cue.stage === 'cutting') scene.dataset.cut = 'true';
          if (cue.stage === 'falling') scene.dataset.motion = 'down';
          if (cue.stage === 'rising') scene.dataset.motion = 'finishing';
          if (cue.stage === 'sealing') {
            scene.dataset.sealed = 'true';
            scene.dataset.motion = 'finishing';
          }
          gate.complete({ terminal: cue.stage === 'done' && latest.verified && queue.length === 0 });
        }
      } finally {
        if (epoch === generation) {
          pumping = false;
          pose(latest);
          onMotion({ type: 'settled', snapshot: latest });
          gate.clear();
          readout.textContent = latest.archived ? 'Saved real result. Start a new mission to see live event-driven motion.'
            : latest.pose === 'down' ? 'Server offline. The cut marker and server exit were observed; choose Resume Golem.'
            : latest.verified ? latest.cues.some(cue => cue.stage === 'blocking-after')
              ? 'Observed sequence complete: cable blocked → ribbon cut → server exit → restart → sealed parcel → fresh cable request blocked.'
              : 'Observed sequence complete: cut → server exit → restart → sealed parcel → fresh policy checks.'
            : latest.pose === 'finishing' ? 'Golem is recovering the original tool call. Waiting for its result and fresh policy checks.'
            : 'Waiting for the next observed runtime event.';
          replaying = false;
          updateButton();
        }
      }
    })();
  }

  function prepareReplay() {
    stop();
    receipts.replaceChildren();
    pose({ ...latest, pose: 'ready', cut: false, sealed: false });
    // Commit the neutral pose so the CSS keyframes restart even on repeated replays.
    rig.getBoundingClientRect();
    replaying = true;
    queue = [...latest.cues];
    gate.setQueued(queue.length);
  }

  replayButton.addEventListener('click', () => {
    if (!canReplay() || pumping && !heldAtEnd()) return;
    prepareReplay();
    gate.resume();
    pump();
  });
  function togglePause() {
    if (!latest || latest.archived || latest.status === 'failed') return;
    if (gate.state().paused) { gate.resume(); pump(); }
    else gate.pause();
    updateButton();
  }
  function nextEvent() {
    const step = stepAvailability();
    if (!step.allowed) return;
    if (step.replay) prepareReplay();
    if (gate.step()) pump();
    updateButton();
  }
  for (const control of pauseControls) control.addEventListener('click', togglePause);
  for (const control of stepControls) control.addEventListener('click', nextEvent);
  gate.setQueued(0);

  return {
    update(options) {
      const snapshot = missionMotionSnapshot(options);
      onMotion({ type: 'snapshot', snapshot });
      panel.hidden = !snapshot;
      if (!snapshot) { stop(); latest = null; updateButton(); return; }
      if (!latest || latest.runId !== snapshot.runId || snapshot.archived !== latest.archived) {
        stop();
        latest = snapshot;
        seen = new Set(snapshot.cues.map(cue => cue.key));
        receipts.replaceChildren();
        pose(snapshot);
        for (const cue of snapshot.cues) receipt(cue, 'observed');
        readout.textContent = snapshot.archived ? 'Saved real result. Start a new mission to see live event-driven motion.'
          : snapshot.pose === 'down' ? 'Joined this run at its real crash checkpoint. Resume Golem to continue.'
          : snapshot.verified ? 'Completed real run. Replay its observed events below, or start a new mission.'
          : 'Waiting for real policy and tool evidence. Motion begins only after an observation.';
        placeReach();
        updateButton();
        return;
      }
      latest = snapshot;
      if (snapshot.status === 'failed') {
        stop();
        pose(snapshot);
        readout.textContent = 'The runtime reported a failure. No successful finish is being animated.';
        updateButton();
        return;
      }
      for (const cue of snapshot.cues) {
        if (seen.has(cue.key)) continue;
        seen.add(cue.key);
        queue.push(cue);
      }
      gate.setQueued(queue.length);
      if (queue.length) pump();
      else if (!pumping && !gate.state().paused) pose(snapshot);
      updateButton();
    },
  };
}
