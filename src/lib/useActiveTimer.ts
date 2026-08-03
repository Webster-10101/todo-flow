"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RunnerState, Task } from "./types";
import {
  formatCountdown,
  getActiveRemainingMs,
  getTaskTotalMinutes,
  minutesToMs,
} from "./time";
import { useInterval } from "./useInterval";
import { useTransientFlag } from "./useTransientFlag";
import {
  cancelTimerNotification,
  haptic,
  isNative,
  scheduleTimerNotification,
} from "./platform";

// The timer engine. This used to live inside RunView, which meant the ding,
// the tab title, and the native time-up notification only existed while the
// full-screen run view was mounted. Now that a task can run with the canvas on
// screen (or with the app zoomed into RunView), the engine has to sit above
// both — mount this ONCE, at App level, and pass the readings down.
export type ActiveTimer = ReturnType<typeof useActiveTimer>;

export function useActiveTimer(args: { tasks: Task[]; runner: RunnerState }) {
  const { tasks, runner } = args;

  // 250ms so the countdown reads smoothly; the app's own 1s clock drives
  // everything that isn't the timer.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useInterval(() => setNowMs(Date.now()), 250);

  const { on: timeUpPulseOn, trigger: triggerTimeUpPulse } = useTransientFlag(900);
  const hasPlayedDing = useRef(false);
  // Attach to whichever "Done" button is on screen — it gets focus when time is
  // up. Only one of FocusBar / RunView renders at a time, so there's no fight.
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);

  const activeTask = useMemo(
    () => (runner.activeTaskId ? tasks.find((t) => t.id === runner.activeTaskId) ?? null : null),
    [runner.activeTaskId, tasks],
  );

  const activeParent = useMemo(() => {
    if (!activeTask?.parentId) return null;
    return tasks.find((t) => t.id === activeTask.parentId) ?? null;
  }, [activeTask?.parentId, tasks]);

  const nextTask = useMemo(() => {
    const top = tasks.filter((t) => t.parentId === null && t.inSprint && t.status !== "done");
    for (const t of top) {
      if (t.kind === "break") {
        if (t.status === "queued") return t;
        continue;
      }
      const kids = tasks.filter((c) => c.parentId === t.id && c.status !== "done");
      if (kids.length) {
        const nextKid = kids.find((c) => c.status === "queued") ?? null;
        if (nextKid) return nextKid;
        continue;
      }
      if (t.status === "queued") return t;
    }
    return null;
  }, [tasks]);

  const nextParent = useMemo(() => {
    if (!nextTask?.parentId) return null;
    return tasks.find((t) => t.id === nextTask.parentId) ?? null;
  }, [nextTask?.parentId, tasks]);

  const autoStartRemainingMs = useMemo(() => {
    if (!runner.autoStartAt) return null;
    if (runner.autoStartPausedAt && runner.autoStartPausedRemainingMs != null) {
      return runner.autoStartPausedRemainingMs;
    }
    return Math.max(0, runner.autoStartAt - nowMs);
  }, [
    runner.autoStartAt,
    runner.autoStartPausedAt,
    runner.autoStartPausedRemainingMs,
    nowMs,
  ]);

  const isTicking = Boolean(activeTask && runner.activeStartedAt);
  const remainingMs = getActiveRemainingMs({ nowMs, runner, tasks });
  const isTimeUp = Boolean(isTicking && remainingMs === 0);

  // 0 → 1 across the task's planned duration. Drives the drain on the canvas
  // block; clamped so an over-running task reads as full, not >100%.
  const elapsedFraction = useMemo(() => {
    if (!activeTask || !isTicking) return 0;
    const totalMs = minutesToMs(getTaskTotalMinutes(activeTask));
    if (totalMs <= 0) return 1;
    return Math.max(0, Math.min(1, (totalMs - remainingMs) / totalMs));
  }, [activeTask, isTicking, remainingMs]);

  const activeEndAt = useMemo(() => {
    if (!activeTask || !runner.activeStartedAt) return null;
    return new Date(runner.activeStartedAt + minutesToMs(getTaskTotalMinutes(activeTask)));
  }, [activeTask, runner.activeStartedAt]);

  useEffect(() => {
    if (isTimeUp) triggerTimeUpPulse();
  }, [isTimeUp, triggerTimeUpPulse]);

  useEffect(() => {
    if (isTimeUp) doneButtonRef.current?.focus();
  }, [isTimeUp]);

  // Ding + system notification when time is up. On native the pre-scheduled
  // local notification covers the backgrounded case, so the web-only
  // Notification path is skipped there.
  useEffect(() => {
    if (isTimeUp && !hasPlayedDing.current) {
      hasPlayedDing.current = true;
      playDing();
      void haptic("warning");
      if (!isNative()) maybeFireNotification(activeTask?.title ?? "Active task");
    }
    if (!isTimeUp) {
      hasPlayedDing.current = false;
    }
  }, [isTimeUp, activeTask?.title]);

  // Native: keep a local notification scheduled at the active task's expected
  // end so time-up fires even with the app backgrounded. Reschedules on
  // start/extend/reduce/resume (deps change), cancels on pause/complete.
  const notifyEndMs = useMemo(() => {
    if (!activeTask || !runner.activeStartedAt) return null;
    if (runner.pausedAt) return null;
    return (
      runner.activeStartedAt +
      minutesToMs(getTaskTotalMinutes(activeTask)) +
      runner.pauseAccumulatedMs
    );
  }, [activeTask, runner.activeStartedAt, runner.pausedAt, runner.pauseAccumulatedMs]);
  const activeTitleForNotify = activeTask?.title ?? "";
  useEffect(() => {
    if (!isNative()) return;
    if (notifyEndMs == null) {
      void cancelTimerNotification();
      return;
    }
    void scheduleTimerNotification({ taskTitle: activeTitleForNotify, atMs: notifyEndMs });
  }, [notifyEndMs, activeTitleForNotify]);
  // Cancel any pending schedule when the app unmounts entirely.
  useEffect(() => () => void cancelTimerNotification(), []);

  // Tab title countdown
  useEffect(() => {
    if (isTicking) {
      const timeStr = formatCountdown(remainingMs);
      if (isTimeUp) document.title = "Done! - TodoFlow";
      else if (runner.pausedAt) document.title = `${timeStr} (paused) - TodoFlow`;
      else document.title = `${timeStr} - TodoFlow`;
    } else {
      document.title = "TodoFlow";
    }
    return () => {
      document.title = "TodoFlow";
    };
  }, [isTicking, runner.pausedAt, remainingMs, isTimeUp]);

  return {
    nowMs,
    activeTask,
    activeParent,
    nextTask,
    nextParent,
    remainingMs,
    elapsedFraction,
    isTicking,
    isTimeUp,
    timeUpPulseOn,
    activeEndAt,
    autoStartRemainingMs,
    doneButtonRef,
  };
}

function maybeFireNotification(taskTitle: string) {
  if (typeof window === "undefined") return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState !== "hidden") return;
  try {
    new Notification("TodoFlow — time's up", {
      body: taskTitle,
      silent: false,
      tag: "todoflow-timeup",
    });
  } catch {
    // Some browsers throw if invoked outside a service worker; ignore.
  }
}

function playDing() {
  try {
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    // Pleasant bell-like tone
    oscillator.frequency.setValueAtTime(830, ctx.currentTime); // ~G#5
    oscillator.type = "sine";

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.8);

    // Second tone for a pleasant two-tone ding
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.frequency.setValueAtTime(1046, ctx.currentTime + 0.15); // ~C6
    osc2.type = "sine";

    gain2.gain.setValueAtTime(0, ctx.currentTime);
    gain2.gain.setValueAtTime(0.25, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);

    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 1);
  } catch {
    // Audio not available
  }
}
