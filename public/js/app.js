var esc = RoomHelpers.escapeHtml;

var PRESETS = [
  { mode: '52/17', desc: 'Standard cycle' },
  { mode: '112/26', desc: 'Deep focus cycle' }
];
var ACCESS_OPTIONS = [
  { value: 'link', label: 'Anyone with the link' },
  { value: 'password', label: 'Password protected' }
];
var TABS = [
  { id: 'solo', label: 'Solo' },
  { id: 'create', label: 'Create a room' },
  { id: 'join', label: 'Join a room' }
];

function render() {
  var app = document.getElementById('app');
  var focus = saveFocus();
  if (S.screen !== 'join') stopRoomInfo();
  if (S.screen === 'config') { app.innerHTML = renderConfig(); bindConfig(); }
  else if (S.screen === 'edit') { app.innerHTML = renderEdit(); bindEdit(); }
  else if (S.screen === 'join') { app.innerHTML = renderJoin(); bindJoin(); }
  else { app.innerHTML = renderTimer(); bindTimer(); setupDrag(); }
  restoreFocus(focus);
}

// Re-rendering replaces the DOM, so put keyboard focus (and the text caret) back where it was.
function saveFocus() {
  var el = document.activeElement;
  if (!el || !el.id || !document.getElementById('app').contains(el)) return null;
  var start = null, end = null;
  try { start = el.selectionStart; end = el.selectionEnd; } catch (e) {}
  return { id: el.id, start: start, end: end };
}

function restoreFocus(saved) {
  if (!saved) return;
  var el = document.getElementById(saved.id);
  if (!el) return;
  el.focus();
  if (saved.start !== null) { try { el.setSelectionRange(saved.start, saved.end); } catch (e) {} }
}

function roomsAvailable() {
  return RoomHelpers.roomsEnabled(typeof ROOMS_ENABLED !== 'undefined' && ROOMS_ENABLED, location.protocol);
}

// ===== Shared pieces =====
function panelHead(subtitle, backButton, withoutRule) {
  return '<div class="corner-bl"></div><div class="corner-br"></div>' + (backButton || '') +
    '<div class="header"><h1>DEEP WORK</h1>' + (subtitle ? '<div class="subtitle">' + subtitle + '</div>' : '') + '</div>' +
    (withoutRule ? '' : '<div class="h-rule"></div>');
}

function modeTimeHtml(mode) {
  var cfg = SessionModel.MODES[mode];
  return (cfg.workSec / 60) + 'm <span class="mode-sub">focus</span> / ' + (cfg.restSec / 60) + 'm <span class="mode-sub">break</span>';
}

// A square-checkmark choice. Radios give a group one selection at a time and arrow-key navigation.
function optionCard(type, name, value, checked, inner, extraClass) {
  var id = name + '-' + value.replace(/\W/g, '');
  return '<label class="mode-btn opt-card ' + (extraClass || '') + (checked ? ' active' : '') + '">' +
    '<input type="' + type + '" class="opt-input" id="' + id + '" name="' + name + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + '>' +
    '<span class="custom-checkbox" aria-hidden="true"><span class="check-mark">✓</span></span>' +
    '<span class="opt-body">' + inner + '</span></label>';
}

function presetPicker() {
  return '<div class="mode-selector" role="radiogroup" aria-label="Timer protocol">' + PRESETS.map(function(p) {
    return optionCard('radio', 'preset', p.mode, S.cfg.mode === p.mode,
      '<span class="mode-time">' + modeTimeHtml(p.mode) + '</span><span class="mode-desc">' + p.desc + '</span>');
  }).join('') + '</div>';
}

function snackToggle(hint) {
  return '<label class="checkbox-container' + (S.cfg.snacks ? ' checked' : '') + '">' +
    '<input type="checkbox" class="opt-input" id="snack-toggle" name="snacks"' + (S.cfg.snacks ? ' checked' : '') + '>' +
    '<span class="custom-checkbox" aria-hidden="true"><span class="check-mark">✓</span></span>' +
    '<span class="checkbox-text">Exercise Snacks' + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>';
}

function nameField(id, value, readonly) {
  return '<label class="field-label" for="' + id + '">Display Name</label>' +
    '<input type="text" class="text-input" id="' + id + '" maxlength="24" autocomplete="nickname" placeholder="1–24 characters" value="' + esc(value) + '"' + (readonly ? ' readonly' : '') + '>';
}

function profileSection() {
  return '<div class="config-section"><span class="config-label">User Profile</span>' +
    nameField('cfg-name', S.cfg.name) + snackToggle('') + '</div>';
}

function accessSection(keepsPassword) {
  var cards = '<div class="mode-selector" role="radiogroup" aria-label="Room access">' + ACCESS_OPTIONS.map(function(o) {
    return optionCard('radio', 'access', o.value, S.cfg.access === o.value, o.label, 'access-card');
  }).join('') + '</div>';
  var password = S.cfg.access === 'password'
    ? '<label class="field-label pass-label" for="cfg-pass">Password</label>' +
      '<input type="password" class="text-input" id="cfg-pass" maxlength="64" autocomplete="new-password" placeholder="' + (keepsPassword ? 'Unchanged' : '4–64 characters') + '" value="' + esc(S.cfg.pass) + '">'
    : '';
  return '<div class="config-section"><span class="config-label">Room Access</span>' + cards + password + '</div>';
}

function playlistSection() {
  return '<div class="config-section"><label class="config-label" for="cfg-playlist">Playlist (optional)</label>' +
    '<input type="text" class="text-input" id="cfg-playlist" maxlength="' + PlaylistLink.MAX_INPUT + '" autocomplete="off" spellcheck="false" placeholder="Paste a YouTube playlist link" value="' + esc(S.cfg.playlist) + '">' +
    '<small class="field-hint">Public or unlisted playlists only. Everyone in the room gets a link to open it.</small></div>';
}

function statusLine() {
  return '<div class="room-msg' + (S.createError ? ' err' : '') + '" id="room-status" role="status">' + esc(S.createMsg) + '</div>';
}

// Keep S.cfg in step with the form. Choices re-render (they show or hide fields); typing does not.
function bindFormFields(form) {
  form.addEventListener('change', function(e) {
    var t = e.target;
    if (t.name === 'preset') S.cfg.mode = t.value;
    else if (t.name === 'access') S.cfg.access = t.value;
    else if (t.name === 'snacks') S.cfg.snacks = t.checked;
    else return;
    S.createMsg = ''; S.createError = false;
    render();
  });
  form.addEventListener('input', function(e) {
    var t = e.target;
    if (t.id === 'cfg-name') S.cfg.name = t.value;
    else if (t.id === 'cfg-pass') S.cfg.pass = t.value;
    else if (t.id === 'cfg-link') S.cfg.link = t.value;
    else if (t.id === 'cfg-playlist') S.cfg.playlist = t.value;
  });
}

function setCreateStatus(msg, isError) {
  S.createMsg = msg; S.createError = !!isError;
  var el = document.getElementById('room-status');
  if (el) { el.textContent = msg; el.className = 'room-msg' + (isError ? ' err' : ''); }
  var b = document.getElementById('create-btn');
  if (b) b.disabled = !!S.creating;
}

// ===== Config screen: solo | create a room | join a room =====
function renderConfig() {
  if (!roomsAvailable()) return renderSoloOnly();
  var body = S.configTab === 'create' ? renderCreateForm() : S.configTab === 'join' ? renderJoinTab() : renderSoloForm();
  return '<div class="terminal-panel tabbed">' + panelHead('Productivity Terminal v2.7', '', true) + renderTabs() +
    '<div id="tabpanel" role="tabpanel" aria-labelledby="tab-' + S.configTab + '">' + body + '</div></div>';
}

function renderTabs() {
  return '<div class="tabs" role="tablist" aria-label="Session type">' + TABS.map(function(t) {
    var on = S.configTab === t.id;
    return '<button type="button" class="tab' + (on ? ' active' : '') + '" role="tab" id="tab-' + t.id + '" data-tab="' + t.id + '"' +
      ' aria-selected="' + on + '" aria-controls="tabpanel" tabindex="' + (on ? '0' : '-1') + '">' + t.label + '</button>';
  }).join('') + '</div>';
}

function renderSoloForm() {
  return '<form id="config-form" novalidate>' +
    '<div class="config-section"><span class="config-label">Select Timer Protocol</span>' + presetPicker() + '</div>' +
    '<div class="config-section"><span class="config-label">Options</span>' + snackToggle('Movement reminders during focus') + '</div>' +
    '<div class="h-rule"></div>' +
    '<button type="submit" class="launch-btn" id="launch-btn">LET’S BUILD!</button></form>';
}

function renderCreateForm() {
  return '<form id="config-form" novalidate>' +
    '<h2 class="room-heading">Create a room</h2>' +
    '<div class="config-section"><span class="config-label">Select Timer Protocol</span>' + presetPicker() + '</div>' +
    '<div class="h-rule"></div>' + profileSection() +
    '<div class="h-rule"></div>' + accessSection(false) +
    '<div class="h-rule"></div>' + playlistSection() +
    statusLine() +
    '<button type="submit" class="launch-btn" id="create-btn"' + (S.creating ? ' disabled' : '') + '>CREATE ROOM</button></form>';
}

function renderJoinTab() {
  return '<form id="config-form" novalidate>' +
    '<h2 class="room-heading">Join a room</h2>' +
    '<div class="config-section"><label class="config-label" for="cfg-link">Room Link</label>' +
    '<input type="text" class="text-input" id="cfg-link" autocomplete="off" spellcheck="false" placeholder="Paste invite link" value="' + esc(S.cfg.link) + '"></div>' +
    statusLine() +
    '<button type="submit" class="launch-btn" id="find-btn">FIND ROOM</button></form>';
}

// The original single-purpose screen, shown while rooms are switched off.
function renderSoloOnly() {
  function modeBtn(p) {
    var on = S.cfg.mode === p.mode;
    return '<button type="button" class="mode-btn ' + (on ? 'active' : '') + '" data-mode="' + p.mode + '" aria-pressed="' + on + '"><span class="mode-time">' + modeTimeHtml(p.mode) + '</span><span class="mode-desc">' + p.desc + '</span></button>';
  }
  return '<div class="terminal-panel">' + panelHead('Productivity Terminal v2.7') +
    '<div class="config-section"><span class="config-label">Select Timer Protocol</span>' +
    '<div class="mode-selector">' + PRESETS.map(modeBtn).join('') + '</div></div>' +
    '<div class="config-section"><span class="config-label">Options</span>' +
    '<button type="button" class="checkbox-container ' + (S.cfg.snacks ? 'checked' : '') + '" id="snack-toggle" aria-pressed="' + S.cfg.snacks + '">' +
    '<div class="custom-checkbox"><span class="check-mark">✓</span></div>' +
    '<div class="checkbox-text">Exercise Snacks<small>Movement reminders during focus</small></div>' +
    '</button></div>' +
    '<div class="h-rule"></div>' +
    '<div class="launch-row"><button type="button" class="launch-btn" id="launch-btn">LET’S BUILD!</button></div></div>';
}

function bindConfig() {
  if (!roomsAvailable()) { bindSoloOnly(); return; }
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() { selectTab(tab.dataset.tab); });
  });
  var list = document.querySelector('.tabs');
  if (list) list.addEventListener('keydown', onTabKey);
  var form = document.getElementById('config-form');
  if (!form) return;
  bindFormFields(form);
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (S.configTab === 'create') createRoom();
    else if (S.configTab === 'join') findRoom();
    else launch();
  });
}

function bindSoloOnly() {
  document.querySelectorAll('.mode-btn').forEach(function(b) {
    b.addEventListener('click', function() { S.cfg.mode = b.dataset.mode; render(); });
  });
  var st = document.getElementById('snack-toggle');
  if (st) st.addEventListener('click', function() { S.cfg.snacks = !S.cfg.snacks; render(); });
  var lb = document.getElementById('launch-btn');
  if (lb) lb.addEventListener('click', launch);
}

function selectTab(id) {
  S.configTab = id;
  S.createMsg = ''; S.createError = false;
  render();
}

function onTabKey(e) {
  var i = TABS.findIndex(function(t) { return t.id === S.configTab; });
  if (e.key === 'ArrowRight') i = (i + 1) % TABS.length;
  else if (e.key === 'ArrowLeft') i = (i + TABS.length - 1) % TABS.length;
  else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = TABS.length - 1;
  else return;
  e.preventDefault();
  selectTab(TABS[i].id);
  document.getElementById('tab-' + TABS[i].id).focus();
}

function findRoom() {
  var id = RoomHelpers.parseRoomInput(S.cfg.link);
  if (!id) { setCreateStatus('// NOT A VALID ROOM LINK', true); return; }
  S.cfg.link = '';
  showJoin(id, true);
}

// ===== Edit an existing room (host, before Play) =====
function myName() {
  var me = (Room.members || []).filter(function(m) { return m.clientId === Room.you; })[0];
  return me ? me.name : Room.getName();
}

// Fill the form from the room as it is now.
function loadFormFromRoom() {
  S.cfg.mode = S.mode; S.cfg.snacks = S.exerciseSnacks; S.cfg.name = myName();
  S.cfg.access = Room.protected ? 'password' : 'link'; S.cfg.pass = '';
  S.cfg.playlist = PlaylistLink.url(Room.playlist) || '';
  S.createMsg = ''; S.createError = false;
}

function openEdit() {
  loadFormFromRoom();
  S.screen = 'edit';
  render();
}

function closeEdit() {
  S.screen = 'timer';
  render();
  ensureLoop();
}

function renderEdit() {
  return '<div class="terminal-panel">' +
    panelHead('Productivity Terminal v2.7', '<button type="button" class="back-btn" id="edit-cancel">◂ CANCEL</button>', true) +
    '<form id="config-form" novalidate>' +
    '<h2 class="room-heading">Edit room</h2>' +
    '<div class="config-section"><span class="config-label">Select Timer Protocol</span>' + presetPicker() + '</div>' +
    '<div class="h-rule"></div>' + profileSection() +
    '<div class="h-rule"></div>' + accessSection(Room.protected) +
    '<div class="h-rule"></div>' + playlistSection() +
    statusLine() +
    '<button type="submit" class="launch-btn" id="save-btn">SAVE</button></form></div>';
}

function bindEdit() {
  var cancel = document.getElementById('edit-cancel');
  if (cancel) cancel.addEventListener('click', function() { loadFormFromRoom(); closeEdit(); });
  var form = document.getElementById('config-form');
  if (!form) return;
  bindFormFields(form);
  form.addEventListener('submit', function(e) { e.preventDefault(); saveEdit(); });
}

function saveEdit() {
  var error = RoomHelpers.validateRoomForm(S.cfg, Room.protected);
  if (error) { setCreateStatus(error, true); return; }
  var steps = RoomHelpers.planRoomEdit({ mode: S.mode, protected: Room.protected, name: myName(), playlist: Room.playlist }, S.cfg);
  var sent = steps.every(function(step) { return Room.send(step.type, step.payload); });
  if (!sent) { setCreateStatus('// NOT CONNECTED', true); return; }
  steps.forEach(function(step) { if (step.type === 'setName') Room.setName(step.payload.name); });
  S.exerciseSnacks = S.cfg.snacks;
  S.cfg.pass = '';
  closeEdit();
}

// ===== Guest join screen =====
function renderJoin() {
  var st = Room.status, info = S.roomInfo;
  var head = panelHead(null, '<button type="button" class="back-btn" id="back-btn">◂ BACK</button>', true);
  var body;
  if (st === 'expired' || (info && info.expired)) {
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
    body = renderJoinForm(st, info);
  }
  return '<div class="terminal-panel">' + head + '<div class="join-panel">' + body + '</div></div>';
}

function joinStatusText(info) {
  if (!info) return 'CHECKING ROOM';
  if (info.unreachable) return 'ROOM UNREACHABLE';
  return RoomHelpers.joinStatusLabel(info.status);
}

function renderJoinForm(st, info) {
  var needPass = st === 'authRequired' || st === 'authFailed' || (!!info && info.protected === true && !Room.getToken(S.roomId));
  var wait = Math.max(0, Math.ceil((Room.retryUntil - Date.now()) / 1000));
  var busy = st === 'connecting' || st === 'reconnecting';
  var msg = '';
  if (S.joinError) msg = '<div class="room-msg err">' + esc(S.joinError) + '</div>';
  else if (st === 'authFailed') msg = '<div class="room-msg err">// ' + (wait > 0 ? 'TOO MANY ATTEMPTS — RETRY IN ' + esc(fmtWait(wait)) : 'WRONG PASSWORD') + '</div>';
  else if (st === 'authRequired') msg = '<div class="room-msg">// THIS ROOM IS PASSWORD PROTECTED</div>';
  else if (busy) msg = '<div class="room-msg">// CONNECTING...</div>';
  var card = '<div class="join-info"><div class="join-code"><span class="invite-label">ROOM</span>' +
    '<span class="invite-code">' + esc(RoomHelpers.shortRoomCode(S.roomId)) + '</span>' + (info && info.protected ? lockIcon() : '') + '</div>' +
    (info && info.mode ? '<div class="summary-time">' + modeTimeHtml(info.mode) + '</div>' : '') +
    '<div class="join-status" role="status">' + esc(joinStatusText(info)) + '</div></div>';
  return '<h2 class="room-heading center">Join room</h2>' + card +
    '<form id="join-form" novalidate>' +
    '<div class="config-section"><span class="config-label">User Profile</span>' + nameField('join-name', S.cfg.name, busy) + snackToggle('') + '</div>' +
    (needPass
      ? '<div class="config-section"><label class="field-label" for="join-pass">Room Password</label>' +
        '<input type="password" class="text-input" id="join-pass" maxlength="64" autocomplete="current-password" value="' + esc(S.joinPass) + '"></div>'
      : '') +
    msg +
    '<button type="submit" class="launch-btn" id="join-btn"' + ((busy || wait > 0) ? ' disabled' : '') + '>' + (busy ? 'CONNECTING...' : 'JOIN') + '</button></form>';
}

function fmtWait(sec) {
  return sec >= 60 ? Math.ceil(sec / 60) + ' MIN' : sec + ' S';
}

function bindJoin() {
  var bb = document.getElementById('back-btn');
  if (bb) bb.addEventListener('click', function() { leaveRoom(true); });
  var form = document.getElementById('join-form');
  if (form) {
    form.addEventListener('submit', function(e) { e.preventDefault(); submitJoin(); });
    form.addEventListener('change', function(e) {
      if (e.target.name === 'snacks') { S.cfg.snacks = e.target.checked; render(); }
    });
    form.addEventListener('input', function(e) {
      if (e.target.id === 'join-name') S.cfg.name = e.target.value;
      else if (e.target.id === 'join-pass') S.joinPass = e.target.value;
    });
  }
  var home = document.getElementById('join-home-btn');
  if (home) home.addEventListener('click', function() { leaveRoom(true); });
  var retry = document.getElementById('join-retry-btn');
  if (retry) retry.addEventListener('click', function() { S.joinError = null; Room.join(S.roomId, RoomHelpers.validName(S.cfg.name) || 'Guest', null); });
  var pass = document.getElementById('join-pass');
  if (pass && !S.joinPass) pass.focus();
  // Re-enable JOIN when a lockout ends.
  if (Room.status === 'authFailed' && Room.retryUntil > Date.now()) {
    setTimeout(function() { if (S.screen === 'join') render(); }, Room.retryUntil - Date.now() + 100);
  }
}

function submitJoin() {
  var name = RoomHelpers.validName(S.cfg.name);
  if (!name) { S.joinError = '// DISPLAY NAME MUST BE 1–24 CHARACTERS'; render(); return; }
  var needPass = Room.status === 'authRequired' || Room.status === 'authFailed' ||
    (!!S.roomInfo && S.roomInfo.protected === true && !Room.getToken(S.roomId));
  if (needPass && !S.joinPass) { S.joinError = '// ENTER THE ROOM PASSWORD'; render(); return; }
  S.joinError = null;
  S.cfg.name = name;
  S.exerciseSnacks = S.cfg.snacks;
  Room.setName(name);
  AudioEngine.playDoorChime(0);   // creates/resumes the AudioContext inside this user gesture so later chimes can play
  var pw = needPass ? S.joinPass : null;
  S.joinPass = '';
  Room.join(S.roomId, name, pw);
}

// The join screen shows the room's protocol and session status, so it asks the server while it is open.
var roomInfoTimer = null;
var ROOM_INFO_INTERVAL_MS = 5000;

function startRoomInfo() {
  stopRoomInfo();
  fetchRoomInfo();
  roomInfoTimer = setInterval(fetchRoomInfo, ROOM_INFO_INTERVAL_MS);
}

function stopRoomInfo() {
  if (roomInfoTimer) clearInterval(roomInfoTimer);
  roomInfoTimer = null;
}

function fetchRoomInfo() {
  var id = S.roomId;
  if (!id || S.screen !== 'join' || document.hidden) return;
  fetch('/api/rooms/' + encodeURIComponent(id), { cache: 'no-store' }).then(function(res) {
    if (res.status === 200) return res.json();
    return { expired: res.status === 404 || res.status === 410, unreachable: res.status !== 404 && res.status !== 410 };
  }).catch(function() {
    return { unreachable: true };
  }).then(function(info) {
    if (id !== S.roomId || S.screen !== 'join') return;
    if (JSON.stringify(info) === JSON.stringify(S.roomInfo)) return;
    S.roomInfo = info;
    render();
  });
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

// Members only ever see a link built from a validated playlist ID, never text the host typed.
function renderPlaylist() {
  var url = PlaylistLink.url(Room.playlist);
  if (!url) return '';
  return '<a class="playlist-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" aria-label="Open the room playlist on YouTube in a new tab">' +
    '♪ OPEN PLAYLIST <span aria-hidden="true">↗</span></a>';
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
function updatePlaylist() {
  var el = document.getElementById('playlist-bar');
  if (el && S.screen === 'timer' && S.roomId) el.innerHTML = renderPlaylist();
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
  var started = SessionModel.isStarted(getTimer());
  var beforePlay = room && !started;
  var label = ph==='work'?'Focus Mode Active':ph==='rest'?'Rest Period':ph==='alarm'?'Phase Complete':'Session Complete';
  var pct = S.totalSeconds > 0 ? (S.elapsedSeconds / S.totalSeconds) * 100 : 100;
  var time = fmt(clockSeconds());
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

  // A room's session has started once the timer has run or been scrubbed, even while it is paused.
  var notStarted = room ? !started : (!S.running && !isDone && !isAlarm);
  var status = '';
  if (notStarted) status = '<div class="session-info" style="color:var(--pip-bright);">' + (canControl ? '// READY — PRESS PLAY' : '// READY — WAITING FOR HOST') + '</div>';
  else if (S.paused && (S.running || room)) status = '<div class="session-info" style="color:var(--pip-bright);">// PAUSED</div>';
  else if (isAlarm) status = '<div class="session-info">// Transitioning...</div>';
  else if (isDone) status = '<div class="done-message">' + (canControl ? 'Great work. Press replay to begin again.' : 'Great work.') + '</div>';
  if (room && !canControl && started) status += '<div class="session-info host-note">// HOST CONTROLS THE TIMER</div>';

  var roomTop = room
    ? '<div id="conn-wrap">' + renderConnBar() + '</div>' +
      (beforePlay ? '<div class="ready-title">Room ready</div>' + renderSummary(canControl) : '') +
      '<div class="invite-bar" id="invite-bar">' + renderInvite() + '</div>' +
      '<div class="playlist-bar" id="playlist-bar">' + renderPlaylist() + '</div>'
    : '';
  var roomBottom = room && started ? '<div class="roster-wrap" id="roster">' + renderRoster() + '</div>' : '';
  var subtitle = 'Protocol ' + S.mode + (room ? ' // Snacks ' + (S.exerciseSnacks ? 'ON' : 'OFF') : (S.exerciseSnacks ? ' // Snacks ON' : ''));

  return '<div class="terminal-panel">' +
    '<div class="corner-bl"></div><div class="corner-br"></div>' +
    '<button type="button" class="back-btn" id="back-btn">' + (room ? '◂ LEAVE' : '◂ CONFIG') + '</button>' +
    '<div class="header"><h1>DEEP WORK</h1><div class="subtitle">' + subtitle + '</div></div>' +
    (room ? '' : '<div class="h-rule"></div>') +
    roomTop +
    '<div class="timer-screen">' +
    (beforePlay ? '' : '<div class="phase-label'+(isDone?' done':'')+'">' + label + '</div>') +
    '<div class="timer-display'+(isDone?' done':'')+'" id="timer-text" aria-live="polite">' + time + '</div>' +
    '<div class="progress-track'+(room && !canControl ? ' locked' : '')+'" id="progress-track" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="'+S.totalSeconds+'" aria-valuenow="'+S.elapsedSeconds+'">' +
      '<div class="progress-fill" id="progress-fill" style="width:'+pct+'%"></div>' +
    '</div>' +
    '<div class="controls">' + controls + '</div>' +
    status + '</div>' + roomBottom + '</div>';
}

// Read-only protocol summary shown before Play; the host can open the form to change it.
function renderSummary(canEdit) {
  return '<div class="summary-bar"><span class="summary-time">' + modeTimeHtml(S.mode) + '</span>' +
    (canEdit ? '<button type="button" class="mini-btn" id="edit-btn">EDIT</button>' : '') + '</div>';
}

// ===== Binding =====
function bindTimer() {
  var pb = document.getElementById('pause-btn');
  if (pb) pb.addEventListener('click', togglePause);
  var rb = document.getElementById('reset-btn');
  if (rb) rb.addEventListener('click', resetTimer);
  var bb = document.getElementById('back-btn');
  if (bb) bb.addEventListener('click', goBack);
  var eb = document.getElementById('edit-btn');
  if (eb) eb.addEventListener('click', openEdit);
  if (isRoom()) bindInvite();
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
// Creating is one step: the room is made, then the creator connects straight into it as host.
// Until the host is welcomed the config screen stays up with its values, so any failure can be retried.
function createRoom() {
  if (S.creating) return;
  var error = RoomHelpers.validateRoomForm(S.cfg, false);
  if (error) { setCreateStatus(error, true); return; }
  var name = RoomHelpers.validName(S.cfg.name);
  var pass = S.cfg.access === 'password' ? S.cfg.pass : '';
  S.creating = true;
  setCreateStatus('// OPENING ROOM...', false);
  fetch('/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pass ? { password: pass } : {})
  }).then(function(res) {
    return res.json().catch(function() { return {}; }).then(function(data) { return { status: res.status, data: data || {} }; });
  }).then(function(r) {
    if (r.status === 201 && RoomHelpers.isValidRoomId(r.data.roomId)) {
      if (r.data.sessionToken) Room.setToken(r.data.roomId, r.data.sessionToken);
      enterCreatedRoom(r.data.roomId, name);
      return;
    }
    S.creating = false;
    if (r.status === 400) setCreateStatus(r.data.error === 'badPassword' ? '// PASSWORD MUST BE 4–64 CHARACTERS' : '// BAD REQUEST', true);
    else if (r.status === 429) setCreateStatus('// TOO MANY ROOMS — TRY AGAIN LATER', true);
    else if (r.status === 403) setCreateStatus('// REQUEST REJECTED BY SERVER', true);
    else setCreateStatus('// SERVER ERROR (' + r.status + ')', true);
  }).catch(function() {
    S.creating = false;
    setCreateStatus('// COULD NOT REACH SERVER', true);
  });
}

function enterCreatedRoom(roomId, name) {
  S.pendingMode = S.cfg.mode;
  S.pendingPlaylist = S.cfg.playlist.trim();
  S.exerciseSnacks = S.cfg.snacks;
  S.roomId = roomId;
  S.joinPass = ''; S.passEdit = false;
  Room.setName(name);
  Room.join(roomId, name, null);
}

function failCreate() {
  Room.leave();
  S.roomId = null; S.pendingMode = null; S.pendingPlaylist = ''; S.creating = false;
  setCreateStatus('// COULD NOT ENTER ROOM — TRY AGAIN', true);
  render();
}

// Show the join panel for a room (from a pasted link, a ?room= URL, or history navigation).
function showJoin(roomId, push) {
  S.roomId = roomId;
  S.screen = 'join';
  S.joinPass = ''; S.joinError = null; S.passEdit = false; S.roomInfo = null;
  if (push) { try { history.pushState({ room: roomId }, '', location.pathname + '?room=' + encodeURIComponent(roomId)); } catch (e) {} }
  render();
  startRoomInfo();
}

// ===== Room events =====
Room.on('status', function() {
  if (!S.roomId) return;
  var st = Room.status;
  if (S.creating) {
    if (RoomHelpers.leavesTimerScreen(st)) failCreate();
    return;
  }
  if (S.screen === 'join') render();
  else if (S.screen === 'timer' || S.screen === 'edit') {
    if (RoomHelpers.leavesTimerScreen(st)) {
      cancelTimerEvents();
      S.screen = 'join';
      S.roomInfo = null;
      render();
      startRoomInfo();
    } else if (S.screen === 'timer') updateInvite();
  }
});

Room.on('welcome', function(m) {
  var timer = { mode: m.timer.mode, anchorAt: m.timer.anchorAt, offsetMs: m.timer.offsetMs, paused: m.timer.paused };
  onRoomTimer(timer, true);
  // A host who picked a protocol before creating the room applies it once, before anything is started.
  if (S.pendingMode) {
    if (Room.isHost() && !SessionModel.isStarted(timer) && S.pendingMode !== timer.mode && Room.send('setMode', { mode: S.pendingMode })) {
      S.mode = S.pendingMode;
      derive();
    }
    S.pendingMode = null;
  }
  // Same for a playlist: the server reads the link itself and tells everyone the ID it found.
  if (S.pendingPlaylist) {
    if (Room.isHost()) Room.send('setPlaylist', { url: S.pendingPlaylist });
    S.pendingPlaylist = '';
    S.cfg.playlist = '';
  }
  if (S.creating) {
    S.creating = false;
    setCreateStatus('', false);
    try { history.pushState({ room: S.roomId }, '', location.pathname + '?room=' + encodeURIComponent(S.roomId)); } catch (e) {}
  }
  S.screen = 'timer';
  S.dragging = false;
  render();
  ensureLoop();
  if (document.hidden) Room.send('visibility', { visible: false });
});

Room.on('timer', function(timer) {
  if (!S.roomId) return;
  if (S.screen === 'edit' && SessionModel.isStarted(timer)) S.screen = 'timer';
  onRoomTimer(timer, false);
});

Room.on('members', function(prev, next) {
  var prevIds = {}, nextIds = {};
  prev.forEach(function(m) { prevIds[m.clientId] = m; });
  next.forEach(function(m) { nextIds[m.clientId] = m; });
  next.forEach(function(m) { if (!prevIds[m.clientId] && m.clientId !== Room.you) toast('// ' + String(m.name).toUpperCase() + ' JOINED'); });
  prev.forEach(function(m) { if (!nextIds[m.clientId] && m.clientId !== Room.you) toast('// ' + String(m.name).toUpperCase() + ' LEFT'); });
  updateRoster();
  if (S.lastProtected !== Room.protected) { S.lastProtected = Room.protected; updateInvite(); }   // lock icon follows `protected` from the server
});

Room.on('playlist', updatePlaylist);

Room.on('host', function() {
  if (S.screen === 'edit' && !Room.isHost()) { closeEdit(); return; }
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

setInterval(updateRoster, 15000);

window.addEventListener('popstate', function() {
  if (!roomsAvailable()) return;
  var id = RoomHelpers.parseRoomId(location.search);
  if (id === S.roomId) return;
  if (S.roomId) leaveRoom(false);
  if (id) showJoin(id, false);
});

// With rooms disabled, ?room= links open the normal solo timer.
S.cfg.name = Room.getName();
var initialRoom = roomsAvailable() ? RoomHelpers.parseRoomId(location.search) : null;
if (initialRoom) showJoin(initialRoom, false);
else render();
