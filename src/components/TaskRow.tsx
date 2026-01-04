"use client";

import type { Task } from "@/src/lib/types";
import { useMemo } from "react";

function clampMinutes(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.round(n));
}

export function TaskRow(props: {
  task: Task;
  tone?: { bg: string; accent: string };
  minutesOverride?: number;
  minutesReadOnly?: boolean;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleInSprint?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onRequestAddSubtask?: (parentId: string) => void;
}) {
  const minutes = useMemo(
    () => clampMinutes(props.task.estimateMinutes),
    [props.task.estimateMinutes],
  );

  const isBreak = props.task.kind === "break";
  const muted = props.task.status === "done";
  const showAddSubtask = Boolean(
    props.onRequestAddSubtask && props.task.parentId === null && props.task.kind === "task",
  );

  return (
    <div
      className={[
        "group rounded-xl border border-line bg-white/70 shadow-soft",
        "px-4 py-3",
        muted ? "opacity-60" : "",
      ].join(" ")}
      style={props.tone ? { backgroundColor: props.tone.bg } : undefined}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 h-6 w-[8px] rounded-full"
          style={props.tone ? { backgroundColor: props.tone.accent } : undefined}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={() => props.onToggleDone(props.task.id)}
          className={[
            "mt-0.5 h-6 w-6 rounded-full border border-line flex items-center justify-center",
            "bg-white hover:bg-soft transition-colors shrink-0",
          ].join(" ")}
          aria-label={props.task.status === "done" ? "Mark as not done" : "Mark as done"}
        >
          {props.task.status === "done" ? (
            <span className="text-xs text-ink">✓</span>
          ) : (
            <span className="text-xs text-muted"> </span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <input
            value={props.task.title}
            onChange={(e) => props.onEditTitle(props.task.id, e.target.value)}
            placeholder={isBreak ? "Break" : "Task"}
            aria-label="Task title"
            className={[
              "w-full bg-transparent text-[15px] outline-none",
              muted ? "line-through decoration-[rgba(20,20,20,0.25)]" : "",
            ].join(" ")}
          />
          <div className="mt-0.5 text-xs text-muted">
            {isBreak ? "Break" : "Task"}
            {props.task.extraMinutes > 0 ? ` · +${props.task.extraMinutes}m added` : ""}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={props.minutesOverride ?? minutes}
            onChange={(e) => {
              if (props.minutesReadOnly) return;
              const val = e.target.valueAsNumber;
              props.onEditMinutes(props.task.id, isNaN(val) ? 1 : clampMinutes(val));
            }}
            disabled={props.minutesReadOnly}
            className="w-[88px] rounded-lg border border-line bg-white/70 px-2 py-1.5 text-xs text-ink outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
            aria-label="Estimated minutes"
          />
          <span className="text-xs text-muted">min</span>
        </div>

        <div className="sm:ml-auto flex flex-wrap items-center gap-2">
          {props.onDuplicate ? (
            <button
              type="button"
              onClick={() => props.onDuplicate?.(props.task.id)}
              className="rounded-lg border border-line bg-white/60 px-2 py-1.5 text-xs text-ink hover:bg-soft transition-colors"
            >
              Duplicate
            </button>
          ) : null}

          {showAddSubtask ? (
            <button
              type="button"
              onClick={() => props.onRequestAddSubtask?.(props.task.id)}
              className="rounded-lg border border-line bg-white/60 px-2 py-1.5 text-xs text-ink hover:bg-soft transition-colors"
            >
              + Subtask
            </button>
          ) : null}

          {props.onToggleInSprint ? (
            <button
              type="button"
              onClick={() => props.onToggleInSprint?.(props.task.id)}
              className="rounded-lg border border-line bg-white/60 px-2 py-1.5 text-xs text-ink hover:bg-soft transition-colors"
            >
              {props.task.inSprint ? "Later" : "To sprint"}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => props.onDelete(props.task.id)}
            className="rounded-lg border border-line bg-white/60 px-2 py-1.5 text-xs text-ink hover:bg-soft transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}


