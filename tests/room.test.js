'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../js/room.js');

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

test('clientIdFromBytes yields a server-valid id', () => {
  const bytes = Array.from({ length: 16 }, (_, i) => i * 17);
  const id = H.clientIdFromBytes(bytes);
  assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(id));
  assert.ok(H.isValidClientId(id));
  assert.ok(!H.isValidClientId('short'));
});
