// Timer state is intentionally kept in one object because this is a small, dependency-free app.
var S = {
  screen: 'config', mode: '52/17', exerciseSnacks: false,
  phase: 'work', totalSeconds: 0, elapsedSeconds: 0,
  running: false, paused: false, rafId: null,
  alarmTimeout: null, snackTimeout: null, triggeredSnacks: {}, dragging: false,
  startedAt: null
};

function workSec() { return S.mode === '52/17' ? 52*60 : 112*60; }
function restSec() { return S.mode === '52/17' ? 17*60 : 26*60; }
function snackMins() { return S.mode === '52/17' ? [25] : [25, 55, 85]; }
function fmt(sec) { return String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0'); }

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
  var label = S.phase === 'work' ? 'Focus' : 'Break';
  document.title = fmt(S.elapsedSeconds) + ' / ' + fmt(S.totalSeconds) + ' ' + label + ' \u2014 DEEP WORK';
}

function checkExerciseSnacks() {
  if (!S.exerciseSnacks || S.phase !== 'work') return;
  var elapsedMinutes = Math.floor(S.elapsedSeconds / 60);
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

function completeCurrentPhase() {
  var wasWorkPhase = S.phase === 'work';
  S.running = false;
  if (S.rafId) cancelAnimationFrame(S.rafId);
  S.rafId = null;
  tick();

  S.phase = 'alarm';
  render();
  AudioEngine.playDoorChime(10);

  if (wasWorkPhase) {
    S.alarmTimeout = setTimeout(function() {
      S.phase = 'rest'; S.totalSeconds = restSec(); S.elapsedSeconds = 0;
      render(); startTimer();
    }, 10000);
  } else {
    S.alarmTimeout = setTimeout(function() { S.phase = 'done'; render(); }, 10000);
  }
}

var lastDisplayedSecond = -1;
function updateTimer() {
  if (!S.running || S.paused || S.dragging) {
    if (S.running) S.rafId = requestAnimationFrame(updateTimer);
    return;
  }
  S.elapsedSeconds = Math.floor((Date.now() - S.startedAt) / 1000);
  if (S.elapsedSeconds > S.totalSeconds) S.elapsedSeconds = S.totalSeconds;
  // Only update DOM when the displayed second changes
  if (S.elapsedSeconds !== lastDisplayedSecond) {
    lastDisplayedSecond = S.elapsedSeconds;
    checkExerciseSnacks();
    if (S.elapsedSeconds >= S.totalSeconds) {
      completeCurrentPhase();
      return;
    }
    tick();
  }
  if (S.running) S.rafId = requestAnimationFrame(updateTimer);
}

// Catch up instantly when tab becomes visible again
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && S.running && !S.paused) {
    updateTimer();
  }
});

// Keep elapsed time accurate when requestAnimationFrame is throttled in a background tab.
setInterval(function() {
  if (!S.running || S.paused || !S.startedAt) return;
  if (S.phase === 'alarm' || S.phase === 'done') return;
  // Sync elapsed from wall clock
  var elapsed = Math.floor((Date.now() - S.startedAt) / 1000);
  if (elapsed > S.totalSeconds) elapsed = S.totalSeconds;
  S.elapsedSeconds = elapsed;
  updatePageTitle();
  checkExerciseSnacks();
  // Phase completed while in background
  if (S.elapsedSeconds >= S.totalSeconds && S.running) {
    completeCurrentPhase();
  }
}, 1000);

function startTimer() {
  if (S.rafId) cancelAnimationFrame(S.rafId);
  S.running = true; S.paused = false;
  S.startedAt = Date.now() - (S.elapsedSeconds * 1000);
  S.rafId = requestAnimationFrame(updateTimer);
  render();
}

function launch() {
  S.screen = 'timer'; S.phase = 'work';
  S.totalSeconds = workSec(); S.elapsedSeconds = 0;
  S.triggeredSnacks = {}; S.running = false; S.paused = true;
  render();
}

function togglePause() {
  if (!S.running) { startTimer(); }
  else {
    S.paused = !S.paused;
    if (!S.paused) {
      S.startedAt = Date.now() - (S.elapsedSeconds * 1000);
      S.rafId = requestAnimationFrame(updateTimer);
    }
    render();
  }
}

function cancelTimerEvents() {
  if (S.rafId) cancelAnimationFrame(S.rafId);
  if (S.alarmTimeout) clearTimeout(S.alarmTimeout);
  S.rafId = null;
  S.alarmTimeout = null;
  hideSnack();
}

function resetTimer() {
  cancelTimerEvents();
  S.phase = 'work'; S.totalSeconds = workSec(); S.elapsedSeconds = 0;
  S.triggeredSnacks = {}; S.paused = false; S.running = false;
  S.startedAt = null;
  document.title = 'DEEP WORK TERMINAL';
  render();
}

function goBack() {
  cancelTimerEvents();
  S.screen = 'config'; S.running = false; S.paused = false;
  S.phase = 'work'; document.title = 'DEEP WORK TERMINAL'; render();
}

function setupDrag() {
  var track = document.getElementById('progress-track');
  if (!track) return;
  function setFromX(cx) {
    var rect = track.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
    S.elapsedSeconds = Math.round(pct * S.totalSeconds);
    if (S.exerciseSnacks && S.phase === 'work') {
      var eMin = Math.floor(S.elapsedSeconds / 60);
      var kept = {};
      Object.keys(S.triggeredSnacks).forEach(function(k) { if (parseInt(k) <= eMin) kept[k] = true; });
      S.triggeredSnacks = kept;
    }
    tick();
    // Keep startedAt in sync with manual elapsed change
    if (S.running && S.startedAt) {
      S.startedAt = Date.now() - (S.elapsedSeconds * 1000);
    }
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

