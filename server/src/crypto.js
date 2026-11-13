// Crypto helpers: encoding, signed room IDs, PBKDF2 password hashing, session tokens.
const enc = new TextEncoder();
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export const ID_RE = /^([a-z2-7]{10})\.([0-9a-z]{1,9})\.([A-Za-z0-9_-]{16})$/;

export function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// n chars of base32 (5 bits each; 256 % 32 == 0 so the byte-mod is unbiased).
export function randomBase32(n) {
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += B32[b[i] % 32];
  return s;
}

export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

async function sign(secret, random, createdAt) {
  return b64urlEncode(await hmac(secret, random + '.' + createdAt)).slice(0, 16);
}

// Room ID: <random10 base32>.<createdAt base36 seconds>.<sig16 base64url>
export async function createRoomId(secret, nowMs) {
  const random = randomBase32(10);
  const createdAt = Math.floor(nowMs / 1000).toString(36);
  return { roomId: random + '.' + createdAt + '.' + (await sign(secret, random, createdAt)), random, createdAtSec: Math.floor(nowMs / 1000) };
}

// Returns { random, createdAtSec } or null. Constant-time signature compare.
export async function verifyRoomId(secret, id) {
  if (typeof id !== 'string' || id.length > 40) return null;
  const m = ID_RE.exec(id);
  if (!m || !secret) return null;
  const expected = enc.encode(await sign(secret, m[1], m[2]));
  if (!safeEqual(expected, enc.encode(m[3]))) return null;
  return { random: m[1], createdAtSec: parseInt(m[2], 36) };
}

// PBKDF2-SHA256. Iterations are stored with the hash so they can change later.
async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password, iterations) {
  const salt = randomBytes(16);
  return { hash: b64urlEncode(await derive(password, salt, iterations)), salt: b64urlEncode(salt), iterations };
}

export async function verifyPassword(password, rec) {
  const got = await derive(password, b64urlDecode(rec.salt), rec.iterations);
  return safeEqual(got, b64urlDecode(rec.hash));
}

export function parseIterations(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 25000;
  return Math.max(1000, Math.min(100000, n));
}

export function generateToken() {
  return b64urlEncode(randomBytes(32));
}

export async function hashToken(token) {
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(token))));
}
