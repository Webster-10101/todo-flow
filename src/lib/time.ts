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

function getChildren(parentId: string, tasks: Task[]) {
  return tasks.filter((t) => t.parentId === parentId);
}

function getTopLevelInSprint(tasks: Task[]) {
  return tasks.filter((t) => t.parentId === null && t.status !== "done" && t.inSprint);
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

export function getProjectedFinishDate(args: {
  nowMs: number;
  runner: RunnerState;
  tasks: Task[];
}) {
  const { nowMs, runner, tasks } = args;
  let remainingMs = 0;
  remainingMs += getActiveRemainingMs({ nowMs, runner, tasks });

  const top = getTopLevelInSprint(tasks);
  for (const t of top) {
    if (t.kind === "break") {
      if (t.status === "queued") remainingMs += minutesToMs(getTaskTotalMinutes(t));
      continue;
    }

    const kids = getChildren(t.id, tasks).filter((c) => c.status !== "done");
    if (kids.length) {
      for (const c of kids) {
        if (c.status === "queued") remainingMs += minutesToMs(getTaskTotalMinutes(c));
      }
      continue;
    }

    if (t.status === "queued") remainingMs += minutesToMs(getTaskTotalMinutes(t));
  }

  return new Date(nowMs + remainingMs);
}

export function isProjectedPastCutoff(args: {
  now: Date;
  projectedFinish: Date;
  settings: Settings;
}) {
  const cutoff = getTodayAtMinutes(args.now, args.settings.latestFinishMinutes);
  return args.projectedFinish.getTime() > cutoff.getTime();
}


