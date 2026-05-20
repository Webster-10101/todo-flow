import type { RunnerState, Settings, Task } from "./types";

export function minutesToMs(min: number) {
  return Math.max(0, Math.round(min * 60_000));
}

export function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

export function formatClock(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatMinutesOfDay(minutesFromMidnight: number) {
  const m = ((minutesFromMidnight % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return `${pad2(h)}:${pad2(mins)}`;
}

export function parseHHMMToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function formatCountdown(ms: number) {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

export function getTodayAtMinutes(now: Date, minutesFromMidnight: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutesFromMidnight);
  return d;
}

export function getTaskTotalMinutes(t: Task) {
  return Math.max(0, Math.round(t.estimateMinutes + t.extraMinutes));
}

export function formatTotalMinutes(totalMinutes: number) {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm}m`;
  return `${h}h ${mm.toString().padStart(2, "0")}m`;
}

function getChildren(parentId: string, tasks: Task[]) {
  return tasks.filter((t) => t.parentId === parentId);
}

function getTopLevelInSprint(tasks: Task[]) {
  return tasks.filter((t) => t.parentId === null && t.status !== "done" && t.inSprint);
}

export function getSprintPlannedMinutes(tasks: Task[]) {
  // Sum remaining, in-sprint work. If a parent has children, count children instead of the parent.
  // This mirrors the PlanView behavior where parent minutes become derived when subtasks exist.
  let total = 0;
  const top = tasks.filter((t) => t.parentId === null && t.inSprint && t.status !== "done");
  for (const t of top) {
    if (t.kind === "break") {
      total += getTaskTotalMinutes(t);
      continue;
    }
    const kids = getChildren(t.id, tasks).filter((c) => c.status !== "done");
    if (kids.length) {
      for (const c of kids) total += getTaskTotalMinutes(c);
    } else {
      total += getTaskTotalMinutes(t);
    }
  }
  return total;
}

export function getActiveRemainingMs(args: {
  nowMs: number;
  runner: RunnerState;
  tasks: Task[];
}) {
  const { nowMs, runner, tasks } = args;
  if (!runner.activeTaskId || !runner.activeStartedAt) return 0;
  const task = tasks.find((t) => t.id === runner.activeTaskId);
  if (!task) return 0;
  const durationMs = minutesToMs(getTaskTotalMinutes(task));
  const pausedSoFar =
    runner.pauseAccumulatedMs + (runner.pausedAt ? Math.max(0, nowMs - runner.pausedAt) : 0);
  const endAt = runner.activeStartedAt + durationMs + pausedSoFar;
  return Math.max(0, endAt - nowMs);
}

export type SprintScheduleRow = {
  taskId: string;
  startMs: number;
  endMs: number;
  minutes: number;
};

export type SprintSchedule = {
  anchorMs: number;
  rows: SprintScheduleRow[];
  totalMinutes: number;
};

// Per-task start/end times for every top-level not-done in-sprint task.
// Each task's start is its absolute `scheduledStartMinutes` projected onto today.
// Active task's start is pinned to activeStartedAt regardless of stored value.
export function computeSprintSchedule(args: {
  tasks: Task[];
  runner: RunnerState;
  nowMs: number;
  scheduledStartMs: number | null;
}): SprintSchedule {
  const { tasks, runner, nowMs } = args;

  const isRunning = Boolean(runner.activeTaskId && runner.activeStartedAt);
  const pausedSoFar = isRunning
    ? runner.pauseAccumulatedMs + (runner.pausedAt ? Math.max(0, nowMs - runner.pausedAt) : 0)
    : 0;

  const getMinutesFor = (t: Task): number => {
    if (t.kind === "break") return getTaskTotalMinutes(t);
    const kids = getChildren(t.id, tasks).filter((c) => c.status !== "done");
    if (kids.length) {
      let total = 0;
      for (const c of kids) total += getTaskTotalMinutes(c);
      return total;
    }
    return getTaskTotalMinutes(t);
  };

  const top = getTopLevelInSprint(tasks);
  const rows: SprintScheduleRow[] = [];
  let totalMinutes = 0;

  for (const t of top) {
    const minutes = getMinutesFor(t);
    const isActive = isRunning && t.id === runner.activeTaskId;

    if (isActive && runner.activeStartedAt) {
      const startMs = runner.activeStartedAt;
      const endMs = startMs + minutesToMs(minutes) + pausedSoFar;
      rows.push({ taskId: t.id, startMs, endMs, minutes });
      totalMinutes += minutes;
      continue;
    }

    if (t.scheduledStartMinutes == null) {
      // Unscheduled task — projected from nowMs as a fallback (shouldn't happen
      // after hydrate migration, but keep math defined).
      const startMs = nowMs;
      const endMs = startMs + minutesToMs(minutes);
      rows.push({ taskId: t.id, startMs, endMs, minutes });
      totalMinutes += minutes;
      continue;
    }

    const startMs = getTodayAtMinutes(new Date(nowMs), t.scheduledStartMinutes).getTime();
    const endMs = startMs + minutesToMs(minutes);
    rows.push({ taskId: t.id, startMs, endMs, minutes });
    totalMinutes += minutes;
  }

  // Projected finish = max endMs across rows (tasks may not be in time order).
  const anchorMs = rows.length
    ? rows.reduce((min, r) => Math.min(min, r.startMs), rows[0].startMs)
    : nowMs;

  return { anchorMs, rows, totalMinutes };
}

export function getProjectedFinishDate(args: {
  nowMs: number;
  runner: RunnerState;
  tasks: Task[];
  scheduledStartMs?: number | null;
}) {
  const schedule = computeSprintSchedule({
    tasks: args.tasks,
    runner: args.runner,
    nowMs: args.nowMs,
    scheduledStartMs: args.scheduledStartMs ?? null,
  });
  if (schedule.rows.length === 0) return new Date(schedule.anchorMs);
  // Tasks may not be in chronological order; finish = max end across all rows.
  const lastEnd = schedule.rows.reduce((max, r) => Math.max(max, r.endMs), 0);
  return new Date(lastEnd);
}

export function isProjectedPastCutoff(args: {
  now: Date;
  projectedFinish: Date;
  settings: Settings;
}) {
  const cutoff = getTodayAtMinutes(args.now, args.settings.latestFinishMinutes);
  return args.projectedFinish.getTime() > cutoff.getTime();
}


