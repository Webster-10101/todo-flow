import type { RunnerState, Settings, Task } from "./types";
import { DEFAULT_BREAK_MINUTES, DEFAULT_TASK_MINUTES, POSITION_GAP } from "./types";
import { clampMinutes } from "./ids";
import { todayLocalISO } from "./dates";
import { cascade, DAY_END_MIN, DAY_START_MIN, type CascadeBlock } from "./cascade";

export type State = {
  tasks: Task[];
  runner: RunnerState;
  settings: Settings;
  lastCompletion: { taskId: string; at: number } | null;
  // The undo buffer behind the 5s toast. `tasks` are pre-change copies of every
  // row the action touched — removed rows AND rows it merely edited, since
  // UNDO_DELETE restores by id (see there). `label` overrides the toast's
  // default "Deleted N tasks" wording for actions that aren't plain deletes.
  lastDeletion: { tasks: Task[]; at: number; label?: string } | null;
};

export type AddTaskPayload = {
  id: string;
  title: string;
  minutes: number;
  nowMs: number;
  // Optional explicit clock-time override (minutes from midnight). Used by
  // click-to-create on the canvas. Falls back to findNextFreeSlot if absent.
  scheduledStartMinutes?: number;
  // Auto-break: when both are set, a break block of breakMinutes is placed
  // directly after the new task. Handled inside ADD_TASK rather than as a
  // second dispatch so it's one undo step and both rows get stamped together.
  breakId?: string;
  breakMinutes?: number;
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
  | { type: "MOVE_TASK_GROUP"; ids: string[]; deltaMinutes: number; nowMs: number }
  | {
      type: "BATCH_TASKS";
      payload: { ids: string[]; parentId: string; title: string; nowMs: number };
    }
  | { type: "INSERT_BREAK_PLAN"; payload: InsertBreakPayload }
  | { type: "INSERT_BREAK_NEXT"; payload: InsertBreakPayload }
  | { type: "START_SPRINT"; nowMs: number }
  | { type: "START_TASK"; id: string; nowMs: number }
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
  | { type: "START_FRESH_DAY"; nowMs: number }
  | { type: "UNDO_DELETE"; nowMs: number }
  | { type: "CLEAR_LAST_DELETION" }
  | { type: "SET_SCHEDULED_START"; minutes: number | null }
  | {
      type: "SET_POMODORO";
      patch: Partial<
        Pick<Settings, "defaultTaskMinutes" | "defaultBreakMinutes" | "autoBreak">
      >;
    }
  | {
      type: "APPLY_REMOTE_TASKS";
      upserts: Task[];
      deletions: Array<{ id: string; deletedAtMs: number }>;
    }
  | { type: "APPLY_REMOTE_SETTINGS"; settings: Settings };

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
  settings: {
    latestFinishMinutes: 18 * 60,
    scheduledStartMinutes: null,
    defaultTaskMinutes: DEFAULT_TASK_MINUTES,
    defaultBreakMinutes: DEFAULT_BREAK_MINUTES,
    autoBreak: true,
  },
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

// Move the block that's about to start to where the clock actually is, then
// bounce whatever it lands on later. Without this the canvas shows the running
// block sitting in its planned slot while the now-line marches past it — and
// the cascade's "pinned obstacle" (which reads scheduledStartMinutes) would
// guard the wrong stretch of the day. Starting a task IS a plan edit.
//
// startId is the leaf that runs; the canvas block is its top-level ancestor,
// so that's what gets placed.
function placeStartedBlockAtNow(args: {
  tasks: Task[];
  startId: string;
  nowMs: number;
}): Task[] {
  const { tasks, startId, nowMs } = args;
  const leaf = tasks.find((t) => t.id === startId);
  if (!leaf) return tasks;
  const topId = leaf.parentId ?? leaf.id;
  const top = tasks.find((t) => t.id === topId);
  if (!top || !top.inSprint) return tasks;

  const d = new Date(nowMs);
  const startMin = d.getHours() * 60 + d.getMinutes();
  const duration = getTaskDurationMinutes(top, tasks);

  const placed = tasks.map((t) =>
    t.id === topId ? touch({ ...t, scheduledStartMinutes: startMin }, nowMs) : t,
  );
  return cascadeTasks({
    tasks: placed,
    placed: { ids: [topId], intervals: [{ start: startMin, end: startMin + duration }] },
    activeTaskId: startId,
    nowMs,
  });
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

// Bounce-down: after a block lands (dropped, resized, created, extended),
// push every queued sprint block it now collides with LATER, gap-absorbing —
// see cascade.ts. `placed` holds the intervals that just claimed their spots
// (one row, task + auto-break together, or a shift-selected group); its ids
// are excluded from the sweep.
// Displaced rows come back touch()-stamped; everything else keeps its object
// identity so the sync engine's per-id reference diff pushes only real moves.
function cascadeTasks(args: {
  tasks: Task[];
  placed: { ids: string[]; intervals: Array<{ start: number; end: number }> };
  activeTaskId: string | null;
  nowMs: number;
}): Task[] {
  const { tasks, placed, activeTaskId, nowMs } = args;
  const placedIntervals = placed.intervals.filter((i) => i.end > i.start);
  if (placedIntervals.length === 0) return tasks;
  const placedIds = new Set(placed.ids);

  const movable: CascadeBlock[] = [];
  let activeInterval: { start: number; end: number } | null = null;
  for (const t of tasks) {
    if (t.parentId !== null || !t.inSprint || t.scheduledStartMinutes == null) continue;
    if (placedIds.has(t.id) || t.status === "done") continue;
    const duration = getTaskDurationMinutes(t, tasks);
    if (t.id === activeTaskId || t.status === "active") {
      // The running block is pinned to activeStartedAt — never moved.
      activeInterval = {
        start: t.scheduledStartMinutes,
        end: t.scheduledStartMinutes + duration,
      };
      continue;
    }
    movable.push({
      id: t.id,
      start: t.scheduledStartMinutes,
      duration,
      position: t.position,
      createdAt: t.createdAt,
    });
  }

  const obstacles = [...placedIntervals];
  if (activeInterval) obstacles.push(activeInterval);
  const { moves } = cascade({ movable, obstacles });
  if (moves.size === 0) return tasks;

  return tasks.map((t) => {
    const newStart = moves.get(t.id);
    return newStart == null
      ? t
      : touch({ ...t, scheduledStartMinutes: newStart }, nowMs);
  });
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
    byParent.delete(p.id);
  }
  // Keep orphan children (parent not in this array) instead of dropping them.
  // Realtime sync applies single-row events, so a child can legitimately
  // arrive before its parent — dropping it here would tombstone it.
  for (const kids of byParent.values()) {
    out.push(...kids.slice().sort(byPosition));
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

// What "Start fresh day" will do, decided in one place so the button's enabled
// state, the confirm copy and the reducer can't drift apart.
//
// The canvas — not the whole task list — is what gets cleared:
//   swept  = today's completions (sprint or Later) + auto-break furniture.
//            Breaks are never ticked off, so without this they survive every
//            clear and roll forward forever as orphans.
//   parked = unfinished canvas tasks, dropped into Later unscheduled. These
//            are what actually clutters a new morning: rollDay carries every
//            undone task forward, and the old sweep left all of them in place.
// Untouched: previous days' completions (that's the history the plan view
// already hides by date), anything already in Later, and the running block.
export function planFreshDay(
  tasks: Task[],
  opts: { today: string; activeTaskId: string | null },
): { sweptIds: Set<string>; parkedIds: Set<string> } {
  const { today } = opts;
  const sweptIds = new Set<string>();
  const parkedIds = new Set<string>();

  for (const t of tasks) {
    if (t.parentId !== null) continue; // children follow their parent
    if (t.id === opts.activeTaskId) continue; // never yank the block that's running
    if (t.status === "done") {
      if (t.date === today) sweptIds.add(t.id);
      continue;
    }
    if (!t.inSprint) continue; // already parked in Later
    if (t.kind === "break") sweptIds.add(t.id);
    else parkedIds.add(t.id);
  }

  return { sweptIds, parkedIds };
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
      const {
        id,
        title,
        minutes,
        nowMs,
        scheduledStartMinutes: override,
        breakId,
        breakMinutes,
      } = action.payload;
      const baseMin = state.settings.scheduledStartMinutes ?? DEFAULT_DAY_START_MIN;
      const taskMinutes = clampMinutes(minutes);
      const scheduledStartMinutes =
        override != null
          ? Math.min(
              snapToSchedule(override),
              Math.max(0, DAY_END_MIN - taskMinutes),
            )
          : findNextFreeSlot({ tasks: state.tasks, baseMin });
      const basePosition = maxPosition(state.tasks) + POSITION_GAP;
      const t: Task = {
        id,
        title,
        notes: "",
        estimateMinutes: taskMinutes,
        extraMinutes: 0,
        scheduledStartMinutes,
        status: "queued",
        kind: "task",
        parentId: null,
        inSprint: true,
        createdAt: nowMs,
        date: todayLocalISO(new Date(nowMs)),
        position: basePosition,
        updatedAtMs: nowMs,
      };

      const added: Task[] = [t];
      // Auto-break: butted right up against the task, deliberately NOT
      // snapped to the 15-min grid — a 25-min task at 09:00 gets its break at
      // 09:25, so the 30-minute cycle lands back on the grid at 09:30.
      // Anything already occupying that window gets bounced by the cascade
      // below; the break is only skipped when there's no room before midnight.
      const breakStart =
        breakId != null &&
        breakMinutes != null &&
        breakMinutes > 0 &&
        scheduledStartMinutes + taskMinutes + breakMinutes <= DAY_END_MIN
          ? scheduledStartMinutes + taskMinutes
          : null;
      if (breakId && breakStart != null) {
        added.push({
          id: breakId,
          title: "Break",
          notes: "",
          estimateMinutes: clampMinutes(breakMinutes as number),
          extraMinutes: 0,
          scheduledStartMinutes: breakStart,
          status: "queued",
          kind: "break",
          parentId: null,
          inSprint: true,
          createdAt: nowMs,
          date: todayLocalISO(new Date(nowMs)),
          position: basePosition + POSITION_GAP,
          updatedAtMs: nowMs,
        });
      }

      // One cascade for the combined task+break span — both rows land as a
      // unit, and it stays one action (one undo step, both rows stamped).
      const placedEnd =
        breakStart != null && breakMinutes != null
          ? breakStart + clampMinutes(breakMinutes)
          : scheduledStartMinutes + taskMinutes;
      return {
        ...state,
        tasks: normalizeTasks(
          cascadeTasks({
            tasks: [...added, ...state.tasks],
            placed: {
              ids: added.map((a) => a.id),
              intervals: [{ start: scheduledStartMinutes, end: placedEnd }],
            },
            activeTaskId: state.runner.activeTaskId,
            nowMs,
          }),
        ),
      };
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
      // A new subtask grows the parent's derived duration — its block may now
      // collide with whatever sits below it.
      const parent = next[parentIdx];
      let out = next;
      if (parent.inSprint && parent.status !== "done" && parent.scheduledStartMinutes != null) {
        out = cascadeTasks({
          tasks: next,
          placed: {
            ids: [parent.id],
            intervals: [
              {
                start: parent.scheduledStartMinutes,
                end: parent.scheduledStartMinutes + getTaskDurationMinutes(parent, next),
              },
            ],
          },
          activeTaskId: state.runner.activeTaskId,
          nowMs,
        });
      }
      return { ...state, tasks: normalizeTasks(out) };
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

    case "EDIT_MINUTES": {
      const next = state.tasks.map((t) =>
        t.id === action.id
          ? touch(
              { ...t, estimateMinutes: clampMinutes(action.minutes), extraMinutes: 0 },
              action.nowMs,
            )
          : t,
      );
      // Growing a block (or a subtask growing its parent's derived duration)
      // pushes whatever it now collides with, rather than being capped.
      const target = next.find((t) => t.id === action.id);
      const block = target?.parentId
        ? next.find((t) => t.id === target.parentId)
        : target;
      let out = next;
      if (
        block &&
        block.parentId === null &&
        block.inSprint &&
        block.status !== "done" &&
        block.scheduledStartMinutes != null
      ) {
        out = cascadeTasks({
          tasks: next,
          placed: {
            ids: [block.id],
            intervals: [
              {
                start: block.scheduledStartMinutes,
                end: block.scheduledStartMinutes + getTaskDurationMinutes(block, next),
              },
            ],
          },
          activeTaskId: state.runner.activeTaskId,
          nowMs: action.nowMs,
        });
      }
      return { ...state, tasks: normalizeTasks(out) };
    }

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
      const next = state.tasks.map((t) =>
        t.id === action.id
          ? touch({ ...t, inSprint: true, scheduledStartMinutes: slot }, action.nowMs)
          : t,
      );
      // A kept-from-before time can land on today's blocks — bounce them.
      return {
        ...state,
        tasks: normalizeTasks(
          cascadeTasks({
            tasks: next,
            placed: {
              ids: [action.id],
              intervals: [
                { start: slot, end: slot + getTaskDurationMinutes(target, state.tasks) },
              ],
            },
            activeTaskId: state.runner.activeTaskId,
            nowMs: action.nowMs,
          }),
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
            ? Math.min(
                snapToSchedule(original.scheduledStartMinutes + originalDuration + 10),
                Math.max(0, DAY_END_MIN - originalDuration),
              )
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
        return {
          ...state,
          tasks: normalizeTasks(
            cascadeTasks({
              tasks: next,
              placed: {
                ids: [newParent.id],
                intervals: [
                  {
                    start: duplicateStart,
                    end: duplicateStart + getTaskDurationMinutes(newParent, next),
                  },
                ],
              },
              activeTaskId: state.runner.activeTaskId,
              nowMs,
            }),
          ),
        };
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
      const target = state.tasks.find((t) => t.id === action.id);
      if (!target) return state;
      if (action.minutes == null) {
        return {
          ...state,
          tasks: normalizeTasks(
            state.tasks.map((t) =>
              t.id === action.id
                ? touch({ ...t, scheduledStartMinutes: null }, action.nowMs)
                : t,
            ),
          ),
        };
      }
      const duration = getTaskDurationMinutes(target, state.tasks);
      const snapped = Math.min(
        snapToSchedule(action.minutes),
        Math.max(0, DAY_END_MIN - duration),
      );
      const next = state.tasks.map((t) =>
        t.id === action.id
          ? touch({ ...t, scheduledStartMinutes: snapped }, action.nowMs)
          : t,
      );
      // The drag-commit path: whatever the block landed on bounces down.
      return {
        ...state,
        tasks: normalizeTasks(
          cascadeTasks({
            tasks: next,
            placed: {
              ids: [action.id],
              intervals: [{ start: snapped, end: snapped + duration }],
            },
            activeTaskId: state.runner.activeTaskId,
            nowMs: action.nowMs,
          }),
        ),
      };
    }

    case "BATCH_TASKS": {
      // Fold several small blocks into one. The day is full of two- and
      // five-minute admin; as separate blocks they're unreadable slivers, and
      // as one batch they're a single box you can still see inside (the canvas
      // draws the subtask lines). Duration comes from the parts, so the batch
      // never claims more of the day than the jobs actually take.
      const { ids, parentId, title, nowMs } = action.payload;
      const members = state.tasks.filter(
        (t) =>
          ids.includes(t.id) &&
          t.parentId === null &&
          t.inSprint &&
          t.kind === "task" &&
          t.status !== "active" &&
          t.id !== state.runner.activeTaskId &&
          // No nesting: a block that already has subtasks stays as it is.
          !state.tasks.some((c) => c.parentId === t.id),
      );
      if (members.length < 2) return state;

      const memberIds = new Set(members.map((t) => t.id));
      const startMin = members.reduce<number | null>((acc, t) => {
        if (t.scheduledStartMinutes == null) return acc;
        return acc == null ? t.scheduledStartMinutes : Math.min(acc, t.scheduledStartMinutes);
      }, null);
      // Keep the order they sat in on the day.
      const ordered = members.slice().sort((a, b) => {
        const aS = a.scheduledStartMinutes ?? Number.POSITIVE_INFINITY;
        const bS = b.scheduledStartMinutes ?? Number.POSITIVE_INFINITY;
        return aS - bS || a.position - b.position;
      });

      const parent: Task = {
        id: parentId,
        title,
        notes: "",
        // Zero like ADD_SUBTASK's first-child case: the kids are the duration.
        estimateMinutes: 0,
        extraMinutes: 0,
        scheduledStartMinutes: startMin,
        status: "queued",
        kind: "task",
        parentId: null,
        inSprint: true,
        createdAt: nowMs,
        date: todayLocalISO(new Date(nowMs)),
        position: maxPosition(state.tasks.filter((t) => t.parentId === null)) + POSITION_GAP,
        updatedAtMs: nowMs,
      };

      const rest = state.tasks.filter((t) => !memberIds.has(t.id));
      const kids = ordered.map((t, i) =>
        touch(
          {
            ...t,
            parentId,
            scheduledStartMinutes: null,
            inSprint: true,
            position: (i + 1) * POSITION_GAP,
          },
          nowMs,
        ),
      );
      const merged = [...rest, parent, ...kids];
      const duration = getTaskDurationMinutes(parent, merged);
      const out =
        startMin == null
          ? merged
          : cascadeTasks({
              tasks: merged,
              placed: {
                ids: [parentId],
                intervals: [{ start: startMin, end: startMin + duration }],
              },
              activeTaskId: state.runner.activeTaskId,
              nowMs,
            });
      return { ...state, tasks: normalizeTasks(out) };
    }

    case "MOVE_TASK_GROUP": {
      // Shift-selected group drag: every block moves by the same delta, so
      // relative gaps survive by construction. The delta is clamped for the
      // group as a unit — the whole selection hits the day edge together
      // instead of concertinaing. No per-block snapping: the canvas hands us
      // a slot-snapped delta, and off-grid members (auto-breaks) stay glued.
      const group = state.tasks.filter(
        (t) =>
          action.ids.includes(t.id) &&
          t.parentId === null &&
          t.inSprint &&
          t.scheduledStartMinutes != null &&
          t.status !== "done" &&
          t.status !== "active" &&
          t.id !== state.runner.activeTaskId,
      );
      if (group.length === 0) return state;
      let minStart = Number.POSITIVE_INFINITY;
      let maxEnd = Number.NEGATIVE_INFINITY;
      for (const t of group) {
        const start = t.scheduledStartMinutes as number;
        minStart = Math.min(minStart, start);
        maxEnd = Math.max(maxEnd, start + getTaskDurationMinutes(t, state.tasks));
      }
      const delta = Math.max(
        DAY_START_MIN - minStart,
        Math.min(action.deltaMinutes, DAY_END_MIN - maxEnd),
      );
      if (delta === 0) return state;
      const groupIds = new Set(group.map((t) => t.id));
      const next = state.tasks.map((t) =>
        groupIds.has(t.id)
          ? touch(
              {
                ...t,
                scheduledStartMinutes: (t.scheduledStartMinutes as number) + delta,
              },
              action.nowMs,
            )
          : t,
      );
      return {
        ...state,
        tasks: normalizeTasks(
          cascadeTasks({
            tasks: next,
            placed: {
              ids: group.map((t) => t.id),
              intervals: group.map((t) => {
                const start = (t.scheduledStartMinutes as number) + delta;
                return {
                  start,
                  end: start + getTaskDurationMinutes(t, state.tasks),
                };
              }),
            },
            activeTaskId: state.runner.activeTaskId,
            nowMs: action.nowMs,
          }),
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
        tasks: normalizeTasks(
          placeStartedBlockAtNow({ tasks: next, startId: firstId, nowMs: action.nowMs }),
        ),
        runner: {
          ...initialState.runner,
          mode: "run",
          activeTaskId: firstId,
          activeStartedAt: action.nowMs,
        },
      };
    }

    // Start one specific task, rather than whatever comes first in the sprint.
    // Same end state as START_SPRINT — it just picks the target explicitly.
    case "START_TASK": {
      const target = state.tasks.find((t) => t.id === action.id);
      if (!target || target.status === "done") return state;

      // Starting a parent means starting its first unfinished subtask, the same
      // rule getNextStepId uses — the runner should never sit on a task whose
      // real work lives in its children.
      const kids = state.tasks.filter(
        (t) => t.parentId === target.id && t.status !== "done",
      );
      const startId = kids.length ? (kids.find((k) => k.status === "queued") ?? kids[0]).id : target.id;

      const next = state.tasks.map((t) => {
        if (t.id === startId) return touch({ ...t, status: "active" as const }, action.nowMs);
        // Whatever was running gets put back in the queue, not lost.
        if (t.status === "active") return touch({ ...t, status: "queued" as const }, action.nowMs);
        return t;
      });

      return {
        ...state,
        tasks: normalizeTasks(
          placeStartedBlockAtNow({ tasks: next, startId, nowMs: action.nowMs }),
        ),
        runner: {
          ...initialState.runner,
          mode: "run",
          activeTaskId: startId,
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
        tasks: normalizeTasks(
          placeStartedBlockAtNow({ tasks: next, startId: nextId, nowMs: action.nowMs }),
        ),
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
      const next = state.tasks.map((t) =>
        t.id === id
          ? touch({ ...t, extraMinutes: t.extraMinutes + action.minutes }, action.nowMs)
          : t,
      );
      // Growing the running block pushes what's below it. The placed span is
      // where the timer ACTUALLY is: for a top-level active task that's
      // activeStartedAt + duration + pauses (the rendered position), not the
      // stale scheduledStartMinutes; an active subtask grows its parent
      // block, which renders at the parent's scheduled time.
      const active = next.find((t) => t.id === id);
      const r = state.runner;
      let placed: {
        ids: string[];
        intervals: Array<{ start: number; end: number }>;
      } | null = null;
      if (active && active.parentId === null && r.activeStartedAt != null) {
        const startDate = new Date(r.activeStartedAt);
        const startMin = startDate.getHours() * 60 + startDate.getMinutes();
        const pausedSoFar =
          r.pauseAccumulatedMs +
          (r.pausedAt ? Math.max(0, action.nowMs - r.pausedAt) : 0);
        const endMin = Math.min(
          DAY_END_MIN,
          Math.ceil(startMin + getTaskDurationMinutes(active, next) + pausedSoFar / 60_000),
        );
        placed = { ids: [id], intervals: [{ start: startMin, end: endMin }] };
      } else if (active?.parentId != null) {
        const parent = next.find((t) => t.id === active.parentId);
        if (parent && parent.inSprint && parent.scheduledStartMinutes != null) {
          placed = {
            ids: [parent.id],
            intervals: [
              {
                start: parent.scheduledStartMinutes,
                end:
                  parent.scheduledStartMinutes + getTaskDurationMinutes(parent, next),
              },
            ],
          };
        }
      }
      const out = placed
        ? cascadeTasks({ tasks: next, placed, activeTaskId: id, nowMs: action.nowMs })
        : next;
      return { ...state, tasks: normalizeTasks(out) };
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

    case "SET_POMODORO": {
      const patch = action.patch;
      return {
        ...state,
        settings: {
          ...state.settings,
          ...(patch.defaultTaskMinutes != null
            ? { defaultTaskMinutes: clampMinutes(patch.defaultTaskMinutes) }
            : {}),
          // 0 is meaningful here — it's how you say "no break" without turning
          // the whole feature off — so only the floor is clamped.
          ...(patch.defaultBreakMinutes != null
            ? { defaultBreakMinutes: Math.max(0, Math.round(patch.defaultBreakMinutes)) }
            : {}),
          ...(patch.autoBreak != null ? { autoBreak: patch.autoBreak } : {}),
        },
      };
    }

    case "START_FRESH_DAY": {
      const { sweptIds, parkedIds } = planFreshDay(state.tasks, {
        today: todayLocalISO(new Date(action.nowMs)),
        activeTaskId: state.runner.activeTaskId,
      });
      if (sweptIds.size === 0 && parkedIds.size === 0) return state;

      const isSwept = (t: Task) =>
        sweptIds.has(t.id) || (t.parentId !== null && sweptIds.has(t.parentId));

      // Parked tasks join the end of Later in the order they sat on the canvas,
      // rather than interleaving with what's already there on stale positions.
      const laterBase = maxPosition(
        state.tasks.filter(
          (t) => t.parentId === null && !t.inSprint && !parkedIds.has(t.id) && !isSwept(t),
        ),
      );
      const parkOrder = new Map(
        state.tasks
          .filter((t) => parkedIds.has(t.id))
          .slice()
          .sort(
            (a, b) =>
              (a.scheduledStartMinutes ?? Number.POSITIVE_INFINITY) -
                (b.scheduledStartMinutes ?? Number.POSITIVE_INFINITY) ||
              a.createdAt - b.createdAt,
          )
          .map((t, i) => [t.id, laterBase + (i + 1) * POSITION_GAP] as const),
      );

      // Pre-change copies of everything touched, so one Undo restores the whole
      // day — the removals and the parked tasks' schedule alike.
      const touched = state.tasks.filter((t) => isSwept(t) || parkedIds.has(t.id));

      const nextTasks = state.tasks
        .filter((t) => !isSwept(t))
        .map((t) =>
          parkedIds.has(t.id)
            ? touch(
                {
                  ...t,
                  inSprint: false,
                  scheduledStartMinutes: null,
                  position: parkOrder.get(t.id) ?? t.position,
                },
                action.nowMs,
              )
            : t,
        );

      return {
        ...state,
        tasks: normalizeTasks(nextTasks),
        // The Later list sits below the canvas on desktop, so parked tasks land
        // off-screen — the toast has to say where they went.
        lastDeletion: {
          tasks: touched,
          at: action.nowMs,
          label: parkedIds.size
            ? `Day cleared · ${parkedIds.size} task${parkedIds.size === 1 ? "" : "s"} moved to Later`
            : "Day cleared",
        },
      };
    }

    case "UNDO_DELETE": {
      if (!state.lastDeletion) return state;
      // Restore by id, not by append: the buffer can hold rows that were only
      // edited (Start fresh day parks tasks rather than deleting them), and a
      // row can also have been re-created by an inbound sync since the delete.
      // Either way the pre-change copy wins. Re-stamped so the undo out-LWWs
      // both the delete's tombstone and the edit it's reverting.
      const byId = new Map(state.tasks.map((t) => [t.id, t] as const));
      for (const t of state.lastDeletion.tasks) byId.set(t.id, touch(t, action.nowMs));
      return {
        ...state,
        tasks: normalizeTasks([...byId.values()]),
        lastDeletion: null,
      };
    }

    case "CLEAR_LAST_DELETION":
      return state.lastDeletion ? { ...state, lastDeletion: null } : state;

    // Inbound sync: last-write-wins per row on updatedAtMs. Rows the local
    // copy has touched more recently are skipped; tombstones remove unless
    // the local row is newer than the delete.
    case "APPLY_REMOTE_TASKS": {
      const byId = new Map(state.tasks.map((t) => [t.id, t] as const));
      let changed = false;
      for (const incoming of action.upserts) {
        const cur = byId.get(incoming.id);
        if (cur && cur.updatedAtMs >= incoming.updatedAtMs) continue;
        byId.set(incoming.id, incoming);
        changed = true;
      }
      for (const del of action.deletions) {
        const cur = byId.get(del.id);
        if (!cur) continue;
        if (cur.updatedAtMs > del.deletedAtMs) continue;
        byId.delete(del.id);
        changed = true;
      }
      if (!changed) return state;

      // If the task being run right now was completed or deleted on another
      // device, clear the runner rather than ticking a ghost.
      let runner = state.runner;
      const activeId = runner.activeTaskId;
      if (activeId) {
        const active = byId.get(activeId);
        if (!active || active.status === "done") {
          runner = clearedRunner(runner, { awaitingNext: true });
        }
      }
      return { ...state, tasks: normalizeTasks([...byId.values()]), runner };
    }

    case "APPLY_REMOTE_SETTINGS":
      return { ...state, settings: action.settings };

    default:
      return state;
  }
}
