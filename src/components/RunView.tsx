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

export function RunView(props: {
  now: Date;
  tasks: Task[];
  runner: RunnerState;
  settings: Settings;
  onStartNext: () => void;
  onDoneActive: () => void;
  onDeleteActive: () => void;
  onExtendActive: (minutes: 5 | 10) => void;
  onInsertBreakNext: (minutes: 5 | 10) => void;
  onStopAfterThisTask: () => void;
  onTogglePause: () => void;
  onExitToPlan: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useInterval(() => setNowMs(Date.now()), 250);

  const { on: timeUpPulseOn, trigger: triggerTimeUpPulse } = useTransientFlag(900);
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
                  Ends at <span className="text-ink">{activeEndAt ? formatClock(activeEndAt) : "—"}</span>
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

              <div className="mx-2 h-6 w-px bg-line" />

              <button
                type="button"
                onClick={() => props.onInsertBreakNext(5)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                Insert break +5
              </button>
              <button
                type="button"
                onClick={() => props.onInsertBreakNext(10)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                Insert break +10
              </button>
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

              <div className="mx-2 h-6 w-px bg-line" />

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

              <div className="mx-2 h-6 w-px bg-line" />

              <button
                type="button"
                onClick={() => props.onInsertBreakNext(5)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                Insert break +5
              </button>
              <button
                type="button"
                onClick={() => props.onInsertBreakNext(10)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
              >
                Insert break +10
              </button>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="text-muted">
            Projected finish: <span className="text-ink">{formatClock(projectedFinish)}</span>
            {pastCutoff ? <span className="ml-2 text-ink">· Runs past cutoff</span> : null}
          </div>

          {pastCutoff ? (
            <button
              type="button"
              onClick={props.onStopAfterThisTask}
              disabled={props.runner.stopAfterThisTask}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
            >
              {props.runner.stopAfterThisTask ? "Will stop after this task" : "Stop after this task"}
            </button>
          ) : null}
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


