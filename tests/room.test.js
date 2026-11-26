'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../public/js/room.js');

test('escapeHtml neutralises markup and quotes', () => {
  assert.strictEqual(H.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.strictEqual(H.escapeHtml('"a" & \'b\' `c`'), '&quot;a&quot; &amp; &#39;b&#39; &#96;c&#96;');
  assert.ok(!/[<>"']/.test(H.escapeHtml('<script>"x"</script>\'')));
  assert.strictEqual(H.escapeHtml(null), '');
  assert.strictEqual(H.escapeHtml(undefined), '');
  assert.strictEqual(H.escapeHtml(42), '42');
});

test('estimateOffset uses the round-trip midpoint', () => {
  // client sent at 1000, got reply at 1100; server clock said 5050 => server is 4000 ahead
  assert.strictEqual(H.estimateOffset(1000, 1100, 5050), 4000);
  assert.strictEqual(H.estimateOffset(1000, 1100, 1050), 0);
  assert.strictEqual(H.estimateOffset(2000, 2000, 1000), -1000);
});

test('betterSample keeps the lowest RTT', () => {
  const a = { rtt: 80, offset: 10 }, b = { rtt: 30, offset: 12 }, c = { rtt: 30, offset: 99 };
  assert.strictEqual(H.betterSample(null, a), a);
  assert.strictEqual(H.betterSample(a, b), b);
  assert.strictEqual(H.betterSample(b, a), b);
  assert.strictEqual(H.betterSample(b, c), b);          // tie keeps the earlier sample
  assert.strictEqual(H.betterSample(b, { rtt: -5, offset: 0 }), b);   // invalid sample ignored
  assert.strictEqual(H.betterSample(b, null), b);
});

test('backoffDelay doubles from 1s and caps at 30s', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 20].map(H.backoffDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.strictEqual(H.backoffDelay(-3), 1000);
});

test('away minutes and status labels', () => {
  const now = 10 * 60000;
  assert.strictEqual(H.awayMinutes(now - 5 * 60000 - 1, now), 5);
  assert.strictEqual(H.awayMinutes(now - 59999, now), 0);
  assert.strictEqual(H.awayMinutes(now + 5000, now), 0);      // clock skew never goes negative
  assert.strictEqual(H.awayMinutes(null, now), null);
  assert.strictEqual(H.formatAway(now - 3 * 60000, now), 'AWAY (3m)');
  assert.strictEqual(H.formatAway(null, now), 'AWAY');
  assert.strictEqual(H.statusLabel({ status: 'lockedIn' }, now), 'LOCKED IN');
  assert.strictEqual(H.statusLabel({ status: 'away', awaySince: now - 120000 }, now), 'AWAY (2m)');
  assert.strictEqual(H.statusLabel({ status: 'onBreak' }, now), 'ON BREAK');
  assert.strictEqual(H.statusLabel({ status: 'ready' }, now), 'READY');
  assert.strictEqual(H.statusLabel({ status: '<b>' }, now), 'UNKNOWN');
  assert.strictEqual(H.statusClass('<b>'), 'st-unknown');
});

test('roomsEnabled: flag off hides rooms everywhere', () => {
  assert.strictEqual(H.roomsEnabled(false, 'https:'), false);
  assert.strictEqual(H.roomsEnabled(false, 'http:'), false);
  assert.strictEqual(H.roomsEnabled(undefined, 'https:'), false);
  assert.strictEqual(H.roomsEnabled('true', 'https:'), false);
  assert.strictEqual(H.roomsEnabled(1, 'https:'), false);
});

test('roomsEnabled: flag on needs http(s)', () => {
  assert.strictEqual(H.roomsEnabled(true, 'https:'), true);
  assert.strictEqual(H.roomsEnabled(true, 'http:'), true);
  assert.strictEqual(H.roomsEnabled(true, 'file:'), false);
});

test('public/js/config.js defines ROOMS_ENABLED as a boolean', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/js/config.js'), 'utf8');
  const ctx = {};
  require('node:vm').runInNewContext(src, ctx);
  assert.strictEqual(typeof ctx.ROOMS_ENABLED, 'boolean');
});

test('parseRoomId', () => {
  const id = 'ABCDEFGHIJ.lq3x9z.AbCdEf_-0123456789';
  assert.strictEqual(H.parseRoomId('?room=' + encodeURIComponent(id)), id);
  assert.strictEqual(H.parseRoomId('?a=1&room=' + id + '&b=2'), id);
  assert.strictEqual(H.parseRoomId(''), null);
  assert.strictEqual(H.parseRoomId('?other=1'), null);
  assert.strictEqual(H.parseRoomId('?room='), null);
  assert.strictEqual(H.parseRoomId('?room=%3Cscript%3E'), null);
  assert.strictEqual(H.parseRoomId('?room=%E0%A4%A'), null);              // malformed escape
  assert.strictEqual(H.parseRoomId('?room=' + 'a'.repeat(201)), null);
});

test('shortRoomCode, wsUrl, shouldReconnect', () => {
  assert.strictEqual(H.shortRoomCode('ABCDEFGHIJ.lq3x9z.sig'), 'ABCDEF');
  assert.strictEqual(H.shortRoomCode('ABC.x.y'), 'ABC');
  assert.strictEqual(H.shortRoomCode(null), '');
  assert.strictEqual(H.wsUrl({ protocol: 'https:', host: 'x.dev' }, 'a.b.c'), 'wss://x.dev/rooms/a.b.c');
  assert.strictEqual(H.wsUrl({ protocol: 'http:', host: 'localhost:8787' }, 'a b'), 'ws://localhost:8787/rooms/a%20b');
  [4001, 4002, 4003, 4004].forEach(c => assert.strictEqual(H.shouldReconnect(c), false));
  [1000, 1006, 4000, 4005].forEach(c => assert.strictEqual(H.shouldReconnect(c), true));
});

test('validName and validPassword', () => {
  assert.strictEqual(H.validName('  Sam  '), 'Sam');
  assert.strictEqual(H.validName('   '), null);
  assert.strictEqual(H.validName(''), null);
  assert.strictEqual(H.validName('x'.repeat(24)), 'x'.repeat(24));
  assert.strictEqual(H.validName('x'.repeat(25)), null);
  assert.strictEqual(H.validPassword('abc'), false);
  assert.strictEqual(H.validPassword('abcd'), true);
  assert.strictEqual(H.validPassword('x'.repeat(64)), true);
  assert.strictEqual(H.validPassword('x'.repeat(65)), false);
});

test('leavesTimerScreen covers terminal and auth statuses only', () => {
  ['expired', 'full', 'closed', 'failed', 'authRequired', 'authFailed'].forEach(s => assert.strictEqual(H.leavesTimerScreen(s), true, s));
  ['idle', 'connecting', 'live', 'reconnecting', undefined, null].forEach(s => assert.strictEqual(H.leavesTimerScreen(s), false, String(s)));
});

test('clientIdFromBytes yields a server-valid id', () => {
  const bytes = Array.from({ length: 16 }, (_, i) => i * 17);
  const id = H.clientIdFromBytes(bytes);
  assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(id));
  assert.ok(H.isValidClientId(id));
  assert.ok(!H.isValidClientId('short'));
});

test('parseRoomInput accepts a link, a query string or a bare id', () => {
  const id = 'abc123.tozyd1.NhhnVC2FVoYhXiOa';
  assert.strictEqual(H.parseRoomInput('https://example.com/?room=' + id), id);
  assert.strictEqual(H.parseRoomInput('  http://localhost:8787/?room=' + id + '#x  '), id);
  assert.strictEqual(H.parseRoomInput('?room=' + id), id);
  assert.strictEqual(H.parseRoomInput(id), id);
  assert.strictEqual(H.parseRoomInput('https://example.com/no-room'), null);
  assert.strictEqual(H.parseRoomInput('not a room id'), null);
  assert.strictEqual(H.parseRoomInput(''), null);
  assert.strictEqual(H.parseRoomInput(null), null);
});

test('joinStatusLabel names the live session state', () => {
  assert.strictEqual(H.joinStatusLabel('waiting'), 'WAITING FOR HOST');
  assert.strictEqual(H.joinStatusLabel('running'), 'IN PROGRESS');
  assert.strictEqual(H.joinStatusLabel('paused'), 'PAUSED');
  assert.strictEqual(H.joinStatusLabel('done'), 'COMPLETE');
  assert.strictEqual(H.joinStatusLabel('nonsense'), '');
});

test('validateRoomForm: name, and a password only when access needs one', () => {
  const ok = { name: 'Sam', access: 'link', pass: '' };
  assert.strictEqual(H.validateRoomForm(ok, false), null);
  assert.ok(H.validateRoomForm({ name: '  ', access: 'link', pass: '' }, false).indexOf('DISPLAY NAME') !== -1);
  assert.ok(H.validateRoomForm({ name: 'x'.repeat(25), access: 'link', pass: '' }, false).indexOf('DISPLAY NAME') !== -1);
  // a password typed while access is "link" is ignored
  assert.strictEqual(H.validateRoomForm({ name: 'Sam', access: 'link', pass: 'a' }, false), null);
  assert.ok(H.validateRoomForm({ name: 'Sam', access: 'password', pass: '' }, false).indexOf('PASSWORD') !== -1);
  assert.ok(H.validateRoomForm({ name: 'Sam', access: 'password', pass: 'abc' }, false).indexOf('PASSWORD') !== -1);
  assert.strictEqual(H.validateRoomForm({ name: 'Sam', access: 'password', pass: 'abcd' }, false), null);
  // an already protected room keeps its password when the field is blank, but a typed one must be valid
  assert.strictEqual(H.validateRoomForm({ name: 'Sam', access: 'password', pass: '' }, true), null);
  assert.ok(H.validateRoomForm({ name: 'Sam', access: 'password', pass: 'abc' }, true).indexOf('PASSWORD') !== -1);
});

test('planRoomEdit only sends what changed, on the same room', () => {
  const room = { mode: '52/17', protected: false, name: 'Sam' };
  const same = { mode: '52/17', name: 'Sam', access: 'link', pass: '' };
  assert.deepStrictEqual(H.planRoomEdit(room, same), []);
  assert.deepStrictEqual(H.planRoomEdit(room, Object.assign({}, same, { mode: '112/26' })), [{ type: 'setMode', payload: { mode: '112/26' } }]);
  assert.deepStrictEqual(H.planRoomEdit(room, Object.assign({}, same, { name: '  Alex ' })), [{ type: 'setName', payload: { name: 'Alex' } }]);
  assert.deepStrictEqual(H.planRoomEdit(room, Object.assign({}, same, { access: 'password', pass: 'secret12' })),
    [{ type: 'setPassword', payload: { password: 'secret12' } }]);
  const locked = { mode: '52/17', protected: true, name: 'Sam' };
  assert.deepStrictEqual(H.planRoomEdit(locked, Object.assign({}, same, { access: 'password', pass: '' })), []);
  assert.deepStrictEqual(H.planRoomEdit(locked, same), [{ type: 'setPassword', payload: { password: null } }]);
  assert.deepStrictEqual(H.planRoomEdit(locked, Object.assign({}, same, { access: 'password', pass: 'newpass1', mode: '112/26' })),
    [{ type: 'setMode', payload: { mode: '112/26' } }, { type: 'setPassword', payload: { password: 'newpass1' } }]);
});

const PLAYLIST_ID = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
const PLAYLIST_LINK = 'https://www.youtube.com/playlist?list=' + PLAYLIST_ID;

test('validateRoomForm: a playlist is optional, but must be a YouTube playlist link when given', () => {
  const base = { name: 'Sam', access: 'link', pass: '' };
  assert.strictEqual(H.validateRoomForm(base, false), null);
  assert.strictEqual(H.validateRoomForm(Object.assign({ playlist: '' }, base), false), null);
  assert.strictEqual(H.validateRoomForm(Object.assign({ playlist: '   ' }, base), false), null);
  assert.strictEqual(H.validateRoomForm(Object.assign({ playlist: PLAYLIST_LINK }, base), false), null);
  assert.ok(H.validateRoomForm(Object.assign({ playlist: 'https://evil.example/?list=' + PLAYLIST_ID }, base), false).indexOf('YOUTUBE') !== -1);
  assert.ok(H.validateRoomForm(Object.assign({ playlist: 'javascript:alert(1)' }, base), false).indexOf('YOUTUBE') !== -1);
  assert.ok(H.validateRoomForm(Object.assign({ playlist: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, base), false).indexOf('NO PLAYLIST') !== -1);
});

test('planRoomEdit: sends setPlaylist only when the playlist changes, and null to clear it', () => {
  const room = { mode: '52/17', protected: false, name: 'Sam', playlist: null };
  const form = { mode: '52/17', name: 'Sam', access: 'link', pass: '' };
  assert.deepStrictEqual(H.planRoomEdit(room, Object.assign({ playlist: '' }, form)), []);
  assert.deepStrictEqual(H.planRoomEdit(room, form), []);
  assert.deepStrictEqual(H.planRoomEdit(room, Object.assign({ playlist: PLAYLIST_LINK }, form)),
    [{ type: 'setPlaylist', payload: { url: PLAYLIST_LINK } }]);

  const withList = Object.assign({}, room, { playlist: PLAYLIST_ID });
  assert.deepStrictEqual(H.planRoomEdit(withList, Object.assign({ playlist: PLAYLIST_LINK }, form)), []);
  assert.deepStrictEqual(H.planRoomEdit(withList, Object.assign({ playlist: 'youtu.be/dQw4w9WgXcQ?list=' + PLAYLIST_ID }, form)), []);
  assert.deepStrictEqual(H.planRoomEdit(withList, Object.assign({ playlist: '' }, form)),
    [{ type: 'setPlaylist', payload: { url: null } }]);
  assert.deepStrictEqual(H.planRoomEdit(withList, Object.assign({ playlist: 'https://www.youtube.com/playlist?list=PLanotherPlaylist123' }, form)),
    [{ type: 'setPlaylist', payload: { url: 'https://www.youtube.com/playlist?list=PLanotherPlaylist123' } }]);
});
