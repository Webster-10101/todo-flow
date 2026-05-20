"use client";

import type { Task } from "@/src/lib/types";
import { formatClock } from "@/src/lib/time";
import { useMemo, useState } from "react";

function clampMinutes(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.round(n));
}

const URL_SPLIT = /(\bhttps?:\/\/[^\s]+)/g;
const URL_TEST = /^https?:\/\//;

function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_SPLIT);
  return (
    <>
      {parts.map((p, i) =>
        URL_TEST.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-ink underline underline-offset-2 hover:text-ink/80 break-all"
          >
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function TaskRow(props: {
  task: Task;
  tone?: { bg: string; accent: string };
  compact?: boolean;
  minutesOverride?: number;
  minutesReadOnly?: boolean;
  hasChildren?: boolean;
  endsAtMs?: number;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onEditNotes?: (id: string, notes: string) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleInSprint?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onRequestAddSubtask?: (parentId: string) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const totalMinutes = useMemo(
    () => clampMinutes(props.task.estimateMinutes + props.task.extraMinutes),
    [props.task.estimateMinutes, props.task.extraMinutes],
  );

  const isBreak = props.task.kind === "break";
  const muted = props.task.status === "done";
  const isContainerParent = Boolean(props.hasChildren);
  const showAddSubtask = Boolean(
    props.onRequestAddSubtask && props.task.parentId === null && props.task.kind === "task",
  );

  return (
    <div
      className={[
        "group w-full min-w-0 rounded-xl border border-line bg-white/70 shadow-soft",
        props.compact ? "px-3 py-2" : "px-4 py-3",
        muted ? "opacity-60" : "",
      ].join(" ")}
      style={props.tone ? { backgroundColor: props.tone.bg } : undefined}
    >
      <div className="flex items-start gap-3">
        <div
          className={["mt-0.5 rounded-full", props.compact ? "h-5 w-[6px]" : "h-6 w-[8px]"].join(" ")}
          style={props.tone ? { backgroundColor: props.tone.accent } : undefined}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={() => {
            if (isContainerParent) return;
            props.onToggleDone(props.task.id);
          }}
          disabled={isContainerParent}
          title={
            isContainerParent
              ? "Status derived from subtasks — tick the subtasks instead"
              : undefined
          }
          className={[
            "mt-0.5 rounded-full border border-line flex items-center justify-center",
            props.compact ? "h-5 w-5" : "h-6 w-6",
            isContainerParent
              ? "bg-soft cursor-not-allowed"
              : "bg-white hover:bg-soft transition-colors",
            "shrink-0",
          ].join(" ")}
          aria-label={
            isContainerParent
              ? "Status derived from subtasks"
              : props.task.status === "done"
                ? "Mark as not done"
                : "Mark as done"
          }
        >
          {props.task.status === "done" ? (
            <span className="text-xs text-ink">✓</span>
          ) : isContainerParent ? (
            <span className="text-[10px] text-muted">·</span>
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
            autoFocus={props.task.title === ""}
            className={[
              "w-full bg-transparent outline-none",
              props.compact ? "text-[14px]" : "text-[15px]",
              muted ? "line-through decoration-[rgba(20,20,20,0.25)]" : "",
            ].join(" ")}
          />
          {!props.compact ? (
            <div className="mt-0.5 text-xs text-muted">
              {isBreak ? "Break" : "Task"}
            </div>
          ) : null}

          {props.onEditNotes && !isBreak ? (
            <div className={["min-w-0", props.compact ? "mt-1" : "mt-1.5"].join(" ")}>
              {editingNotes ? (
                <textarea
                  value={props.task.notes}
                  onChange={(e) => props.onEditNotes?.(props.task.id, e.target.value)}
                  onBlur={() => setEditingNotes(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingNotes(false);
                    }
                  }}
                  placeholder="Notes (URLs, context…)"
                  rows={2}
                  autoFocus
                  className={[
                    "w-full resize-y rounded-lg border border-line bg-white/80 px-2 py-1.5",
                    "outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]",
                    props.compact ? "text-xs" : "text-sm",
                  ].join(" ")}
                />
              ) : props.task.notes ? (
                <button
                  type="button"
                  onClick={() => setEditingNotes(true)}
                  className={[
                    "w-full text-left text-muted hover:text-ink transition-colors",
                    "whitespace-pre-wrap break-words",
                    props.compact ? "text-xs" : "text-sm",
                  ].join(" ")}
                  aria-label="Edit notes"
                >
                  <Linkify text={props.task.notes} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingNotes(true)}
                  className="text-xs text-muted hover:text-ink transition-colors"
                >
                  + Note
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className={[props.compact ? "mt-2" : "mt-3", "flex flex-wrap items-center gap-2"].join(" ")}>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={props.minutesOverride ?? totalMinutes}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              if (props.minutesReadOnly) return;
              const val = e.target.valueAsNumber;
              if (isNaN(val)) return;
              props.onEditMinutes(props.task.id, clampMinutes(val));
            }}
            disabled={props.minutesReadOnly}
            className={[
              "rounded-lg border border-line bg-white/70 px-2 py-1.5 text-xs text-ink outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]",
              props.compact ? "w-[72px]" : "w-[88px]",
            ].join(" ")}
            aria-label="Estimated minutes"
          />
          <span className="text-xs text-muted">min</span>
          {props.endsAtMs != null ? (
            <span className="text-xs text-muted tabular-nums">
              ends {formatClock(new Date(props.endsAtMs))}
            </span>
          ) : null}
        </div>

        <div className="sm:ml-auto flex flex-wrap items-center gap-2 min-w-0">
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


