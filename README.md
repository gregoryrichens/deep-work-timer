# Deep Work Timer

A focused, single-page productivity timer built around two ultradian work/rest protocols. The interface is intentionally self-contained: no framework or build step is required, and the solo timer needs no server. Optional shared rooms run on a small Cloudflare Worker.

<img width="1719" height="861" alt="Screenshot 2026-10-21 at 8 47 02 PM" src="https://github.com/user-attachments/assets/841590a4-17ef-4254-9bad-62bfd1fc27c0" />

## Features

- 52/17 and 112/26 focus/rest protocols
- Optional movement reminders during focus sessions
- Accurate wall-clock timing when the tab is in the background
- Pause, reset, replay, and scrub controls
- Seven color themes controlled by an interactive dial
- Audio cues for transitions and movement reminders
- Keyboard-accessible theme and timer controls
- Optional shared timer rooms: a host creates a room and shares the link, and everyone sees the same countdown and who's locked in, with an optional room passphrase

## Run locally

The modular application is served from [index.html](index.html). Run it with any static file server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Shared rooms (local development)

Solo mode still runs with the static server above, but shared rooms need the Cloudflare Worker. From the repository root:

```bash
npm install
cp .dev.vars.example .dev.vars   # then set ROOM_SECRET to the output of: openssl rand -base64 32
npm run dev                      # http://localhost:8787
```

The room UI is behind a feature flag. Set `ROOMS_ENABLED = true` in [js/config.js](js/config.js) to show it; while it is `false`, the site is the solo timer only and `?room=` links open the solo timer.

Run the tests with `npm test` (session, room client and server tests).

## Deploying and standalone use

Deploy the repository root on any static host. The root `index.html` loads its assets using relative paths, so no build step or special routing is required.

For a portable, single-file version, use [dist/deep-work-timer.html](dist/deep-work-timer.html). It embeds its styles and JavaScript, so it can be downloaded and opened directly in a modern browser. The standalone artifact is intentionally kept separate from the modular source: make feature changes in the source files first, then regenerate the artifact before release.

The solo timer can still be deployed on any static host. Shared rooms require deploying the Worker defined in `wrangler.jsonc` instead, with a `ROOM_SECRET` secret set and `ALLOWED_ORIGINS` set to the production origin. The standalone `dist/` file is solo-only.

## Project structure

```text
deep-work-timer/
├── index.html                     # Modular application entry point
├── css/
│   └── styles.css                 # Application styles
├── assets/                         # Background images and exercise snack sprite
├── js/
│   ├── app.js                     # Rendering and event binding
│   ├── audio.js                   # Web Audio notifications
│   ├── config.js                  # Feature flags
│   ├── dial.js                    # Theme dial interactions
│   ├── room.js                    # Room client
│   ├── session.js                 # Pure session model
│   ├── snack-sprite.js            # Theme palette swap for the exercise snack sprite
│   └── timer.js                   # Timer state and lifecycle
├── server/src/                    # Cloudflare Worker + Durable Object (rooms)
├── dist/
│   └── deep-work-timer.html       # Optional standalone artifact
├── tests/                         # Session, room client and server tests
├── wrangler.jsonc                 # Worker and Durable Object configuration
├── package.json                   # Scripts and dev dependencies
└── README.md                      # Project overview and local-run instructions
```

## Implementation notes

The timer derives elapsed time from the system clock rather than counting animation frames. This keeps sessions accurate when browsers throttle rendering in inactive tabs. The app is deliberately framework-free to keep the project portable and easy to inspect. JavaScript files are loaded in dependency order with `defer`, which preserves the app's existing browser support without requiring a bundler.

The modular app stores background images in `assets/` so its HTML remains easy to navigate. The standalone artifact keeps those same images embedded as Base64 data URLs. This intentionally increases the artifact's file size, but ensures it can be shared or opened without an accompanying assets directory or external image requests.

## Accessibility

Interactive controls have keyboard support and visible focus states. The theme dial can be changed with the left and right arrow keys.

## Future Features
- Shared playlists/music
- Pet (inspired by chat gpt pet icon)
