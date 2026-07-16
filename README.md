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

Open [index.html](index.html) in any modern browser. For the most representative experience, serve the directory with a static file server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Project structure

```text
deep-work-timer/
├── index.html   # Application markup, styles, and behavior
└── README.md    # Project overview and local-run instructions
```

## Implementation notes

The timer derives elapsed time from the system clock rather than counting animation frames. This keeps sessions accurate when browsers throttle rendering in inactive tabs. The app is deliberately framework-free to keep the project portable and easy to inspect.

## Accessibility

Interactive controls have keyboard support and visible focus states. The theme dial can be changed with the left and right arrow keys.
