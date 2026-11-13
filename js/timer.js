// Timer state is intentionally kept in one object because this is a small, dependency-free app.
// Session progress lives in `timer` (a SessionModel timer object); phase, totalSeconds, elapsedSeconds,
// running and paused are DERIVED from it by derive() on every frame/tick and read by app.js.
var S = {
  screen: 'config', mode: '52/17', exerciseSnacks: false,
  timer: SessionModel.initialTimer(), viewIndex: 0,
  phase: 'work', alarmAfter: null, totalSeconds: 0, elapsedSeconds: 0,
  running: false, paused: false, rafId: null,
  snackTimeout: null, triggeredSnacks: {}, dragging: false
};

// Seams for the room client: swap the clock (local vs server-corrected) and the timer source
// (local controls vs pushed from the server). Everything else goes through these.
function now() { return Date.now(); }
function getTimer() { return S.timer; }
function applyTimer(timer) { S.timer = timer; derive(); }

function modeCfg() { return SessionModel.MODES[S.mode]; }
function snackMins() { return modeCfg().snackMins; }
function fmt(sec) { return String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0'); }

// Derive the view fields of S from the timer object and the clock. Returns the SessionModel view.
function derive() {
  var timer = getTimer();
  var v = SessionModel.view(S.mode, SessionModel.elapsedMs(timer, now(), S.mode));
  var cfg = modeCfg();
  S.phase = v.phase; S.alarmAfter = v.alarmAfter;
  if (v.phase === 'work' || v.phase === 'rest') {
    S.totalSeconds = v.phaseTotalSec; S.elapsedSeconds = v.phaseElapsedSec;
  } else {
    // alarm and done screens show the just-finished phase in full
    S.totalSeconds = (v.alarmAfter === 'work') ? cfg.workSec : cfg.restSec;
    S.elapsedSeconds = S.totalSeconds;
  }
  var inPlay = v.phase === 'work' || v.phase === 'rest';
  S.running = inPlay && timer.anchorAt !== null;   // started (running or paused) and not in alarm/done
  S.paused = inPlay ? timer.paused : false;
  return v;
}

function showSnack() {
  document.getElementById('snack-layer').classList.add('visible');
  AudioEngine.playYeahBuddy();
  if (S.snackTimeout) clearTimeout(S.snackTimeout);
  S.snackTimeout = setTimeout(hideSnack, 10000);
}
function hideSnack() {
  if (S.snackTimeout) clearTimeout(S.snackTimeout);
  document.getElementById('snack-layer').classList.remove('visible');
  S.snackTimeout = null;
}

function updatePageTitle() {
  var label = (S.phase === 'work' || S.alarmAfter === 'work') ? 'Focus' : 'Break';
  document.title = fmt(S.elapsedSeconds) + ' / ' + fmt(S.totalSeconds) + ' ' + label + ' \u2014 DEEP WORK';
}

function checkExerciseSnacks(phase, elapsedSeconds) {
  if (!S.exerciseSnacks || phase !== 'work') return;
  var elapsedMinutes = Math.floor(elapsedSeconds / 60);
  snackMins().forEach(function(minute) {
    if (elapsedMinutes >= minute && !S.triggeredSnacks[minute]) {
      S.triggeredSnacks[minute] = true;
      showSnack();
    }
  });
}

function tick() {
  var el = document.getElementById('timer-text');
  var fill = document.getElementById('progress-fill');
  if (el) el.textContent = fmt(S.elapsedSeconds);
  var pct = S.totalSeconds > 0 ? (S.elapsedSeconds / S.totalSeconds) * 100 : 0;
  if (fill) fill.style.width = pct + '%';
  var track = document.getElementById('progress-track');
  if (track) track.setAttribute('aria-valuenow', S.elapsedSeconds);
  updatePageTitle();
}

// True while the clock is advancing the session (includes the alarm phases and the auto-started rest).
function isAdvancing() {
  return S.screen === 'timer' && !getTimer().paused && S.phase !== 'done';
}

// Single update path for requestAnimationFrame, the 1s interval and visibilitychange.
// Phase transitions come from the view's index changing; the chime is played only when this
// client observes a live single-step transition into an alarm phase while the timer is running.
var lastDisplayedSecond = -1;
function sync() {
  if (S.screen !== 'timer') return;
  var prevIndex = S.viewIndex, prevPhase = S.phase;
  var timerRunning = !getTimer().paused;
  var v = derive();
  if (v.index !== prevIndex) {
    S.viewIndex = v.index;
    lastDisplayedSecond = -1;
    if (prevPhase === 'work') checkExerciseSnacks('work', modeCfg().workSec);
    updatePageTitle();
    render();
    if ((v.phase === 'alarm') && timerRunning && v.index === prevIndex + 1) AudioEngine.playDoorChime(10);
    return;
  }
  if (S.running && !S.paused) checkExerciseSnacks(S.phase, S.elapsedSeconds);
  if (S.elapsedSeconds !== lastDisplayedSecond) {
    lastDisplayedSecond = S.elapsedSeconds;
    tick();
  }
}

function updateTimer() {
  S.rafId = null;
  if (!isAdvancing()) return;
  if (!S.dragging) sync();
  if (isAdvancing() && S.rafId === null) S.rafId = requestAnimationFrame(updateTimer);
}

function ensureLoop() {
  if (S.rafId === null && isAdvancing()) S.rafId = requestAnimationFrame(updateTimer);
}

// Catch up instantly when tab becomes visible again
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && isAdvancing()) sync();
});

// Keep elapsed time accurate when requestAnimationFrame is throttled in a background tab.
setInterval(function() {
  if (isAdvancing()) { sync(); ensureLoop(); }
}, 1000);

function startTimer() {
  applyTimer(SessionModel.start(getTimer(), S.mode, now()));
  S.viewIndex = SessionModel.view(S.mode, SessionModel.elapsedMs(getTimer(), now(), S.mode)).index;
  lastDisplayedSecond = -1;
  render();
  ensureLoop();
}

function launch() {
  S.screen = 'timer';
  S.triggeredSnacks = {};
  applyTimer(SessionModel.reset());
  S.viewIndex = 0; lastDisplayedSecond = -1;
  render();
}

function togglePause() {
  if (getTimer().paused) { startTimer(); }
  else {
    applyTimer(SessionModel.pause(getTimer(), S.mode, now()));
    render();
  }
}

function cancelTimerEvents() {
  if (S.rafId) cancelAnimationFrame(S.rafId);
  S.rafId = null;
  hideSnack();
}

function resetTimer() {
  cancelTimerEvents();
  S.triggeredSnacks = {};
  applyTimer(SessionModel.reset());
  S.viewIndex = 0; lastDisplayedSecond = -1;
  document.title = 'DEEP WORK TERMINAL';
  render();
}

function goBack() {
  cancelTimerEvents();
  S.screen = 'config';
  applyTimer(SessionModel.reset());
  S.viewIndex = 0;
  document.title = 'DEEP WORK TERMINAL'; render();
}

function setupDrag() {
  var track = document.getElementById('progress-track');
  if (!track) return;
  function setFromX(cx) {
    // Scrubbing only applies within a work/rest phase (the model ignores alarm/done)
    if (S.phase !== 'work' && S.phase !== 'rest') return;
    var rect = track.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
    var ms = Math.round(pct * S.totalSeconds) * 1000;
    applyTimer(SessionModel.scrub(getTimer(), S.mode, ms, now()));
    if (S.exerciseSnacks && S.phase === 'work') {
      var eMin = Math.floor(S.elapsedSeconds / 60);
      var kept = {};
      Object.keys(S.triggeredSnacks).forEach(function(k) { if (parseInt(k) <= eMin) kept[k] = true; });
      S.triggeredSnacks = kept;
    }
    tick();
  }
  function onDown(cx) {
    S.dragging = true; setFromX(cx);
    function onMove(e) { setFromX(e.clientX !== undefined ? e.clientX : e.touches[0].clientX); }
    function onUp() {
      S.dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }
  track.addEventListener('mousedown', function(e) { e.preventDefault(); onDown(e.clientX); });
  track.addEventListener('touchstart', function(e) { e.preventDefault(); onDown(e.touches[0].clientX); }, { passive: false });
}

