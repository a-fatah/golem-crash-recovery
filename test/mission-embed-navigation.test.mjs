import assert from 'node:assert/strict';
import test from 'node:test';
import { connectMissionEmbed } from '../public/mission-embed-controller.js';
import { MISSION_EMBED_REVEAL, MISSION_EMBED_REVEAL_REQUEST, MISSION_EMBED_RESIZE } from '../public/mission-embed-protocol.js';

function navigationFixture({ embedded = true, reducedMotion = false } = {}) {
  const messages = [];
  const scrolls = [];
  const listeners = new Map();
  const buttons = new Map(['primary-action', 'motion-replay'].map(id => {
    const callbacks = new Set();
    return [id, { disabled: false, hidden: false,
      addEventListener: (type, callback) => callbacks.add(callback),
      removeEventListener: (type, callback) => callbacks.delete(callback),
      activate(options = {}) { for (const callback of callbacks) callback({ isTrusted: true, currentTarget: this, ...options }); },
    }];
  }));
  const parent = { postMessage: (message, origin) => messages.push({ message, origin }) };
  const windowObject = { parent, scrollY: 0,
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: type => listeners.delete(type),
    requestAnimationFrame: callback => callback(),
    matchMedia: () => ({ matches: reducedMotion }),
    scrollTo: options => scrolls.push(options),
  };
  if (!embedded) windowObject.parent = windowObject;
  const scene = { hidden: false, getBoundingClientRect: () => ({ top: 240, height: 275 }) };
  const documentObject = {
    body: { dataset: embedded ? { parentOrigin: 'https://article.example' } : {} },
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 1200 }) }),
    getElementById: id => id === 'mission-scene' ? scene : buttons.get(id),
    fonts: { ready: Promise.resolve() },
  };
  let observed;
  const disconnect = connectMissionEmbed({ documentObject, windowObject, ResizeObserverClass: class {
    constructor(callback) { observed = callback; }
    observe() {}
    disconnect() { observed = undefined; }
  } });
  return { messages, scrolls, buttons, disconnect,
    measure: () => observed?.(),
    request: overrides => listeners.get('message')?.({ source: parent, origin: 'https://article.example',
      data: { type: MISSION_EMBED_REVEAL_REQUEST }, ...overrides }),
  };
}

test('a real start, resume, or replay activation reports the actual scene to the exact parent origin', () => {
  const f = navigationFixture();
  assert.deepEqual(f.messages, [{ message: { type: MISSION_EMBED_RESIZE, height: 1202 }, origin: 'https://article.example' }]);
  for (const id of ['primary-action', 'motion-replay']) {
    f.messages.length = 0;
    f.buttons.get(id).activate();
    assert.deepEqual(f.messages, [
      { message: { type: MISSION_EMBED_RESIZE, height: 1202 }, origin: 'https://article.example' },
      { message: { type: MISSION_EMBED_REVEAL, top: 240, height: 275 }, origin: 'https://article.example' },
    ]);
  }
  assert.deepEqual(f.scrolls, [], 'The child leaves cross-document scrolling to the article');
});

test('passive measurements, synthetic clicks, disabled actions, and foreign requests cannot reveal the scene', () => {
  const f = navigationFixture();
  f.messages.length = 0;
  f.measure();
  f.buttons.get('primary-action').activate({ isTrusted: false });
  f.buttons.get('primary-action').disabled = true;
  f.buttons.get('primary-action').activate();
  f.request({ source: {} });
  f.request({ origin: 'https://untrusted.example' });
  assert.deepEqual(f.messages, []);
  f.request();
  assert.equal(f.messages.at(-1).message.type, MISSION_EMBED_REVEAL);
  f.disconnect();
  f.messages.length = 0;
  f.request();
  f.buttons.get('motion-replay').activate();
  assert.deepEqual(f.messages, []);
});

test('standalone user navigation scrolls to the scene and honors reduced motion', () => {
  const f = navigationFixture({ embedded: false, reducedMotion: true });
  f.buttons.get('primary-action').activate();
  assert.deepEqual(f.scrolls, [{ top: 112, behavior: 'instant' }]);
  assert.deepEqual(f.messages, []);
});
