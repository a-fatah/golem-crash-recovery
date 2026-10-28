import assert from 'node:assert/strict';
import test from 'node:test';
import { MISSION_EMBED_RESIZE, MISSION_EMBED_REVEAL, isMissionEmbedSize, isMissionEmbedScene } from '../public/mission-embed-protocol.js';
import { connectMissionFrame } from '../public/mission-frame-controller.js';

function frameFixture({ onConnect = () => {}, onReveal = () => {}, reducedMotion = false } = {}) {
  const listeners = new Set();
  const scrolls = [];
  const windowObject = {
    scrollY: 300,
    matchMedia: () => ({ matches: reducedMotion }),
    scrollTo: options => scrolls.push(options),
    addEventListener(type, listener) {
      assert.equal(type, 'message');
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'message');
      listeners.delete(listener);
    },
  };
  const frame = { src: 'http://127.0.0.1:4319/?embed=1', contentWindow: {}, height: '760', hidden: true,
    getBoundingClientRect: () => ({ top: 500 }) };
  const status = { hidden: false };
  const disconnect = connectMissionFrame({ frame, status, windowObject, onConnect, onReveal });
  const dispatch = overrides => {
    const event = {
      source: frame.contentWindow,
      origin: 'http://127.0.0.1:4319',
      data: { type: MISSION_EMBED_RESIZE, height: 1200 },
      ...overrides,
    };
    for (const listener of listeners) listener(event);
  };
  return { frame, status, listeners, disconnect, dispatch, scrolls };
}

test('the embed protocol accepts only bounded positive integer heights', () => {
  for (const height of [1, 760, 1200, 20000]) {
    assert.equal(isMissionEmbedSize({ type: MISSION_EMBED_RESIZE, height }), true);
  }
  for (const height of [0, -1, 0.5, 20001, NaN, Infinity, '1200', null, undefined]) {
    assert.equal(isMissionEmbedSize({ type: MISSION_EMBED_RESIZE, height }), false);
  }
});

test('unrelated and malformed postMessage payloads cannot enter the resize protocol', () => {
  for (const data of [null, undefined, true, 'golem:mission:resize', [], {},
    { type: 'resize', height: 1200 }, { height: 1200 }, { type: MISSION_EMBED_RESIZE }]) {
    assert.equal(isMissionEmbedSize(data), false);
  }
});

test('a resize from the mission frame and its exact origin adjusts the article frame', () => {
  const f = frameFixture();
  f.dispatch();
  assert.equal(Number(f.frame.height), 1200);
  assert.equal(f.frame.hidden, false);
  assert.equal(f.status.hidden, true);
  f.dispatch({ data: { type: MISSION_EMBED_RESIZE, height: 860 } });
  assert.equal(Number(f.frame.height), 860, 'The frame may shrink when the mission content shrinks');
});

test('a different window cannot resize the article even when its origin matches', () => {
  const f = frameFixture();
  for (const source of [{}, null, undefined]) f.dispatch({ source });
  assert.equal(f.frame.height, '760');
  assert.equal(f.status.hidden, false);
});

test('the frame cannot send resize messages from a different origin after navigation', () => {
  const f = frameFixture();
  for (const origin of ['http://127.0.0.1:4320', 'http://localhost:4319',
    'https://127.0.0.1:4319', 'https://example.com', 'null', '']) {
    f.dispatch({ origin });
  }
  assert.equal(f.frame.height, '760');
  assert.equal(f.status.hidden, false);
});

test('trusted frame messages still require the bounded numeric resize contract', () => {
  const f = frameFixture();
  for (const data of [null, {}, { type: 'other', height: 1200 },
    { type: MISSION_EMBED_RESIZE, height: 20001 },
    { type: MISSION_EMBED_RESIZE, height: '1200' },
    { type: MISSION_EMBED_RESIZE, height: Infinity }]) {
    f.dispatch({ data });
  }
  assert.equal(f.frame.height, '760');
  assert.equal(f.status.hidden, false);
});

test('disconnecting the embedded mission removes its message listener', () => {
  const f = frameFixture();
  assert.equal(f.listeners.size, 1);
  f.disconnect();
  assert.equal(f.listeners.size, 0);
  f.dispatch();
  assert.equal(f.frame.height, '760');
  assert.equal(f.status.hidden, false);
});

test('only an accepted layout message completes a pending mission connection', () => {
  let connected = 0;
  const f = frameFixture({ onConnect: () => { connected++; } });
  f.dispatch({ origin: 'https://example.com' });
  f.dispatch({ source: {} });
  f.dispatch({ data: { type: MISSION_EMBED_RESIZE, height: -100 } });
  assert.equal(connected, 0);
  assert.equal(f.frame.hidden, true);
  f.dispatch();
  assert.equal(connected, 1);
  assert.equal(f.frame.hidden, false, 'A mission that responds after a timeout becomes visible again');
});

test('scene reveal geometry accepts fractional CSS coordinates within the document bound', () => {
  assert.equal(isMissionEmbedScene({ type: MISSION_EMBED_REVEAL, top: 240.5, height: 275.25 }), true);
  assert.equal(isMissionEmbedScene({ type: MISSION_EMBED_REVEAL, top: 0, height: 20000 }), true);
  for (const geometry of [
    { top: -1, height: 10 }, { top: 0, height: 0 }, { top: 0, height: -1 },
    { top: 19990, height: 20 }, { top: Infinity, height: 10 }, { top: 0, height: NaN },
    { top: '100', height: 20 }, { top: 100, height: '20' }, {},
  ]) assert.equal(isMissionEmbedScene({ type: MISSION_EMBED_REVEAL, ...geometry }), false);
});

test('only valid scene messages from the connected frame can scroll the article', () => {
  const revealed = [];
  const f = frameFixture({ onReveal: geometry => revealed.push(geometry) });
  const data = { type: MISSION_EMBED_REVEAL, top: 240, height: 275 };
  f.dispatch({ data });
  assert.deepEqual(f.scrolls, [], 'A hidden or disconnected frame cannot move the page');
  f.dispatch();
  for (const overrides of [
    { origin: 'https://untrusted.example' }, { source: {} },
    { data: { ...data, top: Infinity } }, { data: { ...data, height: -1 } },
    { data: { ...data, top: 1100 } },
  ]) f.dispatch({ data, ...overrides });
  assert.deepEqual(f.scrolls, []);
  f.dispatch({ data });
  assert.deepEqual(f.scrolls, [{ top: 912, behavior: 'smooth' }]);
  assert.deepEqual(revealed, [{ top: 240, height: 275 }]);
});

test('resize updates never scroll, and requested scene navigation honors reduced motion', () => {
  const f = frameFixture({ reducedMotion: true });
  f.dispatch();
  assert.deepEqual(f.scrolls, []);
  f.dispatch({ data: { type: MISSION_EMBED_REVEAL, top: 240, height: 275 } });
  assert.deepEqual(f.scrolls, [{ top: 912, behavior: 'instant' }]);
  f.disconnect();
  f.dispatch({ data: { type: MISSION_EMBED_REVEAL, top: 240, height: 275 } });
  assert.equal(f.scrolls.length, 1);
});
