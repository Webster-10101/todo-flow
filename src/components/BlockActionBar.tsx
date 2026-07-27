"use client";

import type { Task } from "@/src/lib/types";
import { formatClock } from "@/src/lib/time";

// Touch replacement for the tiny inline icons on canvas blocks: tap a block
// to select it, act on it from here. Rendered inside the mobile dock so it
// stacks cleanly above the add-task bar.

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function CheckIcon() {
  return (
    <svg {...iconProps} strokeWidth={2}>
      <path d="M3 8.5L6.5 12 13 4.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
      <path d="M10.5 5V3.5A1 1 0 0 0 9.5 2.5h-6A1 1 0 0 0 2.5 3.5v6A1 1 0 0 0 3.5 10.5H5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-9" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 3v9M4.5 8.5L8 12l3.5-3.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg {...iconProps} fill="currentColor" stroke="none">
      <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1l-7.3-4.8A.6.6 0 0 0 5 3.2z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg {...iconProps}>
      <path d="M11 2.5l2.5 2.5M2.5 13.5l.7-2.8 8-8 2.1 2.1-8 8-2.8.7z" />
    </svg>
  );
}

function ActionButton(props: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      className={[
        "flex h-12 min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors",
        props.disabled
          ? "text-muted/50 cursor-not-allowed"
          : props.danger
            ? "text-rose-700 active:bg-rose-50"
            : "text-ink/80 active:bg-soft",
      ].join(" ")}
    >
      {props.children}
      <span className="text-[10px] leading-none">{props.label}</span>
    </button>
  );
}

export function BlockActionBar(props: {
  task: Task;
  minutes: number;
  endsAtMs: number | null;
  minutesReadOnly: boolean;
  childCount: number;
  onClose: () => void;
  onToggleDone: (id: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToLater: (id: string) => void;
  onOpenSubtasks: (id: string, anchor: DOMRect) => void;
  onRename: (id: string) => void;
  onStart: (id: string) => void;
}) {
  const t = props.task;
  const isBreak = t.kind === "break";
  const done = t.status === "done";
  const hasKids = props.childCount > 0;

  return (
    <div className="mx-2 mb-2 rounded-2xl border border-line bg-white/95 shadow-soft backdrop-blur px-2 pt-2 pb-1">
      <div className="flex items-center gap-2 px-2">
        <span
          className={[
            "min-w-0 flex-1 truncate text-sm font-medium text-ink",
            done ? "line-through decoration-[rgba(20,20,20,0.25)] opacity-60" : "",
          ].join(" ")}
        >
          {t.title || (isBreak ? "Break" : "Untitled task")}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {props.minutes} min
          {props.endsAtMs != null ? ` · ends ${formatClock(new Date(props.endsAtMs))}` : ""}
        </span>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close"
          className="relative -m-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-soft"
        >
          <XIcon />
        </button>
      </div>
      <div className="mt-1 flex items-stretch gap-1">
        {!done ? (
          <ActionButton label="Start" onClick={() => props.onStart(t.id)}>
            <PlayIcon />
          </ActionButton>
        ) : null}
        <ActionButton
          label={done ? "Undo" : "Done"}
          onClick={() => props.onToggleDone(t.id)}
          disabled={hasKids}
        >
          <CheckIcon />
        </ActionButton>
        <ActionButton label="Rename" onClick={() => props.onRename(t.id)}>
          <PencilIcon />
        </ActionButton>
        {!props.minutesReadOnly ? (
          <>
            <ActionButton
              label="−5 min"
              onClick={() => props.onEditMinutes(t.id, Math.max(5, props.minutes - 5))}
            >
              <span className="text-sm font-medium leading-none">−5</span>
            </ActionButton>
            <ActionButton
              label="+5 min"
              onClick={() => props.onEditMinutes(t.id, props.minutes + 5)}
            >
              <span className="text-sm font-medium leading-none">+5</span>
            </ActionButton>
          </>
        ) : null}
        {!isBreak ? (
          <ActionButton
            label={hasKids ? `Subs (${props.childCount})` : "Subtask"}
            onClick={(e) => {
              // Anchor the subtasks popover to this button's on-screen rect.
              props.onOpenSubtasks(t.id, e.currentTarget.getBoundingClientRect());
            }}
          >
            <PlusIcon />
          </ActionButton>
        ) : null}
        {!isBreak ? (
          <ActionButton label="Duplicate" onClick={() => props.onDuplicate(t.id)}>
            <CopyIcon />
          </ActionButton>
        ) : null}
        {!isBreak ? (
          <ActionButton label="Later" onClick={() => props.onToLater(t.id)}>
            <ArrowDownIcon />
          </ActionButton>
        ) : null}
        <ActionButton label="Delete" onClick={() => props.onDelete(t.id)} danger>
          <TrashIcon />
        </ActionButton>
      </div>
    </div>
  );
}
