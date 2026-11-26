// Worker entry: room creation, WebSocket upgrade gate, static assets for everything else.
import { DurableObject } from 'cloudflare:workers';
import { createRoomId, verifyRoomId, hashPassword, parseIterations, generateToken, hashToken } from './crypto.js';
import { isOriginAllowed } from './origins.js';
export { Room } from './room.js';

const HOUR_MS = 3600 * 1000;
const CREATE_PER_HOUR = 5;
const FUTURE_SKEW_SEC = 300;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

function originAllowed(request, env) {
  return isOriginAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS);
}

// Hourly per-IP creation counter. The rate-limit binding only supports 10s/60s periods,
// so the 5-per-hour rule is enforced here. IPs are hashed before they name the object.
export class CreateLimiter extends DurableObject {
  async hit(limit, windowMs) {
    const now = Date.now();
    let hits = (await this.ctx.storage.get('hits')) || [];
    hits = hits.filter((t) => now - t < windowMs);
    if (hits.length >= limit) return false;
    hits.push(now);
    await this.ctx.storage.put('hits', hits);
    await this.ctx.storage.setAlarm(hits[0] + windowMs);
    return true;
  }
  async alarm() {
    const now = Date.now();
    const hits = ((await this.ctx.storage.get('hits')) || []).filter((t) => now - t < HOUR_MS);
    if (hits.length) {
      await this.ctx.storage.put('hits', hits);
      await this.ctx.storage.setAlarm(hits[0] + HOUR_MS);
    } else {
      await this.ctx.storage.deleteAll();
    }
  }
}

async function ipKey(ip) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(d).slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function createRoom(request, env) {
  if (!originAllowed(request, env)) return json(403, { error: 'forbidden' });

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const burst = await env.ROOM_CREATE_LIMITER.limit({ key: ip });
  if (!burst.success) return json(429, { error: 'rateLimited' });
  const hourly = env.CREATE_LIMITS.get(env.CREATE_LIMITS.idFromName(await ipKey(ip)));
  if (!(await hourly.hit(CREATE_PER_HOUR, HOUR_MS))) return json(429, { error: 'rateLimited' });

  let body = {};
  const text = await request.text();
  if (text.length > 1024) return json(400, { error: 'badRequest' });
  if (text.trim() !== '') {
    try { body = JSON.parse(text); } catch (e) { return json(400, { error: 'badRequest' }); }
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'badRequest' });
  const password = body.password;
  if (password !== undefined && password !== null) {
    if (typeof password !== 'string' || password.length < 4 || password.length > 64) {
      return json(400, { error: 'badPassword' });
    }
  }
  if (!env.ROOM_SECRET) return json(500, { error: 'serverError' });

  const { roomId, random, createdAtSec } = await createRoomId(env.ROOM_SECRET, Date.now());
  if (typeof password !== 'string') return json(201, { roomId });

  const sessionToken = generateToken();
  const stub = env.ROOMS.get(env.ROOMS.idFromName(random));
  await stub.init({
    createdAt: createdAtSec * 1000,
    passwordHash: await hashPassword(password, parseIterations(env.PBKDF2_ITERATIONS)),
    hostTokenHash: await hashToken(sessionToken)
  });
  return json(201, { roomId, sessionToken });
}

// Read-only summary for the join screen: protocol, session status and whether a password is needed.
// Needs a valid signed room id, so it reveals nothing about rooms that were never issued.
async function roomInfo(env, roomId) {
  const parsed = await verifyRoomId(env.ROOM_SECRET, roomId);
  if (!parsed || parsed.createdAtSec > Date.now() / 1000 + FUTURE_SKEW_SEC) return json(404, { error: 'notFound' });
  const stub = env.ROOMS.get(env.ROOMS.idFromName(parsed.random));
  const info = await stub.info(parsed.createdAtSec * 1000);
  return info ? json(200, info) : json(410, { error: 'expired' });
}

async function roomSocket(request, env, roomId) {
  if (request.method !== 'GET' || (request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  if (!originAllowed(request, env)) return new Response('Forbidden', { status: 403 });
  const parsed = await verifyRoomId(env.ROOM_SECRET, roomId);
  if (!parsed || parsed.createdAtSec > Date.now() / 1000 + FUTURE_SKEW_SEC) {
    return new Response('Not found', { status: 404 });
  }
  const headers = new Headers(request.headers);
  headers.set('X-Room-Created', String(parsed.createdAtSec * 1000));
  headers.set('X-Client-IP', request.headers.get('CF-Connecting-IP') || 'unknown');
  const stub = env.ROOMS.get(env.ROOMS.idFromName(parsed.random));
  return stub.fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/rooms') {
      if (request.method !== 'POST') return json(405, { error: 'methodNotAllowed' });
      return createRoom(request, env);
    }
    if (url.pathname.startsWith('/api/rooms/')) {
      if (request.method !== 'GET') return json(405, { error: 'methodNotAllowed' });
      let roomId;
      try { roomId = decodeURIComponent(url.pathname.slice('/api/rooms/'.length)); } catch (e) { return json(404, { error: 'notFound' }); }
      return roomInfo(env, roomId);
    }
    if (url.pathname.startsWith('/rooms/')) {
      return roomSocket(request, env, url.pathname.slice('/rooms/'.length));
    }
    return env.ASSETS.fetch(request);
  }
};
