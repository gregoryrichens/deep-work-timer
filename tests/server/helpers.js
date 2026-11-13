import { env, exports } from 'cloudflare:workers';

export const ORIGIN = 'http://localhost:8787';
const BASE = 'http://localhost:8787';
let ipCounter = 0;
export function freshIp() {
  ipCounter += 1;
  return '10.0.' + ((ipCounter >> 8) & 255) + '.' + (ipCounter & 255);
}

export async function createRoom(body, headers) {
  const res = await exports.default.fetch(BASE + '/api/rooms', {
    method: 'POST',
    headers: Object.assign({ Origin: ORIGIN, 'content-type': 'application/json', 'CF-Connecting-IP': freshIp() }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { res, json: await res.json().catch(() => null) };
}

export function stubFor(roomId) {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId.split('.')[0]));
}

export class Client {
  constructor(ws) {
    this.ws = ws;
    this.queue = [];
    this.closed = null;
    ws.addEventListener('message', (e) => { this.queue.push(JSON.parse(e.data)); });
    ws.addEventListener('close', (e) => { this.closed = { code: e.code }; });
  }
  send(obj) { this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
  async waitFor(fn, what) {
    for (let i = 0; i < 600; i++) {
      const r = fn();
      if (r) return r;
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error('timeout waiting for ' + what + '; queue=' + JSON.stringify(this.queue) + ' closed=' + JSON.stringify(this.closed));
  }
  // Consume the next queued message of this type.
  next(type) {
    return this.waitFor(() => {
      const i = this.queue.findIndex((m) => m.type === type);
      return i === -1 ? null : this.queue.splice(i, 1)[0];
    }, type);
  }
  nextError(code) {
    return this.waitFor(() => {
      const i = this.queue.findIndex((m) => m.type === 'error' && m.code === code);
      return i === -1 ? null : this.queue.splice(i, 1)[0];
    }, 'error ' + code);
  }
  // Latest message of a type without consuming (waits until one exists).
  async latest(type) {
    await this.waitFor(() => this.queue.some((m) => m.type === type), type);
    return this.queue.filter((m) => m.type === type).pop();
  }
  noMessage(type) { return !this.queue.some((m) => m.type === type); }
  waitClosed() { return this.waitFor(() => this.closed, 'close'); }
  close() { try { this.ws.close(1000); } catch (e) { /* closed */ } }
}

export async function upgrade(roomId, headers) {
  return exports.default.fetch(BASE + '/rooms/' + roomId, {
    headers: Object.assign({ Upgrade: 'websocket', Origin: ORIGIN, 'CF-Connecting-IP': freshIp() }, headers || {})
  });
}

export async function connect(roomId, headers) {
  const res = await upgrade(roomId, headers);
  if (res.status !== 101) throw new Error('upgrade failed ' + res.status);
  res.webSocket.accept();
  return new Client(res.webSocket);
}

export function cid(n) { return 'client-' + n + '-abcdefgh'; }

// Connect and send hello; resolves with the client (hello response not consumed).
export async function join(roomId, n, extra, headers) {
  const c = await connect(roomId, headers);
  c.send(Object.assign({ type: 'hello', clientId: cid(n), name: 'User' + n }, extra || {}));
  return c;
}
