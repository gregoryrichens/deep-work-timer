// One Durable Object per room. SQLite-backed storage, raw WebSocket Hibernation API
// (ctx.acceptWebSocket) so idle rooms are evicted from memory while sockets stay open.
//
// Hibernation rules followed here:
//  - per-socket data lives in serializeAttachment (survives eviction);
//  - everything time-based runs from ONE alarm whose time is recomputed from state
//    (reschedule()): hello timeouts, host handoff, cleanup, roster pruning,
//    away/phase status flips;
//  - storage is only written at creation (init RPC) or after the first valid hello.
import { DurableObject } from 'cloudflare:workers';
import SessionModel from './session-model.js';
import PlaylistLink from './playlist.js';
import { verifyPassword, hashPassword, parseIterations, generateToken, hashToken } from './crypto.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

const HELLO_TIMEOUT_MS = 5 * SEC;
const HANDOFF_MS = 30 * SEC;
const ROOM_TTL_MS = 2 * HOUR; // empty-room cleanup, and never-entered expiry
const DROP_MS = 5 * MIN; // disconnected members leave the roster
const HIDDEN_AWAY_MS = 2 * MIN;
const MAX_MEMBERS = 20;
const MAX_SOCKETS = 60;
const MAX_MSG_BYTES = 1024;
const BUCKET_CAP = 10; // burst
const BUCKET_REFILL_PER_SEC = 5; // sustained
const MAX_VIOLATIONS = 5;
const IP_MAX_WRONG = 5;
const IP_LOCK_MS = 10 * MIN;
const ROOM_MAX_WRONG_PER_HOUR = 50;
const MAX_SESSIONS = 100;
const MAX_TRACKED_IPS = 200;

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/;
const enc = new TextEncoder();

function safeCloseCode(code) {
  return code >= 3000 && code <= 4999 ? code : 1000;
}

async function shortHash(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(d).slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newState(createdAt) {
  return {
    createdAt,
    entered: false,
    mode: '52/17',
    timer: SessionModel.initialTimer(),
    hostClientId: null,
    members: {}, // clientId -> { name, joinedAt, disconnectedAt }
    password: null, // { hash, salt, iterations }
    playlist: null, // YouTube playlist ID; rooms saved before this field existed read as null
    sessions: {}, // tokenHash -> { clientId|null, at }
    attempts: { ips: {}, hourStart: 0, hourCount: 0 },
    handoffAt: null,
    cleanupAt: null
  };
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = null;
    this.busy = new WeakSet(); // sockets with an in-flight hello
    this.lastRosterSig = '';
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) || null;
    });
  }

  // ---- RPC: called by the Worker when a protected room is created ----
  async init(opts) {
    if (this.state) return false;
    if (!opts || typeof opts.createdAt !== 'number' || !opts.passwordHash || typeof opts.hostTokenHash !== 'string') {
      throw new Error('bad init');
    }
    const st = newState(opts.createdAt);
    st.password = opts.passwordHash;
    st.sessions[opts.hostTokenHash] = { clientId: null, at: Date.now() };
    this.state = st;
    await this.save();
    await this.reschedule();
    return true;
  }

  // ---- RPC: called by the Worker for the join screen. Reads only; null when the room has expired ----
  async info(createdAt) {
    const st = this.state;
    const now = Date.now();
    if (!st) {
      return now - createdAt >= ROOM_TTL_MS ? null : { mode: '52/17', status: 'waiting', protected: false };
    }
    if ((st.cleanupAt && now >= st.cleanupAt) || (!st.entered && now >= st.createdAt + ROOM_TTL_MS)) return null;
    return { mode: st.mode, status: SessionModel.status(st.timer, st.mode, now), protected: !!st.password };
  }

  // ---- WebSocket entry ----------------------------------------------------------------
  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const createdAt = parseInt(request.headers.get('X-Room-Created'), 10);
    if (!Number.isFinite(createdAt)) return new Response('Bad request', { status: 400 });
    const now = Date.now();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      ip: await shortHash(request.headers.get('X-Client-IP') || 'unknown'),
      createdAt,
      helloDone: false,
      helloDeadline: now + HELLO_TIMEOUT_MS,
      bucket: BUCKET_CAP,
      bucketAt: now,
      violations: 0,
      visible: true,
      hiddenSince: null
    });
    if (this.ctx.getWebSockets().length > MAX_SOCKETS) {
      this.sendError(server, 'roomFull', 'Room is full');
      server.close(4002, 'full');
    } else {
      await this.reschedule();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const att = ws.deserializeAttachment();
    if (!att) return;
    const now = Date.now();

    att.bucket = Math.min(BUCKET_CAP, att.bucket + ((now - att.bucketAt) / SEC) * BUCKET_REFILL_PER_SEC);
    att.bucketAt = now;
    if (att.bucket < 1) return this.violate(ws, att, 'rateLimited', 'Too many messages');
    att.bucket -= 1;
    ws.serializeAttachment(att);

    if (typeof message !== 'string' || message.length > MAX_MSG_BYTES || enc.encode(message).length > MAX_MSG_BYTES) {
      return this.violate(ws, att, 'badMessage', 'Message too large or not text');
    }
    let msg;
    try { msg = JSON.parse(message); } catch (e) { msg = null; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
      return this.violate(ws, att, 'badMessage', 'Malformed message');
    }

    if (!att.helloDone) {
      if (msg.type !== 'hello') return this.violate(ws, att, 'badMessage', 'Expected hello');
      return this.onHello(ws, att, msg, now);
    }
    return this.onMessage(ws, att, msg, now);
  }

  async webSocketClose(ws, code) {
    await this.onGone(ws);
    try { ws.close(safeCloseCode(code), 'closing'); } catch (e) { /* already closed */ }
  }

  async webSocketError(ws) {
    await this.onGone(ws);
  }

  // ---- hello ---------------------------------------------------------------------------
  async onHello(ws, att, msg, now) {
    if (this.busy.has(ws)) return this.violate(ws, att, 'badMessage', 'Hello in progress');
    const clientId = msg.clientId;
    const name = typeof msg.name === 'string' ? msg.name.trim() : '';
    if (typeof clientId !== 'string' || !CLIENT_ID_RE.test(clientId) ||
        name.length < 1 || name.length > 24 || CONTROL_CHARS_RE.test(name) ||
        (msg.password !== undefined && (typeof msg.password !== 'string' || msg.password.length > 64)) ||
        (msg.sessionToken !== undefined && (typeof msg.sessionToken !== 'string' || msg.sessionToken.length > 64))) {
      return this.violate(ws, att, 'badMessage', 'Invalid hello');
    }

    this.busy.add(ws);
    try {
      // Never recreate an expired room, and write nothing for it.
      let st = this.state;
      if (st && st.cleanupAt && now >= st.cleanupAt) { await this.cleanup(); return this.expire(ws); }
      if (st) {
        if (!st.entered && now >= st.createdAt + ROOM_TTL_MS) { await this.cleanup(); return this.expire(ws); }
      } else if (now - att.createdAt >= ROOM_TTL_MS) {
        return this.expire(ws);
      }

      // A clientId is public (welcome, members list), so it proves nothing. Once a clientId has
      // a session (or is the host) only its private token can reclaim it; the password never can.
      // The creator's unbound host token may only claim a clientId nobody has used yet.
      let issuedToken = null;
      let tokenHash = null;
      if (st) {
        const given = typeof msg.sessionToken === 'string' ? await hashToken(msg.sessionToken) : null;
        const entry = given ? st.sessions[given] : null;
        const tokenOk = !!entry && (entry.clientId === clientId || (entry.clientId === null && !st.members[clientId]));
        if (tokenOk) {
          tokenHash = given;
        } else if (st.hostClientId === clientId || this.hasSession(st, clientId)) {
          this.sendError(ws, 'sessionInvalid', 'Session token missing or invalid');
          ws.close(4003, 'bad session');
          return;
        } else if (st.password) {
          if (typeof msg.password === 'string' && msg.password !== '') {
            const res = await this.checkPassword(att, msg.password, now);
            if (this.state !== st) return this.expire(ws);
            if (!res.ok) {
              const out = { type: 'authFailed' };
              if (res.retryAfterSec) out.retryAfterSec = res.retryAfterSec;
              this.send(ws, out);
              ws.close(4004, 'auth failed');
              await this.reschedule();
              return;
            }
          } else {
            this.send(ws, { type: 'authRequired' });
            ws.close(4004, 'auth required');
            await this.reschedule();
            return;
          }
        }
        if (this.state !== st) return this.expire(ws);
      }
      if (!tokenHash) {
        issuedToken = generateToken();
        tokenHash = await hashToken(issuedToken);
      }

      if (st && !st.members[clientId] && Object.keys(st.members).length >= MAX_MEMBERS) {
        this.sendError(ws, 'roomFull', 'Room is full');
        ws.close(4002, 'full');
        return;
      }

      // Open rooms are created by the first valid hello. No awaits between the state check
      // and assignment, so two racing first hellos cannot both create it.
      if (!st) {
        st = newState(att.createdAt);
        st.hostClientId = clientId;
        this.state = st;
      }
      st.entered = true;
      const entry = st.sessions[tokenHash];
      if (!entry) {
        this.addSession(st, tokenHash, clientId, now);
      } else if (entry.clientId === null) {
        entry.clientId = clientId;
        if (st.hostClientId === null) st.hostClientId = clientId;
      }
      const prev = st.members[clientId];
      st.members[clientId] = { name, joinedAt: prev ? prev.joinedAt : now, disconnectedAt: null };
      st.cleanupAt = null;
      if (st.hostClientId === clientId) st.handoffAt = null;

      att.helloDone = true;
      att.clientId = clientId;
      att.helloDeadline = null;
      ws.serializeAttachment(att);

      // If the host's handoff already ran while the room was empty, nobody would ever be
      // elected again, so the first joiner after that takes over.
      if (st.hostClientId !== null && st.hostClientId !== clientId && !st.handoffAt && !this.isConnected(st.hostClientId)) {
        st.hostClientId = clientId;
        this.broadcast({ type: 'host', hostClientId: clientId }, ws);
      }

      await this.save();
      this.send(ws, this.welcome(clientId, issuedToken));
      this.broadcastMembers(true);
      await this.reschedule();
    } finally {
      this.busy.delete(ws);
    }
  }

  hasSession(st, clientId) {
    return Object.keys(st.sessions).some((h) => st.sessions[h].clientId === clientId);
  }

  addSession(st, tokenHash, clientId, now) {
    // one token per client; bound the table, never evicting the host
    for (const h of Object.keys(st.sessions)) {
      if (st.sessions[h].clientId === clientId) delete st.sessions[h];
    }
    st.sessions[tokenHash] = { clientId, at: now };
    const keys = Object.keys(st.sessions);
    if (keys.length > MAX_SESSIONS) {
      keys.filter((h) => st.sessions[h].clientId !== st.hostClientId)
        .sort((a, b) => st.sessions[a].at - st.sessions[b].at)
        .slice(0, keys.length - MAX_SESSIONS)
        .forEach((h) => delete st.sessions[h]);
    }
  }

  async checkPassword(att, password, now) {
    const st = this.state;
    const a = st.attempts;
    if (now - a.hourStart >= HOUR) { a.hourStart = now; a.hourCount = 0; }
    if (a.hourCount >= ROOM_MAX_WRONG_PER_HOUR) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((a.hourStart + HOUR - now) / SEC)) };
    }
    let rec = a.ips[att.ip];
    if (rec && rec.lockedUntil && rec.lockedUntil > now) {
      return { ok: false, retryAfterSec: Math.ceil((rec.lockedUntil - now) / SEC) };
    }
    if (rec && now - rec.lastAt > IP_LOCK_MS) rec = null; // old failures decay
    const ok = await verifyPassword(password, st.password);
    if (this.state !== st) return { ok: false };
    if (ok) {
      if (a.ips[att.ip]) { delete a.ips[att.ip]; await this.save(); }
      return { ok: true };
    }
    rec = rec || { count: 0, lastAt: now, lockedUntil: 0 };
    rec.count += 1;
    rec.lastAt = now;
    a.hourCount += 1;
    let retryAfterSec;
    if (rec.count >= IP_MAX_WRONG) {
      rec.lockedUntil = now + IP_LOCK_MS;
      rec.count = 0;
      retryAfterSec = IP_LOCK_MS / SEC;
    }
    a.ips[att.ip] = rec;
    const keys = Object.keys(a.ips);
    if (keys.length > MAX_TRACKED_IPS) {
      keys.sort((x, y) => a.ips[x].lastAt - a.ips[y].lastAt).slice(0, keys.length - MAX_TRACKED_IPS).forEach((k) => delete a.ips[k]);
    }
    await this.save();
    return { ok: false, retryAfterSec };
  }

  expire(ws) {
    this.sendError(ws, 'roomExpired', 'This room has expired');
    try { ws.close(4001, 'expired'); } catch (e) { /* ignore */ }
  }

  // ---- messages from joined members ------------------------------------------------------
  async onMessage(ws, att, msg, now) {
    const st = this.state;
    if (!st) return this.expire(ws);
    const type = msg.type;

    if (type === 'ping') {
      if (typeof msg.t !== 'number' || !Number.isFinite(msg.t)) return this.violate(ws, att, 'badMessage', 'Bad ping');
      return this.send(ws, { type: 'pong', t: msg.t, serverNow: now });
    }
    if (type === 'visibility') {
      if (typeof msg.visible !== 'boolean') return this.violate(ws, att, 'badMessage', 'Bad visibility');
      if (msg.visible !== att.visible) {
        att.visible = msg.visible;
        att.hiddenSince = msg.visible ? null : now;
        ws.serializeAttachment(att);
        this.broadcastMembers(false);
        await this.reschedule();
      }
      return;
    }

    if (type === 'setName') return this.onSetName(ws, att, msg);

    const controls = ['start', 'resume', 'pause', 'reset', 'scrub', 'setMode', 'setPassword', 'setPlaylist'];
    if (controls.indexOf(type) === -1) return this.violate(ws, att, 'badMessage', 'Unknown message type');
    if (att.clientId !== st.hostClientId) return this.sendError(ws, 'notHost', 'Only the host can do that');

    if (type === 'setPassword') return this.onSetPassword(ws, att, msg, now);
    if (type === 'setPlaylist') return this.onSetPlaylist(ws, att, msg);

    const mode = st.mode;
    const timer = st.timer;
    let next = timer;
    let nextMode = mode;
    if (type === 'start' || type === 'resume') {
      next = SessionModel.start(timer, mode, now);
    } else if (type === 'pause') {
      next = SessionModel.pause(timer, mode, now);
    } else if (type === 'reset') {
      next = SessionModel.reset();
    } else if (type === 'scrub') {
      if (typeof msg.elapsedMs !== 'number' || !Number.isFinite(msg.elapsedMs)) return this.violate(ws, att, 'badMessage', 'Bad scrub');
      next = SessionModel.scrub(timer, mode, msg.elapsedMs, now);
    } else if (type === 'setMode') {
      if (typeof msg.mode !== 'string' || !Object.prototype.hasOwnProperty.call(SessionModel.MODES, msg.mode)) {
        return this.violate(ws, att, 'badMessage', 'Bad mode');
      }
      if (SessionModel.isStarted(timer)) return this.violate(ws, att, 'badMessage', 'Session already started');
      nextMode = msg.mode;
    }

    if (next === timer && nextMode === mode) {
      // invalid or no-op: just re-sync the sender
      return this.send(ws, this.timerMessage());
    }
    st.timer = next;
    st.mode = nextMode;
    await this.save();
    this.broadcast(this.timerMessage());
    this.broadcastMembers(false);
    await this.reschedule();
  }

  // Any member may rename themselves.
  async onSetName(ws, att, msg) {
    const st = this.state;
    const name = typeof msg.name === 'string' ? msg.name.trim() : '';
    if (name.length < 1 || name.length > 24 || CONTROL_CHARS_RE.test(name)) {
      return this.violate(ws, att, 'badMessage', 'Invalid name');
    }
    const member = st.members[att.clientId];
    if (!member || member.name === name) return;
    member.name = name;
    await this.save();
    this.broadcastMembers(true);
  }

  // The host sends whatever was pasted (or null to clear it). The server finds the playlist ID itself,
  // stores only that ID, and tells members the ID, never the pasted text.
  async onSetPlaylist(ws, att, msg) {
    const st = this.state;
    let id = null;
    if (msg.url !== null) {
      const parsed = PlaylistLink.parse(msg.url);
      if (!parsed.ok) return this.violate(ws, att, 'badMessage', 'Bad playlist');
      id = parsed.id;
    }
    if ((st.playlist || null) === id) return;
    st.playlist = id;
    await this.save();
    this.broadcast({ type: 'playlist', playlist: id });
  }

  async onSetPassword(ws, att, msg, now) {
    const st = this.state;
    const pw = msg.password;
    if (pw !== null && (typeof pw !== 'string' || pw.length < 4 || pw.length > 64)) {
      return this.violate(ws, att, 'badMessage', 'Bad password');
    }
    const hadPassword = !!st.password;
    const newHash = pw === null ? null : await hashPassword(pw, parseIterations(this.env.PBKDF2_ITERATIONS));
    if (this.state !== st) return;
    st.password = newHash;

    // Revoke every token except the host's.
    const keep = {};
    for (const h of Object.keys(st.sessions)) {
      const e = st.sessions[h];
      if (e.clientId !== null && e.clientId === st.hostClientId) keep[h] = e;
    }
    st.sessions = keep;

    // Hand out tokens to the host (if it has none) and, when a password is first set, to
    // everyone already in the room so they stay in on refresh.
    const tokens = {};
    if (newHash) {
      const hostHas = Object.keys(keep).length > 0;
      for (const w of this.joinedSockets()) {
        const cid = w.deserializeAttachment().clientId;
        if (tokens[cid]) continue;
        if ((cid === st.hostClientId && !hostHas) || (!hadPassword && cid !== st.hostClientId)) {
          const token = generateToken();
          this.addSession(st, await hashToken(token), cid, now);
          tokens[cid] = token;
        }
      }
    }
    await this.save();
    // New token holders get a fresh welcome carrying it; the broadcast updates the lock icon.
    for (const w of this.joinedSockets()) {
      const cid = w.deserializeAttachment().clientId;
      if (tokens[cid]) this.send(w, this.welcome(cid, tokens[cid]));
    }
    this.broadcastMembers(true);
  }

  // ---- disconnects ---------------------------------------------------------------------------
  async onGone(ws) {
    let att;
    try { att = ws.deserializeAttachment(); } catch (e) { att = null; }
    const st = this.state;
    if (!att || !att.helloDone || !st) { await this.reschedule(); return; }
    const now = Date.now();
    const stillThere = this.joinedSockets().some((w) => w !== ws && w.deserializeAttachment().clientId === att.clientId);
    if (!stillThere) {
      const m = st.members[att.clientId];
      if (m) m.disconnectedAt = now;
      if (st.hostClientId === att.clientId) st.handoffAt = now + HANDOFF_MS;
      if (!this.joinedSockets().some((w) => w !== ws)) st.cleanupAt = now + ROOM_TTL_MS;
      await this.save();
      this.broadcastMembers(true, ws);
    }
    await this.reschedule();
  }

  // ---- alarm: the single scheduler ----------------------------------------------------------------
  async alarm() {
    const now = Date.now();
    const st = this.state;
    let dirty = false;

    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && !a.helloDone && a.helloDeadline && now >= a.helloDeadline) {
        try { w.close(4000, 'hello timeout'); } catch (e) { /* ignore */ }
      }
    }

    if (st) {
      if ((!st.entered && now >= st.createdAt + ROOM_TTL_MS) || (st.cleanupAt && now >= st.cleanupAt)) {
        await this.cleanup();
        return;
      }
      if (st.handoffAt && now >= st.handoffAt) {
        st.handoffAt = null;
        dirty = true;
        if (!this.isConnected(st.hostClientId)) {
          const next = this.connectedMemberIds().sort((x, y) => st.members[x].joinedAt - st.members[y].joinedAt)[0];
          if (next) {
            st.hostClientId = next;
            this.broadcast({ type: 'host', hostClientId: next });
          }
        }
      }
      for (const cid of Object.keys(st.members)) {
        const m = st.members[cid];
        if (m.disconnectedAt && now - m.disconnectedAt >= DROP_MS && !this.isConnected(cid)) {
          delete st.members[cid];
          dirty = true;
        }
      }
      if (dirty) await this.save();
      this.broadcastMembers(false);
    }
    await this.reschedule();
  }

  async cleanup() {
    for (const w of this.ctx.getWebSockets()) {
      try { w.close(4001, 'expired'); } catch (e) { /* ignore */ }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.state = null;
    this.lastRosterSig = '';
  }

  async reschedule() {
    const now = Date.now();
    const times = [];
    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && !a.helloDone && a.helloDeadline) times.push(a.helloDeadline);
    }
    const st = this.state;
    if (st) {
      if (st.handoffAt) times.push(st.handoffAt);
      if (st.cleanupAt) times.push(st.cleanupAt);
      if (!st.entered) times.push(st.createdAt + ROOM_TTL_MS);
      for (const cid of Object.keys(st.members)) {
        const m = st.members[cid];
        if (m.disconnectedAt) times.push(m.disconnectedAt + DROP_MS);
      }
      for (const w of this.joinedSockets()) {
        const a = w.deserializeAttachment();
        if (a.visible === false && a.hiddenSince && a.hiddenSince + HIDDEN_AWAY_MS > now) times.push(a.hiddenSince + HIDDEN_AWAY_MS);
      }
      const t = st.timer;
      if (!t.paused && t.anchorAt !== null) {
        const v = SessionModel.view(st.mode, SessionModel.elapsedMs(t, now, st.mode));
        if (v.index < 4) times.push(t.anchorAt + (v.phaseStartMs + v.phaseDurationMs - t.offsetMs));
      }
    }
    if (times.length === 0) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(Math.max(Math.min.apply(null, times), now + 1));
    }
  }

  // ---- helpers --------------------------------------------------------------------------------
  async save() {
    if (this.state) await this.ctx.storage.put('state', this.state);
  }

  joinedSockets() {
    return this.ctx.getWebSockets().filter((w) => {
      if (w.readyState !== undefined && w.readyState > 1) return false;
      const a = w.deserializeAttachment();
      return a && a.helloDone;
    });
  }

  connectedMemberIds() {
    const ids = {};
    for (const w of this.joinedSockets()) ids[w.deserializeAttachment().clientId] = true;
    return Object.keys(ids);
  }

  isConnected(clientId) {
    return clientId !== null && this.connectedMemberIds().indexOf(clientId) !== -1;
  }

  timerMessage() {
    const st = this.state;
    return { type: 'timer', mode: st.mode, anchorAt: st.timer.anchorAt, offsetMs: st.timer.offsetMs, paused: st.timer.paused };
  }

  welcome(clientId, sessionToken) {
    const st = this.state;
    const out = {
      type: 'welcome',
      you: clientId,
      hostClientId: st.hostClientId,
      timer: { mode: st.mode, anchorAt: st.timer.anchorAt, offsetMs: st.timer.offsetMs, paused: st.timer.paused },
      members: this.roster(),
      serverNow: Date.now(),
      protected: !!st.password,
      playlist: st.playlist || null
    };
    if (sessionToken) out.sessionToken = sessionToken;
    return out;
  }

  // Server-side presence. Order: disconnected -> away; not started -> ready;
  // rest (and the alarm after work) -> onBreak; hidden >= 2 min -> away; else lockedIn.
  roster(excludeSocket) {
    const st = this.state;
    const now = Date.now();
    const started = SessionModel.isStarted(st.timer);
    const view = SessionModel.view(st.mode, SessionModel.elapsedMs(st.timer, now, st.mode));
    const onBreak = view.phase === 'rest' || (view.phase === 'alarm' && view.alarmAfter === 'work');
    const conn = {};
    for (const w of this.joinedSockets()) {
      if (w === excludeSocket) continue;
      const a = w.deserializeAttachment();
      const c = conn[a.clientId] || (conn[a.clientId] = { visible: false, hiddenSince: 0 });
      if (a.visible !== false) c.visible = true;
      else if (a.hiddenSince > c.hiddenSince) c.hiddenSince = a.hiddenSince;
    }
    return Object.keys(st.members)
      .sort((x, y) => st.members[x].joinedAt - st.members[y].joinedAt)
      .map((cid) => {
        const m = st.members[cid];
        const c = conn[cid];
        let status;
        let awaySince = null;
        if (!c) {
          status = 'away';
          awaySince = m.disconnectedAt || now;
        } else if (!started) {
          status = 'ready';
        } else if (onBreak) {
          status = 'onBreak';
        } else if (!c.visible && now - c.hiddenSince >= HIDDEN_AWAY_MS) {
          status = 'away';
          awaySince = c.hiddenSince;
        } else {
          status = 'lockedIn';
        }
        return { clientId: cid, name: m.name, status, awaySince, isHost: cid === st.hostClientId };
      });
  }

  broadcastMembers(force, excludeSocket) {
    if (!this.state) return;
    const members = this.roster(excludeSocket);
    const sig = JSON.stringify(members);
    if (!force && sig === this.lastRosterSig) return;
    this.lastRosterSig = sig;
    this.broadcast({ type: 'members', members, protected: !!this.state.password }, excludeSocket);
  }

  broadcast(obj, excludeSocket) {
    const text = JSON.stringify(obj);
    for (const w of this.joinedSockets()) {
      if (w === excludeSocket) continue;
      try { w.send(text); } catch (e) { /* socket gone */ }
    }
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* socket gone */ }
  }

  sendError(ws, code, message) {
    this.send(ws, { type: 'error', code, message });
  }

  violate(ws, att, code, message) {
    att.violations = (att.violations || 0) + 1;
    ws.serializeAttachment(att);
    this.sendError(ws, code, message);
    if (att.violations >= MAX_VIOLATIONS) {
      try { ws.close(4003, 'too many violations'); } catch (e) { /* ignore */ }
    }
  }
}
