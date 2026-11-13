var esc = RoomHelpers.escapeHtml;

function render() {
  var app = document.getElementById('app');
  if (S.screen === 'config') { app.innerHTML = renderConfig(); bindConfig(); }
  else if (S.screen === 'join') { captureJoinInputs(); app.innerHTML = renderJoin(); bindJoin(); }
  else { app.innerHTML = renderTimer(); bindTimer(); setupDrag(); }
}

function roomsAvailable() { return location.protocol === 'http:' || location.protocol === 'https:'; }

function renderConfig() {
  var roomRow = roomsAvailable()
    ? '<button type="button" class="launch-btn room-btn" id="room-btn"' + (S.creating ? ' disabled' : '') + '>START A ROOM</button>'
    : '';
  var roomExtra = roomsAvailable()
    ? '<div class="room-create">' +
      (S.showRoomPass
        ? '<label class="field-label" for="room-pass">Room passphrase <span class="opt">(optional, 4–64 chars)</span></label>' +
          '<input type="password" class="text-input" id="room-pass" maxlength="64" autocomplete="new-password" value="' + esc(S.roomPass) + '">'
        : '<button type="button" class="link-btn" id="room-pass-toggle">+ ADD ROOM PASSPHRASE</button>') +
      '<div class="room-status" id="room-status" role="status">' + esc(S.createMsg) + '</div></div>'
    : '';
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
    '<div class="custom-checkbox"><span class="check-mark">✓</span></div>' +
    '<div class="checkbox-text">Exercise Snacks<small>Movement reminders during focus</small></div>' +
    '</button></div>' +
    '<div class="h-rule"></div>' +
    '<div class="launch-row"><button type="button" class="launch-btn" id="launch-btn">LET’S BUILD!</button>' + roomRow + '</div>' +
    roomExtra + '</div>';
}

// ===== Room: join panel =====
function renderModeButtons() {
  return '<div class="mode-selector room-mode">' +
    '<button type="button" class="mode-btn '+(S.mode==='52/17'?'active':'')+'" data-mode="52/17" aria-pressed="'+(S.mode==='52/17')+'"><span class="mode-time">52m <span class="mode-sub">focus</span> / 17m <span class="mode-sub">break</span></span></button>' +
    '<button type="button" class="mode-btn '+(S.mode==='112/26'?'active':'')+'" data-mode="112/26" aria-pressed="'+(S.mode==='112/26')+'"><span class="mode-time">112m <span class="mode-sub">focus</span> / 26m <span class="mode-sub">break</span></span></button>' +
    '</div>';
}

function captureJoinInputs() {
  var n = document.getElementById('join-name'), p = document.getElementById('join-pass');
  if (n) S.joinName = n.value;
  if (p) S.joinPass = p.value;
}

function renderJoin() {
  var st = Room.status;
  var head = '<div class="corner-bl"></div><div class="corner-br"></div>' +
    '<button type="button" class="back-btn" id="back-btn">◂ CONFIG</button>' +
    '<div class="header"><h1>DEEP WORK</h1><div class="subtitle">Shared Room</div></div>' +
    '<div class="h-rule"></div>';
  var body;
  if (st === 'expired') {
    body = '<div class="room-msg err">// ROOM EXPIRED — START A NEW ONE</div>' +
      '<button type="button" class="launch-btn" id="join-home-btn">NEW ROOM</button>';
  } else if (st === 'full') {
    body = '<div class="room-msg err">// ROOM FULL — TRY AGAIN LATER</div>' +
      '<button type="button" class="launch-btn" id="join-retry-btn">TRY AGAIN</button>';
  } else if (st === 'closed') {
    body = '<div class="room-msg err">// DISCONNECTED BY SERVER</div>' +
      '<button type="button" class="launch-btn" id="join-retry-btn">TRY AGAIN</button>';
  } else if (st === 'failed') {
    body = '<div class="room-msg err">// COULD NOT REACH ROOM</div>' +
      '<button type="button" class="launch-btn" id="join-retry-btn">TRY AGAIN</button>';
  } else {
    var needPass = st === 'authRequired' || st === 'authFailed';
    var wait = Math.max(0, Math.ceil((Room.retryUntil - Date.now()) / 1000));
    var busy = st === 'connecting' || st === 'reconnecting';
    var msg = '';
    if (S.joinError) msg = '<div class="room-msg err">' + esc(S.joinError) + '</div>';
    else if (st === 'authFailed') msg = '<div class="room-msg err">// ' + (wait > 0 ? 'TOO MANY ATTEMPTS — RETRY IN ' + esc(fmtWait(wait)) : 'WRONG PASSWORD') + '</div>';
    else if (st === 'authRequired') msg = '<div class="room-msg">// THIS ROOM IS PASSWORD PROTECTED</div>';
    else if (busy) msg = '<div class="room-msg">// CONNECTING...</div>';
    body = '<form id="join-form" novalidate>' +
      '<div class="config-section"><label class="config-label" for="join-name">Display Name</label>' +
      '<input type="text" class="text-input" id="join-name" maxlength="24" autocomplete="nickname" placeholder="1–24 characters" value="' + esc(S.joinName) + '"' + (busy ? ' readonly' : '') + '></div>' +
      (needPass
        ? '<div class="config-section"><label class="config-label" for="join-pass">Room Password</label>' +
          '<input type="password" class="text-input" id="join-pass" maxlength="64" autocomplete="current-password" value="' + esc(S.joinPass) + '"></div>'
        : '') +
      '<div class="config-section"><button type="button" class="checkbox-container '+(S.exerciseSnacks?'checked':'')+'" id="snack-toggle" aria-pressed="'+S.exerciseSnacks+'">' +
      '<div class="custom-checkbox"><span class="check-mark">✓</span></div>' +
      '<div class="checkbox-text">Exercise Snacks<small>Movement reminders during focus (just for you)</small></div></button></div>' +
      msg +
      '<button type="submit" class="launch-btn" id="join-btn"' + ((busy || wait > 0) ? ' disabled' : '') + '>' + (busy ? 'CONNECTING...' : 'JOIN') + '</button></form>';
  }
  return '<div class="terminal-panel room-panel">' + head + '<div class="join-panel">' + body + '</div></div>';
}

function fmtWait(sec) {
  return sec >= 60 ? Math.ceil(sec / 60) + ' MIN' : sec + ' S';
}

function bindJoin() {
  var bb = document.getElementById('back-btn');
  if (bb) bb.addEventListener('click', function() { leaveRoom(true); });
  var form = document.getElementById('join-form');
  if (form) form.addEventListener('submit', function(e) { e.preventDefault(); submitJoin(); });
  var st = document.getElementById('snack-toggle');
  if (st) st.addEventListener('click', function() { captureJoinInputs(); S.exerciseSnacks = !S.exerciseSnacks; render(); });
  var home = document.getElementById('join-home-btn');
  if (home) home.addEventListener('click', function() { leaveRoom(true); });
  var retry = document.getElementById('join-retry-btn');
  if (retry) retry.addEventListener('click', function() { S.joinError = null; Room.join(S.roomId, RoomHelpers.validName(S.joinName) || 'Guest', null); });
  var pass = document.getElementById('join-pass');
  if (pass && !S.joinPass) pass.focus();
  // Re-enable JOIN when a lockout ends.
  if (Room.status === 'authFailed' && Room.retryUntil > Date.now()) {
    setTimeout(function() { if (S.screen === 'join') render(); }, Room.retryUntil - Date.now() + 100);
  }
}

function submitJoin() {
  captureJoinInputs();
  var name = RoomHelpers.validName(S.joinName);
  if (!name) { S.joinError = '// NAME MUST BE 1–24 CHARACTERS'; render(); return; }
  var needPass = Room.status === 'authRequired' || Room.status === 'authFailed';
  if (needPass && !S.joinPass) { S.joinError = '// ENTER THE ROOM PASSWORD'; render(); return; }
  S.joinError = null;
  S.joinName = name;
  Room.setName(name);
  AudioEngine.playDoorChime(0);   // creates/resumes the AudioContext inside this user gesture so later chimes can play
  var pw = needPass ? S.joinPass : null;
  S.joinPass = '';
  Room.join(S.roomId, name, pw);
}

// ===== Room: timer screen pieces =====
function lockIcon() {
  return '<svg class="lock-icon" viewBox="0 0 24 24" role="img" aria-label="Password protected"><title>Password protected</title>' +
    '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
}

function renderInvite() {
  var host = Room.isHost();
  var h = '<span class="invite-label">ROOM</span><span class="invite-code" title="Room code">' + esc(RoomHelpers.shortRoomCode(S.roomId)) + '</span>' +
    (Room.protected ? lockIcon() : '') +
    '<button type="button" class="mini-btn" id="copy-btn">COPY LINK</button>';
  if (host && !S.passEdit) {
    h += '<button type="button" class="mini-btn" id="pass-change-btn">' + (Room.protected ? 'CHANGE PASSWORD' : 'ADD PASSWORD') + '</button>';
    if (Room.protected) h += '<button type="button" class="mini-btn" id="pass-remove-btn">REMOVE PASSWORD</button>';
  }
  if (host && S.passEdit) {
    h += '<span class="pass-edit"><input type="password" class="text-input small" id="pass-input" maxlength="64" placeholder="4–64 chars" autocomplete="new-password" aria-label="New room password">' +
      '<button type="button" class="mini-btn" id="pass-set-btn">SET</button>' +
      '<button type="button" class="mini-btn" id="pass-cancel-btn">CANCEL</button></span>';
  }
  return h;
}

function renderRoster() {
  var t = Room.now();
  var ms = Room.members || [];
  var items = ms.map(function(m) {
    var isMe = m.clientId === Room.you;
    var isH = m.isHost === true || m.clientId === Room.hostId;
    return '<li class="member ' + esc(RoomHelpers.statusClass(m.status)) + '">' +
      '<span class="m-dot"></span>' +
      '<span class="m-name">' + esc(m.name) + (isMe ? ' <span class="m-you">(you)</span>' : '') + '</span>' +
      (isH ? '<span class="m-host" title="Host">HOST</span>' : '') +
      '<span class="m-status">' + esc(RoomHelpers.statusLabel(m, t)) + '</span></li>';
  }).join('');
  return '<div class="roster-title">// IN THE ROOM (' + esc(ms.length) + ')</div><ul class="roster">' + items + '</ul>';
}

function renderConnBar() {
  return Room.status === 'reconnecting' ? '<div class="conn-bar" role="status">// RECONNECTING...</div>' : '';
}

function updateRoster() {
  var el = document.getElementById('roster');
  if (el && S.screen === 'timer' && S.roomId) el.innerHTML = renderRoster();
}
function updateInvite() {
  var el = document.getElementById('invite-bar');
  if (el && S.screen === 'timer' && S.roomId) { el.innerHTML = renderInvite(); bindInvite(); }
  var cb = document.getElementById('conn-wrap');
  if (cb) cb.innerHTML = renderConnBar();
}

function renderTimer() {
  var ph = S.phase, isAlarm = ph==='alarm', isDone = ph==='done';
  var room = isRoom(), canControl = isHost();
  var label = ph==='work'?'Focus Mode Active':ph==='rest'?'Rest Period':ph==='alarm'?'Phase Complete':'Session Complete';
  var pct = S.totalSeconds > 0 ? (S.elapsedSeconds / S.totalSeconds) * 100 : 100;
  var time = (isDone||isAlarm) ? fmt(S.totalSeconds) : fmt(S.elapsedSeconds);
  var showPlay = (!S.running || S.paused);

  var controls = '';
  if (!canControl) {
    controls = '';
  } else if (!isDone && !isAlarm) {
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
  if (!S.running && !isDone && !isAlarm) status = '<div class="session-info" style="color:var(--pip-bright);">' + (canControl ? '// READY — PRESS PLAY' : '// READY — WAITING FOR HOST') + '</div>';
  else if (S.paused && S.running) status = '<div class="session-info" style="color:var(--pip-bright);">// PAUSED</div>';
  else if (isAlarm) status = '<div class="session-info">// Transitioning...</div>';
  else if (isDone) status = '<div class="done-message">' + (canControl ? 'Great work. Press replay to begin again.' : 'Great work.') + '</div>';
  if (room && !canControl) status += '<div class="session-info host-note">// HOST CONTROLS THE TIMER</div>';

  var modePick = (room && canControl && !SessionModel.isStarted(getTimer())) ? renderModeButtons() : '';

  var roomTop = room
    ? '<div id="conn-wrap">' + renderConnBar() + '</div><div class="invite-bar" id="invite-bar">' + renderInvite() + '</div>'
    : '';
  var roomBottom = room ? '<div class="roster-wrap" id="roster">' + renderRoster() + '</div>' : '';

  return '<div class="terminal-panel'+(room?' room-panel':'')+'">' +
    '<div class="corner-bl"></div><div class="corner-br"></div>' +
    '<button type="button" class="back-btn" id="back-btn">' + (room ? '◂ LEAVE' : '◂ CONFIG') + '</button>' +
    '<div class="header"><h1>DEEP WORK</h1>' +
    '<div class="subtitle">Protocol '+S.mode+(S.exerciseSnacks?' // Snacks ON':'')+'</div></div>' +
    '<div class="h-rule"></div>' +
    roomTop +
    '<div class="timer-screen">' +
    modePick +
    '<div class="phase-label'+(isDone?' done':'')+'">' + label + '</div>' +
    '<div class="timer-display'+(isDone?' done':'')+'" id="timer-text" aria-live="polite">' + time + '</div>' +
    '<div class="progress-track'+(room && !canControl ? ' locked' : '')+'" id="progress-track" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="'+S.totalSeconds+'" aria-valuenow="'+S.elapsedSeconds+'">' +
      '<div class="progress-fill" id="progress-fill" style="width:'+pct+'%"></div>' +
    '</div>' +
    '<div class="controls">' + controls + '</div>' +
    status + '</div>' + roomBottom + '</div>';
}

// ===== Binding =====
function bindConfig() {
  document.querySelectorAll('.mode-btn').forEach(function(b) {
    b.addEventListener('click', function() { S.mode = b.dataset.mode; render(); });
  });
  var st = document.getElementById('snack-toggle');
  if (st) st.addEventListener('click', function() { S.exerciseSnacks = !S.exerciseSnacks; render(); });
  var lb = document.getElementById('launch-btn');
  if (lb) lb.addEventListener('click', launch);
  var rb = document.getElementById('room-btn');
  if (rb) rb.addEventListener('click', createRoom);
  var pt = document.getElementById('room-pass-toggle');
  if (pt) pt.addEventListener('click', function() { S.showRoomPass = true; render(); var i = document.getElementById('room-pass'); if (i) i.focus(); });
  var pi = document.getElementById('room-pass');
  if (pi) {
    pi.addEventListener('input', function() { S.roomPass = pi.value; });
    pi.addEventListener('keydown', function(e) { if (e.key === 'Enter') createRoom(); });
  }
}

function bindTimer() {
  var pb = document.getElementById('pause-btn');
  if (pb) pb.addEventListener('click', togglePause);
  var rb = document.getElementById('reset-btn');
  if (rb) rb.addEventListener('click', resetTimer);
  var bb = document.getElementById('back-btn');
  if (bb) bb.addEventListener('click', goBack);
  if (isRoom()) {
    bindInvite();
    document.querySelectorAll('.room-mode .mode-btn').forEach(function(b) {
      b.addEventListener('click', function() { roomSend('setMode', { mode: b.dataset.mode }); });
    });
  }
}

function bindInvite() {
  var cb = document.getElementById('copy-btn');
  if (cb) cb.addEventListener('click', function() { copyInviteLink(cb); });
  var ch = document.getElementById('pass-change-btn');
  if (ch) ch.addEventListener('click', function() { S.passEdit = true; updateInvite(); var i = document.getElementById('pass-input'); if (i) i.focus(); });
  var rm = document.getElementById('pass-remove-btn');
  if (rm) rm.addEventListener('click', function() {
    if (Room.send('setPassword', { password: null })) toast('// PASSWORD REMOVED');
    else toast('// NOT CONNECTED');
  });
  var cancel = document.getElementById('pass-cancel-btn');
  if (cancel) cancel.addEventListener('click', function() { S.passEdit = false; updateInvite(); });
  var set = document.getElementById('pass-set-btn');
  var inp = document.getElementById('pass-input');
  function doSet() {
    var v = inp ? inp.value : '';
    if (!RoomHelpers.validPassword(v)) { toast('// PASSWORD MUST BE 4–64 CHARACTERS'); return; }
    if (Room.send('setPassword', { password: v })) { S.passEdit = false; toast('// PASSWORD UPDATED'); updateInvite(); }
    else toast('// NOT CONNECTED');
  }
  if (set) set.addEventListener('click', doSet);
  if (inp) inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') doSet(); else if (e.key === 'Escape') { S.passEdit = false; updateInvite(); } });
}

function copyInviteLink(btn) {
  var url = location.origin + location.pathname + '?room=' + encodeURIComponent(S.roomId);
  function ok() { btn.textContent = 'COPIED'; setTimeout(function() { btn.textContent = 'COPY LINK'; }, 1500); }
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = url; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var done = false;
    try { done = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    if (done) ok(); else toast('// COPY FAILED — COPY THE URL FROM THE ADDRESS BAR');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, fallback);
  else fallback();
}

// ===== Toasts (live outside #app so render() never wipes them) =====
function toast(text) {
  var box = document.getElementById('toasts');
  if (!box) return;
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;   // textContent: names are never parsed as HTML
  box.appendChild(el);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 4000);
}

// ===== Create / enter / leave a room =====
function setCreateStatus(msg) {
  S.createMsg = msg;
  var el = document.getElementById('room-status');
  if (el) el.textContent = msg;
  var b = document.getElementById('room-btn');
  if (b) b.disabled = !!S.creating;
}

function createRoom() {
  if (S.creating) return;
  var pass = S.roomPass || '';
  if (pass && !RoomHelpers.validPassword(pass)) { setCreateStatus('// PASSPHRASE MUST BE 4–64 CHARACTERS'); return; }
  S.creating = true;
  setCreateStatus('// OPENING ROOM...');
  fetch('/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pass ? { password: pass } : {})
  }).then(function(res) {
    return res.json().catch(function() { return {}; }).then(function(data) { return { status: res.status, data: data || {} }; });
  }).then(function(r) {
    S.creating = false;
    if (r.status === 201 && RoomHelpers.isValidRoomId(r.data.roomId)) {
      if (r.data.sessionToken) Room.setToken(r.data.roomId, r.data.sessionToken);
      S.roomPass = ''; S.showRoomPass = false; S.createMsg = '';
      S.pendingMode = S.mode;
      showJoin(r.data.roomId, true);
    } else if (r.status === 400) {
      setCreateStatus(r.data.error === 'badPassword' ? '// PASSPHRASE MUST BE 4–64 CHARACTERS' : '// BAD REQUEST');
    } else if (r.status === 429) {
      setCreateStatus('// TOO MANY ROOMS — TRY AGAIN LATER');
    } else if (r.status === 403) {
      setCreateStatus('// REQUEST REJECTED BY SERVER');
    } else {
      setCreateStatus('// SERVER ERROR (' + r.status + ')');
    }
  }).catch(function() {
    S.creating = false;
    setCreateStatus('// COULD NOT REACH SERVER');
  });
}

// Show the join panel for a room (from a created room, a ?room= URL, or history navigation).
function showJoin(roomId, push) {
  S.roomId = roomId;
  S.screen = 'join';
  S.joinName = Room.getName(); S.joinPass = ''; S.joinError = null; S.passEdit = false;
  if (push) { try { history.pushState({ room: roomId }, '', location.pathname + '?room=' + encodeURIComponent(roomId)); } catch (e) {} }
  render();
}

// ===== Room events =====
Room.on('status', function() {
  if (!S.roomId) return;
  if (S.screen === 'join') render();
  else if (S.screen === 'timer') {
    var st = Room.status;
    if (st === 'expired' || st === 'full' || st === 'closed' || st === 'failed') {
      cancelTimerEvents();
      S.screen = 'join';
      render();
    } else updateInvite();
  }
});

Room.on('welcome', function(m) {
  var timer = { mode: m.timer.mode, anchorAt: m.timer.anchorAt, offsetMs: m.timer.offsetMs, paused: m.timer.paused };
  onRoomTimer(timer, true);
  // Host who picked a protocol before creating the room applies it once, before anything is started.
  if (S.pendingMode) {
    if (Room.isHost() && !SessionModel.isStarted(timer) && S.pendingMode !== timer.mode) Room.send('setMode', { mode: S.pendingMode });
    S.pendingMode = null;
  }
  S.screen = 'timer';
  S.dragging = false;
  render();
  ensureLoop();
  if (document.hidden) Room.send('visibility', { visible: false });
});

Room.on('timer', function(timer) { if (S.roomId) onRoomTimer(timer, false); });

Room.on('members', function(prev, next) {
  var prevIds = {}, nextIds = {};
  prev.forEach(function(m) { prevIds[m.clientId] = m; });
  next.forEach(function(m) { nextIds[m.clientId] = m; });
  next.forEach(function(m) { if (!prevIds[m.clientId] && m.clientId !== Room.you) toast('// ' + String(m.name).toUpperCase() + ' JOINED'); });
  prev.forEach(function(m) { if (!nextIds[m.clientId] && m.clientId !== Room.you) toast('// ' + String(m.name).toUpperCase() + ' LEFT'); });
  updateRoster();
  if (S.lastProtected !== Room.protected) { S.lastProtected = Room.protected; updateInvite(); }   // lock icon follows `protected` from the server
});

Room.on('host', function() {
  if (S.screen !== 'timer') return;
  var me = Room.isHost();
  if (S.dragging) { updateRoster(); return; }
  render();
  ensureLoop();
  if (me) toast('// YOU ARE NOW THE HOST');
});

Room.on('error', function(m) {
  if (m.code === 'notHost') toast('// ONLY THE HOST CAN DO THAT');
  else if (m.code === 'rateLimited') toast('// SLOW DOWN — RATE LIMITED');
  else toast('// ' + String(m.message || m.code || 'ERROR').toUpperCase().slice(0, 60));
});

// "AWAY (Nm)" ticks up client-side.
setInterval(updateRoster, 15000);

// Browser back/forward between ?room= and the config screen.
window.addEventListener('popstate', function() {
  var id = RoomHelpers.parseRoomId(location.search);
  if (id === S.roomId) return;
  if (S.roomId) leaveRoom(false);
  if (id) showJoin(id, false);
});

var initialRoom = RoomHelpers.parseRoomId(location.search);
if (initialRoom) showJoin(initialRoom, false);
else render();
