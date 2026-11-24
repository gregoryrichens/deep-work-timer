import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject, runDurableObjectAlarm, evictDurableObject, listDurableObjectIds } from 'cloudflare:test';
import SessionModel from '../../server/src/session-model.js';
import { createRoomId, verifyRoomId, hashPassword, verifyPassword } from '../../server/src/crypto.js';
import { createRoom, connect, join, upgrade, stubFor, cid, freshIp, ORIGIN } from './helpers.js';

const open = [];
async function jn(roomId, n, extra, headers) {
  const c = await join(roomId, n, extra, headers);
  open.push(c);
  return c;
}
async function mk(password) {
  const r = await createRoom(password === undefined ? {} : { password });
  expect(r.res.status).toBe(201);
  return r.json;
}
const now = () => Date.now();

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now()); });
afterEach(() => {
  open.splice(0).forEach((c) => c.close());
  vi.useRealTimers();
});
function advance(ms) { vi.setSystemTime(Date.now() + ms); }

describe('crypto helpers', () => {
  it('signs and verifies room ids, rejects tampering', async () => {
    const { roomId } = await createRoomId('s3cret', Date.now());
    expect(await verifyRoomId('s3cret', roomId)).not.toBeNull();
    expect(await verifyRoomId('other', roomId)).toBeNull();
    const parts = roomId.split('.');
    expect(await verifyRoomId('s3cret', parts[0] + '.' + parts[1] + '.' + 'A'.repeat(16))).toBeNull();
    expect(await verifyRoomId('s3cret', 'garbage')).toBeNull();
  });
  it('hashes passwords with stored iterations', async () => {
    const rec = await hashPassword('correct horse', 1000);
    expect(rec.iterations).toBe(1000);
    expect(await verifyPassword('correct horse', rec)).toBe(true);
    expect(await verifyPassword('wrong horse', rec)).toBe(false);
  });
});

describe('worker gate', () => {
  it('rejects forged / unsigned ids without creating a Durable Object', async () => {
    const before = (await listDurableObjectIds(env.ROOMS)).length;
    const { roomId } = await mk();
    const parts = roomId.split('.');
    const forged = parts[0] + '.' + parts[1] + '.' + 'A'.repeat(16);
    for (const id of ['abcdefghij', 'abcdefghij.zzzzzz.AAAAAAAAAAAAAAAA', forged, parts[0] + '.' + parts[1] + '.' + parts[2].slice(0, 15)]) {
      const res = await upgrade(id);
      expect(res.status).toBe(404);
    }
    expect((await listDurableObjectIds(env.ROOMS)).length).toBe(before);
  });

  it('rejects a bad or missing Origin on upgrade and on create, before the DO', async () => {
    const { roomId } = await mk();
    const before = (await listDurableObjectIds(env.ROOMS)).length;
    expect((await upgrade(roomId, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await upgrade(roomId, { Origin: '' })).status).toBe(403);
    const bad = await createRoom({}, { Origin: 'https://evil.example' });
    expect(bad.res.status).toBe(403);
    expect((await listDurableObjectIds(env.ROOMS)).length).toBe(before);
  });

  it('validates the create body', async () => {
    expect((await createRoom({ password: 'abc' })).res.status).toBe(400);
    expect((await createRoom({ password: 'abc' })).json.error).toBe('badPassword');
    expect((await createRoom({ password: 'x'.repeat(65) })).json.error).toBe('badPassword');
    expect((await createRoom({ password: 12345 })).json.error).toBe('badPassword');
    const r = await exports.default.fetch('http://localhost:8787/api/rooms', {
      method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': freshIp() }, body: '{not json'
    });
    expect(r.status).toBe(400);
    const ok = await createRoom({ password: 'abcd' });
    expect(ok.res.status).toBe(201);
    expect(ok.json.sessionToken).toBeTruthy();
    expect((await createRoom({})).json.sessionToken).toBeUndefined();
  });

  it('answers 429 on the sixth creation from one IP within an hour', async () => {
    const h = { 'CF-Connecting-IP': '203.0.113.77' };
    for (let i = 0; i < 5; i++) expect((await createRoom({}, h)).res.status).toBe(201);
    const sixth = await createRoom({}, h);
    expect(sixth.res.status).toBe(429);
    expect(sixth.json.error).toBe('rateLimited');
    expect((await createRoom({}, { 'CF-Connecting-IP': '203.0.113.78' })).res.status).toBe(201);
  });

  it('falls through to static assets for other paths', async () => {
    const res = await exports.default.fetch('http://localhost:8787/definitely-missing');
    expect(res.status).toBe(404);
  });
});

describe('hello and abuse limits', () => {
  it('closes a socket that never says hello (4000), via the alarm', async () => {
    const { roomId } = await mk();
    const c = await connect(roomId);
    open.push(c);
    advance(6000);
    expect(await runDurableObjectAlarm(stubFor(roomId))).toBe(true);
    expect((await c.waitClosed()).code).toBe(4000);
  });

  it('does not write storage for a room that was only connected to', async () => {
    const { roomId } = await mk();
    const c = await connect(roomId);
    open.push(c);
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      expect((await state.storage.list()).size).toBe(0);
    });
  });

  it('rejects a non-hello first message, oversize messages and counts violations (4003)', async () => {
    const { roomId } = await mk();
    const c = await connect(roomId);
    open.push(c);
    c.send({ type: 'start' });
    await c.nextError('badMessage');
    c.send('x'.repeat(1100));
    await c.nextError('badMessage');
    c.send('not json');
    c.send('[]');
    c.send('{"type":5}');
    expect((await c.waitClosed()).code).toBe(4003);
  });

  it('validates hello fields', async () => {
    const { roomId } = await mk();
    const c = await jn(roomId, 1, { name: '   ' });
    await c.nextError('badMessage');
    c.send({ type: 'hello', clientId: 'short', name: 'ok' });
    await c.nextError('badMessage');
    c.send({ type: 'hello', clientId: cid(1), name: 'x'.repeat(25) });
    await c.nextError('badMessage');
    c.send({ type: 'hello', clientId: cid(1), name: '  Neat  ' });
    const w = await c.next('welcome');
    expect(w.members[0].name).toBe('Neat');
  });

  it('rate limits message floods', async () => {
    const { roomId } = await mk();
    const c = await jn(roomId, 1);
    await c.next('welcome');
    for (let i = 0; i < 40; i++) c.send({ type: 'ping', t: i });
    await c.nextError('rateLimited');
  });

  it('caps the room at 20 members (roomFull, 4002)', async () => {
    const { roomId } = await mk();
    const tokens = {};
    for (let i = 1; i <= 20; i++) {
      const c = await jn(roomId, i);
      tokens[i] = (await c.next('welcome')).sessionToken;
    }
    const extra = await jn(roomId, 21);
    await extra.nextError('roomFull');
    expect((await extra.waitClosed()).code).toBe(4002);
    // an existing member can still reconnect
    const again = await jn(roomId, 5, { sessionToken: tokens[5] });
    await again.next('welcome');
  });
});

describe('timer, host and presence', () => {
  it('lets only the host control the timer, even with raw messages', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    const w = await a.next('welcome');
    expect(w.hostClientId).toBe(cid(1));
    expect(w.protected).toBe(false);
    expect(w.timer).toEqual({ mode: '52/17', anchorAt: null, offsetMs: 0, paused: true });
    const b = await jn(roomId, 2);
    const wb = await b.next('welcome');
    expect(wb.hostClientId).toBe(cid(1));
    expect(wb.members.map((m) => m.isHost)).toEqual([true, false]);

    for (const m of [{ type: 'start' }, { type: 'pause' }, { type: 'resume' }, { type: 'reset' },
      { type: 'scrub', elapsedMs: 5 }, { type: 'setMode', mode: '112/26' }, { type: 'setPassword', password: 'abcd' }]) {
      b.send(m);
      await b.nextError('notHost');
    }
    expect(a.noMessage('timer')).toBe(true);

    a.send({ type: 'start' });
    const t = await b.next('timer');
    expect(t.paused).toBe(false);
    expect(t.anchorAt).toBe(now());
    expect(t.mode).toBe('52/17');
    expect((await a.next('timer')).anchorAt).toBe(now());
  });

  it('supports pause, scrub (phase-relative), reset and setMode only before start', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    await a.next('welcome');
    a.send({ type: 'setMode', mode: '112/26' });
    expect((await a.next('timer')).mode).toBe('112/26');
    a.send({ type: 'setMode', mode: 'nope' });
    await a.nextError('badMessage');
    a.send({ type: 'start' });
    await a.next('timer');
    a.send({ type: 'setMode', mode: '52/17' });
    await a.nextError('badMessage');
    advance(10000);
    a.send({ type: 'pause' });
    let t = await a.next('timer');
    expect(t.paused).toBe(true);
    expect(t.anchorAt).not.toBeNull();
    expect(t.offsetMs).toBe(10000);
    a.send({ type: 'scrub', elapsedMs: 600000 });
    t = await a.next('timer');
    expect(t.offsetMs).toBe(600000);
    a.send({ type: 'scrub', elapsedMs: 'x' });
    await a.nextError('badMessage');
    a.send({ type: 'resume' });
    expect((await a.next('timer')).paused).toBe(false);
    a.send({ type: 'reset' });
    t = await a.next('timer');
    expect(t).toMatchObject({ anchorAt: null, offsetMs: 0, paused: true, mode: '112/26' });
  });

  it('keeps the host across a refresh and does not hand off before 30s', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    const aToken = (await a.next('welcome')).sessionToken;
    const b = await jn(roomId, 2);
    await b.next('welcome');
    a.close();
    await b.waitFor(() => b.queue.filter((m) => m.type === 'members').pop()?.members.find((m) => m.clientId === cid(1))?.status === 'away', 'a away');
    advance(10000);
    await runDurableObjectAlarm(stubFor(roomId));
    expect(b.noMessage('host')).toBe(true);
    const a2 = await jn(roomId, 1, { sessionToken: aToken });
    expect((await a2.next('welcome')).hostClientId).toBe(cid(1));
    advance(60000);
    await runDurableObjectAlarm(stubFor(roomId));
    expect(b.noMessage('host')).toBe(true);
  });

  it('promotes the longest-present member 30s after the host leaves', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    const aToken = (await a.next('welcome')).sessionToken;
    const b = await jn(roomId, 2);
    await b.next('welcome');
    advance(1000);
    const c = await jn(roomId, 3);
    await c.next('welcome');
    a.close();
    await b.waitFor(() => b.queue.some((m) => m.type === 'members' && m.members.find((x) => x.clientId === cid(1) && x.status === 'away')), 'away');
    advance(31000);
    await runDurableObjectAlarm(stubFor(roomId));
    expect((await b.next('host')).hostClientId).toBe(cid(2));
    expect((await c.next('host')).hostClientId).toBe(cid(2));
    b.send({ type: 'start' });
    expect((await c.next('timer')).paused).toBe(false);
    // the old host is a normal member now
    const a2 = await jn(roomId, 1, { sessionToken: aToken });
    expect((await a2.next('welcome')).hostClientId).toBe(cid(2));
    a2.send({ type: 'pause' });
    await a2.nextError('notHost');
  });

  it('gives a late joiner the correct live timer, and onBreak during rest', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    await a.next('welcome');
    a.send({ type: 'start' });
    await a.next('timer');
    const startedAt = now();
    advance(3140 * 1000); // 3120s work + 10s alarm -> 10s into rest
    const b = await jn(roomId, 2);
    const w = await b.next('welcome');
    const v = SessionModel.view(w.timer.mode, SessionModel.elapsedMs(w.timer, w.serverNow, w.timer.mode));
    expect(w.timer.anchorAt).toBe(startedAt);
    expect(v.phase).toBe('rest');
    expect(v.phaseElapsedSec).toBe(10);
    expect(w.serverNow).toBe(now());
    expect(w.members.every((m) => m.status === 'onBreak')).toBe(true);
  });

  it('computes presence: ready, lockedIn, hidden away, disconnected away; phase flips via alarm', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    let w = await a.next('welcome');
    expect(w.members[0].status).toBe('ready');
    const b = await jn(roomId, 2);
    await b.next('welcome');
    a.send({ type: 'start' });
    let m = (await b.latest('members')).members;
    await b.waitFor(() => b.queue.filter((x) => x.type === 'members').pop().members.every((x) => x.status === 'lockedIn'), 'lockedIn');
    b.send({ type: 'visibility', visible: false });
    const hiddenAt = now();
    b.send({ type: 'ping', t: 1 });
    await b.next('pong'); // visibility was processed before the clock moves
    advance(121000);
    await runDurableObjectAlarm(stubFor(roomId));
    await a.waitFor(() => a.queue.filter((x) => x.type === 'members').pop().members.find((x) => x.clientId === cid(2)).status === 'away', 'b hidden away');
    m = a.queue.filter((x) => x.type === 'members').pop().members.find((x) => x.clientId === cid(2));
    expect(m.awaySince).toBe(hiddenAt);
    b.send({ type: 'visibility', visible: true });
    await a.waitFor(() => a.queue.filter((x) => x.type === 'members').pop().members.find((x) => x.clientId === cid(2)).status === 'lockedIn', 'b back');
    // phase boundary -> onBreak
    advance(3130 * 1000);
    await runDurableObjectAlarm(stubFor(roomId));
    await a.waitFor(() => a.queue.filter((x) => x.type === 'members').pop().members.every((x) => x.status === 'onBreak'), 'onBreak');
  });

  it('drops members that stayed disconnected for more than 5 minutes', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    await a.next('welcome');
    const b = await jn(roomId, 2);
    await b.next('welcome');
    b.close();
    await a.waitFor(() => a.queue.some((x) => x.type === 'members' && x.members.length === 2 && x.members[1].status === 'away'), 'b away');
    advance(5 * 60 * 1000 + 1000);
    await runDurableObjectAlarm(stubFor(roomId));
    await a.waitFor(() => a.queue.filter((x) => x.type === 'members').pop().members.length === 1, 'dropped');
  });

  it('answers ping with the echoed t and server time', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    await a.next('welcome');
    a.send({ type: 'ping', t: 12345 });
    expect(await a.next('pong')).toMatchObject({ t: 12345, serverNow: now() });
  });

  it('survives Durable Object eviction (hibernation): sockets, host and timer persist', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    await a.next('welcome');
    const b = await jn(roomId, 2);
    await b.next('welcome');
    a.send({ type: 'start' });
    await a.next('timer');
    b.queue.length = 0;
    await evictDurableObject(stubFor(roomId));
    b.send({ type: 'pause' });
    await b.nextError('notHost');
    advance(5000);
    a.send({ type: 'pause' });
    const t = await b.next('timer');
    expect(t.paused).toBe(true);
    expect(t.offsetMs).toBe(5000);
    const c = await jn(roomId, 3);
    expect((await c.next('welcome')).members.length).toBe(3);
  });
});

describe('host impersonation', () => {
  async function expectRejected(c) {
    await c.nextError('sessionInvalid');
    expect((await c.waitClosed()).code).toBe(4003);
    expect(c.queue.some((m) => m.type === 'welcome')).toBe(false);
  }

  it('issues a private token to every new member of an open room', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    expect((await a.next('welcome')).sessionToken).toBeTruthy();
    const b = await jn(roomId, 2);
    expect((await b.next('welcome')).sessionToken).toBeTruthy();
  });

  it('rejects a second socket claiming the host clientId without its token (open room)', async () => {
    const { roomId } = await mk();
    const host = await jn(roomId, 1);
    const hw = await host.next('welcome');
    const thief = await jn(roomId, 1);
    await expectRejected(thief);
    const wrong = await jn(roomId, 1, { sessionToken: 'x'.repeat(30) });
    await expectRejected(wrong);
    // the real host is untouched and still controls the room
    host.send({ type: 'start' });
    expect((await host.next('timer')).paused).toBe(false);
    // and a member cannot borrow another member's token to become the host
    const b = await jn(roomId, 2);
    const bw = await b.next('welcome');
    const thief2 = await jn(roomId, 1, { sessionToken: bw.sessionToken });
    await expectRejected(thief2);
    expect(hw.sessionToken).toBeTruthy();
  });

  it('rejects a host clientId claim even with the correct password (protected room)', async () => {
    const { roomId, sessionToken } = await mk('hunter2-secret');
    const host = await jn(roomId, 1, { sessionToken });
    const hw = await host.next('welcome');
    expect(hw.sessionToken).toBeUndefined();
    const thief = await jn(roomId, 1, { password: 'hunter2-secret' });
    await expectRejected(thief);
    const m = await jn(roomId, 2, { password: 'hunter2-secret' });
    const mw = await m.next('welcome');
    const thief2 = await jn(roomId, 2, { password: 'hunter2-secret' });
    await expectRejected(thief2);
    m.send({ type: 'start' });
    await m.nextError('notHost');
    expect(mw.hostClientId).toBe(cid(1));
  });

  it('lets the real host reconnect with its token, in an open room, while two tabs share it', async () => {
    const { roomId } = await mk();
    const tab1 = await jn(roomId, 1);
    const w = await tab1.next('welcome');
    const tab2 = await jn(roomId, 1, { sessionToken: w.sessionToken });
    expect((await tab2.next('welcome')).hostClientId).toBe(cid(1));
    tab1.close();
    const again = await jn(roomId, 1, { sessionToken: w.sessionToken });
    expect((await again.next('welcome')).hostClientId).toBe(cid(1));
    again.send({ type: 'start' });
    expect((await again.next('timer')).paused).toBe(false);
  });
});

describe('hostless room recovery', () => {
  it('elects a member who joins after the handoff alarm ran on an empty room', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    await a.next('welcome');
    a.close();
    await a.waitClosed();
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      const st = await state.storage.get('state');
      expect(st.handoffAt).toBeTruthy();
    });
    advance(31000);
    await runDurableObjectAlarm(stubFor(roomId));
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      const st = await state.storage.get('state');
      expect(st.handoffAt).toBeNull();
    });
    const b = await jn(roomId, 2);
    const bw = await b.next('welcome');
    expect(bw.hostClientId).toBe(cid(2));
    b.send({ type: 'start' });
    expect((await b.next('timer')).paused).toBe(false);
  });

  it('does not steal the host from a host whose handoff is still pending', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    await a.next('welcome');
    a.close();
    await a.waitClosed();
    const b = await jn(roomId, 2);
    expect((await b.next('welcome')).hostClientId).toBe(cid(1));
  });
});

describe('lifetime', () => {
  const TWO_H = 2 * 3600 * 1000;

  it('deletes a room empty for 2h, then reports roomExpired without recreating it', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    await a.next('welcome');
    a.send({ type: 'start' });
    await a.next('timer');
    a.close();
    await runInDurableObject(stubFor(roomId), async (_i, s) => {});
    advance(TWO_H + 60000);
    await runDurableObjectAlarm(stubFor(roomId));
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      expect((await state.storage.list()).size).toBe(0);
    });
    const late = await jn(roomId, 1);
    await late.nextError('roomExpired');
    expect((await late.waitClosed()).code).toBe(4001);
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      expect((await state.storage.list()).size).toBe(0);
    });
  });

  it('cancels deletion when someone rejoins before 2h, keeping timer state', async () => {
    const { roomId } = await mk();
    const a = await jn(roomId, 1);
    const aToken = (await a.next('welcome')).sessionToken;
    a.send({ type: 'start' });
    await a.next('timer');
    a.close();
    await runInDurableObject(stubFor(roomId), async () => {});
    advance(3600 * 1000);
    const a2 = await jn(roomId, 1, { sessionToken: aToken });
    const w = await a2.next('welcome');
    expect(w.timer.paused).toBe(false);
    advance(TWO_H - 1000);
    await runDurableObjectAlarm(stubFor(roomId));
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      expect(await state.storage.get('state')).toBeTruthy();
    });
    expect(w.timer.anchorAt).not.toBeNull();
    // the timer is still the host's running timer (no reset by the cancelled cleanup)
    a2.send({ type: 'pause' });
    expect((await a2.next('timer')).anchorAt).toBe(w.timer.anchorAt);
  });

  it('expires an unprotected room nobody entered within 2h, writing nothing', async () => {
    const { roomId } = await mk();
    advance(TWO_H + 1000);
    const c = await jn(roomId, 1);
    await c.nextError('roomExpired');
    expect((await c.waitClosed()).code).toBe(4001);
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      expect((await state.storage.list()).size).toBe(0);
    });
  });

  it('expires a protected room nobody entered within 2h: alarm deletes it, hello says roomExpired', async () => {
    const { roomId } = await mk('secret-pass');
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      expect(await state.storage.get('state')).toBeTruthy();
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    advance(TWO_H + 1000);
    await runDurableObjectAlarm(stubFor(roomId));
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      expect((await state.storage.list()).size).toBe(0);
    });
    const c = await jn(roomId, 1, { password: 'secret-pass' });
    await c.nextError('roomExpired');
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      expect((await state.storage.list()).size).toBe(0);
    });
  });
});

describe('password protection', () => {
  // Each auth attempt uses a fresh socket: the server closes with 4004 after authRequired/authFailed.
  async function attempt(roomId, n, extra, ip) {
    const c = await jn(roomId, n, extra, ip ? { 'CF-Connecting-IP': ip } : undefined);
    return c;
  }
  async function lastMembers(c, pred) {
    await c.waitFor(() => c.queue.filter((x) => x.type === 'members').some(pred), 'members');
    return c.queue.filter((x) => x.type === 'members').filter(pred).pop();
  }

  it('never stores the password or token in plain text', async () => {
    const { roomId, sessionToken } = await mk('hunter2-secret');
    const host = await jn(roomId, 1, { sessionToken });
    await host.next('welcome');
    host.send({ type: 'setPassword', password: 'another-secret' });
    await lastMembers(host, (m) => m.protected === true);
    await runInDurableObject(stubFor(roomId), async (inst, state) => {
      const all = JSON.stringify(Array.from((await state.storage.list()).entries()));
      expect(all).not.toContain('hunter2-secret');
      expect(all).not.toContain('another-secret');
      expect(all).not.toContain(sessionToken);
      const st = await state.storage.get('state');
      expect(st.password.iterations).toBeGreaterThan(0);
      expect(st.password.salt.length).toBeGreaterThan(10);
    });
  });

  it('runs the protected flow: host token, authRequired/authFailed (4004), join, token reuse', async () => {
    const { roomId, sessionToken } = await mk('hunter2-secret');
    const host = await jn(roomId, 1, { sessionToken });
    const hw = await host.next('welcome');
    expect(hw.hostClientId).toBe(cid(1));
    expect(hw.protected).toBe(true);
    expect(hw.sessionToken).toBeUndefined();

    const ip = '198.51.100.9';
    const b = await attempt(roomId, 2, {}, ip);
    await b.next('authRequired');
    expect((await b.waitClosed()).code).toBe(4004);
    const b1 = await attempt(roomId, 2, { password: 'nope-nope' }, ip);
    await b1.next('authFailed');
    expect((await b1.waitClosed()).code).toBe(4004);
    const b2 = await attempt(roomId, 2, { password: 'hunter2-secret' }, ip);
    const bw = await b2.next('welcome');
    expect(bw.sessionToken).toBeTruthy();
    expect(bw.hostClientId).toBe(cid(1));
    expect((await lastMembers(host, (m) => m.members.length === 2)).protected).toBe(true);

    b2.close();
    const b3 = await attempt(roomId, 2, { sessionToken: bw.sessionToken }, ip);
    expect((await b3.next('welcome')).you).toBe(cid(2));
    // token is bound to its client
    const thief = await attempt(roomId, 3, { sessionToken: bw.sessionToken });
    await thief.next('authRequired');
    const thief2 = await attempt(roomId, 4, { sessionToken });
    await thief2.next('authRequired');
  });

  it('locks an IP out for 10 minutes after 5 wrong attempts, even for the right password', async () => {
    const { roomId } = await mk('hunter2-secret');
    const ip = '198.51.100.20';
    for (let i = 1; i <= 4; i++) {
      const c = await attempt(roomId, 5, { password: 'bad-' + i }, ip);
      expect((await c.next('authFailed')).retryAfterSec).toBeUndefined();
    }
    const fifth = await attempt(roomId, 5, { password: 'bad-5' }, ip);
    expect((await fifth.next('authFailed')).retryAfterSec).toBe(600);
    const locked = await attempt(roomId, 5, { password: 'hunter2-secret' }, ip);
    expect((await locked.next('authFailed')).retryAfterSec).toBeGreaterThan(590);
    const other = await attempt(roomId, 6, { password: 'hunter2-secret' });
    await other.next('welcome');
    advance(601000);
    const again = await attempt(roomId, 5, { password: 'hunter2-secret' }, ip);
    await again.next('welcome');
  });

  it('refuses password attempts for the whole room after 50 wrong attempts in an hour', async () => {
    const { roomId } = await mk('hunter2-secret');
    for (let i = 0; i < 50; i++) {
      const c = await attempt(roomId, 100 + i, { password: 'wrong-' + i }, '192.0.2.' + (i + 1));
      await c.next('authFailed');
    }
    const ok = await attempt(roomId, 200, { password: 'hunter2-secret' }, '192.0.2.200');
    expect((await ok.next('authFailed')).retryAfterSec).toBeGreaterThan(0);
    advance(3600 * 1000 + 1000);
    const ok2 = await attempt(roomId, 200, { password: 'hunter2-secret' }, '192.0.2.200');
    await ok2.next('welcome');
  });

  it('revokes member tokens and the old password when the host changes the password', async () => {
    const { roomId, sessionToken } = await mk('old-password');
    const host = await jn(roomId, 1, { sessionToken });
    await host.next('welcome');
    const b = await attempt(roomId, 2, { password: 'old-password' });
    const memberToken = (await b.next('welcome')).sessionToken;
    b.close();

    host.send({ type: 'setPassword', password: 'new-password' });
    await lastMembers(host, (m) => m.protected === true && m.members.length >= 1);

    const b2 = await attempt(roomId, 2, { sessionToken: memberToken });
    await b2.next('authRequired');
    const b3 = await attempt(roomId, 2, { password: 'old-password' });
    await b3.next('authFailed');
    const b4 = await attempt(roomId, 2, { password: 'new-password' });
    expect((await b4.next('welcome')).sessionToken).toBeTruthy();

    host.close();
    const h2 = await jn(roomId, 1, { sessionToken });
    expect((await h2.next('welcome')).hostClientId).toBe(cid(1));
  });

  it('removes the password with setPassword null and broadcasts protected:false', async () => {
    const { roomId, sessionToken } = await mk('old-password');
    const host = await jn(roomId, 1, { sessionToken });
    await host.next('welcome');
    host.send({ type: 'setPassword', password: null });
    await lastMembers(host, (m) => m.protected === false);
    const b = await jn(roomId, 2);
    expect((await b.next('welcome')).protected).toBe(false);
    host.send({ type: 'setPassword', password: 'abc' });
    await host.nextError('badMessage');
  });

  it('protects an open room when the host sets a password: tokens for current members, members.protected for all', async () => {
    const { roomId } = await mk();
    const host = await jn(roomId, 1);
    const hw = await host.next('welcome');
    const b = await jn(roomId, 2);
    const bw0 = await b.next('welcome');
    expect(bw0.protected).toBe(false);
    host.send({ type: 'setPassword', password: 'fresh-pass' });
    const bw = await b.next('welcome');
    expect(hw.sessionToken).toBeTruthy();
    expect(bw.sessionToken).toBeTruthy();
    expect(bw.protected).toBe(true);
    expect((await lastMembers(b, (m) => m.protected === true)).protected).toBe(true);
    const c = await attempt(roomId, 3, {});
    await c.next('authRequired');
    expect((await c.waitClosed()).code).toBe(4004);
    host.close();
    const h2 = await jn(roomId, 1, { sessionToken: hw.sessionToken });
    expect((await h2.next('welcome')).hostClientId).toBe(cid(1));
  });
});

describe('room info for the join screen', () => {
  async function getInfo(roomId, method) {
    const res = await exports.default.fetch('http://localhost:8787/api/rooms/' + encodeURIComponent(roomId), {
      method: method || 'GET', headers: { 'CF-Connecting-IP': freshIp() }
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  it('describes a room nobody has entered without writing anything', async () => {
    const { roomId } = await mk();
    const r = await getInfo(roomId);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ mode: '52/17', status: 'waiting', protected: false });
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      expect((await state.storage.list()).size).toBe(0);
    });
  });

  it('follows the session: protocol, running, paused, done', async () => {
    const { roomId } = await mk();
    const host = await jn(roomId, 1);
    await host.next('welcome');
    host.send({ type: 'setMode', mode: '112/26' });
    await host.next('timer');
    expect((await getInfo(roomId)).json).toEqual({ mode: '112/26', status: 'waiting', protected: false });
    host.send({ type: 'start' });
    await host.next('timer');
    expect((await getInfo(roomId)).json.status).toBe('running');
    host.send({ type: 'pause' });
    await host.next('timer');
    expect((await getInfo(roomId)).json.status).toBe('paused');
    host.send({ type: 'resume' });
    await host.next('timer');
    advance(SessionModel.totalMs('112/26') + 1000);
    expect((await getInfo(roomId)).json.status).toBe('done');
  });

  it('says whether a password is needed, without needing one to ask', async () => {
    const { roomId } = await mk('secret-pass');
    const r = await getInfo(roomId);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ mode: '52/17', status: 'waiting', protected: true });
  });

  it('answers 404 for ids that were never issued and 405 for other methods', async () => {
    const { roomId } = await mk();
    const parts = roomId.split('.');
    for (const id of ['garbage', parts[0] + '.' + parts[1] + '.' + 'A'.repeat(16)]) {
      expect((await getInfo(id)).status).toBe(404);
    }
    expect((await getInfo(roomId, 'POST')).status).toBe(405);
    const res = await exports.default.fetch('http://localhost:8787/api/rooms/%E0%A4%A', { headers: { 'CF-Connecting-IP': freshIp() } });
    expect(res.status).toBe(404);
  });

  it('answers 410 once the room has expired', async () => {
    const { roomId } = await mk();
    advance(2 * 3600 * 1000 + 1000);
    const r = await getInfo(roomId);
    expect(r.status).toBe(410);
    expect(r.json).toEqual({ error: 'expired' });
  });
});

describe('renaming', () => {
  async function renamed(client, name) {
    return client.waitFor(() => client.queue.find((m) => m.type === 'members' && m.members.some((x) => x.name === name)), 'roster with ' + name);
  }

  it('lets any member rename themselves and tells everyone', async () => {
    const { roomId } = await mk();
    const host = await jn(roomId, 1);
    await host.next('welcome');
    const guest = await jn(roomId, 2);
    await guest.next('welcome');
    guest.send({ type: 'setName', name: '  Alex  ' });
    const seen = await renamed(host, 'Alex');
    expect(seen.members.map((m) => m.name)).toEqual(['User1', 'Alex']);
    expect(host.noMessage('error')).toBe(true);
    host.send({ type: 'setName', name: 'Boss' });
    await renamed(guest, 'Boss');
  });

  it('keeps the new name across a reconnect of the roster', async () => {
    const { roomId } = await mk();
    const host = await jn(roomId, 1);
    await host.next('welcome');
    host.send({ type: 'setName', name: 'Renamed' });
    await renamed(host, 'Renamed');
    await runInDurableObject(stubFor(roomId), async (_i, state) => {
      const st = await state.storage.get('state');
      expect(st.members[cid(1)].name).toBe('Renamed');
    });
  });

  it('rejects empty, oversize and control-character names', async () => {
    const { roomId } = await mk();
    const host = await jn(roomId, 1);
    await host.next('welcome');
    // four violations: the fifth would disconnect the socket
    for (const name of ['   ', 'x'.repeat(25), 'bad\u0007name', 42]) {
      host.send({ type: 'setName', name });
      await host.nextError('badMessage');
    }
    host.send({ type: 'ping', t: 1 });
    await host.next('pong');
  });
});
