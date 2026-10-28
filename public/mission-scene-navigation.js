/** Keep the adjacent mission actions visible above the scene without moving focus. */
export function scrollToMissionScene({ windowObject, top }) {
  const reducedMotion = windowObject.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  windowObject.scrollTo({ top: Math.max(0, top - 128), behavior: reducedMotion ? 'instant' : 'smooth' });
}
