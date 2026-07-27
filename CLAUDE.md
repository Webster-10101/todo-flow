# CLAUDE.md — TodoFlow

Time-blocking todo app. One web core (Next.js static export) shipped to three
targets: web (Vercel), iOS (Capacitor), and — in progress — macOS (Electron).

Live state and next steps live in the vault: `World/Handovers/TodoFlow.md`.

## Commands

```bash
npm run dev        # localhost:3000
npm run build      # static export to out/ (runs prebuild → CHANGELOG.md)
npm run changelog  # regenerate CHANGELOG.md from changelog.json
npm run ios:sync   # next build && cap sync ios
npm run ios:open   # open the Xcode project

npm run desktop:build   # next build && electron-builder → dist-desktop/mac-arm64/TodoFlow.app
npm run desktop:dev     # electron against the running `npm run dev` server
npm run desktop:verify  # launch, assert the renderer mounted, exit (smoke test)
```

## Desktop shell

`electron/main.js` (plain CommonJS — no build step) serves `out/` over a custom
`app://` protocol rather than a localhost port. That's deliberate: localStorage
is scoped per origin *including port*, so a shifting dev port would silently wipe
the user's tasks between launches.

The main process owns the menu bar tick. The renderer publishes `{ endMs, paused,
… }` only when timer state changes, and main counts down to that timestamp —
otherwise Chromium's throttling of a hidden window would make the menu bar drift.

## Architecture rules

- **One platform seam.** `src/lib/platform.ts` is the only place that branches
  on web / native / desktop. Never scatter platform checks through components.
- **Shells render, they never own logic.** The runner state machine lives in
  `src/lib/todoflowReducer.ts`. A shell (iOS notification, Mac tray) is handed an
  end timestamp and displays it — it does not decide when a task ends.
- **Every reducer mutation must stamp `touch()`** on the rows it changes.
  `updatedAtMs` is the sync engine's last-write-wins clock; a case that mutates
  without stamping causes silent sync losses. This applies to rows a case creates
  as a side effect too (e.g. the auto-break in `ADD_TASK`).
- **Storage is `todoflow:v2`.** The old `todoflow:v1` blob is deliberately left
  in localStorage as a rollback escape hatch — don't "clean it up".
- **Auth is email OTP, not magic link.** Magic-link redirects break inside the
  Capacitor WKWebView; OTP is one code path on every platform.

## Releases

Follows the global rules in `~/.claude/CLAUDE.md`; TodoFlow has **opted in** to
user-facing release notes (Al asked for them, 27 Jul).

1. Bump `version` in `package.json` at **session close**, not per commit — minor
   for a feature, patch for fixes. One bump per session, however many slices it
   contained.
2. Add one entry to `changelog.json` for that version — newest first, `kind` is
   `added` / `changed` / `fixed`. These are **release notes for a user**, not a
   handover: what changed and what it means. Never a security fix, never a
   roadmap item, never internal tooling names. Roadmap and internals belong in
   `World/Handovers/TodoFlow.md`.
3. `CHANGELOG.md` is generated from that JSON on build — never edit it directly.

The header badge shows `v1.1.0 · a3f9c21` (version + commit SHA, so a stale
alias is obvious) and opens the notes.
