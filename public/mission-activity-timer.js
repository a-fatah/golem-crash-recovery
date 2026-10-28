const timedKinds = new Set(['preparing', 'restarting', 'recovering', 'checking']);

function elapsedLabel(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return minutes < 60 ? `${minutes}:${rest}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`;
}

/** Measures wall time in the current runtime step, independently of visual playback. */
export function createMissionActivityTimer({ element, now = Date.now, schedule = callback => window.setInterval(callback, 1000), cancel = id => window.clearInterval(id) }) {
  let key = null;
  let startedAt = null;
  let interval = null;

  function tick() {
    const label = `Elapsed ${elapsedLabel(now() - startedAt)}`;
    if (element.textContent !== label) element.textContent = label;
  }

  function stop() {
    if (interval !== null) cancel(interval);
    interval = null;
    element.hidden = true;
  }

  return {
    update({ state, pendingAction, activity }) {
      const pending = pendingAction === 'start' || pendingAction === 'resume';
      const running = state?.runtime === 'golem' && state.status === 'running';
      if (!pending && !running) {
        key = null;
        startedAt = null;
        stop();
        return;
      }
      const nextKey = pending ? `request:${pendingAction}` : `${state.runId}:${state.golem?.phase ?? 'idle'}`;
      const timestamp = pending ? NaN : Date.parse(state.golem?.phaseStartedAt);
      if (nextKey !== key) {
        key = nextKey;
        startedAt = Number.isFinite(timestamp) ? timestamp : now();
      } else if (Number.isFinite(timestamp)) {
        startedAt = timestamp;
      }
      if (!activity || !timedKinds.has(activity.kind)) {
        stop();
        return;
      }
      element.hidden = false;
      tick();
      if (interval === null) interval = schedule(tick);
    },
    disconnect: stop,
  };
}
