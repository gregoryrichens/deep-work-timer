// ROOM CLIENT
// RoomHelpers: pure, DOM-free helpers (unit-tested in Node).
// Room: WebSocket client for a shared timer room (connect, hello, reconnect, clock sync, presence).
// No DOM access here; the UI subscribes with Room.on(event, fn).
var RoomHelpers = (function() {
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  var ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"'`]/g, function(c) { return ESC[c]; });
  }

  // offset = serverNow - midpoint of the round trip. Add it to Date.now() to get server time.
  function estimateOffset(sentAt, receivedAt, serverNow) {
    return serverNow - (sentAt + receivedAt) / 2;
  }

  // Keep the lowest-RTT sample ({ rtt, offset }); the earlier sample wins ties.
  function betterSample(best, sample) {
    if (!sample || !(sample.rtt >= 0)) return best;
    if (!best || sample.rtt < best.rtt) return sample;
    return best;
  }

  // Reconnect delay: 1s, 2s, 4s ... capped at 30s. attempt starts at 0.
  function backoffDelay(attempt) {
    var n = Math.max(0, attempt | 0);
    return Math.min(30000, 1000 * Math.pow(2, Math.min(n, 10)));
  }

  // Whole minutes since awaySince (server ms), using a server-corrected "now". null when unknown.
  function awayMinutes(awaySince, nowMs) {
    if (typeof awaySince !== 'number') return null;
    return Math.max(0, Math.floor((nowMs - awaySince) / 60000));
  }

  function formatAway(awaySince, nowMs) {
    var m = awayMinutes(awaySince, nowMs);
    return m === null ? 'AWAY' : 'AWAY (' + m + 'm)';
  }

  function statusLabel(member, nowMs) {
    switch (member && member.status) {
      case 'lockedIn': return 'LOCKED IN';
      case 'away': return formatAway(member.awaySince, nowMs);
      case 'onBreak': return 'ON BREAK';
      case 'ready': return 'READY';
      default: return 'UNKNOWN';
    }
  }

  function statusClass(status) {
    return ({ lockedIn: 'st-locked', away: 'st-away', onBreak: 'st-break', ready: 'st-ready' })[status] || 'st-unknown';
  }

  // Room ID from a location.search string. Returns null unless it looks like an opaque token.
  function parseRoomId(search) {
    var m = /(?:^|[?&])room=([^&#]*)/.exec(search || '');
    if (!m) return null;
    var id;
    try { id = decodeURIComponent(m[1]); } catch (e) { return null; }
    return isValidRoomId(id) ? id : null;
  }

  // Rooms need the feature flag on (strictly true) and a page served over http(s).
  function roomsEnabled(flag, protocol) {
    return flag === true && (protocol === 'http:' || protocol === 'https:');
  }

  function isValidRoomId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 200 && /^[A-Za-z0-9._-]+$/.test(id);
  }

  // Short display code: first 6 chars of the random part (before the first dot).
  function shortRoomCode(roomId) {
    return String(roomId || '').split('.')[0].slice(0, 6);
  }

  function wsUrl(loc, roomId) {
    return (loc.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + loc.host + '/rooms/' + encodeURIComponent(roomId);
  }

  // Close codes 4001 (expired), 4002 (full), 4003 (too many violations) are final; 4004 (auth needed/failed)
  // waits for the user to resubmit the password form, which opens a fresh socket.
  function shouldReconnect(closeCode) {
    return !(closeCode >= 4001 && closeCode <= 4004);
  }

  // Trimmed name when 1-24 chars, otherwise null.
  function validName(name) {
    var n = String(name === null || name === undefined ? '' : name).trim();
    return (n.length >= 1 && n.length <= 24) ? n : null;
  }

  function validPassword(p) {
    return typeof p === 'string' && p.length >= 4 && p.length <= 64;
  }

  // 16-char clientId (matches [A-Za-z0-9_-]{8,64}) from random bytes.
  function clientIdFromBytes(bytes) {
    var out = '';
    for (var i = 0; i < 16; i++) out += ID_CHARS.charAt(bytes[i % bytes.length] & 63);
    return out;
  }

  function isValidClientId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id); }

  return {
    escapeHtml: escapeHtml, estimateOffset: estimateOffset, betterSample: betterSample,
    backoffDelay: backoffDelay, awayMinutes: awayMinutes, formatAway: formatAway,
    statusLabel: statusLabel, statusClass: statusClass,
    roomsEnabled: roomsEnabled, parseRoomId: parseRoomId, isValidRoomId: isValidRoomId, shortRoomCode: shortRoomCode,
    wsUrl: wsUrl, shouldReconnect: shouldReconnect, validName: validName, validPassword: validPassword,
    clientIdFromBytes: clientIdFromBytes, isValidClientId: isValidClientId
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RoomHelpers;

// The client itself needs the browser (WebSocket, document); under Node only RoomHelpers is exported.
var Room = (typeof document === 'undefined') ? null : (function() {
  var H = RoomHelpers;
  var R = {
    roomId: null, status: 'idle',   // idle | connecting | authRequired | authFailed | live | reconnecting | expired | full | closed | failed
    you: null, hostId: null, members: [], protected: false,
    offset: 0, retryUntil: 0, welcomed: false, closeCode: 0
  };
  var handlers = {};
  var ws = null, name = '', password = null, sentToken = false;
  var attempt = 0, intentional = false, best = null;
  var reconnectTimer = null, pingTimer = null, pingBurst = [];
  var memClientId = null;
  var MAX_INITIAL_ATTEMPTS = 5;

  // ----- storage (always guarded; private windows can throw) -----
  function sget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function sdel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function getClientId() {
    var id = sget('dwt.clientId');
    if (H.isValidClientId(id)) return id;
    if (memClientId) return memClientId;
    var bytes = new Uint8Array(16);
    try { crypto.getRandomValues(bytes); } catch (e) { for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256); }
    id = H.clientIdFromBytes(bytes);
    memClientId = id;
    sset('dwt.clientId', id);
    return id;
  }
  function getName() { return sget('dwt.name') || ''; }
  function setName(n) { name = n; sset('dwt.name', n); }
  function getToken(roomId) { return sget('dwt.token.' + roomId); }
  function setToken(roomId, t) { if (t) sset('dwt.token.' + roomId, t); }
  function clearToken(roomId) { sdel('dwt.token.' + roomId); }

  // ----- events -----
  function on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); }
  function emit(evt, a, b) {
    (handlers[evt] || []).forEach(function(fn) { try { fn(a, b); } catch (e) { if (window.console) console.error(e); } });
  }
  function setStatus(s) { R.status = s; emit('status', s); }

  // ----- clock -----
  function now() { return Date.now() + R.offset; }
  function sendPing() { rawSend({ type: 'ping', t: Date.now() }); }
  function startPings() {
    stopPings();
    best = null;
    sendPing();
    // A couple of early extra samples; the lowest-RTT one wins.
    pingBurst = [setTimeout(sendPing, 800), setTimeout(sendPing, 2500)];
    pingTimer = setInterval(sendPing, 5 * 60 * 1000);
  }
  function stopPings() {
    if (pingTimer) clearInterval(pingTimer);
    pingBurst.forEach(clearTimeout);
    pingTimer = null; pingBurst = [];
  }
  function onPong(m) {
    var recv = Date.now();
    if (typeof m.t !== 'number' || typeof m.serverNow !== 'number') return;
    var s = { rtt: recv - m.t, offset: H.estimateOffset(m.t, recv, m.serverNow) };
    best = H.betterSample(best, s);
    if (best) R.offset = best.offset;
  }

  // ----- socket -----
  function rawSend(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  function sendHello() {
    var h = { type: 'hello', clientId: getClientId(), name: name };
    var tok = getToken(R.roomId);
    sentToken = !!tok;
    if (tok) h.sessionToken = tok;
    if (password) h.password = password;
    rawSend(h);
  }

  function connect() {
    clearTimeout(reconnectTimer);
    var sock;
    try { sock = new WebSocket(H.wsUrl(location, R.roomId)); } catch (e) { scheduleReconnect(); return; }
    ws = sock;
    sock.onopen = function() { if (ws === sock) sendHello(); };
    sock.onmessage = function(ev) { if (ws === sock) handle(ev.data); };
    sock.onclose = function(ev) { if (ws === sock) onClose(ev.code); };
    sock.onerror = function() {};
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, H.backoffDelay(attempt++));
  }

  function onClose(code) {
    stopPings();
    ws = null;
    R.closeCode = code;
    if (intentional) return;
    if (code === 4004) return;   // status stays authRequired/authFailed; not counted as a failed attempt
    if (R.status === 'expired' || R.status === 'full') return;
    if (!H.shouldReconnect(code)) {
      if (code === 4001) { clearToken(R.roomId); setStatus('expired'); }
      else if (code === 4002) setStatus('full');
      else setStatus('closed');
      return;
    }
    // Waiting on the user (password) - don't loop; they resubmit and we reconnect then.
    if (R.status === 'authRequired' || R.status === 'authFailed') return;
    if (!R.welcomed && attempt >= MAX_INITIAL_ATTEMPTS) { setStatus('failed'); return; }
    setStatus(R.welcomed ? 'reconnecting' : 'connecting');
    scheduleReconnect();
  }

  function handle(data) {
    var m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'welcome':
        attempt = 0;
        R.welcomed = true;
        R.you = m.you; R.hostId = m.hostClientId;
        R.members = Array.isArray(m.members) ? m.members : [];
        R.protected = !!m.protected;
        if (m.sessionToken) { setToken(R.roomId, m.sessionToken); password = null; }
        if (typeof m.serverNow === 'number') R.offset = m.serverNow - Date.now();   // provisional until a ping lands
        startPings();
        R.status = 'live';
        emit('status', 'live');
        emit('welcome', m);
        break;
      case 'authRequired':
        if (sentToken) clearToken(R.roomId);   // stored token was rejected
        password = null;
        setStatus('authRequired');
        break;
      case 'authFailed':
        password = null;
        R.retryUntil = (typeof m.retryAfterSec === 'number' && m.retryAfterSec > 0) ? Date.now() + m.retryAfterSec * 1000 : 0;
        setStatus('authFailed');
        break;
      case 'timer':
        emit('timer', { mode: m.mode, anchorAt: m.anchorAt, offsetMs: m.offsetMs, paused: m.paused });
        break;
      case 'members':
        var prev = R.members;
        if (typeof m.protected === 'boolean') R.protected = m.protected;
        R.members = Array.isArray(m.members) ? m.members : [];
        emit('members', prev, R.members);
        break;
      case 'host':
        R.hostId = m.hostClientId;
        emit('host', R.hostId);
        break;
      case 'pong':
        onPong(m);
        break;
      case 'error':
        if (m.code === 'roomExpired') { clearToken(R.roomId); intentional = false; setStatus('expired'); }
        else if (m.code === 'roomFull') setStatus('full');
        else emit('error', m);
        break;
    }
  }

  // ----- public API -----
  function closeSocket() {
    clearTimeout(reconnectTimer);
    stopPings();
    var s = ws; ws = null;
    if (s) { try { s.close(1000); } catch (e) {} }
  }

  // Join (or retry joining) a room. Safe to call again after authRequired/authFailed with a password.
  function join(roomId, displayName, pw) {
    name = displayName;
    password = pw || null;
    intentional = false;
    if (R.roomId === roomId && ws && ws.readyState === 1 && (R.status === 'authRequired' || R.status === 'authFailed')) {
      R.status = 'connecting'; emit('status', 'connecting');
      sendHello();
      return;
    }
    closeSocket();
    R.roomId = roomId; R.welcomed = false; R.members = []; R.you = null; R.hostId = null;
    R.protected = false; R.offset = 0; R.retryUntil = 0;
    attempt = 0;
    setStatus('connecting');
    connect();
  }

  function leave() {
    intentional = true;
    closeSocket();
    R.roomId = null; R.welcomed = false; R.members = []; R.you = null; R.hostId = null;
    R.protected = false; R.offset = 0; R.retryUntil = 0;
    password = null; attempt = 0;
    R.status = 'idle';
  }

  function send(type, payload) {
    var o = { type: type };
    if (payload) for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) o[k] = payload[k];
    return rawSend(o);
  }

  document.addEventListener('visibilitychange', function() {
    if (R.status === 'live') send('visibility', { visible: !document.hidden });
  });

  R.on = on; R.join = join; R.leave = leave; R.send = send; R.now = now;
  R.active = function() { return R.roomId !== null && R.welcomed; };
  R.isHost = function() { return R.you !== null && R.you === R.hostId; };
  R.getName = getName; R.setName = setName;
  R.getToken = getToken; R.setToken = setToken; R.clearToken = clearToken;
  return R;
})();
