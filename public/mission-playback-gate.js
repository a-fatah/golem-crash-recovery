/** Paces visual cues and Web Animations independently from the real runtime. */
export function createPlaybackGate({ getAnimations, onChange = () => {} }) {
  let paused = false;
  let stepping = false;
  let permits = 0;
  let queued = 0;
  let activeCueKey = null;
  let terminal = false;
  let signature;
  const pausedAnimations = new Set();
  const waiters = new Set();

  function state() {
    return { paused, stepping, waiting: paused && !stepping && queued === 0 && !terminal, activeCueKey };
  }
  function notify() {
    const value = state();
    const next = JSON.stringify(value);
    if (next === signature) return;
    signature = next;
    onChange(value);
  }
  function wake() { for (const resolve of [...waiters]) resolve(); }
  function freeze() {
    for (const animation of getAnimations()) {
      if (animation.playState === 'finished' || animation.playState === 'idle') continue;
      animation.pause?.();
      pausedAnimations.add(animation);
    }
  }
  function play() {
    for (const animation of pausedAnimations) {
      if (animation.playState === 'paused') animation.play?.();
    }
    pausedAnimations.clear();
  }
  async function boundary(signal) {
    while (paused && permits === 0 && !signal.aborted) {
      await new Promise(resolve => {
        const release = () => {
          waiters.delete(release);
          signal.removeEventListener('abort', release);
          resolve();
        };
        waiters.add(release);
        signal.addEventListener('abort', release, { once: true });
      });
    }
    return !signal.aborted;
  }

  return {
    state,
    boundary,
    setQueued(count) { queued = count; if (count > 0) terminal = false; notify(); wake(); },
    start(key) {
      if (paused && permits > 0) permits -= 1;
      activeCueKey = key;
      terminal = false;
      notify();
    },
    complete({ terminal: reachedTerminal = false } = {}) {
      terminal = reachedTerminal;
      // A step that first finished an interrupted cue still owes the next cue.
      if (stepping && permits === 0) stepping = false;
      if (paused && !stepping) freeze();
      notify();
    },
    pause() {
      paused = true;
      stepping = false;
      permits = 0;
      freeze();
      notify();
    },
    resume() {
      paused = false;
      stepping = false;
      permits = 0;
      play();
      notify();
      wake();
    },
    step() {
      if (stepping || queued === 0) return false;
      paused = true;
      stepping = true;
      permits = 1;
      // Committing a cue's result can create fresh CSS transitions after its
      // original animation promises resolved. Finish those too, so the next cue
      // cannot inherit a paused transition whose promise would never settle.
      for (const animation of getAnimations()) {
        if (animation.effect?.getTiming().iterations === Infinity) continue;
        if (animation.playState !== 'idle') {
          try { animation.finish?.(); } catch {
            if (animation.playState === 'paused') animation.play?.();
          }
        }
        pausedAnimations.delete(animation);
      }
      notify();
      wake();
      return true;
    },
    clear() {
      stepping = false;
      permits = 0;
      queued = 0;
      activeCueKey = null;
      terminal = false;
      pausedAnimations.clear();
      notify();
      wake();
    },
  };
}
