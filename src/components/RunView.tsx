"use client";

import type { RunnerState, Settings, Task } from "@/src/lib/types";
import type { ActiveTimer } from "@/src/lib/useActiveTimer";
import {
  formatClock,
  formatCountdown,
  getProjectedFinishDate,
  isProjectedPastCutoff,
} from "@/src/lib/time";
import { useMemo } from "react";
import { RadioButton } from "./RadioButton";

// The zoomed focus view: big countdown, nothing else competing for attention.
// No longer where a run *lives* — pressing play keeps you on the canvas, and
// this is opt-in via the focus bar's Zoom button. Purely presentational; the
// timer engine is useActiveTimer, mounted in App.
export function RunView(props: {
  now: Date;
  tasks: Task[];
  runner: RunnerState;
  settings: Settings;
  timer: ActiveTimer;
  onStartNext: () => void;
  onDoneActive: () => void;
  onDeleteActive: () => void;
  onExtendActive: (minutes: 5 | 10) => void;
  onReduceActive: (minutes: 5 | 10) => void;
  onInsertBreakNext: (minutes: 5 | 10) => void;
  onStopAfterThisTask: () => void;
  onTogglePause: () => void;
  onBackToCanvas: () => void;
}) {
  const {
    activeTask,
    activeParent,
    nextTask,
    nextParent,
    remainingMs,
    isTicking,
    isTimeUp,
    timeUpPulseOn,
    activeEndAt,
    autoStartRemainingMs,
    doneButtonRef,
    nowMs,
  } = props.timer;

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
              {isTicking ? (
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

          <div className="flex shrink-0 items-center gap-2">
            <RadioButton />
            <button
              type="button"
              onClick={props.onBackToCanvas}
              className="rounded-lg border border-line bg-white/60 px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              title="Back to the day’s plan (Esc) — the timer keeps running"
            >
              Back to plan
            </button>
          </div>
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
            {isTicking ? formatCountdown(remainingMs) : "—"}
          </div>
          <div className="mt-2 text-sm text-muted" aria-live="polite">
            {isTimeUp ? "Time’s up — mark done or extend." : " "}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {!isTicking ? (
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
                {autoStartRemainingMs != null
                  ? `Starting in ${Math.ceil(autoStartRemainingMs / 1000)}s`
                  : "Start task"}
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
