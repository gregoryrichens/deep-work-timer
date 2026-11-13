'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SM = require('../js/session.js');

const W52 = 3120000, R52 = 1020000, A = 10000;
const T52 = W52 + A + R52 + A;

test('constants and totals', () => {
  assert.strictEqual(SM.ALARM_MS, 10000);
  assert.strictEqual(SM.totalMs('52/17'), T52);
  assert.strictEqual(SM.totalMs('112/26'), (6720 + 1560) * 1000 + 20000);
  assert.deepStrictEqual(SM.MODES['112/26'].snackMins, [25, 55, 85]);
});

test('schedule boundaries for both modes', () => {
  const s = SM.schedule('52/17');
  assert.deepStrictEqual(s, [
    { phase: 'work', alarmAfter: null, startMs: 0, durationMs: W52 },
    { phase: 'alarm', alarmAfter: 'work', startMs: W52, durationMs: A },
    { phase: 'rest', alarmAfter: null, startMs: W52 + A, durationMs: R52 },
    { phase: 'alarm', alarmAfter: 'rest', startMs: W52 + A + R52, durationMs: A }
  ]);
  const l = SM.schedule('112/26');
  assert.strictEqual(l[0].durationMs, 6720000);
  assert.strictEqual(l[2].startMs, 6730000);
  assert.strictEqual(l[2].durationMs, 1560000);
  assert.strictEqual(l[3].startMs + l[3].durationMs, SM.totalMs('112/26'));
  assert.throws(() => SM.schedule('nope'));
});

test('view at key points', () => {
  let v = SM.view('52/17', 0);
  assert.strictEqual(v.phase, 'work'); assert.strictEqual(v.index, 0);
  assert.strictEqual(v.phaseElapsedSec, 0); assert.strictEqual(v.phaseTotalSec, 3120);
  v = SM.view('52/17', W52 - 1);
  assert.strictEqual(v.phase, 'work'); assert.strictEqual(v.phaseElapsedSec, 3119);
  v = SM.view('52/17', W52);
  assert.strictEqual(v.phase, 'alarm'); assert.strictEqual(v.alarmAfter, 'work');
  assert.strictEqual(v.index, 1); assert.strictEqual(v.phaseElapsedMs, 0);
  v = SM.view('52/17', W52 + A - 1);
  assert.strictEqual(v.index, 1);
  v = SM.view('52/17', W52 + A);
  assert.strictEqual(v.phase, 'rest'); assert.strictEqual(v.index, 2);
  assert.strictEqual(v.phaseElapsedSec, 0); assert.strictEqual(v.phaseTotalSec, 1020);
  v = SM.view('52/17', W52 + A + R52);
  assert.strictEqual(v.phase, 'alarm'); assert.strictEqual(v.alarmAfter, 'rest'); assert.strictEqual(v.index, 3);
  v = SM.view('52/17', T52 - 1);
  assert.strictEqual(v.index, 3);
  v = SM.view('52/17', T52);
  assert.strictEqual(v.phase, 'done'); assert.strictEqual(v.index, 4);
  assert.strictEqual(v.sessionElapsedMs, T52);
  v = SM.view('52/17', T52 * 5);
  assert.strictEqual(v.phase, 'done'); assert.strictEqual(v.sessionElapsedMs, T52);
  v = SM.view('52/17', -5);
  assert.strictEqual(v.index, 0); assert.strictEqual(v.sessionElapsedMs, 0);
  assert.strictEqual(SM.view('52/17', 1999).phaseElapsedSec, 1);
});

test('elapsedMs: paused, running, clamping', () => {
  assert.strictEqual(SM.elapsedMs({ anchorAt: null, offsetMs: 0, paused: true }, 999), 0);
  assert.strictEqual(SM.elapsedMs({ anchorAt: 100, offsetMs: 500, paused: true }, 99999), 500);
  assert.strictEqual(SM.elapsedMs({ anchorAt: 1000, offsetMs: 500, paused: false }, 4000), 3500);
  assert.strictEqual(SM.elapsedMs({ anchorAt: 5000, offsetMs: 0, paused: false }, 1000), 0, 'clock behind anchor clamps to 0');
  assert.strictEqual(SM.elapsedMs({ anchorAt: 0, offsetMs: 0, paused: false }, 1e12, '52/17'), T52, 'upper clamp with mode');
});

test('start / pause / resume arithmetic', () => {
  const t0 = SM.initialTimer();
  assert.deepStrictEqual(t0, { anchorAt: null, offsetMs: 0, paused: true });
  assert.strictEqual(SM.isStarted(t0), false);
  const t1 = SM.start(t0, '52/17', 1000);
  assert.deepStrictEqual(t1, { anchorAt: 1000, offsetMs: 0, paused: false });
  assert.strictEqual(SM.isStarted(t1), true);
  assert.strictEqual(SM.start(t1, '52/17', 2000), t1, 'start while running is a no-op');
  const t2 = SM.pause(t1, '52/17', 6000);
  assert.strictEqual(t2.paused, true); assert.strictEqual(t2.offsetMs, 5000);
  assert.strictEqual(SM.elapsedMs(t2, 999999), 5000);
  assert.strictEqual(SM.pause(t2, '52/17', 7000), t2, 'pause while paused is a no-op');
  assert.strictEqual(SM.isStarted(t2), true);
  const t3 = SM.start(t2, '52/17', 10000);
  assert.deepStrictEqual(t3, { anchorAt: 10000, offsetMs: 5000, paused: false });
  assert.strictEqual(SM.elapsedMs(t3, 13000), 8000);
});

test('pause is a no-op during alarm and done; start is a no-op when done', () => {
  const run = SM.start(SM.initialTimer(), '52/17', 0);
  const inAlarm = W52 + 3000;
  assert.strictEqual(SM.pause(run, '52/17', inAlarm), run);
  assert.strictEqual(SM.pause(run, '52/17', W52 + A + R52 + 1), run);
  assert.strictEqual(SM.pause(run, '52/17', T52 + 5), run);
  const doneTimer = { anchorAt: null, offsetMs: T52, paused: true };
  assert.strictEqual(SM.start(doneTimer, '52/17', 0), doneTimer);
  // the rest phase auto-continues: running timer at rest start is in rest
  assert.strictEqual(SM.view('52/17', SM.elapsedMs(run, W52 + A, '52/17')).phase, 'rest');
});

test('scrub: within phase, paused vs running, clamping', () => {
  const paused = SM.initialTimer();
  let t = SM.scrub(paused, '52/17', 600000, 5000);
  assert.deepStrictEqual(t, { anchorAt: null, offsetMs: 600000, paused: true });
  const running = SM.start(paused, '52/17', 1000);
  t = SM.scrub(running, '52/17', 600000, 9000);
  assert.deepStrictEqual(t, { anchorAt: 9000, offsetMs: 600000, paused: false });
  assert.strictEqual(SM.elapsedMs(t, 11000), 602000);
  // clamping
  assert.strictEqual(SM.scrub(paused, '52/17', -50, 0).offsetMs, 0);
  const hi = SM.scrub(paused, '52/17', 1e12, 0);
  assert.strictEqual(hi.offsetMs, W52 - 1);
  assert.strictEqual(SM.view('52/17', hi.offsetMs).phase, 'work');
  // in rest: relative to rest start
  const inRest = SM.start(SM.initialTimer(), '52/17', 0);
  const restNow = W52 + A + 5000;
  t = SM.scrub(inRest, '52/17', 120000, restNow);
  assert.strictEqual(t.offsetMs, W52 + A + 120000);
  assert.strictEqual(SM.scrub(inRest, '52/17', -1, restNow).offsetMs, W52 + A);
  assert.strictEqual(SM.scrub(inRest, '52/17', 1e12, restNow).offsetMs, W52 + A + R52 - 1);
});

test('scrub is a no-op during alarm and done', () => {
  const run = SM.start(SM.initialTimer(), '52/17', 0);
  assert.strictEqual(SM.scrub(run, '52/17', 1000, W52 + 1), run);
  assert.strictEqual(SM.scrub(run, '52/17', 1000, W52 + A + R52 + 1), run);
  assert.strictEqual(SM.scrub(run, '52/17', 1000, T52 + 1), run);
});

test('reset', () => {
  assert.deepStrictEqual(SM.reset(), SM.initialTimer());
  assert.notStrictEqual(SM.reset(), SM.reset());
});

test('isStarted', () => {
  assert.strictEqual(SM.isStarted({ anchorAt: null, offsetMs: 0, paused: true }), false);
  assert.strictEqual(SM.isStarted({ anchorAt: null, offsetMs: 5, paused: true }), true);
  assert.strictEqual(SM.isStarted({ anchorAt: 1, offsetMs: 0, paused: false }), true);
});

test('transitions do not mutate inputs and return new objects', () => {
  const t = Object.freeze({ anchorAt: 1000, offsetMs: 500, paused: false });
  const p = SM.pause(t, '52/17', 5000);
  assert.notStrictEqual(p, t);
  assert.deepStrictEqual(t, { anchorAt: 1000, offsetMs: 500, paused: false });
  const frozenPaused = Object.freeze({ anchorAt: null, offsetMs: 0, paused: true });
  assert.notStrictEqual(SM.start(frozenPaused, '52/17', 1), frozenPaused);
  assert.notStrictEqual(SM.scrub(frozenPaused, '52/17', 1000, 1), frozenPaused);
  assert.deepStrictEqual(frozenPaused, { anchorAt: null, offsetMs: 0, paused: true });
  SM.schedule('52/17')[0].durationMs = 1;
  assert.strictEqual(SM.schedule('52/17')[0].durationMs, W52);
});
