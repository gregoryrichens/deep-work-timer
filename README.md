# Deep Work Timer

A focused, single-page productivity timer built around two ultradian work/rest protocols. The interface is intentionally self-contained: no framework, build step, or server is required.

## Features

- 52/17 and 112/26 focus/rest protocols
- Optional movement reminders during focus sessions
- Accurate wall-clock timing when the tab is in the background
- Pause, reset, replay, and scrub controls
- Seven color themes controlled by an interactive dial
- Audio cues for transitions and movement reminders
- Keyboard-accessible theme and timer controls

## Run locally

The modular application is served from [index.html](index.html). Run it with any static file server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploying and standalone use

Deploy the repository root on any static host. The root `index.html` loads its assets using relative paths, so no build step or special routing is required.

For a portable, single-file version, use [dist/deep-work-timer.html](dist/deep-work-timer.html). It embeds its styles and JavaScript, so it can be downloaded and opened directly in a modern browser. The standalone artifact is intentionally kept separate from the modular source: make feature changes in the source files first, then regenerate the artifact before release.

## Project structure

```text
deep-work-timer/
├── index.html                     # Modular application entry point
├── css/
│   └── styles.css                 # Application styles
├── assets/                         # Background images for the modular app
├── js/
│   ├── app.js                     # Rendering and event binding
│   ├── audio.js                   # Web Audio notifications
│   ├── dial.js                    # Theme dial interactions
│   └── timer.js                   # Timer state and lifecycle
├── dist/
│   └── deep-work-timer.html       # Optional standalone artifact
└── README.md                      # Project overview and local-run instructions
```

## Implementation notes

The timer derives elapsed time from the system clock rather than counting animation frames. This keeps sessions accurate when browsers throttle rendering in inactive tabs. The app is deliberately framework-free to keep the project portable and easy to inspect. JavaScript files are loaded in dependency order with `defer`, which preserves the app's existing browser support without requiring a bundler.

The modular app stores background images in `assets/` so its HTML remains easy to navigate. The standalone artifact keeps those same images embedded as Base64 data URLs. This intentionally increases the artifact's file size, but ensures it can be shared or opened without an accompanying assets directory or external image requests.

## Accessibility

Interactive controls have keyboard support and visible focus states. The theme dial can be changed with the left and right arrow keys.
