"use client";

import type { Task } from "@/src/lib/types";
import type { SprintSchedule } from "@/src/lib/time";
import { formatClock } from "@/src/lib/time";
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
  MIN_BLOCK_HEIGHT_PX,
  SCHEDULE_SLOT_MIN,
} from "@/src/lib/layout";
import { paletteForId } from "@/src/lib/palette";
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

const iconBtnClass =
  "shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:text-ink hover:bg-ink/5 transition-colors";

function snapToCanvas(min: number) {
  const snapped = Math.round(min / SCHEDULE_SLOT_MIN) * SCHEDULE_SLOT_MIN;
  return Math.max(
    CANVAS_START_MIN,
    Math.min(CANVAS_END_MIN - SCHEDULE_SLOT_MIN, snapped),
  );
}

// Given a desired start and a duration, return the closest 15-min slot that
// doesn't overlap any of `others`. Searches outward from `desired` in slot
// increments, alternating below/above. Returns null if no slot found within
// the search window (caller treats null as "snap back to original").
function findNonOverlappingStart(args: {
  desired: number;
  duration: number;
  others: Array<{ start: number; end: number }>;
}): number | null {
  const { desired, duration, others } = args;
  const overlaps = (start: number) => {
    const end = start + duration;
    return others.some((o) => start < o.end && end > o.start);
  };
  if (!overlaps(desired)) return desired;
  const maxDeltaMin = 120; // search ±2 hours
  for (let d = SCHEDULE_SLOT_MIN; d <= maxDeltaMin; d += SCHEDULE_SLOT_MIN) {
    const below = snapToCanvas(desired + d);
    if (!overlaps(below)) return below;
    const above = snapToCanvas(desired - d);
    if (!overlaps(above)) return above;
  }
  return null;
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
  hasChildren: boolean;
  childCount?: number;
  minutesReadOnly?: boolean;
  minutesOverride?: number;
  maxMinutes?: number;
  canvasStartMin: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.task.id,
  });

  // Resize state — local delta during a pointer drag; commits to onEditMinutes
  // on release. Snap happens on commit, not during drag, for smooth preview.
  const [resizeDelta, setResizeDelta] = useState(0);
  const resizeRef = useRef({ startY: 0, startMin: 0, captured: false });

  const startMin = props.task.scheduledStartMinutes ?? props.canvasStartMin;
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
  const displayMinutes = props.minutesOverride ?? props.minutes;

  // Stop pointer events on inputs/buttons so they don't activate drag.
  const swallow = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = {
      startY: e.clientY,
      startMin: props.minutes,
      captured: true,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current.captured) return;
    setResizeDelta(e.clientY - resizeRef.current.startY);
  };

  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current.captured) return;
    const dy = e.clientY - resizeRef.current.startY;
    const dyMin = dy / props.pxPerMinute;
    const proposed = resizeRef.current.startMin + dyMin;
    let snapped = Math.max(
      SCHEDULE_SLOT_MIN,
      Math.round(proposed / SCHEDULE_SLOT_MIN) * SCHEDULE_SLOT_MIN,
    );
    if (props.maxMinutes != null) {
      snapped = Math.min(snapped, props.maxMinutes);
    }
    resizeRef.current.captured = false;
    setResizeDelta(0);
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
        zIndex: isDragging ? 30 : 1,
        opacity: isDragging ? 0.92 : 1,
      }}
    >
      <div
        {...attributes}
        {...listeners}
        className={[
          "relative h-full w-full overflow-hidden rounded-lg border shadow-soft flex flex-col",
          isBreak ? "border-emerald-200/80 bg-emerald-50/90" : "border-line/80",
          muted ? "opacity-55 saturate-50" : "",
          "pl-3 pr-2 py-1.5",
        ].join(" ")}
        style={{
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
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
              "h-[18px] w-[18px] shrink-0 rounded-full border flex items-center justify-center transition-colors",
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
          <input
            value={props.task.title}
            onChange={(e) => props.onEditTitle(props.task.id, e.target.value)}
            onPointerDown={swallow}
            placeholder={isBreak ? "Break" : "Task"}
            aria-label="Task title"
            autoFocus={props.task.title === ""}
            className={[
              "flex-1 min-w-0 bg-transparent outline-none truncate ml-0.5",
              "text-[13px] sm:text-sm font-medium tracking-tight text-ink/90",
              muted ? "line-through decoration-[rgba(20,20,20,0.25)]" : "",
            ].join(" ")}
          />
          {props.onOpenSubtasks && !isBreak ? (
            <button
              type="button"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                props.onOpenSubtasks?.(props.task.id, rect);
              }}
              onPointerDown={swallow}
              className={[
                iconBtnClass,
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
          {props.onDuplicate && !isBreak ? (
            <button
              type="button"
              onClick={() => props.onDuplicate?.(props.task.id)}
              onPointerDown={swallow}
              className={iconBtnClass}
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
            className={[iconBtnClass, "hover:text-rose-700 hover:bg-rose-50"].join(" ")}
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
              value={displayMinutes}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                if (props.minutesReadOnly) return;
                const v = e.target.valueAsNumber;
                if (isNaN(v)) return;
                props.onEditMinutes(
                  props.task.id,
                  Math.max(1, Math.round(v)),
                );
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
            className="absolute left-3 right-3 bottom-0 h-2.5 cursor-ns-resize group/handle"
            style={{ touchAction: "none" }}
            aria-label="Resize task duration"
          >
            <div className="absolute inset-x-0 bottom-1 mx-auto h-[3px] w-10 rounded-full bg-ink/15 group-hover/handle:bg-ink/45 transition-colors" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TaskCanvas(props: {
  tasks: Task[];
  schedule: SprintSchedule;
  pxPerMinute: number;
  now: Date;
  onSetTaskTime: (id: string, minutes: number) => void;
  onCreateTaskAtTime: (scheduledStartMinutes: number) => void;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onEditNotes?: (id: string, notes: string) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleInSprint?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onOpenSubtasks?: (parentId: string, anchor: DOMRect) => void;
  childCountById?: Record<string, number>;
  minutesOverrideById?: Record<string, number>;
  minutesReadOnlyById?: Record<string, boolean>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // Dynamic canvas start: trim the empty hours above "now". Start the visible
  // canvas at hour-floor(now - 60min), but pull earlier if any queued task is
  // scheduled before that. Clamps to the hard 8am floor.
  const nowMinForStart = props.now.getHours() * 60 + props.now.getMinutes();
  const earliestQueuedStart = useMemo(() => {
    let earliest = Number.POSITIVE_INFINITY;
    for (const t of props.tasks) {
      if (t.parentId !== null) continue;
      if (t.status === "done") continue;
      if (t.scheduledStartMinutes == null) continue;
      earliest = Math.min(earliest, t.scheduledStartMinutes);
    }
    return earliest;
  }, [props.tasks]);
  const effectiveStartMin = useMemo(() => {
    const nowFloor = Math.floor((nowMinForStart - 60) / 60) * 60;
    const earliestFloor =
      earliestQueuedStart === Number.POSITIVE_INFINITY
        ? nowFloor
        : Math.floor(earliestQueuedStart / 60) * 60;
    return Math.max(CANVAS_START_MIN, Math.min(nowFloor, earliestFloor));
  }, [nowMinForStart, earliestQueuedStart]);

  const canvasHeightPx = (CANVAS_END_MIN - effectiveStartMin) * props.pxPerMinute;
  const slotPx = SCHEDULE_SLOT_MIN * props.pxPerMinute; // 15-min line

  // Latch the drag transform to the 15-min grid so blocks visually snap as you
  // move them, instead of free-floating to pixel positions.
  const snapToSlotModifier = useMemo<Modifier>(
    () =>
      ({ transform }) => ({
        ...transform,
        y: Math.round(transform.y / slotPx) * slotPx,
      }),
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

  // Build gutter labels at every 15 min: hour labels bold, :15/:30/:45 faded.
  const gutterLabels: number[] = [];
  for (let m = effectiveStartMin; m <= CANVAS_END_MIN; m += SCHEDULE_SLOT_MIN) {
    gutterLabels.push(m);
  }

  // Current time line — only visible if "now" falls inside the canvas window.
  const nowMin = props.now.getHours() * 60 + props.now.getMinutes();
  const nowInCanvas = nowMin >= effectiveStartMin && nowMin <= CANVAS_END_MIN;
  const nowTopPx = (nowMin - effectiveStartMin) * props.pxPerMinute;
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
      autoScroll={false}
      modifiers={[snapToSlotModifier]}
      onDragEnd={(e) => {
        const task = topLevel.find((t) => t.id === String(e.active.id));
        if (!task || task.scheduledStartMinutes == null) return;
        const dyMin = e.delta.y / props.pxPerMinute;
        const desired = snapToCanvas(task.scheduledStartMinutes + dyMin);
        if (desired === task.scheduledStartMinutes) return;
        const row = scheduleById.get(task.id);
        const duration = row?.minutes ?? props.schedule.rows.find((r) => r.taskId === task.id)?.minutes ?? 15;
        const others = topLevel
          .filter((t) => t.id !== task.id && t.scheduledStartMinutes != null)
          .map((t) => {
            const r = scheduleById.get(t.id);
            const start = t.scheduledStartMinutes as number;
            const end = start + (r?.minutes ?? 15);
            return { start, end };
          });
        const placed = findNonOverlappingStart({
          desired,
          duration,
          others,
        });
        if (placed != null && placed !== task.scheduledStartMinutes) {
          props.onSetTaskTime(task.id, placed);
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
                style={{ top: (m - effectiveStartMin) * props.pxPerMinute }}
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
            const clickedMin = effectiveStartMin + yOffset / props.pxPerMinute;
            const snapped = snapToCanvas(clickedMin);
            props.onCreateTaskAtTime(snapped);
          }}
        >
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
            // Cap resize at the start of the next block below (if any).
            const myStart = t.scheduledStartMinutes ?? effectiveStartMin;
            const nextStart = topLevel
              .filter(
                (o) =>
                  o.id !== t.id &&
                  o.scheduledStartMinutes != null &&
                  (o.scheduledStartMinutes as number) >= myStart + row.minutes,
              )
              .reduce<number | null>((acc, o) => {
                const s = o.scheduledStartMinutes as number;
                return acc == null ? s : Math.min(acc, s);
              }, null);
            const maxByNext = nextStart != null ? nextStart - myStart : null;
            const maxByCanvas = CANVAS_END_MIN - myStart;
            const maxMinutes =
              maxByNext != null ? Math.min(maxByNext, maxByCanvas) : maxByCanvas;
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
                hasChildren={Boolean(props.minutesReadOnlyById?.[t.id])}
                childCount={props.childCountById?.[t.id]}
                minutesReadOnly={props.minutesReadOnlyById?.[t.id]}
                minutesOverride={props.minutesOverrideById?.[t.id]}
                maxMinutes={maxMinutes}
                canvasStartMin={effectiveStartMin}
              />
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}
