# Changelog

Generated from `changelog.json` — edit that, not this file.

## 1.5.0 — 2026-08-03

_The day stays on screen while you work_

### Added

- A focus bar along the bottom carries the countdown and the controls you actually reach for — done, pause, five minutes more or less, a break.
- Freelance Radio is one press away from the focus bar, for when you want something in your ears.
- Zoom still gives you the big full-screen countdown when you want the blinkers on. Escape brings the plan back, and the timer keeps running either way.

### Changed

- Pressing play no longer swaps your plan for a full-screen timer. The day stays put: the running block lights up with a live countdown and fills in as the time goes, and everything else fades back — still there, still draggable, so you can reshuffle the afternoon without stopping the clock.
- Starting a task moves its block to the time you actually started it, so the plan reflects the clock instead of quietly drifting from it.

## 1.4.0 — 2026-07-31

_Move several blocks at once_

### Added

- Shift-click blocks to select more than one, then drag any of them — the whole group moves together, keeping the gaps between them exactly as you laid them out. Everything else bounces out of the way as usual.

## 1.3.0 — 2026-07-29

_Blocks push each other out of the way_

### Added

- The canvas now works like a scratchboard. Drop a block onto a busy time and whatever's there bounces down to make room — free gaps absorb the shuffle, everything keeps its order, and a task's break stays glued to it.
- You can see it happen live: while you're still dragging, the other blocks slide into their new spots so you know exactly what you'll get before you let go.

### Changed

- Resizing a block no longer stops at the next one — growing a task nudges everything below it down instead. Creating a task in a busy spot does the same.
- The day is no longer boxed into 8am–8pm. The canvas still shows the main day by default, but it stretches to fit early mornings and late evenings whenever you plan them — up to midnight.

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
