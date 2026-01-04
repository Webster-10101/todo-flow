"use client";

import type { Settings, Task } from "@/src/lib/types";
import { formatMinutesOfDay, isProjectedPastCutoff } from "@/src/lib/time";
import { useEffect, useMemo, useState } from "react";
import { TaskList } from "./TaskList";
import { TaskRow } from "./TaskRow";
import { SubtaskList } from "./SubtaskList";

export function PlanView(props: {
  now: Date;
  tasks: Task[];
  settings: Settings;
  projectedFinish: Date;
  onAddTask: (title: string, minutes: number) => void;
  onAddSubtask: (parentId: string, title: string, minutes: number) => void;
  onDuplicate: (id: string) => void;
  onInsertBreak: (minutes: 5 | 10) => void;
  onStartSprint: () => void;
  onReorderSubtasks: (parentId: string, orderedChildIds: string[]) => void;
  onReorderSprint: (orderedIds: string[]) => void;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleInSprint: (id: string) => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [newMinutes, setNewMinutes] = useState(25);
  const canAdd = newTitle.trim().length > 0;
  const [openSubtaskFor, setOpenSubtaskFor] = useState<string | null>(null);
  const [subTitle, setSubTitle] = useState("");
  const [subMinutes, setSubMinutes] = useState(10);
  const [collapsedParents, setCollapsedParents] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Default to collapsed on small screens to avoid huge scrolling stacks.
    // User can expand per-parent.
    if (typeof window === "undefined") return;
    const small = window.matchMedia?.("(max-width: 639px)")?.matches ?? false;
    if (!small) return;
    setCollapsedParents((prev) => {
      if (Object.keys(prev).length) return prev;
      const next: Record<string, boolean> = {};
      for (const t of props.tasks) {
        if (t.parentId !== null) continue;
        const hasKids = props.tasks.some((k) => k.parentId === t.id);
        if (hasKids) next[t.id] = true;
      }
      return next;
    });
  }, [props.tasks]);

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
  const later = useMemo(
    () => props.tasks.filter((t) => t.status === "queued" && !t.inSprint),
    [props.tasks],
  );
  const done = useMemo(() => props.tasks.filter((t) => t.status === "done"), [props.tasks]);

  const pastCutoff = isProjectedPastCutoff({
    now: props.now,
    projectedFinish: props.projectedFinish,
    settings: props.settings,
  });

  return (
    <div className="space-y-6">
      <div
        className={[
          "rounded-xl border px-5 py-4 shadow-soft",
          pastCutoff ? "border-rose-200 bg-rose-50" : "border-teal-200 bg-teal-50",
        ].join(" ")}
      >
        <div className={["text-sm", pastCutoff ? "text-rose-900" : "text-teal-900"].join(" ")}>
          {pastCutoff
            ? `This plan runs past ${formatMinutesOfDay(props.settings.latestFinishMinutes)}.`
            : `This plan finishes before ${formatMinutesOfDay(props.settings.latestFinishMinutes)}.`}
        </div>
        {pastCutoff ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={props.onStartSprint}
              className="rounded-lg border border-teal-700 bg-teal-600 px-4 py-2 text-sm text-white hover:bg-teal-700 transition-colors"
            >
              Start anyway
            </button>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-line bg-white/70 p-5 shadow-soft">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="min-w-0 flex-1 text-center md:text-left">
            <div className="text-sm text-muted">Add a task</div>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
              }}
              placeholder="What's the next tiny step?"
              aria-label="Task title"
              className="mt-2 w-full rounded-xl border border-line bg-white/70 px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
            />
          </div>
          <div className="flex items-center justify-center md:justify-end gap-2">
            <input
              type="number"
              min={1}
              value={newMinutes}
              onChange={(e) => {
                const val = e.target.valueAsNumber;
                setNewMinutes(isNaN(val) ? 1 : Math.max(1, Math.round(val)));
              }}
              aria-label="Task duration in minutes"
              className="w-[96px] sm:w-[120px] rounded-xl border border-line bg-white/70 px-3 py-3 text-[15px] outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
            />
            <span className="pb-3 text-sm text-muted">min</span>
          </div>
        </div>
        <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
            <button
              type="button"
              onClick={() => {
                submitAdd();
              }}
              disabled={!canAdd}
              className={[
                "rounded-lg px-4 py-2 text-sm transition-colors",
                canAdd
                  ? "border border-line bg-ink text-paper hover:bg-black"
                  : "border border-line bg-white/40 text-muted cursor-not-allowed",
              ].join(" ")}
            >
              Add
            </button>

            <div className="mx-1 hidden md:block h-6 w-px bg-line" />

            <button
              type="button"
              onClick={() => props.onInsertBreak(5)}
              className="rounded-lg border border-line bg-white/60 px-4 py-2 text-sm text-muted hover:bg-soft hover:text-ink transition-colors"
            >
              Insert break +5
            </button>
            <button
              type="button"
              onClick={() => props.onInsertBreak(10)}
              className="rounded-lg border border-line bg-white/60 px-4 py-2 text-sm text-muted hover:bg-soft hover:text-ink transition-colors"
            >
              Insert break +10
            </button>
          </div>

          <button
            type="button"
            onClick={props.onStartSprint}
            disabled={queuedSprint.length === 0}
            className={[
              "w-full md:w-auto rounded-lg px-4 py-2 text-sm transition-colors",
              queuedSprint.length === 0
                ? "border border-line bg-white/40 text-muted cursor-not-allowed"
                : "border border-teal-700 bg-teal-600 text-white hover:bg-teal-700",
            ].join(" ")}
          >
            Start sprint
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-sm text-muted">Sprint</div>
          <div className="text-sm text-muted">{queuedSprint.length} items</div>
        </div>

        {queuedSprint.length ? (
          <TaskList
            tasks={queuedSprint}
            onReorder={props.onReorderSprint}
            onEditTitle={props.onEditTitle}
            onEditMinutes={props.onEditMinutes}
            onToggleDone={props.onToggleDone}
            onDelete={props.onDelete}
            onToggleInSprint={props.onToggleInSprint}
            onDuplicate={props.onDuplicate}
            onRequestAddSubtask={(parentId) => {
              setOpenSubtaskFor(parentId);
              setSubTitle("");
              setSubMinutes(10);
            }}
            minutesOverrideById={minutesOverrideById}
            minutesReadOnlyById={minutesReadOnlyById}
            renderAfterRow={(parent) => {
              if (parent.kind !== "task") return null;
              const kids = subtasksByParent.get(parent.id) ?? [];
              const isOpen = openSubtaskFor === parent.id;
              const isCollapsed = Boolean(collapsedParents[parent.id]);
              return (
                <div className="mt-2 ml-3 sm:ml-6 space-y-2 min-w-0 max-w-full overflow-x-hidden">
                  {kids.length ? (
                    <div className="space-y-2 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-muted">
                          {kids.length} subtask{kids.length === 1 ? "" : "s"}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedParents((prev) => ({ ...prev, [parent.id]: !Boolean(prev[parent.id]) }))
                          }
                          className="rounded-lg border border-line bg-white/60 px-2 py-1.5 text-xs text-ink hover:bg-soft transition-colors"
                        >
                          {isCollapsed ? "Show" : "Hide"}
                        </button>
                      </div>

                      {!isCollapsed ? (
                        <SubtaskList
                          tasks={kids}
                          onReorder={(orderedIds) => props.onReorderSubtasks(parent.id, orderedIds)}
                          onEditTitle={props.onEditTitle}
                          onEditMinutes={props.onEditMinutes}
                          onToggleDone={props.onToggleDone}
                          onDelete={props.onDelete}
                          onDuplicate={props.onDuplicate}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {isOpen ? (
                    <div className="rounded-xl border border-line bg-white/60 p-4 shadow-soft">
                      <div className="text-xs text-muted">Add subtask</div>
                      <div className="mt-2 flex flex-col sm:flex-row gap-2 min-w-0">
                        <input
                          value={subTitle}
                          onChange={(e) => setSubTitle(e.target.value)}
                          placeholder="Subtask"
                          className="flex-1 rounded-xl border border-line bg-white/80 px-3 py-2 text-sm outline-none"
                        />
                        <div className="flex items-center justify-center sm:justify-end gap-2">
                          <input
                            type="number"
                            min={1}
                            value={subMinutes}
                            onChange={(e) =>
                              setSubMinutes(Math.max(1, Math.round(e.target.valueAsNumber || 1)))
                            }
                            className="w-full sm:w-[110px] rounded-xl border border-line bg-white/80 px-3 py-2 text-sm outline-none"
                          />
                          <span className="text-sm text-muted">min</span>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const title = subTitle.trim();
                            if (!title) return;
                            props.onAddSubtask(parent.id, title, subMinutes);
                            setSubTitle("");
                            setSubMinutes(10);
                            setOpenSubtaskFor(null);
                          }}
                          className="rounded-lg border border-line bg-ink px-3 py-2 text-sm text-paper hover:bg-black transition-colors"
                        >
                          Add subtask
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenSubtaskFor(null)}
                          className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink hover:bg-soft transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            }}
          />
        ) : (
          <div className="rounded-xl border border-line bg-white/50 px-5 py-6 text-sm text-muted">
            Add one small task to begin.
          </div>
        )}
      </div>

      {later.length ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-muted">Later</div>
            <div className="text-sm text-muted">{later.length}</div>
          </div>
          <div className="space-y-3">
            {later.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onEditTitle={props.onEditTitle}
                onEditMinutes={props.onEditMinutes}
                onToggleDone={props.onToggleDone}
                onDelete={props.onDelete}
                onToggleInSprint={props.onToggleInSprint}
                onDuplicate={props.onDuplicate}
              />
            ))}
          </div>
        </div>
      ) : null}

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
                onToggleDone={props.onToggleDone}
                onDelete={props.onDelete}
                onToggleInSprint={props.onToggleInSprint}
                onDuplicate={props.onDuplicate}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}


