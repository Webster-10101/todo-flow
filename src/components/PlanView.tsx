"use client";

import type { Settings, Task } from "@/src/lib/types";
import {
  formatMinutesOfDay,
  getTaskTotalMinutes,
  getTodayAtMinutes,
  isProjectedPastCutoff,
  minutesToMs,
  type SprintSchedule,
  type SprintScheduleRow,
} from "@/src/lib/time";
import { useGridPxPerMin } from "@/src/lib/layout";
import { todayLocalISO } from "@/src/lib/dates";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TaskCanvas } from "./TaskCanvas";
import { TaskRow } from "./TaskRow";
import { SubtasksPopover } from "./SubtasksPopover";
import { BlockActionBar } from "./BlockActionBar";
import { MobileDock } from "./MobileDock";

export function PlanView(props: {
  now: Date;
  tasks: Task[];
  settings: Settings;
  projectedFinish: Date;
  schedule: SprintSchedule;
  onAddTask: (title: string, minutes: number) => void;
  onAddTaskAtTime: (scheduledStartMinutes: number) => void;
  onAddSubtask: (parentId: string, title: string, minutes: number) => void;
  onDuplicate: (id: string) => void;
  onInsertBreak: (minutes: 5 | 10) => void;
  onStartSprint: () => void;
  onReorderSubtasks: (parentId: string, orderedChildIds: string[]) => void;
  onSetTaskTime: (id: string, minutes: number) => void;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onEditNotes: (id: string, notes: string) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleInSprint: (id: string) => void;
  onScheduleToSprint: (id: string) => void;
  onStartFreshDay: () => void;
  onOpenExport: () => void;
  onStartTask: (id: string) => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [newMinutes, setNewMinutes] = useState(props.settings.defaultTaskMinutes);
  const [subtaskPopover, setSubtaskPopover] = useState<{
    parentId: string;
    anchor: DOMRect;
  } | null>(null);
  // Selected canvas block — drives the mobile BlockActionBar + chunky resize
  // handle. Selection is harmless on desktop (just a ring).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Touch rename request — the action bar sets it, the canvas block consumes it
  // and clears it. Desktop just double-clicks the title instead.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const clearRenaming = useCallback(() => setRenamingId(null), []);
  const canAdd = newTitle.trim().length > 0;
  const pxPerMin = useGridPxPerMin();

  function submitAdd() {
    const title = newTitle.trim();
    if (!title) return;
    props.onAddTask(title, Math.max(1, Math.round(newMinutes)));
    setNewTitle("");
  }

  const queuedSprint = useMemo(
    () => props.tasks.filter((t) => t.status === "queued" && t.inSprint && t.parentId === null),
    [props.tasks],
  );
  // Done tasks stay in state as history (dated); the plan view only shows
  // today's. Undone tasks roll forward to today on hydrate, so no date
  // filter is needed for them.
  const todayISO = useMemo(() => todayLocalISO(props.now), [props.now]);
  const sprintAll = useMemo(
    () =>
      props.tasks.filter(
        (t) =>
          t.inSprint &&
          t.parentId === null &&
          (t.status === "queued" || (t.status === "done" && t.date === todayISO)),
      ),
    [props.tasks, todayISO],
  );
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of props.tasks) {
      if (!t.parentId) continue;
      const arr = map.get(t.parentId) ?? [];
      arr.push(t);
      map.set(t.parentId, arr);
    }
    return map;
  }, [props.tasks]);

  const minutesOverrideById = useMemo(() => {
    const out: Record<string, number> = {};
    for (const parent of queuedSprint) {
      if (parent.kind !== "task") continue;
      const kids = subtasksByParent.get(parent.id) ?? [];
      if (!kids.length) continue;
      out[parent.id] = kids.reduce((sum, k) => sum + (k.estimateMinutes + k.extraMinutes), 0);
    }
    return out;
  }, [queuedSprint, subtasksByParent]);

  const minutesReadOnlyById = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const id of Object.keys(minutesOverrideById)) out[id] = true;
    return out;
  }, [minutesOverrideById]);
  const childCountById = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [pid, kids] of subtasksByParent) out[pid] = kids.length;
    return out;
  }, [subtasksByParent]);
  const popoverParent = useMemo(
    () =>
      subtaskPopover
        ? props.tasks.find((t) => t.id === subtaskPopover.parentId) ?? null
        : null,
    [subtaskPopover, props.tasks],
  );
  const popoverKids = useMemo(
    () => (subtaskPopover ? subtasksByParent.get(subtaskPopover.parentId) ?? [] : []),
    [subtaskPopover, subtasksByParent],
  );
  const later = useMemo(
    () => props.tasks.filter((t) => t.status === "queued" && !t.inSprint),
    [props.tasks],
  );
  // Done section below the canvas now shows only out-of-sprint completions —
  // sprint-done tasks live on the timeline (muted + line-through) and would be
  // duplicated otherwise.
  const done = useMemo(
    () =>
      props.tasks.filter(
        (t) => t.status === "done" && !t.inSprint && t.date === todayISO,
      ),
    [props.tasks, todayISO],
  );

  // Synthesize schedule rows for done sprint tasks (computeSprintSchedule
  // deliberately excludes them since they don't affect projected finish).
  // Without these rows, TaskCanvas skips rendering them.
  const canvasSchedule = useMemo<SprintSchedule>(() => {
    const extra: SprintScheduleRow[] = [];
    for (const t of sprintAll) {
      if (t.status !== "done") continue;
      if (t.scheduledStartMinutes == null) continue;
      const minutes = getTaskTotalMinutes(t);
      const startMs = getTodayAtMinutes(props.now, t.scheduledStartMinutes).getTime();
      extra.push({
        taskId: t.id,
        startMs,
        endMs: startMs + minutesToMs(minutes),
        minutes,
      });
    }
    if (extra.length === 0) return props.schedule;
    return { ...props.schedule, rows: [...props.schedule.rows, ...extra] };
  }, [props.schedule, sprintAll, props.now]);

  const pastCutoff = isProjectedPastCutoff({
    now: props.now,
    projectedFinish: props.projectedFinish,
    settings: props.settings,
  });

  // Clear the selection when the selected task leaves the canvas
  // (deleted, moved to Later, sprint started).
  useEffect(() => {
    if (selectedId && !sprintAll.some((t) => t.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, sprintAll]);

  const selectedTask = useMemo(
    () => (selectedId ? sprintAll.find((t) => t.id === selectedId) ?? null : null),
    [selectedId, sprintAll],
  );
  const selectedRow = useMemo(
    () =>
      selectedTask
        ? canvasSchedule.rows.find((r) => r.taskId === selectedTask.id) ?? null
        : null,
    [selectedTask, canvasSchedule],
  );

  const doneCount = useMemo(
    () => props.tasks.filter((t) => t.status === "done").length,
    [props.tasks],
  );
  const exportableCount = useMemo(
    () =>
      props.tasks.filter(
        (t) => t.status !== "done" && t.kind === "task",
      ).length,
    [props.tasks],
  );

  return (
    <div className="space-y-6 pb-48 md:pb-0 md:space-y-0 md:grid md:grid-cols-[320px_1fr] md:gap-6">
      {/* Desktop sidebar — on phones its contents move to the fixed MobileDock
          below, so the canvas renders first. */}
      <aside className="hidden md:block space-y-4 md:sticky md:top-4 md:self-start">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onOpenExport}
            disabled={exportableCount === 0}
            className={[
              "rounded-lg border border-line px-3 py-1.5 text-xs transition-colors",
              exportableCount === 0
                ? "bg-white/40 text-muted cursor-not-allowed"
                : "bg-white/70 text-ink hover:bg-soft",
            ].join(" ")}
          >
            Export tasks
          </button>
          <button
            type="button"
            onClick={props.onStartFreshDay}
            disabled={doneCount === 0}
            className={[
              "rounded-lg border border-line px-3 py-1.5 text-xs transition-colors",
              doneCount === 0
                ? "bg-white/40 text-muted cursor-not-allowed"
                : "bg-white/70 text-ink hover:bg-soft",
            ].join(" ")}
            title={
              doneCount === 0
                ? "No completed tasks to clear"
                : `Clear ${doneCount} completed task${doneCount === 1 ? "" : "s"}`
            }
          >
            Start fresh day
          </button>
        </div>

        <div
          className={[
            "rounded-xl border px-4 py-3 shadow-soft",
            pastCutoff ? "border-rose-200 bg-rose-50" : "border-teal-200 bg-teal-50",
          ].join(" ")}
        >
          <div className={["text-sm", pastCutoff ? "text-rose-900" : "text-teal-900"].join(" ")}>
            {pastCutoff
              ? `Runs past ${formatMinutesOfDay(props.settings.latestFinishMinutes)}.`
              : `Finishes before ${formatMinutesOfDay(props.settings.latestFinishMinutes)}.`}
          </div>
          {pastCutoff ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={props.onStartSprint}
                className="rounded-lg border border-teal-700 bg-teal-600 px-3 py-1.5 text-sm text-white hover:bg-teal-700 transition-colors"
              >
                Start anyway
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-line bg-white/70 p-4 shadow-soft space-y-3">
          <div>
            <div className="text-sm text-muted">Add a task</div>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
              }}
              placeholder="What's the next tiny step?"
              aria-label="Task title"
              className="mt-2 w-full rounded-xl border border-line bg-white/70 px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={newMinutes}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                const val = e.target.valueAsNumber;
                if (isNaN(val)) return;
                setNewMinutes(Math.max(1, Math.round(val)));
              }}
              aria-label="Task duration in minutes"
              className="w-[88px] rounded-xl border border-line bg-white/70 px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
            />
            <span className="text-sm text-muted">min</span>
            <button
              type="button"
              onClick={submitAdd}
              disabled={!canAdd}
              className={[
                "ml-auto rounded-lg px-4 py-2 text-sm transition-colors",
                canAdd
                  ? "border border-line bg-ink text-paper hover:bg-black"
                  : "border border-line bg-white/40 text-muted cursor-not-allowed",
              ].join(" ")}
            >
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => props.onInsertBreak(5)}
              className="rounded-lg border border-line bg-white/60 px-3 py-1.5 text-xs text-muted hover:bg-soft hover:text-ink transition-colors"
            >
              Break +5
            </button>
            <button
              type="button"
              onClick={() => props.onInsertBreak(10)}
              className="rounded-lg border border-line bg-white/60 px-3 py-1.5 text-xs text-muted hover:bg-soft hover:text-ink transition-colors"
            >
              Break +10
            </button>
          </div>

          <button
            type="button"
            onClick={props.onStartSprint}
            disabled={queuedSprint.length === 0}
            className={[
              "w-full rounded-lg px-4 py-2 text-sm transition-colors",
              queuedSprint.length === 0
                ? "border border-line bg-white/40 text-muted cursor-not-allowed"
                : "border border-teal-700 bg-teal-600 text-white hover:bg-teal-700",
            ].join(" ")}
          >
            Start sprint
          </button>
        </div>
      </aside>

      <section className="space-y-6 min-w-0">
        <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-sm text-muted">Sprint</div>
          <div className="text-sm text-muted">{queuedSprint.length} items</div>
        </div>

        <TaskCanvas
          tasks={sprintAll}
          schedule={canvasSchedule}
          pxPerMinute={pxPerMin}
          now={props.now}
          createMinutes={props.settings.defaultTaskMinutes}
          onSetTaskTime={props.onSetTaskTime}
          onCreateTaskAtTime={props.onAddTaskAtTime}
          onOpenSubtasks={(parentId, anchor) => setSubtaskPopover({ parentId, anchor })}
          onEditTitle={props.onEditTitle}
          onEditMinutes={props.onEditMinutes}
          onEditNotes={props.onEditNotes}
          onToggleDone={props.onToggleDone}
          onDelete={props.onDelete}
          onToggleInSprint={props.onToggleInSprint}
          onDuplicate={props.onDuplicate}
          onStart={props.onStartTask}
          childCountById={childCountById}
          minutesOverrideById={minutesOverrideById}
          minutesReadOnlyById={minutesReadOnlyById}
          selectedId={selectedId}
          onSelect={setSelectedId}
          renamingId={renamingId}
          onRenameHandled={clearRenaming}
        />
      </div>

      {later.length ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-muted">Later</div>
            <div className="text-sm text-muted">{later.length}</div>
          </div>
          {/* Phones: horizontal chip row — tap to schedule into the next free
              slot. Desktop keeps the full editable rows. */}
          <div className="md:hidden -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {later
              .filter((t) => t.parentId === null)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => props.onScheduleToSprint(t.id)}
                  className="flex max-w-[240px] shrink-0 items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-2 shadow-soft active:bg-soft transition-colors"
                >
                  <span className="truncate text-sm text-ink">
                    {t.title || "Untitled"}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {Math.max(1, Math.round(t.estimateMinutes + t.extraMinutes))}m
                  </span>
                </button>
              ))}
          </div>
          <div className="hidden md:block space-y-3">
            {later.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onEditTitle={props.onEditTitle}
                onEditMinutes={props.onEditMinutes}
                onEditNotes={props.onEditNotes}
                onToggleDone={props.onToggleDone}
                onDelete={props.onDelete}
                onToggleInSprint={props.onToggleInSprint}
                onDuplicate={props.onDuplicate}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Phones: rarely-used day utilities live at the end of the scroll —
          the desktop sidebar copies are hidden below md. */}
      <div className="md:hidden flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={props.onOpenExport}
          disabled={exportableCount === 0}
          className={[
            "h-9 rounded-lg border border-line px-3 text-xs transition-colors",
            exportableCount === 0
              ? "bg-white/40 text-muted cursor-not-allowed"
              : "bg-white/70 text-ink active:bg-soft",
          ].join(" ")}
        >
          Export tasks
        </button>
        <button
          type="button"
          onClick={props.onStartFreshDay}
          disabled={doneCount === 0}
          className={[
            "h-9 rounded-lg border border-line px-3 text-xs transition-colors",
            doneCount === 0
              ? "bg-white/40 text-muted cursor-not-allowed"
              : "bg-white/70 text-ink active:bg-soft",
          ].join(" ")}
        >
          Start fresh day
        </button>
      </div>

      {done.length ? (
        <div className="space-y-3">
          <div className="text-sm text-muted">Done</div>
          <div className="space-y-3">
            {done.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onEditTitle={props.onEditTitle}
                onEditMinutes={props.onEditMinutes}
                onEditNotes={props.onEditNotes}
                onToggleDone={props.onToggleDone}
                onDelete={props.onDelete}
                onToggleInSprint={props.onToggleInSprint}
                onDuplicate={props.onDuplicate}
              />
            ))}
          </div>
        </div>
      ) : null}
      </section>

      {subtaskPopover && popoverParent ? (
        <SubtasksPopover
          parent={popoverParent}
          kids={popoverKids}
          anchor={subtaskPopover.anchor}
          onClose={() => setSubtaskPopover(null)}
          onAddSubtask={props.onAddSubtask}
          onEditTitle={props.onEditTitle}
          onEditMinutes={props.onEditMinutes}
          onEditNotes={props.onEditNotes}
          onToggleDone={props.onToggleDone}
          onDelete={props.onDelete}
        />
      ) : null}

      <MobileDock
        queuedCount={queuedSprint.length}
        defaultMinutes={props.settings.defaultTaskMinutes}
        onAddTask={props.onAddTask}
        onInsertBreak={props.onInsertBreak}
        onStartSprint={props.onStartSprint}
        actionBar={
          selectedTask ? (
            <BlockActionBar
              task={selectedTask}
              minutes={
                selectedRow?.minutes ??
                Math.max(
                  1,
                  Math.round(selectedTask.estimateMinutes + selectedTask.extraMinutes),
                )
              }
              endsAtMs={selectedRow?.endMs ?? null}
              minutesReadOnly={Boolean(minutesReadOnlyById[selectedTask.id])}
              childCount={childCountById[selectedTask.id] ?? 0}
              onClose={() => setSelectedId(null)}
              onToggleDone={props.onToggleDone}
              onEditMinutes={props.onEditMinutes}
              onDuplicate={props.onDuplicate}
              onDelete={props.onDelete}
              onToLater={(id) => {
                props.onToggleInSprint(id);
                setSelectedId(null);
              }}
              onOpenSubtasks={(id, anchor) =>
                setSubtaskPopover({ parentId: id, anchor })
              }
              onRename={(id) => setRenamingId(id)}
              onStart={(id) => {
                setSelectedId(null);
                props.onStartTask(id);
              }}
            />
          ) : null
        }
      />
    </div>
  );
}


