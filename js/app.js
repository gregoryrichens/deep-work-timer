function render() {
  var app = document.getElementById('app');
  if (S.screen === 'config') { app.innerHTML = renderConfig(); bindConfig(); }
  else { app.innerHTML = renderTimer(); bindTimer(); setupDrag(); }
}

function renderConfig() {
  return '<div class="terminal-panel">' +
    '<div class="corner-bl"></div><div class="corner-br"></div>' +
    '<div class="header"><h1>DEEP WORK</h1><div class="subtitle">Productivity Terminal v2.7</div></div>' +
    '<div class="h-rule"></div>' +
    '<div class="config-section"><span class="config-label">Select Timer Protocol</span>' +
    '<div class="mode-selector">' +
    '<button type="button" class="mode-btn '+(S.mode==='52/17'?'active':'')+'" data-mode="52/17" aria-pressed="'+(S.mode==='52/17')+'"><span class="mode-time">52m <span class="mode-sub">focus</span> / 17m <span class="mode-sub">break</span></span><span class="mode-desc">Standard cycle</span></button>' +
    '<button type="button" class="mode-btn '+(S.mode==='112/26'?'active':'')+'" data-mode="112/26" aria-pressed="'+(S.mode==='112/26')+'"><span class="mode-time">112m <span class="mode-sub">focus</span> / 26m <span class="mode-sub">break</span></span><span class="mode-desc">Deep focus cycle</span></button>' +
    '</div></div>' +
    '<div class="config-section"><span class="config-label">Options</span>' +
    '<button type="button" class="checkbox-container '+(S.exerciseSnacks?'checked':'')+'" id="snack-toggle" aria-pressed="'+S.exerciseSnacks+'">' +
    '<div class="custom-checkbox"><span class="check-mark">\u2713</span></div>' +
    '<div class="checkbox-text">Exercise Snacks<small>Movement reminders during focus</small></div>' +
    '</button></div>' +
    '<div class="h-rule"></div>' +
    '<button type="button" class="launch-btn" id="launch-btn">LET\u2019S BUILD!</button></div>';
}

function renderTimer() {
  var ph = S.phase, isAlarm = ph==='alarm', isDone = ph==='done';
  var label = ph==='work'?'Focus Mode Active':ph==='rest'?'Rest Period':ph==='alarm'?'Phase Complete':'Session Complete';
  var pct = S.totalSeconds > 0 ? (S.elapsedSeconds / S.totalSeconds) * 100 : 100;
  var time = (isDone||isAlarm) ? fmt(S.totalSeconds) : fmt(S.elapsedSeconds);
  var showPlay = (!S.running || S.paused);

  var controls = '';
  if (!isDone && !isAlarm) {
    controls =
      '<button type="button" class="ctrl-btn" id="pause-btn" aria-label="'+(showPlay ? 'Start timer' : 'Pause timer')+'">' +
        (showPlay ? '<svg viewBox="0 0 24 24"><polygon points="6,3 20,12 6,21"/></svg>'
                  : '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>') +
      '</button>' +
      '<button type="button" class="ctrl-btn" id="reset-btn" aria-label="Reset timer">' +
        '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24L14 10h7V3l-3.35 3.35z"/></svg></button>';
  } else if (isDone) {
    controls =
      '<button type="button" class="replay-btn" id="reset-btn">' +
        '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24L14 10h7V3l-3.35 3.35z"/></svg> REPLAY</button>';
  }

  var status = '';
  if (!S.running && !isDone && !isAlarm) status = '<div class="session-info" style="color:var(--pip-bright);">// READY \u2014 PRESS PLAY</div>';
  else if (S.paused && S.running) status = '<div class="session-info" style="color:var(--pip-bright);">// PAUSED</div>';
  else if (isAlarm) status = '<div class="session-info">// Transitioning...</div>';
  else if (isDone) status = '<div class="done-message">Great work. Press replay to begin again.</div>';

  return '<div class="terminal-panel">' +
    '<div class="corner-bl"></div><div class="corner-br"></div>' +
    '<button type="button" class="back-btn" id="back-btn">\u25c2 CONFIG</button>' +
    '<div class="header"><h1>DEEP WORK</h1>' +
    '<div class="subtitle">Protocol '+S.mode+(S.exerciseSnacks?' // Snacks ON':'')+'</div></div>' +
    '<div class="h-rule"></div>' +
    '<div class="timer-screen">' +
    '<div class="phase-label'+(isDone?' done':'')+'">' + label + '</div>' +
    '<div class="timer-display'+(isDone?' done':'')+'" id="timer-text" aria-live="polite">' + time + '</div>' +
    '<div class="progress-track" id="progress-track" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="'+S.totalSeconds+'" aria-valuenow="'+S.elapsedSeconds+'">' +
      '<div class="progress-fill" id="progress-fill" style="width:'+pct+'%"></div>' +
    '</div>' +
    '<div class="controls">' + controls + '</div>' +
    status + '</div></div>';
}

function bindConfig() {
  document.querySelectorAll('.mode-btn').forEach(function(b) {
    b.addEventListener('click', function() { S.mode = b.dataset.mode; render(); });
  });
  var st = document.getElementById('snack-toggle');
  if (st) st.addEventListener('click', function() { S.exerciseSnacks = !S.exerciseSnacks; render(); });
  var lb = document.getElementById('launch-btn');
  if (lb) lb.addEventListener('click', launch);
}

function bindTimer() {
  var pb = document.getElementById('pause-btn');
  if (pb) pb.addEventListener('click', togglePause);
  var rb = document.getElementById('reset-btn');
  if (rb) rb.addEventListener('click', resetTimer);
  var bb = document.getElementById('back-btn');
  if (bb) bb.addEventListener('click', goBack);
}

render();
