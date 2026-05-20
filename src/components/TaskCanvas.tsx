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
} from "@dnd-kit/core";
import {
  CANVAS_END_MIN,
  CANVAS_RANGE_MIN,
  CANVAS_START_MIN,
  MIN_BLOCK_HEIGHT_PX,
  SCHEDULE_SLOT_MIN,
} from "@/src/lib/layout";
import { paletteForId } from "@/src/lib/palette";
import { useEffect, useMemo, useRef, useState } from "react";

function snapToCanvas(min: number) {
  const snapped = Math.round(min / SCHEDULE_SLOT_MIN) * SCHEDULE_SLOT_MIN;
  return Math.max(
    CANVAS_START_MIN,
    Math.min(CANVAS_END_MIN - SCHEDULE_SLOT_MIN, snapped),
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
  hasChildren: boolean;
  childCount?: number;
  minutesReadOnly?: boolean;
  minutesOverride?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.task.id,
  });

  // Resize state — local delta during a pointer drag; commits to onEditMinutes
  // on release. Snap happens on commit, not during drag, for smooth preview.
  const [resizeDelta, setResizeDelta] = useState(0);
  const resizeRef = useRef({ startY: 0, startMin: 0, captured: false });

  const startMin = props.task.scheduledStartMinutes ?? CANVAS_START_MIN;
  const topPx = (startMin - CANVAS_START_MIN) * props.pxPerMinute;
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
    const snapped = Math.max(
      SCHEDULE_SLOT_MIN,
      Math.round(proposed / SCHEDULE_SLOT_MIN) * SCHEDULE_SLOT_MIN,
    );
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
          isBreak ? "border-emerald-200 bg-emerald-50/90" : "border-line",
          muted ? "opacity-55 saturate-50" : "",
          "px-2 py-1",
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
              "h-4 w-4 shrink-0 rounded-full border border-line flex items-center justify-center text-[9px]",
              props.hasChildren ? "bg-soft cursor-not-allowed" : "bg-white hover:bg-soft transition-colors",
            ].join(" ")}
            aria-label={
              props.hasChildren
                ? "Status from subtasks"
                : muted
                  ? "Mark not done"
                  : "Mark done"
            }
          >
            {muted ? "✓" : props.hasChildren ? "·" : ""}
          </button>
          <input
            value={props.task.title}
            onChange={(e) => props.onEditTitle(props.task.id, e.target.value)}
            onPointerDown={swallow}
            placeholder={isBreak ? "Break" : "Task"}
            aria-label="Task title"
            autoFocus={props.task.title === ""}
            className={[
              "flex-1 min-w-0 bg-transparent outline-none truncate",
              "text-[13px] sm:text-sm",
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
              className="shrink-0 inline-flex items-center gap-0.5 px-1 text-[13px] leading-none text-muted hover:text-ink transition-colors"
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
              <span>+</span>
              {props.childCount && props.childCount > 0 ? (
                <span className="rounded-full bg-ink/10 px-1 text-[10px] tabular-nums leading-none py-px">
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
              className="shrink-0 px-1 text-[11px] leading-none text-muted hover:text-ink transition-colors"
              aria-label="Duplicate task"
              title="Duplicate"
            >
              ⎘
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => props.onDelete(props.task.id)}
            onPointerDown={swallow}
            className="shrink-0 px-1 text-[14px] leading-none text-muted hover:text-rose-700 transition-colors"
            aria-label="Delete task"
            title="Delete"
          >
            ×
          </button>
        </div>
        ) : null}
        {showMetaRow ? (
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
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
              className="w-10 bg-transparent outline-none border-b border-line/50 tabular-nums"
              aria-label="Minutes"
            />
            <span>min</span>
            <span className="ml-auto tabular-nums">
              → {formatClock(new Date(props.endsAtMs))}
            </span>
          </div>
        ) : null}
        {showResizeHandle ? (
          <div
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            className="absolute left-2 right-2 bottom-0 h-2 cursor-ns-resize group/handle"
            style={{ touchAction: "none" }}
            aria-label="Resize task duration"
          >
            <div className="absolute inset-x-0 bottom-0.5 mx-auto h-0.5 w-8 rounded-full bg-ink/20 group-hover/handle:bg-ink/50 transition-colors" />
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

  const canvasHeightPx = CANVAS_RANGE_MIN * props.pxPerMinute;
  const slotPx = SCHEDULE_SLOT_MIN * props.pxPerMinute; // 15-min line
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
  for (let m = CANVAS_START_MIN; m <= CANVAS_END_MIN; m += SCHEDULE_SLOT_MIN) {
    gutterLabels.push(m);
  }

  // Current time line — only visible if "now" falls inside the canvas window.
  const nowMin = props.now.getHours() * 60 + props.now.getMinutes();
  const nowInCanvas = nowMin >= CANVAS_START_MIN && nowMin <= CANVAS_END_MIN;
  const nowTopPx = (nowMin - CANVAS_START_MIN) * props.pxPerMinute;
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
      onDragEnd={(e) => {
        const task = topLevel.find((t) => t.id === String(e.active.id));
        if (!task || task.scheduledStartMinutes == null) return;
        const dyMin = e.delta.y / props.pxPerMinute;
        const snapped = snapToCanvas(task.scheduledStartMinutes + dyMin);
        if (snapped !== task.scheduledStartMinutes) {
          props.onSetTaskTime(task.id, snapped);
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
                style={{ top: (m - CANVAS_START_MIN) * props.pxPerMinute }}
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
            const clickedMin = CANVAS_START_MIN + yOffset / props.pxPerMinute;
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
              />
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}
