import type { RunnerState, Settings, Task } from "./types";
import { POSITION_GAP } from "./types";
import { clampMinutes } from "./ids";
import { todayLocalISO } from "./dates";

export type State = {
  tasks: Task[];
  runner: RunnerState;
  settings: Settings;
  lastCompletion: { taskId: string; at: number } | null;
  lastDeletion: { tasks: Task[]; at: number } | null;
};

export type AddTaskPayload = {
  id: string;
  title: string;
  minutes: number;
  nowMs: number;
  // Optional explicit clock-time override (minutes from midnight). Used by
  // click-to-create on the canvas. Falls back to findNextFreeSlot if absent.
  scheduledStartMinutes?: number;
};
export type AddSubtaskPayload = { id: string; parentId: string; title: string; minutes: number; nowMs: number };
export type DuplicatePayload = {
  id: string;
  newParentId: string;
  newChildIds: Record<string, string>;
  nowMs: number;
};
export type InsertBreakPayload = { id: string; minutes: 5 | 10; nowMs: number };

export type Action =
  | { type: "HYDRATE"; tasks: Task[]; runner: RunnerState; settings: Settings; nowMs: number }
  | { type: "ADD_TASK"; payload: AddTaskPayload }
  | { type: "ADD_SUBTASK"; payload: AddSubtaskPayload }
  | { type: "EDIT_TITLE"; id: string; title: string; nowMs: number }
  | { type: "EDIT_MINUTES"; id: string; minutes: number; nowMs: number }
  | { type: "EDIT_NOTES"; id: string; notes: string; nowMs: number }
  | { type: "TOGGLE_DONE"; id: string; nowMs: number }
  | { type: "TOGGLE_IN_SPRINT"; id: string; nowMs: number }
  | { type: "SCHEDULE_TO_SPRINT"; id: string; nowMs: number }
  | { type: "DELETE_TASK"; id: string; nowMs: number }
  | { type: "DUPLICATE_TASK"; payload: DuplicatePayload }
  | { type: "REORDER_SPRINT"; orderedIds: string[]; nowMs: number }
  | { type: "REORDER_SUBTASKS"; parentId: string; orderedChildIds: string[]; nowMs: number }
  | { type: "SET_TASK_TIME"; id: string; minutes: number | null; nowMs: number }
  | { type: "INSERT_BREAK_PLAN"; payload: InsertBreakPayload }
  | { type: "INSERT_BREAK_NEXT"; payload: InsertBreakPayload }
  | { type: "START_SPRINT"; nowMs: number }
  | { type: "START_NEXT"; nowMs: number }
  | { type: "COMPLETE_ACTIVE"; nowMs: number }
  | { type: "DELETE_ACTIVE"; nowMs: number }
  | { type: "EXTEND_ACTIVE"; minutes: 5 | 10; nowMs: number }
  | { type: "REDUCE_ACTIVE"; minutes: 5 | 10; nowMs: number }
  | { type: "STOP_AFTER_THIS_TASK" }
  | { type: "TOGGLE_PAUSE"; nowMs: number }
  | { type: "EXIT_TO_PLAN"; nowMs: number }
  | { type: "AUTO_START_TICK"; nowMs: number }
  | { type: "SET_LATEST_FINISH"; minutes: number }
  | { type: "START_FRESH_DAY" }
  | { type: "UNDO_DELETE"; nowMs: number }
  | { type: "CLEAR_LAST_DELETION" }
  | { type: "SET_SCHEDULED_START"; minutes: number | null };

export const AUTO_START_DELAY_MS = 15_000;

export const initialState: State = {
  tasks: [],
  runner: {
    mode: "plan",
    activeTaskId: null,
    activeStartedAt: null,
    awaitingNextStart: false,
    stopAfterThisTask: false,
    pausedAt: null,
    pauseAccumulatedMs: 0,
    autoStartAt: null,
    autoStartPausedAt: null,
    autoStartPausedRemainingMs: null,
  },
  settings: { latestFinishMinutes: 18 * 60, scheduledStartMinutes: null },
  lastCompletion: null,
  lastDeletion: null,
};

export function hasChildren(id: string, tasks: Task[]) {
  return tasks.some((t) => t.parentId === id);
}

export const SCHEDULE_SNAP_MINUTES = 15;
const DEFAULT_DAY_START_MIN = 9 * 60; // 09:00

export function snapToSchedule(minutes: number): number {
  return Math.max(
    0,
    Math.min(24 * 60, Math.round(minutes / SCHEDULE_SNAP_MINUTES) * SCHEDULE_SNAP_MINUTES),
  );
}

function getTaskDurationMinutes(t: Task, allTasks: Task[]): number {
  if (t.kind === "break") return Math.max(0, Math.round(t.estimateMinutes + t.extraMinutes));
  const kids = allTasks.filter((c) => c.parentId === t.id && c.status !== "done");
  if (kids.length) {
    return kids.reduce(
      (sum, c) => sum + Math.max(0, Math.round(c.estimateMinutes + c.extraMinutes)),
      0,
    );
  }
  return Math.max(0, Math.round(t.estimateMinutes + t.extraMinutes));
}

// Earliest free 30-min slot ≥ baseMin that doesn't collide with existing sprint
// tasks. Simple linear scan; sprint sizes are small enough.
export function findNextFreeSlot(args: {
  tasks: Task[];
  baseMin: number;
  ignoreId?: string;
}): number {
  const { tasks, baseMin, ignoreId } = args;
  const occupied = tasks
    .filter(
      (t) =>
        t.parentId === null &&
        t.inSprint &&
        t.status !== "done" &&
        t.scheduledStartMinutes != null &&
        t.id !== ignoreId,
    )
    .map((t) => ({
      start: t.scheduledStartMinutes as number,
      end: (t.scheduledStartMinutes as number) + getTaskDurationMinutes(t, tasks),
    }))
    .sort((a, b) => a.start - b.start);

  let candidate = snapToSchedule(Math.max(0, baseMin));
  for (const block of occupied) {
    if (candidate + 1 <= block.start) return candidate;
    if (candidate < block.end) {
      candidate = snapToSchedule(block.end);
    }
  }
  return candidate;
}

// One-time migration: any sprint task missing a scheduledStartMinutes gets one,
// derived by walking the existing order from the day-start anchor.
function migrateScheduledTimes(tasks: Task[], settings: Settings): Task[] {
  const needsMigration = tasks.some(
    (t) =>
      t.parentId === null &&
      t.inSprint &&
      t.status !== "done" &&
      t.scheduledStartMinutes == null,
  );
  if (!needsMigration) return tasks;

  const dayStart = settings.scheduledStartMinutes ?? DEFAULT_DAY_START_MIN;
  let cursor = snapToSchedule(dayStart);

  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const sprintTop = tasks.filter(
    (t) => t.parentId === null && t.inSprint && t.status !== "done",
  );

  for (const t of sprintTop) {
    if (t.scheduledStartMinutes != null) {
      // Respect any explicit times that already exist.
      const dur = getTaskDurationMinutes(t, tasks);
      cursor = Math.max(cursor, t.scheduledStartMinutes + dur);
      cursor = snapToSchedule(cursor);
      continue;
    }
    const dur = getTaskDurationMinutes(t, tasks);
    byId.set(t.id, { ...t, scheduledStartMinutes: cursor });
    cursor = snapToSchedule(cursor + dur);
  }

  return tasks.map((t) => byId.get(t.id) ?? t);
}

export function normalizeTasks(tasks: Task[]) {
  const topLevel = tasks.filter((t) => t.parentId === null);
  const children = tasks.filter((t) => t.parentId !== null);

  const byParent = new Map<string, Task[]>();
  for (const c of children) {
    const pid = c.parentId as string;
    const arr = byParent.get(pid) ?? [];
    arr.push(c);
    byParent.set(pid, arr);
  }

  const sprintActive = topLevel.filter((t) => t.status === "active" && t.inSprint);
  const sprintQueued = topLevel
    .filter((t) => t.status === "queued" && t.inSprint)
    .sort((a, b) => {
      // Earlier scheduled time first; unscheduled tasks fall to the end.
      const aS = a.scheduledStartMinutes ?? Number.POSITIVE_INFINITY;
      const bS = b.scheduledStartMinutes ?? Number.POSITIVE_INFINITY;
      return aS - bS;
    });
  // Later and subtask order live in the persisted `position` sort key —
  // incoming array order (which a server sync can't preserve) doesn't matter.
  const byPosition = (a: Task, b: Task) =>
    a.position - b.position || a.createdAt - b.createdAt;
  const laterQueued = topLevel
    .filter((t) => t.status === "queued" && !t.inSprint)
    .sort(byPosition);
  const done = topLevel.filter((t) => t.status === "done");

  const orderedTop = [...sprintActive, ...sprintQueued, ...laterQueued, ...done];
  const out: Task[] = [];
  for (const p of orderedTop) {
    out.push(p);
    const kids = byParent.get(p.id);
    if (kids?.length) out.push(...kids.slice().sort(byPosition));
  }
  return out;
}

export function getNextStepId(tasks: Task[]) {
  const top = tasks.filter((t) => t.parentId === null && t.inSprint && t.status !== "done");
  for (const t of top) {
    if (t.kind === "break") {
      if (t.status === "queued") return t.id;
      continue;
    }
    const allKids = tasks.filter((c) => c.parentId === t.id);
    if (allKids.length) {
      const nextKid = allKids.find((c) => c.status === "queued") ?? null;
      if (nextKid) return nextKid.id;
      continue;
    }
    if (t.status === "queued") return t.id;
  }
  return null;
}

function deriveParentStatusFromKids(
  parentId: string,
  tasks: Task[],
  nowMs: number,
): Task[] {
  const kids = tasks.filter((t) => t.parentId === parentId);
  if (kids.length === 0) return tasks;
  const allKidsDone = kids.every((k) => k.status === "done");
  const pIdx = tasks.findIndex((t) => t.id === parentId);
  if (pIdx === -1) return tasks;
  const nextStatus = allKidsDone ? ("done" as const) : ("queued" as const);
  if (tasks[pIdx].status === nextStatus) return tasks;
  const next = tasks.slice();
  next[pIdx] = touch({ ...next[pIdx], status: nextStatus }, nowMs);
  return next;
}

// Stamp a task's LWW clock. EVERY reducer case that changes a task row must
// run the changed rows through this — the sync engine trusts updatedAtMs to
// decide which copy of a row wins.
function touch(t: Task, nowMs: number): Task {
  return { ...t, updatedAtMs: nowMs };
}

function maxPosition(tasks: Task[]): number {
  let max = 0;
  for (const t of tasks) if (t.position > max) max = t.position;
  return max;
}

// Re-derive positions after an explicit reorder, stamping ONLY displaced rows.
// Rows already in strictly-increasing position order keep their position (and
// their updatedAtMs); runs of displaced rows spread evenly between the
// surrounding stable anchors.
function applyOrderPositions(ordered: Task[], nowMs: number): Task[] {
  const out = ordered.slice();
  let prev = Number.NEGATIVE_INFINITY;
  let i = 0;
  while (i < out.length) {
    if (out[i].position > prev) {
      prev = out[i].position;
      i++;
      continue;
    }
    let j = i + 1;
    while (j < out.length && out[j].position <= prev) j++;
    const count = j - i;
    const lower = Number.isFinite(prev) ? prev : 0;
    const upper = j < out.length ? out[j].position : lower + POSITION_GAP * (count + 1);
    const step = (upper - lower) / (count + 1);
    for (let k = 0; k < count; k++) {
      out[i + k] = touch({ ...out[i + k], position: lower + step * (k + 1) }, nowMs);
    }
    prev = out[j - 1].position;
    i = j;
  }
  return out;
}

// On hydrate: undone tasks from earlier days roll forward to today; done
// tasks keep their day — that's the free history that replaces destructive
// day-clearing.
function rollDay(tasks: Task[], nowMs: number): Task[] {
  const today = todayLocalISO(new Date(nowMs));
  return tasks.map((t) =>
    t.status !== "done" && t.date < today
      ? touch({ ...t, date: today }, nowMs)
      : t,
  );
}

function clearedRunner(runner: RunnerState, opts: { awaitingNext: boolean }): RunnerState {
  return {
    ...runner,
    activeTaskId: null,
    activeStartedAt: null,
    awaitingNextStart: opts.awaitingNext,
    pausedAt: null,
    pauseAccumulatedMs: 0,
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "HYDRATE":
      // Note for the sync engine: hydrate-time rewrites (rollDay,
      // migrateScheduledTimes) must NOT be treated as local edits to push —
      // dirty detection starts from the post-hydrate snapshot.
      return {
        ...state,
        tasks: normalizeTasks(
          rollDay(migrateScheduledTimes(action.tasks, action.settings), action.nowMs),
        ),
        runner: action.runner,
        settings: action.settings,
      };

    case "ADD_TASK": {
      const { id, title, minutes, nowMs, scheduledStartMinutes: override } = action.payload;
      const baseMin = state.settings.scheduledStartMinutes ?? DEFAULT_DAY_START_MIN;
      const scheduledStartMinutes =
        override != null
          ? snapToSchedule(override)
          : findNextFreeSlot({ tasks: state.tasks, baseMin });
      const t: Task = {
        id,
        title,
        notes: "",
        estimateMinutes: clampMinutes(minutes),
        extraMinutes: 0,
        scheduledStartMinutes,
        status: "queued",
        kind: "task",
        parentId: null,
        inSprint: true,
        createdAt: nowMs,
        date: todayLocalISO(new Date(nowMs)),
        position: maxPosition(state.tasks) + POSITION_GAP,
        updatedAtMs: nowMs,
      };
      return { ...state, tasks: normalizeTasks([t, ...state.tasks]) };
    }

    case "ADD_SUBTASK": {
      const { id, parentId, title, minutes, nowMs } = action.payload;
      const siblings = state.tasks.filter((t) => t.parentId === parentId);
      const st: Task = {
        id,
        title,
        notes: "",
        estimateMinutes: clampMinutes(minutes),
        extraMinutes: 0,
        scheduledStartMinutes: null,
        status: "queued",
        kind: "task",
        parentId,
        inSprint: true,
        createdAt: nowMs,
        date: todayLocalISO(new Date(nowMs)),
        position: maxPosition(siblings) + POSITION_GAP,
        updatedAtMs: nowMs,
      };
      const next = state.tasks.slice();
      const parentIdx = next.findIndex((t) => t.id === parentId);
      if (parentIdx === -1) {
        return { ...state, tasks: normalizeTasks([st, ...next]) };
      }
      const alreadyHasKids = next.some((t) => t.parentId === parentId);
      if (!alreadyHasKids) {
        const parent = next[parentIdx];
        next[parentIdx] = touch({ ...parent, estimateMinutes: 0, extraMinutes: 0 }, nowMs);
      }
      let insertAt = parentIdx + 1;
      while (insertAt < next.length && next[insertAt].parentId === parentId) insertAt++;
      next.splice(insertAt, 0, st);
      return { ...state, tasks: normalizeTasks(next) };
    }

    case "EDIT_TITLE":
      return {
        ...state,
        tasks: normalizeTasks(
          state.tasks.map((t) =>
            t.id === action.id ? touch({ ...t, title: action.title }, action.nowMs) : t,
          ),
        ),
      };

    case "EDIT_MINUTES":
      return {
        ...state,
        tasks: normalizeTasks(
          state.tasks.map((t) =>
            t.id === action.id
              ? touch(
                  { ...t, estimateMinutes: clampMinutes(action.minutes), extraMinutes: 0 },
                  action.nowMs,
                )
              : t,
          ),
        ),
      };

    case "EDIT_NOTES":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id ? touch({ ...t, notes: action.notes }, action.nowMs) : t,
        ),
      };

    case "TOGGLE_DONE": {
      const target = state.tasks.find((t) => t.id === action.id);
      if (!target) return state;

      if (target.parentId === null && hasChildren(action.id, state.tasks)) {
        return state;
      }

      if (state.runner.activeTaskId === action.id && target.status !== "done") {
        return reducer(state, { type: "COMPLETE_ACTIVE", nowMs: action.nowMs });
      }

      let next: Task[] = state.tasks.map((t): Task => {
        if (t.id !== action.id) return t;
        const nextStatus: Task["status"] = t.status === "done" ? "queued" : "done";
        const nextSprint = nextStatus === "queued" ? true : t.inSprint;
        return touch({ ...t, status: nextStatus, inSprint: nextSprint }, action.nowMs);
      });

      if (target.parentId) {
        next = deriveParentStatusFromKids(target.parentId, next, action.nowMs);
      }

      return { ...state, tasks: normalizeTasks(next) };
    }

    case "TOGGLE_IN_SPRINT":
      return {
        ...state,
        tasks: normalizeTasks(
          state.tasks.map((t) =>
            t.id === action.id ? touch({ ...t, inSprint: !t.inSprint }, action.nowMs) : t,
          ),
        ),
      };

    // Move a Later task onto the canvas in one step: into the sprint AND
    // scheduled at the next free slot (TOGGLE_IN_SPRINT only flips the flag,
    // which leaves the task unplaced). Used by the mobile Later chips.
    case "SCHEDULE_TO_SPRINT": {
      const target = state.tasks.find((t) => t.id === action.id);
      if (!target || target.parentId !== null || target.status === "done") return state;
      const baseMin = state.settings.scheduledStartMinutes ?? DEFAULT_DAY_START_MIN;
      const slot =
        target.scheduledStartMinutes ?? findNextFreeSlot({ tasks: state.tasks, baseMin });
      return {
        ...state,
        tasks: normalizeTasks(
          state.tasks.map((t) =>
            t.id === action.id
              ? touch({ ...t, inSprint: true, scheduledStartMinutes: slot }, action.nowMs)
              : t,
          ),
        ),
      };
    }

    case "DELETE_TASK": {
      const removed = state.tasks.filter((t) => t.id === action.id || t.parentId === action.id);
      if (removed.length === 0) return state;

      const nextTasks = normalizeTasks(
        state.tasks.filter((t) => t.id !== action.id && t.parentId !== action.id),
      );

      const nextRunner: RunnerState =
        state.runner.activeTaskId === action.id
          ? clearedRunner(state.runner, { awaitingNext: true })
          : state.runner;

      return {
        ...state,
        tasks: nextTasks,
        runner: nextRunner,
        lastDeletion: { tasks: removed, at: action.nowMs },
      };
    }

    case "DUPLICATE_TASK": {
      const { id, newParentId, newChildIds, nowMs } = action.payload;
      const original = state.tasks.find((t) => t.id === id);
      if (!original) return state;

      const cloneAs = (t: Task, overrides: Partial<Task> & { id: string }): Task => ({
        ...t,
        scheduledStartMinutes: null,
        createdAt: nowMs,
        status: "queued",
        date: todayLocalISO(new Date(nowMs)),
        // Just after the original in position order; normalizeTasks tiebreaks
        // by createdAt if positions collide.
        position: t.position + 1,
        updatedAtMs: nowMs,
        ...overrides,
      });

      if (original.parentId === null) {
        const baseMin = state.settings.scheduledStartMinutes ?? DEFAULT_DAY_START_MIN;
        const originalDuration = getTaskDurationMinutes(original, state.tasks);
        const duplicateStart =
          original.scheduledStartMinutes != null
            ? snapToSchedule(original.scheduledStartMinutes + originalDuration + 10)
            : findNextFreeSlot({ tasks: state.tasks, baseMin });
        const newParent = cloneAs(original, {
          id: newParentId,
          parentId: null,
          scheduledStartMinutes: duplicateStart,
        });
        const children = state.tasks.filter((t) => t.parentId === original.id);
        const newChildren = children.map((c) =>
          cloneAs(c, { id: newChildIds[c.id] ?? newParentId + "-c", parentId: newParent.id }),
        );

        const next = state.tasks.slice();
        const parentIdx = next.findIndex((t) => t.id === original.id);
        let insertAt = parentIdx + 1;
        while (insertAt < next.length && next[insertAt].parentId === original.id) insertAt++;
        next.splice(insertAt, 0, newParent, ...newChildren);
        return { ...state, tasks: normalizeTasks(next) };
      }

      const newSub = cloneAs(original, { id: newParentId, parentId: original.parentId });
      const next = state.tasks.slice();
      const idx = next.findIndex((t) => t.id === original.id);
      next.splice(idx + 1, 0, newSub);
      return { ...state, tasks: normalizeTasks(next) };
    }

    case "REORDER_SPRINT": {
      const topSprintQueued = state.tasks.filter(
        (t) => t.parentId === null && t.status === "queued" && t.inSprint,
      );
      const byId = new Map(topSprintQueued.map((t) => [t.id, t] as const));
      const childrenByParent = new Map<string, Task[]>();
      for (const t of state.tasks) {
        if (!t.parentId) continue;
        const arr = childrenByParent.get(t.parentId) ?? [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      }
      const reorderedTop = applyOrderPositions(
        action.orderedIds.map((id) => byId.get(id)).filter((t): t is Task => Boolean(t)),
        action.nowMs,
      );
      const reorderedWithKids: Task[] = [];
      for (const p of reorderedTop) {
        reorderedWithKids.push(p);
        const kids = childrenByParent.get(p.id);
        if (kids?.length) reorderedWithKids.push(...kids);
      }
      const rest = state.tasks.filter(
        (t) => !(t.parentId === null && t.status === "queued" && t.inSprint),
      );
      return { ...state, tasks: normalizeTasks([...reorderedWithKids, ...rest]) };
    }

    case "SET_TASK_TIME": {
      const snapped = action.minutes == null ? null : snapToSchedule(action.minutes);
      return {
        ...state,
        tasks: normalizeTasks(
          state.tasks.map((t) =>
            t.id === action.id
              ? touch({ ...t, scheduledStartMinutes: snapped }, action.nowMs)
              : t,
          ),
        ),
      };
    }

    case "REORDER_SUBTASKS": {
      const next = state.tasks.slice();
      const parentIdx = next.findIndex((t) => t.id === action.parentId);
      if (parentIdx === -1) return state;
      const start = parentIdx + 1;
      if (start >= next.length) return state;
      let end = start;
      while (end < next.length && next[end].parentId === action.parentId) end++;

      const existingKids = next.slice(start, end);
      const byId = new Map(existingKids.map((t) => [t.id, t] as const));
      const reordered = action.orderedChildIds
        .map((id) => byId.get(id))
        .filter((t): t is Task => Boolean(t));
      for (const k of existingKids) if (!action.orderedChildIds.includes(k.id)) reordered.push(k);

      next.splice(start, end - start, ...applyOrderPositions(reordered, action.nowMs));
      return { ...state, tasks: normalizeTasks(next) };
    }

    case "INSERT_BREAK_PLAN": {
      const { id, minutes, nowMs } = action.payload;
      const baseMin = state.settings.scheduledStartMinutes ?? DEFAULT_DAY_START_MIN;
      const breakTask: Task = {
        id,
        title: "Break",
        notes: "",
        estimateMinutes: minutes,
        extraMinutes: 0,
        scheduledStartMinutes: findNextFreeSlot({ tasks: state.tasks, baseMin }),
        status: "queued",
        kind: "break",
        parentId: null,
        inSprint: true,
        createdAt: nowMs,
        date: todayLocalISO(new Date(nowMs)),
        position: maxPosition(state.tasks) + POSITION_GAP,
        updatedAtMs: nowMs,
      };
      const sprintActive = state.tasks.filter((t) => t.status === "active" && t.inSprint);
      const sprintQueued = state.tasks.filter((t) => t.status === "queued" && t.inSprint);
      const laterQueued = state.tasks.filter((t) => t.status === "queued" && !t.inSprint);
      const done = state.tasks.filter((t) => t.status === "done");
      return {
        ...state,
        tasks: normalizeTasks([...sprintActive, ...sprintQueued, breakTask, ...laterQueued, ...done]),
      };
    }

    case "INSERT_BREAK_NEXT": {
      const { id, minutes, nowMs } = action.payload;
      const baseMin = state.settings.scheduledStartMinutes ?? DEFAULT_DAY_START_MIN;
      const breakTask: Task = {
        id,
        title: "Break",
        notes: "",
        estimateMinutes: minutes,
        extraMinutes: 0,
        scheduledStartMinutes: findNextFreeSlot({ tasks: state.tasks, baseMin }),
        status: "queued",
        kind: "break",
        parentId: null,
        inSprint: true,
        createdAt: nowMs,
        date: todayLocalISO(new Date(nowMs)),
        position: maxPosition(state.tasks) + POSITION_GAP,
        updatedAtMs: nowMs,
      };
      return { ...state, tasks: normalizeTasks([breakTask, ...state.tasks]) };
    }

    case "START_SPRINT": {
      const firstId = getNextStepId(state.tasks);
      if (!firstId) return state;
      const next = state.tasks.map((t) => {
        if (t.status === "active") return touch({ ...t, status: "queued" as const }, action.nowMs);
        if (t.id === firstId) return touch({ ...t, status: "active" as const }, action.nowMs);
        return t;
      });
      return {
        ...state,
        tasks: normalizeTasks(next),
        runner: {
          ...initialState.runner,
          mode: "run",
          activeTaskId: firstId,
          activeStartedAt: action.nowMs,
        },
      };
    }

    case "START_NEXT": {
      const nextId = getNextStepId(state.tasks);
      if (!nextId) {
        return {
          ...state,
          runner: { ...state.runner, autoStartAt: null, awaitingNextStart: true },
        };
      }
      const next = state.tasks.map((t) => {
        if (t.status === "active") return touch({ ...t, status: "queued" as const }, action.nowMs);
        if (t.id === nextId) return touch({ ...t, status: "active" as const }, action.nowMs);
        return t;
      });
      return {
        ...state,
        tasks: normalizeTasks(next),
        runner: {
          ...state.runner,
          mode: "run",
          activeTaskId: nextId,
          activeStartedAt: action.nowMs,
          awaitingNextStart: false,
          pausedAt: null,
          pauseAccumulatedMs: 0,
          autoStartAt: null,
          autoStartPausedAt: null,
          autoStartPausedRemainingMs: null,
        },
      };
    }

    case "COMPLETE_ACTIVE": {
      const activeId = state.runner.activeTaskId;
      if (!activeId) return state;
      let next: Task[] = state.tasks.map((t): Task =>
        t.id === activeId ? touch({ ...t, status: "done" }, action.nowMs) : t,
      );
      const doneTask = state.tasks.find((t) => t.id === activeId);
      if (doneTask?.parentId) {
        next = deriveParentStatusFromKids(doneTask.parentId, next, action.nowMs);
      }
      const shouldExit = state.runner.stopAfterThisTask;
      return {
        ...state,
        tasks: normalizeTasks(next),
        runner: {
          ...state.runner,
          mode: shouldExit ? "plan" : "run",
          activeTaskId: null,
          activeStartedAt: null,
          awaitingNextStart: !shouldExit,
          stopAfterThisTask: false,
          pausedAt: null,
          pauseAccumulatedMs: 0,
          autoStartAt: shouldExit ? null : action.nowMs + AUTO_START_DELAY_MS,
          autoStartPausedAt: null,
          autoStartPausedRemainingMs: null,
        },
        lastCompletion: { taskId: activeId, at: action.nowMs },
      };
    }

    case "DELETE_ACTIVE": {
      const activeId = state.runner.activeTaskId;
      if (!activeId) return state;
      return reducer(state, { type: "DELETE_TASK", id: activeId, nowMs: action.nowMs });
    }

    case "EXTEND_ACTIVE": {
      const id = state.runner.activeTaskId;
      if (!id) return state;
      return {
        ...state,
        tasks: normalizeTasks(
          state.tasks.map((t) =>
            t.id === id
              ? touch({ ...t, extraMinutes: t.extraMinutes + action.minutes }, action.nowMs)
              : t,
          ),
        ),
      };
    }

    case "REDUCE_ACTIVE": {
      const id = state.runner.activeTaskId;
      if (!id) return state;
      return {
        ...state,
        tasks: normalizeTasks(
          state.tasks.map((t) => {
            if (t.id !== id) return t;
            const currentExtra = Math.max(0, t.extraMinutes);
            const takeFromExtra = Math.min(currentExtra, action.minutes);
            const remaining = action.minutes - takeFromExtra;
            const nextExtra = currentExtra - takeFromExtra;
            const nextEstimate = Math.max(1, Math.round(t.estimateMinutes - remaining));
            return touch(
              { ...t, extraMinutes: nextExtra, estimateMinutes: nextEstimate },
              action.nowMs,
            );
          }),
        ),
      };
    }

    case "STOP_AFTER_THIS_TASK":
      return { ...state, runner: { ...state.runner, stopAfterThisTask: true } };

    case "TOGGLE_PAUSE": {
      const r = state.runner;
      if (r.activeTaskId && r.activeStartedAt) {
        if (r.pausedAt) {
          const add = action.nowMs - r.pausedAt;
          return {
            ...state,
            runner: { ...r, pausedAt: null, pauseAccumulatedMs: r.pauseAccumulatedMs + Math.max(0, add) },
          };
        }
        return { ...state, runner: { ...r, pausedAt: action.nowMs } };
      }
      if (r.autoStartAt) {
        if (r.autoStartPausedAt && r.autoStartPausedRemainingMs != null) {
          return {
            ...state,
            runner: {
              ...r,
              autoStartAt: action.nowMs + r.autoStartPausedRemainingMs,
              autoStartPausedAt: null,
              autoStartPausedRemainingMs: null,
            },
          };
        }
        const remaining = Math.max(0, r.autoStartAt - action.nowMs);
        return {
          ...state,
          runner: { ...r, autoStartPausedAt: action.nowMs, autoStartPausedRemainingMs: remaining },
        };
      }
      return state;
    }

    case "EXIT_TO_PLAN": {
      const next = state.tasks.map((t) =>
        t.status === "active" ? touch({ ...t, status: "queued" as const }, action.nowMs) : t,
      );
      return {
        ...state,
        tasks: normalizeTasks(next),
        runner: { ...initialState.runner, mode: "plan" },
      };
    }

    case "AUTO_START_TICK": {
      if (state.runner.mode !== "run") return state;
      if (!state.runner.autoStartAt) return state;
      if (state.runner.autoStartPausedAt) return state;
      if (state.runner.autoStartAt > action.nowMs) return state;

      return reducer(state, { type: "START_NEXT", nowMs: action.nowMs });
    }

    case "SET_LATEST_FINISH":
      return { ...state, settings: { ...state.settings, latestFinishMinutes: action.minutes } };

    case "SET_SCHEDULED_START":
      return { ...state, settings: { ...state.settings, scheduledStartMinutes: action.minutes } };

    case "START_FRESH_DAY":
      return {
        ...state,
        tasks: normalizeTasks(state.tasks.filter((t) => t.status !== "done")),
      };

    case "UNDO_DELETE": {
      if (!state.lastDeletion) return state;
      // Re-stamp restored rows so the undo out-LWWs the delete's tombstone.
      const restored = [
        ...state.tasks,
        ...state.lastDeletion.tasks.map((t) => touch(t, action.nowMs)),
      ];
      return { ...state, tasks: normalizeTasks(restored), lastDeletion: null };
    }

    case "CLEAR_LAST_DELETION":
      return state.lastDeletion ? { ...state, lastDeletion: null } : state;

    default:
      return state;
  }
}
