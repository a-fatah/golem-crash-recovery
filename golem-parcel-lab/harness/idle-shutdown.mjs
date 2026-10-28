/** Stops only after a full idle interval outside any owned mission or HTTP request. */
export function createIdleShutdown({ idleMs, isActive, isBusy = () => false, onIdle }) {
  if (!Number.isSafeInteger(idleMs) || idleMs <= 0) throw new Error('idleMs must be a positive integer');
  let lastActivity = Date.now();
  let wasActive = false;
  let stopped = false;
  let timer;

  function check() {
    if (stopped) return;
    const active = isActive();
    if (active || wasActive) lastActivity = Date.now();
    wasActive = active;
    if (!active && !isBusy() && Date.now() - lastActivity >= idleMs) {
      stopped = true;
      onIdle();
      return;
    }
    timer = setTimeout(check, Math.min(1000, idleMs));
  }
  timer = setTimeout(check, Math.min(1000, idleMs));

  return {
    touch() { lastActivity = Date.now(); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
