import {
  MISSION_EMBED_MEASURE,
  MISSION_EMBED_RESIZE,
  MISSION_EMBED_REVEAL,
  MISSION_EMBED_REVEAL_REQUEST,
  isMissionEmbedScene,
  isMissionEmbedSize,
} from './mission-embed-protocol.js';
import { scrollToMissionScene } from './mission-scene-navigation.js';

/** Connect document layout and explicitly activated mission navigation. */
export function connectMissionEmbed({ documentObject, windowObject, ResizeObserverClass }) {
  const content = documentObject.querySelector('.page-shell');
  const scene = documentObject.getElementById('mission-scene');
  if (!content || !scene) return () => {};
  const parentOrigin = documentObject.body.dataset.parentOrigin;
  const embedded = windowObject.parent !== windowObject && Boolean(parentOrigin);
  let previousHeight = 0;
  let active = true;

  function reportSize({ force = false } = {}) {
    if (!active || !embedded) return;
    // Content geometry also permits the frame to shrink after a code panel closes.
    const height = Math.ceil(content.getBoundingClientRect().height) + 2;
    const message = { type: MISSION_EMBED_RESIZE, height };
    if ((force || height !== previousHeight) && isMissionEmbedSize(message)) {
      previousHeight = height;
      windowObject.parent.postMessage(message, parentOrigin);
    }
  }

  function revealScene() {
    if (!active || scene.hidden) return;
    const bounds = scene.getBoundingClientRect();
    const geometry = { type: MISSION_EMBED_REVEAL, top: bounds.top + windowObject.scrollY, height: bounds.height };
    if (!isMissionEmbedScene(geometry)) return;
    if (embedded) {
      // The resize arrives first, so the article can validate against the current frame.
      reportSize({ force: true });
      windowObject.parent.postMessage(geometry, parentOrigin);
    } else {
      scrollToMissionScene({ windowObject, top: geometry.top });
    }
  }

  const buttons = ['primary-action', 'motion-replay']
    .map(id => documentObject.getElementById(id)).filter(Boolean);
  function activated(event) {
    if (!event.isTrusted || event.currentTarget.disabled || event.currentTarget.hidden) return;
    // Let the action's synchronous render reveal the scene before measuring it.
    windowObject.requestAnimationFrame(revealScene);
  }
  for (const button of buttons) button.addEventListener('click', activated, true);

  function receive(event) {
    if (!embedded || event.source !== windowObject.parent || event.origin !== parentOrigin) return;
    if (event.data?.type === MISSION_EMBED_MEASURE) reportSize({ force: true });
    if (event.data?.type === MISSION_EMBED_REVEAL_REQUEST) revealScene();
  }
  windowObject.addEventListener('message', receive);
  const observer = embedded ? new ResizeObserverClass(() => reportSize()) : null;
  observer?.observe(content);
  documentObject.fonts.ready.then(() => reportSize());
  reportSize();

  return () => {
    active = false;
    observer?.disconnect();
    windowObject.removeEventListener('message', receive);
    for (const button of buttons) button.removeEventListener('click', activated, true);
  };
}
