"use client";

import type { Task } from "@/src/lib/types";
import type { SprintSchedule } from "@/src/lib/time";
import { formatClock, formatMinutesOfDay } from "@/src/lib/time";
import { googleCalendarUrl } from "@/src/lib/calendar";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type Modifier,
} from "@dnd-kit/core";
import {
  CANVAS_END_MIN,
  CANVAS_START_MIN,
  DAY_END_MIN,
  DAY_START_MIN,
  MIN_BLOCK_HEIGHT_PX,
  SCHEDULE_SLOT_MIN,
} from "@/src/lib/layout";
import { cascade, type CascadeBlock } from "@/src/lib/cascade";
import { paletteForId } from "@/src/lib/palette";
import { haptic } from "@/src/lib/platform";
import { useEffect, useMemo, useRef, useState } from "react";

// Small inline icons sized for the title row. Stroke-based so they pick up
// `currentColor` and inherit hover states from the button.
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

function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 3v10M3 8h10" />
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

function XIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps} strokeWidth={2}>
      <path d="M3 8.5L6.5 12 13 4.5" />
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

function CalendarIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" />
    </svg>
  );
}

// after:-inset-2 expands the tap target to ~36px without changing the visual
// size — the icons sit too close together for the full 44px without overlap.
const iconBtnClass =
  "relative shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:text-ink hover:bg-ink/5 transition-colors after:absolute after:-inset-2 after:content-['']";
// Desktop-only variant: on touch these actions live in the BlockActionBar
// (tap a block to select it), so the tiny inline icons stay hidden.
const iconBtnDesktopClass = `${iconBtnClass} hidden md:inline-flex`;


// Touch devices get a two-tap create (ghost block + confirm) instead of
// instant create-on-tap, so scroll/mis-taps don't spawn empty tasks.
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarse(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  return coarse;
}

function snapToCanvas(min: number) {
  const snapped = Math.round(min / SCHEDULE_SLOT_MIN) * SCHEDULE_SLOT_MIN;
  return Math.max(
    DAY_START_MIN,
    Math.min(DAY_END_MIN - SCHEDULE_SLOT_MIN, snapped),
  );
}

// The slot the pointer is INSIDE (floor, not round). Used for create + the
// hover ghost so the preview always contains the cursor — round-to-nearest
// can snap upward, leaving the ghost hanging above the pointer.
function slotContaining(min: number) {
  const floored = Math.floor(min / SCHEDULE_SLOT_MIN) * SCHEDULE_SLOT_MIN;
  return Math.max(
    DAY_START_MIN,
    Math.min(DAY_END_MIN - SCHEDULE_SLOT_MIN, floored),
  );
}

function TaskBlock(props: {
  task: Task;
  endsAtMs: number;
  minutes: number;
  pxPerMinute: number;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenSubtasks?: (parentId: string, anchor: DOMRect) => void;
  onDuplicate?: (id: string) => void;
  onStart?: (id: string) => void;
  hasChildren: boolean;
  childCount?: number;
  minutesReadOnly?: boolean;
  minutesOverride?: number;
  maxMinutes?: number;
  // Live cascade preview: where this block would sit if the current drag or
  // resize committed right now. Rendering only — the stored time is untouched
  // until the gesture ends.
  startMinOverride?: number;
  // Fires with the snapped minutes proposal as a resize drag crosses 15-min
  // boundaries (null on release) so the canvas can preview the cascade.
  onResizePreview?: (id: string, minutes: number | null) => void;
  canvasStartMin: number;
  selected?: boolean;
  // shiftKey lets the canvas route shift-clicks to multi-select.
  onSelect?: (shiftKey: boolean) => void;
  renameRequested?: boolean;
  onRenameHandled?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.task.id,
  });

  // Resize state — local delta during a pointer drag; commits to onEditMinutes
  // on release. Snap happens on commit, not during drag, for smooth preview.
  const [resizeDelta, setResizeDelta] = useState(0);
  const resizeRef = useRef({ startY: 0, startMin: 0, captured: false });

  // Local draft for the minutes input. Without this, every keystroke dispatches
  // to the reducer — typing "30" shrinks the block to 3 min mid-type and the
  // meta row collapses before the "0" lands. Commit on Enter or blur instead.
  const displayMinutes = props.minutesOverride ?? props.minutes;
  const [minutesDraft, setMinutesDraft] = useState<string>(String(displayMinutes));
  const minutesFocusedRef = useRef(false);
  useEffect(() => {
    if (minutesFocusedRef.current) return;
    setMinutesDraft(String(displayMinutes));
  }, [displayMinutes]);
  const commitMinutesDraft = () => {
    if (props.minutesReadOnly) return;
    const parsed = parseInt(minutesDraft, 10);
    if (isNaN(parsed)) {
      setMinutesDraft(String(displayMinutes));
      return;
    }
    const clamped = Math.max(1, parsed);
    if (clamped !== displayMinutes) {
      props.onEditMinutes(props.task.id, clamped);
    } else {
      setMinutesDraft(String(displayMinutes));
    }
  };

  // Title editing is opt-in. The title used to be an always-live <input> that
  // swallowed pointerdown so it wouldn't start a drag — which meant grabbing a
  // block by its title (the obvious place to grab it) only ever put a cursor in
  // the text. Now it renders as plain text inside the draggable surface and you
  // double-click to edit. Freshly created blocks still open straight into edit.
  const [editingTitle, setEditingTitle] = useState(props.task.title === "");
  // Snapshot for Escape-to-revert. Edits still dispatch on every keystroke (as
  // before), so nothing is lost if the block unmounts mid-edit.
  const titleBeforeEditRef = useRef(props.task.title);
  const startEditingTitle = () => {
    titleBeforeEditRef.current = props.task.title;
    setEditingTitle(true);
  };

  // Touch has no double-click — the BlockActionBar's Rename button asks for it.
  const { renameRequested, onRenameHandled } = props;
  useEffect(() => {
    if (!renameRequested) return;
    startEditingTitle();
    onRenameHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameRequested, onRenameHandled]);

  const startMin =
    props.startMinOverride ??
    props.task.scheduledStartMinutes ??
    props.canvasStartMin;
  const topPx = (startMin - props.canvasStartMin) * props.pxPerMinute;
  const baseHeightPx = Math.max(MIN_BLOCK_HEIGHT_PX, props.minutes * props.pxPerMinute);
  const heightPx = Math.max(
    SCHEDULE_SLOT_MIN * props.pxPerMinute,
    baseHeightPx + resizeDelta,
  );

  const isBreak = props.task.kind === "break";
  const muted = props.task.status === "done";
  const palette = isBreak ? null : paletteForId(props.task.id);
  // Title-only when block is too short for two rows. ~36px is the comfortable
  // threshold for title + meta with the current font sizes.
  const showMetaRow = heightPx >= 36;
  const showTitleRow = heightPx >= 22;
  const showResizeHandle = !props.minutesReadOnly && heightPx >= 24;

  // Stop pointer events on inputs/buttons so they don't activate drag.
  const swallow = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  // Snapped minutes a resize at pointer offset `dy` would commit.
  const snapResize = (dy: number) => {
    const proposed = resizeRef.current.startMin + dy / props.pxPerMinute;
    const snapped = Math.max(
      SCHEDULE_SLOT_MIN,
      Math.round(proposed / SCHEDULE_SLOT_MIN) * SCHEDULE_SLOT_MIN,
    );
    return props.maxMinutes != null
      ? Math.min(snapped, props.maxMinutes)
      : snapped;
  };
  const lastResizePreviewRef = useRef<number | null>(null);

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = {
      startY: e.clientY,
      startMin: props.minutes,
      captured: true,
    };
    lastResizePreviewRef.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current.captured) return;
    setResizeDelta(e.clientY - resizeRef.current.startY);
    // Recompute the cascade preview only when the snapped proposal crosses a
    // 15-min boundary — not per pixel.
    const snapped = snapResize(e.clientY - resizeRef.current.startY);
    if (snapped !== lastResizePreviewRef.current) {
      lastResizePreviewRef.current = snapped;
      props.onResizePreview?.(props.task.id, snapped);
    }
  };

  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current.captured) return;
    const snapped = snapResize(e.clientY - resizeRef.current.startY);
    resizeRef.current.captured = false;
    setResizeDelta(0);
    lastResizePreviewRef.current = null;
    props.onResizePreview?.(props.task.id, null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* element may have unmounted */
    }
    if (snapped !== resizeRef.current.startMin) {
      props.onEditMinutes(props.task.id, snapped);
    }
  };

  return (
    <div
      ref={setNodeRef}
      className="absolute inset-x-1"
      style={{
        top: topPx,
        height: heightPx,
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 30 : props.selected ? 20 : 1,
        opacity: isDragging ? 0.92 : 1,
        // Settle into place on drop / reflow. Off while dragging or resizing
        // so the block tracks the finger without lag.
        transition:
          isDragging || resizeRef.current.captured
            ? undefined
            : "top 140ms cubic-bezier(0.2, 0.9, 0.3, 1.15), height 140ms cubic-bezier(0.2, 0.9, 0.3, 1.15)",
      }}
    >
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => props.onSelect?.(e.shiftKey)}
        className={[
          "relative h-full w-full overflow-hidden rounded-lg border shadow-soft flex flex-col",
          isBreak ? "border-emerald-200/80 bg-emerald-50/90" : "border-line/80",
          muted ? "opacity-55 saturate-50 animate-block-settle" : "",
          props.selected ? "ring-2 ring-ink/30" : "",
          "pl-3 pr-2 py-1.5",
        ].join(" ")}
        style={{
          cursor: isDragging ? "grabbing" : "grab",
          // "manipulation" keeps page scroll working from a touch that starts
          // on a block; the TouchSensor's 200ms long-press still claims the
          // gesture (and preventDefaults) once a drag activates.
          touchAction: "manipulation",
          background: palette ? palette.bg : undefined,
        }}
        aria-label={`${props.task.title || "Untitled task"} — drag to reschedule`}
      >
        {palette ? (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 w-1 rounded-l-lg"
            style={{ background: palette.accent }}
          />
        ) : null}
        {showTitleRow ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (props.hasChildren) return;
              props.onToggleDone(props.task.id);
            }}
            onPointerDown={swallow}
            disabled={props.hasChildren}
            className={[
              "relative h-[18px] w-[18px] shrink-0 rounded-full border flex items-center justify-center transition-colors after:absolute after:-inset-3 after:content-['']",
              props.hasChildren
                ? "border-line/70 bg-white/60 cursor-not-allowed text-muted"
                : muted
                  ? "border-ink/60 bg-ink/80 text-white cursor-pointer"
                  : "border-line/80 bg-white/80 hover:border-ink/40 cursor-pointer",
            ].join(" ")}
            aria-label={
              props.hasChildren
                ? "Status from subtasks"
                : muted
                  ? "Mark not done"
                  : "Mark done"
            }
          >
            {muted ? <CheckIcon /> : props.hasChildren ? <span className="text-[10px] leading-none">·</span> : null}
          </button>
          {editingTitle ? (
            <input
              value={props.task.title}
              onChange={(e) => props.onEditTitle(props.task.id, e.target.value)}
              onPointerDown={swallow}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  props.onEditTitle(props.task.id, titleBeforeEditRef.current);
                  e.currentTarget.blur();
                }
              }}
              onFocus={(e) => e.currentTarget.select()}
              placeholder={isBreak ? "Break" : "Task"}
              aria-label="Task title"
              autoFocus
              className={[
                "flex-1 min-w-0 bg-transparent outline-none truncate ml-0.5",
                "text-[13px] sm:text-sm font-medium tracking-tight text-ink/90",
                muted ? "line-through decoration-[rgba(20,20,20,0.25)]" : "",
              ].join(" ")}
            />
          ) : (
            // No pointer swallow here — that's the whole point: a drag can
            // start on the title like anywhere else on the block.
            <div
              onDoubleClick={startEditingTitle}
              title="Double-click to rename"
              className={[
                "flex-1 min-w-0 truncate ml-0.5 select-none",
                "text-[13px] sm:text-sm font-medium tracking-tight",
                props.task.title ? "text-ink/90" : "text-muted/70",
                muted ? "line-through decoration-[rgba(20,20,20,0.25)]" : "",
              ].join(" ")}
            >
              {props.task.title || (isBreak ? "Break" : "Task")}
            </div>
          )}
          {props.onStart && props.task.status === "queued" ? (
            <button
              type="button"
              onClick={() => props.onStart?.(props.task.id)}
              onPointerDown={swallow}
              className={[
                iconBtnDesktopClass,
                "text-teal-700 hover:text-teal-800 hover:bg-teal-50",
              ].join(" ")}
              aria-label="Start this task now"
              title="Start now"
            >
              <PlayIcon />
            </button>
          ) : null}
          {props.onOpenSubtasks && !isBreak ? (
            <button
              type="button"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                props.onOpenSubtasks?.(props.task.id, rect);
              }}
              onPointerDown={swallow}
              className={[
                iconBtnDesktopClass,
                props.childCount && props.childCount > 0 ? "w-auto px-1 gap-0.5" : "",
              ].join(" ")}
              aria-label={
                props.childCount && props.childCount > 0
                  ? `Subtasks (${props.childCount})`
                  : "Add subtask"
              }
              title={
                props.childCount && props.childCount > 0
                  ? `${props.childCount} subtask${props.childCount === 1 ? "" : "s"}`
                  : "Add subtask"
              }
            >
              <PlusIcon />
              {props.childCount && props.childCount > 0 ? (
                <span className="rounded-full bg-ink/10 px-1 text-[9px] font-medium tabular-nums leading-none py-px">
                  {props.childCount}
                </span>
              ) : null}
            </button>
          ) : null}
          {!isBreak ? (
            <a
              href={googleCalendarUrl({
                title: props.task.title,
                notes: props.task.notes,
                startMs: props.endsAtMs - props.minutes * 60_000,
                endMs: props.endsAtMs,
              })}
              target="_blank"
              rel="noopener noreferrer"
              onClick={swallow}
              onPointerDown={swallow}
              className={iconBtnDesktopClass}
              aria-label="Add to Google Calendar"
              title="Add to Google Calendar"
            >
              <CalendarIcon />
            </a>
          ) : null}
          {props.onDuplicate && !isBreak ? (
            <button
              type="button"
              onClick={() => props.onDuplicate?.(props.task.id)}
              onPointerDown={swallow}
              className={iconBtnDesktopClass}
              aria-label="Duplicate task"
              title="Duplicate"
            >
              <CopyIcon />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => props.onDelete(props.task.id)}
            onPointerDown={swallow}
            className={[iconBtnDesktopClass, "hover:text-rose-700 hover:bg-rose-50"].join(" ")}
            aria-label="Delete task"
            title="Delete"
          >
            <XIcon />
          </button>
        </div>
        ) : null}
        {showMetaRow ? (
          <div className="mt-1 ml-[18px] flex items-center gap-1.5 text-[11px] text-muted">
            <input
              type="number"
              min={1}
              value={minutesDraft}
              onFocus={(e) => {
                minutesFocusedRef.current = true;
                e.currentTarget.select();
              }}
              onChange={(e) => {
                if (props.minutesReadOnly) return;
                setMinutesDraft(e.target.value);
              }}
              onBlur={() => {
                minutesFocusedRef.current = false;
                commitMinutesDraft();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setMinutesDraft(String(displayMinutes));
                  e.currentTarget.blur();
                }
              }}
              onPointerDown={swallow}
              disabled={props.minutesReadOnly}
              className="w-9 bg-transparent outline-none border-b border-line/40 tabular-nums text-right focus:border-ink/50 transition-colors"
              aria-label="Minutes"
            />
            <span className="text-muted/80">min</span>
            <span className="ml-auto tabular-nums text-muted/80">
              ends {formatClock(new Date(props.endsAtMs))}
            </span>
          </div>
        ) : null}
        {showResizeHandle ? (
          <div
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            className="absolute left-3 right-3 bottom-0 h-2.5 cursor-ns-resize group/handle after:absolute after:inset-x-0 after:-top-3 after:bottom-0 after:content-['']"
            style={{ touchAction: "none" }}
            aria-label="Resize task duration"
          >
            <div className="absolute inset-x-0 bottom-1 mx-auto h-[3px] w-10 rounded-full bg-ink/25 md:bg-ink/15 md:group-hover/handle:bg-ink/45 transition-colors" />
          </div>
        ) : null}
      </div>
      {/* Chunky finger-sized resize handle — shown when the block is selected
          on touch. Lives outside the overflow-hidden card so it can hang below
          the block edge. */}
      {props.selected && !props.minutesReadOnly ? (
        <div
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          className="md:hidden absolute left-1/2 -translate-x-1/2 -bottom-4 z-40 flex h-8 w-24 cursor-ns-resize items-center justify-center rounded-full border border-line bg-white shadow-soft"
          style={{ touchAction: "none" }}
          aria-label="Resize task duration"
        >
          <div className="h-1 w-10 rounded-full bg-ink/25" />
        </div>
      ) : null}
    </div>
  );
}

export function TaskCanvas(props: {
  tasks: Task[];
  schedule: SprintSchedule;
  pxPerMinute: number;
  now: Date;
  // Duration a click-to-create block gets — settings.defaultTaskMinutes, so the
  // hover ghost previews the same length the task will actually be.
  createMinutes: number;
  onSetTaskTime: (id: string, minutes: number) => void;
  onCreateTaskAtTime: (scheduledStartMinutes: number) => void;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onEditNotes?: (id: string, notes: string) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleInSprint?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onStart?: (id: string) => void;
  onOpenSubtasks?: (parentId: string, anchor: DOMRect) => void;
  childCountById?: Record<string, number>;
  minutesOverrideById?: Record<string, number>;
  minutesReadOnlyById?: Record<string, boolean>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  // Shift-click group: dragging any member moves the whole set by one delta,
  // preserving relative gaps (MOVE_TASK_GROUP in the reducer).
  multiSelectedIds?: string[];
  onToggleMultiSelect?: (id: string) => void;
  onMoveTaskGroup?: (ids: string[], deltaMinutes: number) => void;
  // Set by the touch action bar's Rename button — opens that block's title
  // for editing, since touch has no double-click.
  renamingId?: string | null;
  onRenameHandled?: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const coarsePointer = useCoarsePointer();
  // Pending two-tap create on touch: snapped start minute of the ghost block.
  const [pendingCreate, setPendingCreate] = useState<number | null>(null);
  // Mouse-hover preview: snapped start minute of the block a click would
  // create. Fine-pointer only; cleared while dragging or over a block.
  const [hoverStart, setHoverStart] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Live bounce-down preview during a drag or resize: id -> the start each
  // displaced block would settle at if the gesture committed now. Rendering
  // only — stored times don't change until the reducer commit on release,
  // which runs the same cascade and therefore lands blocks exactly where the
  // preview showed them.
  const [previewMoves, setPreviewMoves] = useState<Map<string, number> | null>(
    null,
  );
  const lastDragPreviewRef = useRef<number | null>(null);

  // Displayed window: 8am–8pm by default. Trimmed at the top when the morning
  // is empty and behind us; expanded in either direction when scheduled blocks
  // fall outside it (the day is logically 00:00–24:00). Computed from
  // COMMITTED positions only — the window stays frozen during a drag so the
  // coordinate space can't shift under the pointer; it grows on drop.
  const nowMinForStart = props.now.getHours() * 60 + props.now.getMinutes();
  const blockExtent = useMemo(() => {
    const minutesById = new Map(
      props.schedule.rows.map((r) => [r.taskId, r.minutes]),
    );
    let earliest = Number.POSITIVE_INFINITY;
    let latestEnd = Number.NEGATIVE_INFINITY;
    for (const t of props.tasks) {
      if (t.parentId !== null) continue;
      if (t.scheduledStartMinutes == null) continue;
      earliest = Math.min(earliest, t.scheduledStartMinutes);
      latestEnd = Math.max(
        latestEnd,
        t.scheduledStartMinutes + (minutesById.get(t.id) ?? SCHEDULE_SLOT_MIN),
      );
    }
    return { earliest, latestEnd };
  }, [props.tasks, props.schedule.rows]);
  const displayStartMin = useMemo(() => {
    const nowFloor = Math.floor((nowMinForStart - 60) / 60) * 60;
    const defaultStart = Math.max(CANVAS_START_MIN, nowFloor);
    const earliestFloor =
      blockExtent.earliest === Number.POSITIVE_INFINITY
        ? defaultStart
        : Math.floor(blockExtent.earliest / 60) * 60;
    return Math.max(DAY_START_MIN, Math.min(defaultStart, earliestFloor));
  }, [nowMinForStart, blockExtent.earliest]);
  const displayEndMin = useMemo(() => {
    const latestCeil =
      blockExtent.latestEnd === Number.NEGATIVE_INFINITY
        ? CANVAS_END_MIN
        : Math.ceil(blockExtent.latestEnd / 60) * 60;
    return Math.min(DAY_END_MIN, Math.max(CANVAS_END_MIN, latestCeil));
  }, [blockExtent.latestEnd]);

  const canvasHeightPx = (displayEndMin - displayStartMin) * props.pxPerMinute;
  const slotPx = SCHEDULE_SLOT_MIN * props.pxPerMinute; // 15-min line

  // Latch the drag transform to the 15-min grid so blocks visually snap as you
  // move them, instead of free-floating to pixel positions. Each new slot
  // fires a light haptic tick (native only) — the drag feels like a ratchet.
  const lastSnapSlotRef = useRef<number | null>(null);
  const snapToSlotModifier = useMemo<Modifier>(
    () =>
      ({ transform, active }) => {
        const slot = Math.round(transform.y / slotPx);
        if (active && slot !== lastSnapSlotRef.current) {
          if (lastSnapSlotRef.current !== null) void haptic("light");
          lastSnapSlotRef.current = slot;
        }
        if (!active) lastSnapSlotRef.current = null;
        return {
          ...transform,
          y: slot * slotPx,
        };
      },
    [slotPx],
  );
  const halfHourPx = slotPx * 2; // 30-min line
  const hourPx = slotPx * 4; // 60-min line
  const gridBackground = useMemo(
    () => ({
      backgroundImage: [
        // Hour lines — strongest. Listed first so they sit on top.
        `repeating-linear-gradient(to bottom, transparent 0 ${hourPx - 1}px, rgba(20,20,20,0.18) ${hourPx - 1}px ${hourPx}px)`,
        // 30-min lines — medium.
        `repeating-linear-gradient(to bottom, transparent 0 ${halfHourPx - 1}px, rgba(20,20,20,0.10) ${halfHourPx - 1}px ${halfHourPx}px)`,
        // 15-min lines — faint.
        `repeating-linear-gradient(to bottom, transparent 0 ${slotPx - 1}px, rgba(20,20,20,0.05) ${slotPx - 1}px ${slotPx}px)`,
      ].join(", "),
    }),
    [slotPx, halfHourPx, hourPx],
  );

  const scheduleById = new Map(props.schedule.rows.map((r) => [r.taskId, r]));
  const topLevel = useMemo(
    () =>
      props.tasks
        .filter((t) => t.parentId === null)
        .sort((a, b) => {
          const aStart = a.scheduledStartMinutes ?? Number.POSITIVE_INFINITY;
          const bStart = b.scheduledStartMinutes ?? Number.POSITIVE_INFINITY;
          return aStart - bStart;
        }),
    [props.tasks],
  );

  // Shift-click multi-selection, as a set for the drag path.
  const multiSet = useMemo(
    () => new Set(props.multiSelectedIds ?? []),
    [props.multiSelectedIds],
  );
  // The blocks a drag of `activeId` moves as one unit — null means a plain
  // single-block drag. Members mirror the reducer's MOVE_TASK_GROUP filter.
  const groupFor = (activeId: string) => {
    if (!multiSet.has(activeId)) return null;
    const members = topLevel.filter(
      (t) =>
        multiSet.has(t.id) &&
        t.inSprint &&
        t.scheduledStartMinutes != null &&
        t.status !== "done" &&
        t.status !== "active",
    );
    return members.length > 1 && members.some((m) => m.id === activeId)
      ? members
      : null;
  };
  const durationOf = (id: string) =>
    scheduleById.get(id)?.minutes ?? SCHEDULE_SLOT_MIN;
  // Slot-snapped delta for a group drag, clamped so the WHOLE group stays
  // inside the day — same maths the reducer re-runs on commit.
  const groupDragDelta = (anchor: Task, members: Task[], dyMin: number) => {
    const anchorStart = anchor.scheduledStartMinutes as number;
    const desired = snapToCanvas(anchorStart + dyMin);
    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;
    for (const m of members) {
      const s = m.scheduledStartMinutes as number;
      minStart = Math.min(minStart, s);
      maxEnd = Math.max(maxEnd, s + durationOf(m.id));
    }
    return Math.max(
      DAY_START_MIN - minStart,
      Math.min(desired - anchorStart, DAY_END_MIN - maxEnd),
    );
  };

  // Mirror of the reducer's cascadeTasks input-building, fed from the canvas's
  // own view of the day (schedule rows for durations). Same pure cascade, so
  // preview and commit agree by determinism.
  const computePreviewMoves = (
    placed: Array<{ id: string; start: number; end: number }>,
  ) => {
    const placedIds = new Set(placed.map((p) => p.id));
    const movable: CascadeBlock[] = [];
    const obstacles: Array<{ start: number; end: number }> = placed.map(
      (p) => ({ start: p.start, end: p.end }),
    );
    for (const t of topLevel) {
      if (placedIds.has(t.id) || t.scheduledStartMinutes == null) continue;
      if (!t.inSprint || t.status === "done") continue;
      const minutes = scheduleById.get(t.id)?.minutes ?? SCHEDULE_SLOT_MIN;
      if (t.status === "active") {
        // Pinned to where the timer actually is; flows around, never moves.
        const r = scheduleById.get(t.id);
        if (r) {
          const d = new Date(r.startMs);
          const s = d.getHours() * 60 + d.getMinutes();
          obstacles.push({ start: s, end: s + r.minutes });
        }
        continue;
      }
      movable.push({
        id: t.id,
        start: t.scheduledStartMinutes,
        duration: minutes,
        position: t.position,
        createdAt: t.createdAt,
      });
    }
    return cascade({ movable, obstacles }).moves;
  };

  const handleResizePreview = (id: string, minutes: number | null) => {
    if (minutes == null) {
      setPreviewMoves(null);
      return;
    }
    const task = topLevel.find((t) => t.id === id);
    if (!task || task.scheduledStartMinutes == null) return;
    setPreviewMoves(
      computePreviewMoves([
        {
          id,
          start: task.scheduledStartMinutes,
          end: task.scheduledStartMinutes + minutes,
        },
      ]),
    );
  };

  // Build gutter labels at every 15 min: hour labels bold, :15/:30/:45 faded.
  const gutterLabels: number[] = [];
  for (let m = displayStartMin; m <= displayEndMin; m += SCHEDULE_SLOT_MIN) {
    gutterLabels.push(m);
  }

  // Current time line — only visible if "now" falls inside the canvas window.
  const nowMin = props.now.getHours() * 60 + props.now.getMinutes();
  const nowInCanvas = nowMin >= displayStartMin && nowMin <= displayEndMin;
  const nowTopPx = (nowMin - displayStartMin) * props.pxPerMinute;
  const nowLabel = `${Math.floor(nowMin / 60).toString().padStart(2, "0")}:${(nowMin % 60).toString().padStart(2, "0")}`;

  // On first mount, scroll the page so the now-line sits ~80px from the top
  // of the viewport. Runs once; subsequent now-ticks don't re-scroll (would
  // yank the page every minute).
  const gridRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (!nowInCanvas) return;
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const targetY = rect.top + window.scrollY + nowTopPx - 80;
    window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
    didInitialScrollRef.current = true;
  }, [nowInCanvas, nowTopPx]);

  return (
    <DndContext
      sensors={sensors}
      // Scroll the page when a drag nears the viewport edge so blocks can
      // reach off-screen times on a tall mobile canvas.
      autoScroll={{ threshold: { x: 0, y: 0.15 } }}
      modifiers={[snapToSlotModifier]}
      onDragStart={(e) => {
        setPendingCreate(null);
        setHoverStart(null);
        setIsDragging(true);
        lastDragPreviewRef.current = null;
        // Dragging a group member keeps the multi-selection; anything else
        // collapses to a plain single selection.
        const id = String(e.active.id);
        if (!multiSet.has(id)) props.onSelect?.(id);
      }}
      onDragMove={(e) => {
        const task = topLevel.find((t) => t.id === String(e.active.id));
        if (!task || task.scheduledStartMinutes == null) return;
        const dyMin = e.delta.y / props.pxPerMinute;
        const group = groupFor(task.id);
        if (group) {
          const delta = groupDragDelta(task, group, dyMin);
          if (delta === lastDragPreviewRef.current) return;
          lastDragPreviewRef.current = delta;
          const placed = group.map((m) => {
            const start = (m.scheduledStartMinutes as number) + delta;
            return { id: m.id, start, end: start + durationOf(m.id) };
          });
          const moves = computePreviewMoves(placed);
          // Non-anchor members render at their proposed spots via override;
          // the anchor already tracks the pointer through its dnd transform.
          for (const p of placed) {
            if (p.id !== task.id) moves.set(p.id, p.start);
          }
          setPreviewMoves(moves);
          return;
        }
        const duration = durationOf(task.id);
        // Same maths as onDragEnd — recompute only when the snapped slot
        // changes, not per pointer event.
        const desired = Math.min(
          snapToCanvas(task.scheduledStartMinutes + dyMin),
          Math.max(DAY_START_MIN, DAY_END_MIN - duration),
        );
        if (desired === lastDragPreviewRef.current) return;
        lastDragPreviewRef.current = desired;
        setPreviewMoves(
          computePreviewMoves([
            { id: task.id, start: desired, end: desired + duration },
          ]),
        );
      }}
      onDragCancel={() => {
        setIsDragging(false);
        setPreviewMoves(null);
        lastDragPreviewRef.current = null;
      }}
      onDragEnd={(e) => {
        setIsDragging(false);
        setPreviewMoves(null);
        lastDragPreviewRef.current = null;
        const task = topLevel.find((t) => t.id === String(e.active.id));
        if (!task || task.scheduledStartMinutes == null) return;
        const dyMin = e.delta.y / props.pxPerMinute;
        const group = groupFor(task.id);
        if (group && props.onMoveTaskGroup) {
          const delta = groupDragDelta(task, group, dyMin);
          if (delta !== 0) {
            props.onMoveTaskGroup(
              group.map((m) => m.id),
              delta,
            );
          }
          return;
        }
        const duration = durationOf(task.id);
        const desired = Math.min(
          snapToCanvas(task.scheduledStartMinutes + dyMin),
          Math.max(DAY_START_MIN, DAY_END_MIN - duration),
        );
        // One dispatch — the reducer runs the same cascade the live preview
        // showed, so blocks settle exactly where the preview had them.
        if (desired !== task.scheduledStartMinutes) {
          props.onSetTaskTime(task.id, desired);
        }
      }}
    >
      <div className="flex">
        <div className="w-14 shrink-0 relative" style={{ height: canvasHeightPx }}>
          {gutterLabels.map((m) => {
            const isHour = m % 60 === 0;
            const h = Math.floor(m / 60);
            const min = m % 60;
            return (
              <div
                key={m}
                className={[
                  "absolute right-2 -translate-y-1/2 tabular-nums",
                  isHour
                    ? "text-[12px] font-medium text-ink"
                    : "text-[10px] text-muted/60",
                ].join(" ")}
                style={{ top: (m - displayStartMin) * props.pxPerMinute }}
              >
                {isHour ? `${h.toString().padStart(2, "0")}:00` : `:${min.toString().padStart(2, "0")}`}
              </div>
            );
          })}
        </div>
        <div
          ref={gridRef}
          className="relative flex-1 rounded-xl border border-line bg-white/40 cursor-copy"
          style={{ height: canvasHeightPx, ...gridBackground }}
          onClick={(e) => {
            // Only fire when the click landed on the canvas background, not a
            // task block or the now-line (which is pointer-events-none anyway).
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const yOffset = e.clientY - rect.top;
            const clickedMin = displayStartMin + yOffset / props.pxPerMinute;
            const snapped = slotContaining(clickedMin);
            props.onSelect?.(null);
            if (coarsePointer) {
              // Two-tap create on touch: first tap places/moves the ghost,
              // tapping the ghost confirms.
              setPendingCreate(snapped);
              return;
            }
            // Clear the hover ghost now — the new block lands under the
            // cursor and no further mousemove fires to clear it.
            setHoverStart(null);
            props.onCreateTaskAtTime(snapped);
          }}
          onMouseMove={(e) => {
            if (coarsePointer || isDragging) return;
            // Only preview over the bare canvas — moving onto a block (or any
            // other child) clears the ghost.
            if (e.target !== e.currentTarget) {
              setHoverStart(null);
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            const hoveredMin =
              displayStartMin + (e.clientY - rect.top) / props.pxPerMinute;
            setHoverStart(slotContaining(hoveredMin));
          }}
          onMouseLeave={() => setHoverStart(null)}
        >
          {/* Hover ghost — faint preview of the block a click would create.
              pointer-events-none is load-bearing: the canvas click handler
              only fires when the click lands on the canvas itself. */}
          {hoverStart != null && pendingCreate == null && !isDragging ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-lg border-2 border-dashed border-ink/15 bg-ink/[0.03] transition-[top] duration-100 ease-out"
              style={{
                top: (hoverStart - displayStartMin) * props.pxPerMinute,
                height:
                  Math.min(props.createMinutes, DAY_END_MIN - hoverStart) *
                  props.pxPerMinute,
              }}
            >
              <div className="absolute left-2 top-1 text-[11px] text-muted/70 tabular-nums">
                {formatMinutesOfDay(hoverStart)} · {props.createMinutes} min
              </div>
            </div>
          ) : null}
          {/* Ghost block — pending touch create awaiting confirmation */}
          {pendingCreate != null ? (
            <div
              className="absolute inset-x-1 z-20 rounded-lg border-2 border-dashed border-ink/30 bg-white/70 backdrop-blur-[2px] flex items-center justify-center"
              style={{
                top: (pendingCreate - displayStartMin) * props.pxPerMinute,
                height: props.createMinutes * props.pxPerMinute,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  props.onCreateTaskAtTime(pendingCreate);
                  setPendingCreate(null);
                }}
                className="rounded-full border border-line bg-white px-4 py-2 text-sm text-ink shadow-soft"
              >
                Add {props.createMinutes} min at {formatMinutesOfDay(pendingCreate)}
              </button>
              <button
                type="button"
                onClick={() => setPendingCreate(null)}
                aria-label="Cancel"
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted"
              >
                <XIcon />
              </button>
            </div>
          ) : null}
          {/* Now-line indicator */}
          {nowInCanvas ? (
            <div
              className="absolute left-0 right-0 pointer-events-none z-20"
              style={{ top: nowTopPx }}
            >
              <div className="absolute inset-x-0 h-px bg-rose-500/80" />
              <div
                className="absolute -left-1 h-2 w-2 -translate-y-1/2 rounded-full bg-rose-500 shadow-sm"
                aria-hidden
              />
              <div
                className="absolute -left-14 -translate-y-1/2 rounded bg-rose-500 px-1 py-px text-[10px] font-semibold text-white tabular-nums"
                style={{ top: 0 }}
                aria-label="Current time"
              >
                {nowLabel}
              </div>
            </div>
          ) : null}

          {topLevel.map((t) => {
            const row = scheduleById.get(t.id);
            if (!row) return null;
            // Growing into the next block pushes it (bounce-down cascade) —
            // midnight is the only resize cap.
            const myStart = t.scheduledStartMinutes ?? displayStartMin;
            const maxMinutes = DAY_END_MIN - myStart;
            return (
              <TaskBlock
                key={t.id}
                task={t}
                endsAtMs={row.endMs}
                minutes={row.minutes}
                pxPerMinute={props.pxPerMinute}
                onEditTitle={props.onEditTitle}
                onEditMinutes={props.onEditMinutes}
                onToggleDone={props.onToggleDone}
                onDelete={props.onDelete}
                onOpenSubtasks={props.onOpenSubtasks}
                onDuplicate={props.onDuplicate}
                onStart={props.onStart}
                hasChildren={Boolean(props.minutesReadOnlyById?.[t.id])}
                childCount={props.childCountById?.[t.id]}
                minutesReadOnly={props.minutesReadOnlyById?.[t.id]}
                minutesOverride={props.minutesOverrideById?.[t.id]}
                maxMinutes={maxMinutes}
                startMinOverride={previewMoves?.get(t.id)}
                onResizePreview={handleResizePreview}
                canvasStartMin={displayStartMin}
                selected={props.selectedId === t.id || multiSet.has(t.id)}
                onSelect={(shiftKey) =>
                  shiftKey && props.onToggleMultiSelect
                    ? props.onToggleMultiSelect(t.id)
                    : props.onSelect?.(t.id)
                }
                renameRequested={props.renamingId === t.id}
                onRenameHandled={props.onRenameHandled}
              />
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}
