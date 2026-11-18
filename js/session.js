// SESSION MODEL
// Pure, DOM-free description of a focus session as a function of elapsed time:
//   [work W] [alarm 10s] [rest R] [alarm 10s] [done]
// A "timer" is { anchorAt, offsetMs, paused }. All transitions return NEW objects.
var SessionModel = (function() {
  var ALARM_MS = 10000;
  var MODES = {
    '52/17':  { workSec: 3120, restSec: 1020, snackMins: [25] },
    '112/26': { workSec: 6720, restSec: 1560, snackMins: [25, 55, 85] }
  };

  function modeConfig(mode) {
    var m = MODES[mode];
    if (!m) throw new Error('Unknown mode: ' + mode);
    return m;
  }

  function schedule(mode) {
    var m = modeConfig(mode);
    var workMs = m.workSec * 1000, restMs = m.restSec * 1000;
    return [
      { phase: 'work',  alarmAfter: null,   startMs: 0,                         durationMs: workMs },
      { phase: 'alarm', alarmAfter: 'work', startMs: workMs,                    durationMs: ALARM_MS },
      { phase: 'rest',  alarmAfter: null,   startMs: workMs + ALARM_MS,         durationMs: restMs },
      { phase: 'alarm', alarmAfter: 'rest', startMs: workMs + ALARM_MS + restMs, durationMs: ALARM_MS }
    ];
  }

  function totalMs(mode) {
    var m = modeConfig(mode);
    return (m.workSec + m.restSec) * 1000 + 2 * ALARM_MS;
  }

  function initialTimer() {
    return { anchorAt: null, offsetMs: 0, paused: true };
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // The timer carries no mode, so the upper clamp to the session length only applies when the
  // optional `mode` argument is given. view() always clamps.
  function elapsedMs(timer, nowMs, mode) {
    var e = timer.paused || timer.anchorAt === null
      ? timer.offsetMs
      : timer.offsetMs + (nowMs - timer.anchorAt);
    if (e < 0) e = 0;
    if (mode !== undefined) e = Math.min(e, totalMs(mode));
    return e;
  }

  function view(mode, elapsed) {
    var sched = schedule(mode);
    var total = totalMs(mode);
    var e = clamp(elapsed, 0, total);
    for (var i = 0; i < sched.length; i++) {
      var s = sched[i];
      if (e < s.startMs + s.durationMs) {
        var pe = e - s.startMs;
        return {
          phase: s.phase, alarmAfter: s.alarmAfter, index: i,
          phaseStartMs: s.startMs, phaseDurationMs: s.durationMs, phaseElapsedMs: pe,
          phaseElapsedSec: Math.floor(pe / 1000), phaseTotalSec: s.durationMs / 1000,
          sessionElapsedMs: e
        };
      }
    }
    return {
      phase: 'done', alarmAfter: null, index: 4,
      phaseStartMs: total, phaseDurationMs: 0, phaseElapsedMs: 0,
      phaseElapsedSec: 0, phaseTotalSec: 0, sessionElapsedMs: total
    };
  }

  function isStarted(timer) {
    return timer.anchorAt !== null || timer.offsetMs > 0;
  }

  function viewNow(timer, mode, nowMs) {
    return view(mode, elapsedMs(timer, nowMs, mode));
  }

  function start(timer, mode, nowMs) {
    if (!timer.paused) return timer;
    if (viewNow(timer, mode, nowMs).phase === 'done') return timer;
    return { anchorAt: nowMs, offsetMs: timer.offsetMs, paused: false };
  }

  function pause(timer, mode, nowMs) {
    if (timer.paused) return timer;
    var v = viewNow(timer, mode, nowMs);
    if (v.phase === 'alarm' || v.phase === 'done') return timer;
    return { anchorAt: timer.anchorAt, offsetMs: v.sessionElapsedMs, paused: true };
  }

  // Scrub within the current work/rest phase. The position is clamped to
  // [0, phaseDurationMs - 1] so a scrub can never land on the alarm boundary.
  function scrub(timer, mode, phaseElapsedMs, nowMs) {
    var v = viewNow(timer, mode, nowMs);
    if (v.phase !== 'work' && v.phase !== 'rest') return timer;
    var ms = clamp(phaseElapsedMs, 0, v.phaseDurationMs - 1);
    return {
      anchorAt: timer.paused ? timer.anchorAt : nowMs,
      offsetMs: v.phaseStartMs + ms,
      paused: timer.paused
    };
  }

  function reset() { return initialTimer(); }

  return {
    ALARM_MS: ALARM_MS, MODES: MODES,
    schedule: schedule, totalMs: totalMs, initialTimer: initialTimer,
    elapsedMs: elapsedMs, view: view, isStarted: isStarted,
    start: start, pause: pause, scrub: scrub, reset: reset
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SessionModel;
