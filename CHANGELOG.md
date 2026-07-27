# Changelog

Generated from `changelog.json` — edit that, not this file.

## 1.2.0 — 2026-07-27

_Start any task from its own block_

### Added

- A play button on each block starts that task directly, instead of always starting the sprint from the top. On touch it's the Start button in the action bar. Whatever was running goes back in the queue rather than being lost.

### Changed

- The menu bar now shows the task name alongside the countdown, so you can tell what's running without opening the window.

## 1.1.0 — 2026-07-27

_A Mac app with a menu bar timer, pomodoro defaults, and blocks you can actually grab_

### Added

- TodoFlow is a proper Mac app. The active task's countdown sits in the menu bar, and the menu there lets you pause, resume, mark done, add 5 minutes, or start the next task.
- Closing the window parks the app in the menu bar rather than quitting, so the timer keeps running while you work elsewhere. Quit properly from the menu bar.
- A desktop notification when time's up, which fires whether or not the window is open.
- The day's time blocks now feed through to the World HQ dashboard, so you can see what the day actually looked like beside what you planned.
- This changelog. The version badge in the header opens it, and shows a dot when there's something new.

### Changed

- New tasks default to 25 minutes and get a 5-minute break placed right after them, so the projected finish accounts for the breaks you'll actually take. Adjustable in the header — set the break to 0 or untick Auto break to opt out.
- On iPhone, tasks are mirrored into native storage as well as the browser's. iOS can clear web storage when the device is short on space; the mirror is the copy that survives.

### Fixed

- Dragging a block by its title works. The title is plain text now; double-click to rename it, or use Rename on the touch action bar.
- The subtasks popover stays on screen when a task has a lot of subtasks — it measures itself rather than assuming a fixed height, and the list scrolls inside.

## 1.0.0 — 2026-07-13

_iOS shell, cross-device sync and a mobile-first rebuild_

### Added

- Native iOS shell with haptics and timer notifications that fire while the app is backgrounded.
- Mobile-first layout: the canvas leads on phones, with a fixed dock for adding tasks and a tap-to-select action bar for editing blocks.
- Cross-device sync — tasks kept in step across devices, with offline support and email sign-in. Dormant until sync is configured; the app stays fully local until then.
- Per-day task history, a sprint summary card, and 7-day streak dots.
