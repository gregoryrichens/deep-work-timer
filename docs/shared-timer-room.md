# Spec: Shared Timer Room

Status: Draft · 2026-11-11

## Goal

Let a group of people run the same Deep Work session together from a shared link, see who else is locked in, and stay in sync without anyone managing their own timer.

## Non-goals (for now)

- **Chat.** Deliberately excluded: it adds security/moderation overhead and works against the point of a deep work timer.
- **Shared playlists.** A separate feature, specced later.
- **Accounts / login.** Identity is a display name per browser.
- **The standalone `dist/deep-work-timer.html`.** Stays solo-only, because rooms need the server.

## Decisions

| Topic | Decision |
|---|---|
| Timer control | Host only (start, pause, resume, scrub, reset, protocol choice) |
| Identity | Display name typed on join, remembered in `localStorage` |
| Late joiners | Land on the live countdown in progress |
| Presence | Locked in / Away / On break, plus join/leave toasts |
| Backend | Cloudflare Durable Objects (one object per room) via PartyServer |
| Solo mode | Unchanged: rooms are opt-in |

## User flows

**Create a room**
1. Config screen gets a second button: `START A ROOM` (next to `LET'S BUILD!`).
2. Client generates a random room ID (10 chars, base32) and navigates to `/?room=<id>`.
3. Name prompt → join. The first person to join an empty room becomes host.
4. Host sees an invite bar: room code + `COPY LINK`.

**Join a room**
1. Open `/?room=<id>` → name prompt (prefilled from `localStorage`) → `JOIN`.
2. Lands on the timer screen at the current point of the session.

**During a session**
- Everyone sees the same phase, countdown and progress bar.
- Host sees the normal controls. Others see `// HOST CONTROLS THE TIMER` instead, and the progress bar is not draggable for them.
- Exercise snacks, audio and the theme dial stay **per person** (snacks are computed from the shared elapsed time but toggled locally).
- A roster panel shows each member and their status.

## Session model (the refactor)

Today the work → alarm → rest → alarm → done sequence is driven by `setTimeout` chains in each browser (`completeCurrentPhase` in `js/timer.js`). In a room that would drift between clients, so the whole session becomes a **pure function of elapsed time**:

```
schedule(mode) = [work W] [alarm 10s] [rest R] [alarm 10s] [done]

sessionElapsedMs = paused ? offsetMs : offsetMs + (now - anchorAt)
view = sessionView(mode, sessionElapsedMs)
     → { phase, phaseElapsedSec, phaseTotalSec }
```

Controls only change the anchors:

| Action | Effect |
|---|---|
| start / resume | `anchorAt = now; paused = false` |
| pause | `offsetMs = currentElapsed; paused = true` (not allowed during alarm) |
| scrub | `offsetMs = phaseStartMs + scrubbedMs` (and `anchorAt = now` if running) |
| reset | `offsetMs = 0; paused = true` |

Solo mode uses the same model with a local clock, so there is one code path. This step must not change any visible solo behaviour.

**Audio rule:** the chime plays only when a client *sees* a phase transition happen live, not when it joins mid-alarm or reconnects.

## Room server (Durable Object)

One Durable Object instance per room ID, with state stored in its built-in SQLite storage so it survives restarts:

```
{
  mode: '52/17' | '112/26',
  anchorAt: number | null,   // server ms
  offsetMs: number,
  paused: boolean,
  hostClientId: string,
  members: { [clientId]: { name, joinedAt, visible, awaySince, connected } }
}
```

- `clientId`: random ID generated once per browser and kept in `localStorage`, so a host who refreshes stays host.
- **Host-only enforcement happens on the server:** control messages from anyone else are rejected.
- **Host handoff:** if the host disconnects, wait 30s (covers refreshes) using a Durable Object alarm, then promote the longest-present connected member.
- **Room cleanup:** when the last member leaves, schedule deletion of the room's storage after 24h.
- **Limits:** 20 members per room; names 1–24 chars after trimming; about 5 messages/sec per connection.
- Uses WebSocket hibernation so idle rooms cost nothing.

### Protocol (JSON over WebSocket)

Client → server:

| Type | Payload | Who |
|---|---|---|
| `hello` | `{ clientId, name }` | anyone, first message |
| `start` / `pause` / `resume` / `reset` | — | host |
| `scrub` | `{ elapsedMs }` | host |
| `setMode` | `{ mode }` | host, only before start |
| `visibility` | `{ visible }` | anyone |
| `ping` | `{ t }` | anyone |

Server → client:

| Type | Payload |
|---|---|
| `welcome` | `{ you, hostClientId, timer, members, serverNow }` |
| `timer` | `{ mode, anchorAt, offsetMs, paused }` |
| `members` | `[{ clientId, name, status, awaySince }]` |
| `host` | `{ hostClientId }` |
| `pong` | `{ t, serverNow }` |
| `error` | `{ code, message }` |

### Clock sync

On join (and every 5 minutes after), the client sends `ping`. It estimates `offset = serverNow - (sent + received) / 2` and keeps the lowest-latency sample. All timer maths uses `Date.now() + offset`.

## Presence

| Status | Rule |
|---|---|
| **LOCKED IN** | Connected, focus phase, tab visible (or hidden < 2 min) |
| **AWAY (Nm)** | Tab hidden ≥ 2 min, or disconnected. Minutes are computed locally from `awaySince` |
| **ON BREAK** | Rest phase |
| **READY** | Session not started yet |

Members who stay disconnected for more than 5 minutes are dropped from the roster. Join/leave events show as a short toast (`// SAM JOINED`).

## Security notes

- **Escaping:** `render()` builds HTML strings into `innerHTML`, so **display names must be HTML-escaped** before rendering (add an `escapeHtml` helper). This is the only user-supplied text in the feature.
- **Validation:** the server validates every message's shape and drops anything malformed.
- **Room access:** room IDs are unguessable but not secret. Anyone with the link can join, which is acceptable for v1.

## Code structure

```
deep-work-timer/
├── js/
│   ├── session.js   # NEW: pure session model (schedule, sessionView)
│   ├── room.js      # NEW: WebSocket client, clock sync, reconnect with backoff
│   ├── timer.js     # refactored onto session.js
│   └── app.js       # room UI: join prompt, invite bar, roster, host-only controls
├── server/          # NEW: Worker + Durable Object (PartyServer), wrangler.jsonc
└── tests/           # session.js unit tests (node --test); DO tests (vitest-pool-workers)
```

The front end stays framework-free with no build step. It uses the browser's native `WebSocket` plus a small reconnect helper rather than adding a client library.

## Deployment

**Open question: is the site on Cloudflare Pages or Workers?**

- **Option A (recommended): one Worker with static assets + the Durable Object.** One project and one deploy. The WebSocket is same-origin (`/rooms/<id>`). Cloudflare now steers new projects to Workers over Pages.
- **Option B: keep Pages as it is and add a separate Worker** (e.g. `deep-work-rooms`) for the Durable Object. The client connects to that Worker's URL. Less change to the current deploy, but two projects and a cross-origin WebSocket.

Either works on the free plan at this scale.

## Milestones

| # | Milestone | Estimate |
|---|---|---|
| 1 | `session.js` refactor; solo mode on the new model, no visible change; unit tests | 1–2 days |
| 2 | Worker + Durable Object skeleton deployed; room state sync; host-only controls | 2 days |
| 3 | Join flow, display names, invite link, roster + statuses, toasts | 1–2 days |
| 4 | Host handoff, reconnection, clock sync, room cleanup, edge-case tests | 1–2 days |

## Acceptance checks

- Two browsers in one room show the same countdown to within 1 second, including after one tab sits in the background for 10+ minutes.
- A non-host cannot pause/scrub, even by sending raw WebSocket messages.
- When the host refreshes, they are still host. When the host closes the tab, another member becomes host within about 30 seconds.
- A late joiner during rest lands in rest at the right time and does not hear a chime.
- A display name like `<img src=x onerror=alert(1)>` renders as literal text.
- Solo mode behaves exactly as before.
