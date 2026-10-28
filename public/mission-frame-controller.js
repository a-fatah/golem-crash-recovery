import { isMissionEmbedScene, isMissionEmbedSize } from './mission-embed-protocol.js';
import { scrollToMissionScene } from './mission-scene-navigation.js';

/** Accept layout updates only from this mission frame at its configured origin. */
export function connectMissionFrame({ frame, status, windowObject = window, onConnect = () => {}, onReveal = () => {} }) {
  const origin = new URL(frame.src).origin;
  function receive(event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    if (isMissionEmbedSize(event.data)) {
      frame.height = String(event.data.height);
      frame.hidden = false;
      status.hidden = true;
      onConnect();
    } else if (isMissionEmbedScene(event.data) && !frame.hidden
      && event.data.top + event.data.height <= Number(frame.height)) {
      const { top, height } = event.data;
      scrollToMissionScene({ windowObject, top: frame.getBoundingClientRect().top + windowObject.scrollY + top });
      onReveal({ top, height });
    }
  }
  windowObject.addEventListener('message', receive);
  return () => windowObject.removeEventListener('message', receive);
}
