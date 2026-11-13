// INTEGRATION TEST: drives real WebSocket clients against a running dev server.
// Requires `npx wrangler dev` running on http://localhost:8787 (override with BASE_URL).
// Run: npm run test:integration
// Needs Node >= 22 (built-in WebSocket with a non-standard `headers` option for Origin).
// Room creation is rate limited (5/hour/IP). A run creates 3 rooms; to rerun more than once an hour,
// stop wrangler, `rm -rf .wrangler/state`, and start it again.
// Note: `wrangler dev` serves the repo root as assets and live-reloads on any file change (including .git
// writes), which drops sockets mid-test. If the handoff test flakes, run wrangler from a quiet copy of the repo.
// The host-handoff test waits ~31s of real time (HANDOFF_MS = 30s on the server).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SessionModel = require('../../js/session.js');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createRoom(password) {
  const res = await fetch(BASE + '/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(password ? { password } : {})
  });
  assert.equal(res.status, 201);
  return res.json();
}

let counter = 0;
class Client {
  constructor(roomId, name) {
    this.roomId = roomId; this.name = name;
    this.clientId = 'itest' + Date.now().toString(36) + (counter++) + 'abcdefgh';
    this.msgs = []; this.waiters = []; this.closed = null;
    this.offset = 0; this.timer = null; this.mode = null; this.members = []; this.hostId = null; this.token = null;
  }
  open() {
    const url = BASE.replace(/^http/, 'ws') + '/rooms/' + encodeURIComponent(this.roomId);
    this.ws = new WebSocket(url, { headers: { Origin: ORIGIN } });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      this.msgs.push(m);
      if (m.type === 'welcome') {
        this.offset = m.serverNow - Date.now(); this.hostId = m.hostClientId;
        this.timer = m.timer; this.mode = m.timer.mode; this.members = m.members;
        if (m.sessionToken) this.token = m.sessionToken;
      } else if (m.type === 'timer') { this.timer = m; this.mode = m.mode; }
      else if (m.type === 'members') this.members = m.members;
      else if (m.type === 'host') this.hostId = m.hostClientId;
      this.waiters = this.waiters.filter((w) => !w.try());
    };
    this.ws.onclose = (ev) => { this.closed = ev.code; this.waiters = this.waiters.filter((w) => !w.try()); };
    return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  hello(extra) { this.send(Object.assign({ type: 'hello', clientId: this.clientId, name: this.name }, extra || {})); }
  // Resolve with the first message (from now on, or already buffered since `from`) matching pred.
  waitFor(pred, ms, from) {
    ms = ms || 3000;
    const start = from === undefined ? this.msgs.length : from;
    return new Promise((resolve, reject) => {
      const w = { try: () => {
        for (let i = start; i < this.msgs.length; i++) if (pred(this.msgs[i])) { clearTimeout(t); resolve(this.msgs[i]); return true; }
        if (this.closed !== null && pred({ type: '__closed', code: this.closed })) { clearTimeout(t); resolve({ type: '__closed', code: this.closed }); return true; }
        return false;
      } };
      const t = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Error('timeout waiting; got ' + JSON.stringify(this.msgs.slice(start)))); }, ms);
      if (!w.try()) this.waiters.push(w);
    });
  }
  waitClosed(ms) { return this.waitFor((m) => m.type === '__closed', ms); }
  serverNow() { return Date.now() + this.offset; }
  view() { return SessionModel.view(this.mode, SessionModel.elapsedMs(this.timer, this.serverNow(), this.mode)); }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function join(roomId, name, extra) {
  const c = new Client(roomId, name);
  await c.open();
  const from = c.msgs.length;
  c.hello(extra);
  const m = await c.waitFor((x) => x.type === 'welcome' || x.type === 'authRequired' || x.type === 'authFailed' || x.type === 'error', 3000, from);
  c.first = m;
  return c;
}

test('origin and signature checks', async () => {
  // Uses a forged ID, not createRoom(): creation is limited to 5/hour/IP and 5/min in dev too.
  const roomId = 'abcdefghij.togj91.AAAAAAAAAAAAAAAA';
  const bad = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{}' });
  assert.equal(bad.status, 403);
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/rooms/' + encodeURIComponent(roomId.slice(0, -2) + 'xx'), { headers: { Origin: ORIGIN } });
  const code = await new Promise((r) => { ws.onerror = () => r('error'); ws.onopen = () => r('open'); });
  assert.equal(code, 'error');
});

test('open room: join, late join, host controls, non-host rejection, view agreement', async () => {
  const { roomId, sessionToken } = await createRoom();
  assert.equal(sessionToken, undefined);
  const host = await join(roomId, 'Hosty');
  assert.equal(host.first.type, 'welcome');
  assert.equal(host.first.hostClientId, host.clientId);
  assert.equal(host.first.protected, false);
  assert.equal(host.timer.paused, true);
  assert.equal(host.timer.anchorAt, null);
  assert.deepEqual(host.members.map((m) => m.status), ['ready']);

  // Settle the clock offset like the client does (lowest RTT of a few pings).
  const guest = await join(roomId, 'Guesty');
  assert.equal(guest.first.type, 'welcome');
  assert.equal(guest.hostId, host.clientId);
  assert.equal(guest.members.length, 2);
  await host.waitFor((m) => m.type === 'members' && m.members.length === 2);

  // Non-host control rejected.
  guest.send({ type: 'start' });
  const err = await guest.waitFor((m) => m.type === 'error');
  assert.equal(err.code, 'notHost');
  assert.equal(guest.timer.paused, true);

  // Start.
  host.send({ type: 'start' });
  const [ht, gt] = await Promise.all([host.waitFor((m) => m.type === 'timer'), guest.waitFor((m) => m.type === 'timer')]);
  assert.equal(ht.paused, false); assert.equal(gt.paused, false);
  assert.equal(ht.anchorAt, gt.anchorAt);
  await guest.waitFor((m) => m.type === 'members' && m.members.every((x) => x.status === 'lockedIn'));
  await sleep(1100);
  assert.deepEqual(
    { ...host.view(), phaseElapsedMs: 0 }.phase, guest.view().phase);
  assert.ok(Math.abs(host.view().sessionElapsedMs - guest.view().sessionElapsedMs) < 1000, 'views agree within 1s');
  assert.ok(host.view().sessionElapsedMs >= 1000, 'timer advanced');

  // Pause.
  host.send({ type: 'pause' });
  await Promise.all([host.waitFor((m) => m.type === 'timer' && m.paused), guest.waitFor((m) => m.type === 'timer' && m.paused)]);
  const frozen = guest.view().sessionElapsedMs;
  await sleep(300);
  assert.equal(guest.view().sessionElapsedMs, frozen);
  assert.equal(host.view().sessionElapsedMs, frozen);

  // Scrub to 20 min into work.
  host.send({ type: 'scrub', elapsedMs: 20 * 60 * 1000 });
  await Promise.all([host.waitFor((m) => m.type === 'timer'), guest.waitFor((m) => m.type === 'timer')]);
  assert.equal(guest.view().phaseElapsedMs, 20 * 60 * 1000);
  assert.equal(host.view().phaseElapsedMs, 20 * 60 * 1000);
  assert.equal(guest.timer.paused, true);

  // Late joiner sees the current state.
  const late = await join(roomId, 'Latecomer');
  assert.equal(late.view().phaseElapsedMs, 20 * 60 * 1000);
  assert.equal(late.members.length, 3);

  // Resume, then reset.
  host.send({ type: 'start' });
  await guest.waitFor((m) => m.type === 'timer' && !m.paused);
  assert.equal(guest.view().phase, 'work');
  host.send({ type: 'reset' });
  await Promise.all([host.waitFor((m) => m.type === 'timer' && m.anchorAt === null), guest.waitFor((m) => m.type === 'timer' && m.anchorAt === null)]);
  assert.equal(guest.view().sessionElapsedMs, 0);
  await guest.waitFor((m) => m.type === 'members' && m.members.every((x) => x.status === 'ready'));

  // setMode before start is host-only and works.
  host.send({ type: 'setMode', mode: '112/26' });
  await Promise.all([guest.waitFor((m) => m.type === 'timer' && m.mode === '112/26'), host.waitFor((m) => m.type === 'timer' && m.mode === '112/26')]);
  assert.equal(host.mode, '112/26');

  // Visibility: hidden members stay lockedIn for <2min (no status change needed), message accepted.
  guest.send({ type: 'visibility', visible: false });
  guest.send({ type: 'ping', t: Date.now() });
  const pong = await guest.waitFor((m) => m.type === 'pong');
  assert.equal(typeof pong.serverNow, 'number');

  // Leaving guest becomes away for others.
  late.close();
  await host.waitFor((m) => m.type === 'members' && m.members.some((x) => x.name === 'Latecomer' && x.status === 'away'));
  host.close(); guest.close();
});

test('protected room: authRequired, wrong password, right password, token reuse', async () => {
  const { roomId, sessionToken } = await createRoom('hunter22');
  assert.ok(sessionToken, 'creator token returned');

  // Creator joins with token and becomes host.
  const host = await join(roomId, 'Boss', { sessionToken });
  assert.equal(host.first.type, 'welcome');
  assert.equal(host.first.hostClientId, host.clientId);
  assert.equal(host.first.protected, true);

  // No password.
  const a = await join(roomId, 'Anon');
  assert.equal(a.first.type, 'authRequired');
  assert.equal((await a.waitClosed()).code, 4004);

  // Wrong password.
  const b = await join(roomId, 'Anon', { password: 'wrongpass' });
  assert.equal(b.first.type, 'authFailed');
  assert.equal((await b.waitClosed()).code, 4004);

  // Right password: welcome + token.
  const c = await join(roomId, 'Anon', { password: 'hunter22' });
  assert.equal(c.first.type, 'welcome');
  assert.ok(c.first.sessionToken, 'token issued after password');
  assert.equal(c.hostId, host.clientId);

  // Reconnect with token only (new socket, same clientId).
  c.close();
  await sleep(200);
  const c2 = new Client(roomId, 'Anon'); c2.clientId = c.clientId;
  await c2.open();
  c2.hello({ sessionToken: c.token });
  const w = await c2.waitFor((m) => m.type === 'welcome' || m.type === 'authRequired');
  assert.equal(w.type, 'welcome');

  // Bad token alone is refused.
  const d = await join(roomId, 'Anon2', { sessionToken: c.token });
  assert.equal(d.first.type, 'authRequired', 'token is bound to its clientId');
  host.close(); c2.close();
});

test('host disconnect hands off after ~30s', { timeout: 60000 }, async () => {
  const { roomId } = await createRoom();
  const host = await join(roomId, 'H');
  const guest = await join(roomId, 'G');
  host.close();
  const t0 = Date.now();
  const h = await guest.waitFor((m) => m.type === 'host' && m.hostClientId === guest.clientId, 45000);
  assert.equal(h.hostClientId, guest.clientId);
  const dt = Date.now() - t0;
  assert.ok(dt > 20000 && dt < 45000, 'handoff after about 30s, got ' + dt);
  guest.send({ type: 'start' });
  const t = await guest.waitFor((m) => m.type === 'timer');
  assert.equal(t.paused, false);
  guest.close();
});
