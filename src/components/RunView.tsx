"use client";

import type { RunnerState, Settings, Task } from "@/src/lib/types";
import {
  formatClock,
  formatCountdown,
  getActiveRemainingMs,
  getProjectedFinishDate,
  isProjectedPastCutoff,
  minutesToMs,
  getTaskTotalMinutes,
} from "@/src/lib/time";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInterval } from "@/src/lib/useInterval";
import { useTransientFlag } from "@/src/lib/useTransientFlag";
import {
  cancelTimerNotification,
  isNative,
  scheduleTimerNotification,
} from "@/src/lib/platform";

export function RunView(props: {
  now: Date;
  tasks: Task[];
  runner: RunnerState;
  settings: Settings;
  onStartNext: () => void;
  onDoneActive: () => void;
  onDeleteActive: () => void;
  onExtendActive: (minutes: 5 | 10) => void;
  onReduceActive: (minutes: 5 | 10) => void;
  onInsertBreakNext: (minutes: 5 | 10) => void;
  onStopAfterThisTask: () => void;
  onTogglePause: () => void;
  onExitToPlan: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useInterval(() => setNowMs(Date.now()), 250);

  const { on: timeUpPulseOn, trigger: triggerTimeUpPulse } = useTransientFlag(900);
  const hasPlayedDing = useRef(false);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);

  const activeTask = useMemo(
    () => (props.runner.activeTaskId ? props.tasks.find((t) => t.id === props.runner.activeTaskId) : null),
    [props.runner.activeTaskId, props.tasks],
  );

  const activeParent = useMemo(() => {
    if (!activeTask?.parentId) return null;
    return props.tasks.find((t) => t.id === activeTask.parentId) ?? null;
  }, [activeTask?.parentId, props.tasks]);

  const nextTask = useMemo(
    () => {
      const top = props.tasks.filter((t) => t.parentId === null && t.inSprint && t.status !== "done");
      for (const t of top) {
        if (t.kind === "break") {
          if (t.status === "queued") return t;
          continue;
        }
        const kids = props.tasks.filter((c) => c.parentId === t.id && c.status !== "done");
        if (kids.length) {
          const nextKid = kids.find((c) => c.status === "queued") ?? null;
          if (nextKid) return nextKid;
          continue;
        }
        if (t.status === "queued") return t;
      }
      return null;
    },
    [props.tasks],
  );

  const nextParent = useMemo(() => {
    if (!nextTask?.parentId) return null;
    return props.tasks.find((t) => t.id === nextTask.parentId) ?? null;
  }, [nextTask?.parentId, props.tasks]);

  const autoStartRemainingMs = useMemo(() => {
    if (!props.runner.autoStartAt) return null;
    if (props.runner.autoStartPausedAt && props.runner.autoStartPausedRemainingMs != null) {
      return props.runner.autoStartPausedRemainingMs;
    }
    return Math.max(0, props.runner.autoStartAt - nowMs);
  }, [
    props.runner.autoStartAt,
    props.runner.autoStartPausedAt,
    props.runner.autoStartPausedRemainingMs,
    nowMs,
  ]);

  const remainingMs = getActiveRemainingMs({ nowMs, runner: props.runner, tasks: props.tasks });
  const isTimeUp = Boolean(activeTask && props.runner.activeStartedAt && remainingMs === 0);

  useEffect(() => {
    if (isTimeUp) triggerTimeUpPulse();
  }, [isTimeUp, triggerTimeUpPulse]);

  useEffect(() => {
    if (isTimeUp) doneButtonRef.current?.focus();
  }, [isTimeUp]);

  // Play ding sound + system notification when time is up. On native the
  // pre-scheduled local notification covers the backgrounded case, so the
  // web-only Notification path is skipped there.
  useEffect(() => {
    if (isTimeUp && !hasPlayedDing.current) {
      hasPlayedDing.current = true;
      playDing();
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
    if (!activeTask || !props.runner.activeStartedAt) return null;
    if (props.runner.pausedAt) return null;
    return (
      props.runner.activeStartedAt +
      minutesToMs(getTaskTotalMinutes(activeTask)) +
      props.runner.pauseAccumulatedMs
    );
  }, [
    activeTask,
    props.runner.activeStartedAt,
    props.runner.pausedAt,
    props.runner.pauseAccumulatedMs,
  ]);
  const activeTitleForNotify = activeTask?.title ?? "";
  useEffect(() => {
    if (!isNative()) return;
    if (notifyEndMs == null) {
      void cancelTimerNotification();
      return;
    }
    void scheduleTimerNotification({ taskTitle: activeTitleForNotify, atMs: notifyEndMs });
  }, [notifyEndMs, activeTitleForNotify]);
  // Cancel any pending schedule when leaving run mode entirely.
  useEffect(() => () => void cancelTimerNotification(), []);

  // Global keyboard shortcuts while in run mode
  const {
    onTogglePause,
    onExitToPlan,
    onDoneActive,
    onExtendActive,
    onReduceActive,
    onInsertBreakNext,
  } = props;
  const runnerActiveId = props.runner.activeTaskId;
  const runnerActiveStartedAt = props.runner.activeStartedAt;
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!t || !(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const k = e.key.toLowerCase();
      if (e.key === " " || k === "spacebar") {
        e.preventDefault();
        onTogglePause();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onExitToPlan();
        return;
      }
      if (!runnerActiveId || !runnerActiveStartedAt) return;
      if (k === "d") {
        e.preventDefault();
        onDoneActive();
      } else if (k === "e") {
        e.preventDefault();
        onExtendActive(5);
      } else if (k === "r") {
        e.preventDefault();
        onReduceActive(5);
      } else if (k === "b") {
        e.preventDefault();
        onInsertBreakNext(5);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    onTogglePause,
    onExitToPlan,
    onDoneActive,
    onExtendActive,
    onReduceActive,
    onInsertBreakNext,
    runnerActiveId,
    runnerActiveStartedAt,
  ]);

  // Update tab title with remaining time
  useEffect(() => {
    if (activeTask && props.runner.activeStartedAt) {
      const timeStr = formatCountdown(remainingMs);
      if (isTimeUp) {
        document.title = `Done! - TodoFlow`;
      } else if (props.runner.pausedAt) {
        document.title = `${timeStr} (paused) - TodoFlow`;
      } else {
        document.title = `${timeStr} - TodoFlow`;
      }
    } else {
      document.title = "TodoFlow";
    }
    return () => {
      document.title = "TodoFlow";
    };
  }, [activeTask, props.runner.activeStartedAt, props.runner.pausedAt, remainingMs, isTimeUp]);

  const activeEndAt = useMemo(() => {
    if (!activeTask || !props.runner.activeStartedAt) return null;
    const endMs = props.runner.activeStartedAt + minutesToMs(getTaskTotalMinutes(activeTask));
    return new Date(endMs);
  }, [activeTask, props.runner.activeStartedAt]);

  const projectedFinish = useMemo(
    () => getProjectedFinishDate({ nowMs, runner: props.runner, tasks: props.tasks }),
    [nowMs, props.runner, props.tasks],
  );

  const pastCutoff = isProjectedPastCutoff({
    now: props.now,
    projectedFinish,
    settings: props.settings,
  });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-white/70 p-6 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-muted">Active</div>
            <div className="mt-1 text-xl text-ink">
              {activeTask
                ? activeParent
                  ? `${activeParent.title} — ${activeTask.title}`
                  : activeTask.title
                : nextTask
                  ? "Ready for next task"
                  : "No tasks in sprint"}
            </div>
            <div className="mt-2 text-sm text-muted">
              {activeTask && props.runner.activeStartedAt ? (
                <>
                  Ends at{" "}
                  <span className="inline-flex items-center rounded-lg border border-line bg-white/70 px-2 py-1 font-mono tabular-nums tracking-wider text-ink">
                    {activeEndAt ? formatClock(activeEndAt) : "—"}
                  </span>
                </>
              ) : (
                <>Start when you’re ready.</>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={props.onExitToPlan}
            className="rounded-lg border border-line bg-white/60 px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
          >
            Back to plan
          </button>
        </div>

        <div
          className={[
            "mt-6 rounded-2xl border border-line bg-white/60 px-6 py-8",
            "transition-colors duration-300",
            isTimeUp ? "bg-[rgba(20,20,20,0.03)]" : "",
            timeUpPulseOn ? "ring-2 ring-[rgba(20,20,20,0.12)]" : "",
          ].join(" ")}
        >
          <div className="text-[64px] leading-none tracking-tight text-ink">
            {activeTask && props.runner.activeStartedAt ? formatCountdown(remainingMs) : "—"}
          </div>
          <div className="mt-2 text-sm text-muted" aria-live="polite">
            {isTimeUp ? "Time’s up — mark done or extend." : " "}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {!activeTask || !props.runner.activeStartedAt ? (
            <>
              <button
                type="button"
                onClick={props.onStartNext}
                disabled={!nextTask}
                className={[
                  "rounded-lg px-4 py-2 text-sm transition-colors",
                  nextTask
                    ? "border border-line bg-ink text-paper hover:bg-black"
                    : "border border-line bg-white/40 text-muted cursor-not-allowed",
                ].join(" ")}
              >
                {autoStartRemainingMs != null ? `Starting in ${Math.ceil(autoStartRemainingMs / 1000)}s` : "Start task"}
              </button>

              {autoStartRemainingMs != null ? (
                <button
                  type="button"
                  onClick={props.onTogglePause}
                  className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
                >
                  {props.runner.autoStartPausedAt ? "Resume" : "Pause"}
                </button>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                <span className="hidden sm:inline text-xs text-muted">Break</span>
                <button
                  type="button"
                  onClick={() => props.onInsertBreakNext(5)}
                  className="rounded-lg border border-line bg-white/60 px-3 py-1.5 text-xs text-muted hover:bg-soft hover:text-ink transition-colors"
                >
                  +5
                </button>
                <button
                  type="button"
                  onClick={() => props.onInsertBreakNext(10)}
                  className="rounded-lg border border-line bg-white/60 px-3 py-1.5 text-xs text-muted hover:bg-soft hover:text-ink transition-colors"
                >
                  +10
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                ref={doneButtonRef}
                type="button"
                onClick={props.onDoneActive}
                className="rounded-lg border border-line bg-ink px-4 py-2 text-sm text-paper hover:bg-black transition-colors"
              >
                Done
              </button>

              <button
                type="button"
                onClick={props.onTogglePause}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                {props.runner.pausedAt ? "Resume" : "Pause"}
              </button>

              <button
                type="button"
                onClick={props.onDeleteActive}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                Delete
              </button>

              <button
                type="button"
                onClick={() => props.onExtendActive(5)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                +5 min
              </button>
              <button
                type="button"
                onClick={() => props.onExtendActive(10)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                +10 min
              </button>

              <button
                type="button"
                onClick={() => props.onReduceActive(5)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                −5 min
              </button>
              <button
                type="button"
                onClick={() => props.onReduceActive(10)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                −10 min
              </button>

              <div className="ml-auto flex items-center gap-2">
                <span className="hidden sm:inline text-xs text-muted">Break</span>
                <button
                  type="button"
                  onClick={() => props.onInsertBreakNext(5)}
                  className="rounded-lg border border-line bg-white/60 px-3 py-1.5 text-xs text-muted hover:bg-soft hover:text-ink transition-colors"
                >
                  +5
                </button>
                <button
                  type="button"
                  onClick={() => props.onInsertBreakNext(10)}
                  className="rounded-lg border border-line bg-white/60 px-3 py-1.5 text-xs text-muted hover:bg-soft hover:text-ink transition-colors"
                >
                  +10
                </button>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
          <div className="rounded-xl border border-line bg-white/60 px-5 py-4 shadow-soft">
            <div className="text-xs text-muted">Projected finish</div>
            <div className="mt-1 font-mono tabular-nums tracking-widest text-2xl text-ink">
              {formatClock(projectedFinish)}
            </div>
            {pastCutoff ? <div className="mt-1 text-xs text-muted">Runs past cutoff</div> : null}
          </div>

          {pastCutoff ? (
            <div className="flex sm:justify-end">
              <button
                type="button"
                onClick={props.onStopAfterThisTask}
                disabled={props.runner.stopAfterThisTask}
                className="w-full sm:w-auto rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                {props.runner.stopAfterThisTask ? "Will stop after this task" : "Stop after this task"}
              </button>
            </div>
          ) : (
            <div />
          )}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white/60 px-6 py-5 shadow-soft">
        <div className="flex items-baseline justify-between">
          <div className="text-sm text-muted">Next up</div>
          <div className="text-sm text-muted">
            {nextTask ? `${nextTask.estimateMinutes + nextTask.extraMinutes} min` : "—"}
          </div>
        </div>
        <div className="mt-2 text-[15px] text-ink">
          {nextTask ? (nextParent ? `${nextParent.title} — ${nextTask.title}` : nextTask.title) : "No queued tasks"}
        </div>
      </div>
    </div>
  );
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
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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
