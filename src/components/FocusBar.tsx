"use client";

import type { MutableRefObject } from "react";
import type { RunnerState, Task } from "@/src/lib/types";
import { formatClock, formatCountdown } from "@/src/lib/time";
import { RadioButton } from "./RadioButton";

const iconProps = {
  width: 13,
  height: 13,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ExpandIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9.5 2.5H13.5V6.5M6.5 13.5H2.5V9.5M13.5 2.5L9 7M2.5 13.5L7 9" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg {...iconProps} fill="currentColor" stroke="none">
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
    </svg>
  );
}

// The running controls, as a strip rather than a screen. Pressing play now
// keeps you on the canvas — this is everything RunView's control slab did,
// folded into one line so the day's plan stays visible behind it.
export function FocusBar(props: {
  runner: RunnerState;
  activeTask: Task | null;
  activeParent: Task | null;
  nextTask: Task | null;
  remainingMs: number;
  isTicking: boolean;
  isTimeUp: boolean;
  timeUpPulseOn: boolean;
  activeEndAt: Date | null;
  autoStartRemainingMs: number | null;
  // Only the visible instance attaches this — a focus() on a display:none
  // button does nothing, so the mobile and desktop copies must not fight.
  doneRef?: MutableRefObject<HTMLButtonElement | null>;
  compact?: boolean;
  onDoneActive: () => void;
  onTogglePause: () => void;
  onExtendActive: (minutes: 5 | 10) => void;
  onReduceActive: (minutes: 5 | 10) => void;
  onInsertBreakNext: (minutes: 5 | 10) => void;
  onStartNext: () => void;
  onZoom: () => void;
  onStop: () => void;
}) {
  const {
    activeTask,
    activeParent,
    nextTask,
    remainingMs,
    isTicking,
    isTimeUp,
    timeUpPulseOn,
    autoStartRemainingMs,
    compact,
  } = props;

  const title = activeTask
    ? activeParent
      ? `${activeParent.title} — ${activeTask.title}`
      : activeTask.title || "Untitled task"
    : nextTask
      ? `Next: ${nextTask.title || "Untitled task"}`
      : "Nothing queued";

  const btn =
    "shrink-0 rounded-lg border border-line bg-white/70 text-ink hover:bg-soft transition-colors";
  const btnSize = compact ? "h-9 px-2.5 text-xs" : "px-3 py-2 text-sm";
  const ghost =
    "shrink-0 rounded-lg border border-line bg-white/60 text-muted hover:text-ink hover:bg-soft transition-colors";

  return (
    <div
      className={[
        "flex items-center gap-2 border border-line bg-white/95 backdrop-blur shadow-soft",
        compact ? "rounded-none border-x-0 border-b-0 px-3 py-2" : "rounded-xl px-4 py-3",
        timeUpPulseOn ? "ring-2 ring-rose-300" : "",
      ].join(" ")}
      role="region"
      aria-label="Running task controls"
    >
      {/* Countdown + what's running */}
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={[
            "shrink-0 font-mono tabular-nums tracking-tight leading-none",
            compact ? "text-[22px]" : "text-[28px]",
            isTimeUp ? "text-rose-600" : props.runner.pausedAt ? "text-muted" : "text-ink",
          ].join(" ")}
          aria-live="off"
        >
          {isTicking ? formatCountdown(remainingMs) : "—:—"}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] text-ink/90">{title}</div>
          <div className="truncate text-[11px] text-muted" aria-live="polite">
            {isTimeUp
              ? "Time’s up — done or extend"
              : props.runner.pausedAt
                ? "Paused"
                : isTicking && props.activeEndAt
                  ? `ends ${formatClock(props.activeEndAt)}`
                  : autoStartRemainingMs != null
                    ? `starting in ${Math.ceil(autoStartRemainingMs / 1000)}s`
                    : "ready"}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {isTicking ? (
          <>
            <button
              ref={props.doneRef}
              type="button"
              onClick={props.onDoneActive}
              className={[
                "shrink-0 rounded-lg border border-line bg-ink text-paper hover:bg-black transition-colors",
                btnSize,
              ].join(" ")}
            >
              Done
            </button>
            <button
              type="button"
              onClick={props.onTogglePause}
              className={[btn, btnSize].join(" ")}
            >
              {props.runner.pausedAt ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => props.onExtendActive(5)}
              className={[ghost, btnSize, "hidden sm:inline-flex"].join(" ")}
              title="Extend by 5 minutes (E)"
            >
              +5
            </button>
            <button
              type="button"
              onClick={() => props.onReduceActive(5)}
              className={[ghost, btnSize, "hidden sm:inline-flex"].join(" ")}
              title="Trim 5 minutes (R)"
            >
              −5
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={props.onStartNext}
            disabled={!nextTask}
            className={[
              "shrink-0 rounded-lg border border-line transition-colors",
              btnSize,
              nextTask
                ? "bg-ink text-paper hover:bg-black"
                : "bg-white/40 text-muted cursor-not-allowed",
            ].join(" ")}
          >
            {autoStartRemainingMs != null
              ? `Start now (${Math.ceil(autoStartRemainingMs / 1000)}s)`
              : "Start next"}
          </button>
        )}

        <button
          type="button"
          onClick={() => props.onInsertBreakNext(5)}
          className={[ghost, btnSize, "hidden md:inline-flex"].join(" ")}
          title="Insert a 5-minute break next (B)"
        >
          Break
        </button>

        <RadioButton compact={compact} />

        {/* Phones can't spare the width for two more words — the running
            block's title needs it more than these labels do. */}
        <button
          type="button"
          onClick={props.onZoom}
          className={[ghost, btnSize, compact ? "inline-flex items-center" : ""].join(" ")}
          title="Zoom into the focus view"
          aria-label="Zoom into the focus view"
        >
          {compact ? <ExpandIcon /> : "Zoom"}
        </button>

        <button
          type="button"
          onClick={props.onStop}
          className={[
            ghost,
            btnSize,
            compact ? "inline-flex items-center" : "",
            "hover:text-rose-700 hover:bg-rose-50",
          ].join(" ")}
          title="Stop the sprint and go back to planning"
          aria-label="Stop the sprint"
        >
          {compact ? <StopIcon /> : "Stop"}
        </button>
      </div>
    </div>
  );
}
