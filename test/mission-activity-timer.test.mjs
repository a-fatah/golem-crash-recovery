import assert from 'node:assert/strict';
import test from 'node:test';
import { createMissionActivityTimer } from '../public/mission-activity-timer.js';

const epoch = Date.parse('2026-10-28T12:00:00Z');
const timestamp = offset => new Date(epoch + offset).toISOString();

function running({ phase = 'starting', runId = 'parcel-current', startedAt } = {}) {
  return { runtime: 'golem', runId, status: 'running', golem: { phase, phaseStartedAt: startedAt } };
}

function fixture() {
  let currentTime = epoch;
  let sequence = 0;
  const callbacks = new Map();
  const element = { hidden: true, textContent: '' };
  const timer = createMissionActivityTimer({
    element,
    now: () => currentTime,
    schedule(callback) { callbacks.set(++sequence, callback); return sequence; },
    cancel(id) { callbacks.delete(id); },
  });
  return {
    timer, element,
    advance(milliseconds) {
      currentTime += milliseconds;
      for (const callback of callbacks.values()) callback();
    },
    activeTimers: () => callbacks.size,
    update({ state = running(), activity = { kind: 'preparing', animate: true }, ...rest } = {}) {
      timer.update({ state, activity, ...rest });
    },
  };
}

test('repeated state polls preserve elapsed time and one ticking display', () => {
  const f = fixture();
  f.update();
  assert.equal(f.element.hidden, false);
  assert.equal(f.element.textContent, 'Elapsed 0:00');
  f.advance(12_999);
  assert.equal(f.element.textContent, 'Elapsed 0:12');
  for (let poll = 0; poll < 4; poll++) f.update();
  f.advance(2_001);
  assert.equal(f.element.textContent, 'Elapsed 0:15', 'Polling must not restart the current step');
  assert.equal(f.activeTimers(), 1, 'Polling must not multiply visible clocks');
  f.timer.disconnect();
});

test('a server phase timestamp accounts for work before connection and replaces a local fallback', () => {
  const f = fixture();
  f.update({ state: running({ startedAt: timestamp(-43_000) }) });
  assert.equal(f.element.textContent, 'Elapsed 0:43', 'A reader joining midway must see the runtime step age');
  f.timer.disconnect();

  const backfilled = fixture();
  backfilled.update();
  backfilled.advance(3_000);
  backfilled.update({ state: running({ startedAt: timestamp(-27_000) }) });
  assert.equal(backfilled.element.textContent, 'Elapsed 0:30');
  backfilled.advance(2_000);
  backfilled.update({ state: running({ startedAt: timestamp(-27_000) }) });
  assert.equal(backfilled.element.textContent, 'Elapsed 0:32');
  backfilled.timer.disconnect();
});

test('a new phase or run measures its own work even when its activity label is unchanged', () => {
  const f = fixture();
  f.update();
  f.advance(11_000);
  f.update({ state: running({ phase: 'deploying' }) });
  assert.equal(f.element.textContent, 'Elapsed 0:00');
  f.advance(5_000);
  f.update({ state: running({ phase: 'deploying', runId: 'parcel-next' }) });
  assert.equal(f.element.textContent, 'Elapsed 0:00');
  f.advance(2_000);
  assert.equal(f.element.textContent, 'Elapsed 0:02');
  f.timer.disconnect();
});

test('confirmed event animation hides the clock without losing the running step age', () => {
  const f = fixture();
  f.update();
  f.advance(4_000);
  f.update({ activity: null });
  assert.equal(f.element.hidden, true);
  assert.equal(f.activeTimers(), 0, 'A hidden clock must not keep a display interval alive');
  f.advance(17_000);
  f.update();
  assert.equal(f.element.hidden, false);
  assert.equal(f.element.textContent, 'Elapsed 0:21', 'Runtime work continues while a confirmed cue is shown');
  assert.equal(f.activeTimers(), 1);
  f.timer.disconnect();
});

test('pausing or stepping the animation leaves elapsed runtime time moving', () => {
  const f = fixture();
  const state = running({ phase: 'restarted', startedAt: timestamp(-9_000) });
  f.update({ state, activity: { kind: 'recovering', animate: false } });
  assert.equal(f.element.textContent, 'Elapsed 0:09');
  f.advance(4_000);
  assert.equal(f.element.textContent, 'Elapsed 0:13');
  assert.equal(f.element.hidden, false);
  assert.equal(state.golem.phase, 'restarted', 'The timer must not advance runtime state');
  f.timer.disconnect();
});

test('disconnected and connecting feedback never displays an apparent working clock', () => {
  const f = fixture();
  f.update();
  f.advance(6_000);
  f.update({ activity: { kind: 'unavailable', animate: false } });
  assert.equal(f.element.hidden, true);
  assert.equal(f.activeTimers(), 0);
  f.advance(4_000);
  f.update();
  assert.equal(f.element.textContent, 'Elapsed 0:10', 'Reconnecting to the same step preserves its age');
  f.update({ state: null, activity: { kind: 'connecting', animate: true } });
  assert.equal(f.element.hidden, true);
  assert.equal(f.activeTimers(), 0);
});

test('pending start and resume show local request time before the first server observation', () => {
  for (const [pendingAction, kind, status] of [['start', 'preparing', 'completed'], ['resume', 'restarting', 'crashed']]) {
    const f = fixture();
    const staleState = { ...running({ startedAt: timestamp(-3_600_000) }), status };
    const pending = { state: staleState, pendingAction, activity: { kind, animate: true } };
    f.update(pending);
    assert.equal(f.element.textContent, 'Elapsed 0:00', pendingAction);
    f.advance(7_000);
    f.update(pending);
    assert.equal(f.element.textContent, 'Elapsed 0:07', pendingAction);
    f.update({ state: running({ phase: 'restarting', startedAt: timestamp(2_000) }), activity: { kind: 'restarting', animate: true } });
    assert.equal(f.element.textContent, 'Elapsed 0:05', 'A fresh server observation becomes authoritative');
    f.timer.disconnect();
  }
});

test('terminal and other runtime states hide the clock and clear the previous step', () => {
  for (const state of [null, ...['idle', 'crashed', 'completed', 'failed'].map(status => ({ ...running(), status })), { ...running(), runtime: 'local' }]) {
    const f = fixture();
    f.update();
    f.advance(10_000);
    f.update({ state, activity: null });
    assert.equal(f.element.hidden, true);
    assert.equal(f.activeTimers(), 0);
    f.advance(5_000);
    f.update();
    assert.equal(f.element.textContent, 'Elapsed 0:00', 'An old terminal run cannot leak its age into a later run');
    f.timer.disconnect();
  }
});

test('elapsed labels format minutes and hours and clamp future server timestamps to zero', () => {
  const f = fixture();
  f.update({ state: running({ startedAt: timestamp(-62_000) }) });
  assert.equal(f.element.textContent, 'Elapsed 1:02');
  f.advance(3_661_000);
  assert.equal(f.element.textContent, 'Elapsed 1:02:03');
  f.update({ state: running({ phase: 'restarting', startedAt: timestamp(3_666_000) }), activity: { kind: 'restarting', animate: true } });
  assert.equal(f.element.textContent, 'Elapsed 0:00');
  f.advance(7_000);
  assert.equal(f.element.textContent, 'Elapsed 0:02');
  f.timer.disconnect();
});

test('explicit disconnection releases timer resources and hides the elapsed indicator', () => {
  const f = fixture();
  f.update();
  f.advance(2_000);
  f.timer.disconnect();
  f.timer.disconnect();
  assert.equal(f.activeTimers(), 0);
  assert.equal(f.element.hidden, true);
  f.advance(60_000);
  assert.equal(f.element.textContent, 'Elapsed 0:02', 'A disposed display must not receive clock updates');
});
