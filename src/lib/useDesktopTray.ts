"use client";

import { useEffect, useMemo } from "react";
import type { RunnerState, Task } from "./types";
import { getTaskTotalMinutes, minutesToMs } from "./time";
import { getNextStepId } from "./todoflowReducer";
import { isDesktop, onDesktopCommand, publishTimerState } from "./platform";

export type DesktopCommand = "pause" | "resume" | "done" | "extend5" | "start";

/**
 * Feeds the macOS menu bar countdown and handles its commands.
 *
 * The shell is told *when* the active task ends and counts down to it itself —
 * it never computes durations. That keeps one timer state machine (the reducer)
 * and means a hidden window, whose JS timers Chromium throttles, can't make the
 * menu bar drift.
 *
 * No-op on web and iOS.
 */
export function useDesktopTray(args: {
  tasks: Task[];
  runner: RunnerState;
  onCommand: (command: DesktopCommand) => void;
}) {
  const { tasks, runner, onCommand } = args;

  const activeTask = useMemo(
    () => (runner.activeTaskId ? tasks.find((t) => t.id === runner.activeTaskId) ?? null : null),
    [runner.activeTaskId, tasks],
  );

  const nextTask = useMemo(() => {
    const nextId = getNextStepId(tasks);
    return nextId ? tasks.find((t) => t.id === nextId) ?? null : null;
  }, [tasks]);

  // Same formula RunView uses to schedule the iOS notification — one definition
  // of "when does this end", used by every shell.
  const endMs = useMemo(() => {
    if (!activeTask || !runner.activeStartedAt) return null;
    if (runner.pausedAt) return null;
    return (
      runner.activeStartedAt +
      minutesToMs(getTaskTotalMinutes(activeTask)) +
      runner.pauseAccumulatedMs
    );
  }, [activeTask, runner.activeStartedAt, runner.pausedAt, runner.pauseAccumulatedMs]);

  // While paused the clock is frozen, so send the fixed remainder instead.
  const pausedRemainingMs = useMemo(() => {
    if (!activeTask || !runner.activeStartedAt || !runner.pausedAt) return null;
    const wouldEndAt =
      runner.activeStartedAt +
      minutesToMs(getTaskTotalMinutes(activeTask)) +
      runner.pauseAccumulatedMs;
    return Math.max(0, wouldEndAt - runner.pausedAt);
  }, [activeTask, runner.activeStartedAt, runner.pausedAt, runner.pauseAccumulatedMs]);

  const running = Boolean(activeTask && runner.activeStartedAt);
  const title = activeTask?.title ?? "";
  const nextTitle = nextTask?.title ?? null;
  const canStart = Boolean(nextTask);

  useEffect(() => {
    if (!isDesktop()) return;
    publishTimerState({
      running,
      title,
      endMs,
      paused: Boolean(runner.pausedAt),
      remainingMs: pausedRemainingMs,
      nextTitle,
      canStart,
    });
  }, [running, title, endMs, runner.pausedAt, pausedRemainingMs, nextTitle, canStart]);

  useEffect(() => {
    if (!isDesktop()) return;
    return onDesktopCommand(onCommand);
  }, [onCommand]);
}
