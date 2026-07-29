// Sparse ordering gap for Task.position — midpoint insertion between
// neighbours keeps reorders from dirtying every row (matters once rows sync).
export const POSITION_GAP = 1024;

export type TaskKind = "task" | "break";
export type TaskStatus = "queued" | "active" | "done";

export type Task = {
  id: string;
  title: string;
  notes: string;
  estimateMinutes: number;
  extraMinutes: number;
  // Absolute scheduled clock-time in minutes from midnight (e.g. 540 = 09:00).
  // Null for tasks not in the sprint (Later/Done). User placements snap to the
  // 15-min grid; cascade-displaced blocks and auto-breaks can sit off-grid.
  scheduledStartMinutes: number | null;
  status: TaskStatus;
  kind: TaskKind;
  // If set, this task is a subtask belonging under a parent task.
  parentId: string | null;
  inSprint: boolean;
  createdAt: number;
  // Local calendar day this task belongs to (YYYY-MM-DD). Undone tasks roll
  // forward on hydrate; done tasks keep their day (that's the history).
  date: string;
  // Sparse sort key for the Later list and subtask order (midpoint insertion,
  // seed gap 1024). Sprint order derives from scheduledStartMinutes instead.
  position: number;
  // Last-modified stamp (epoch ms) — the sync engine's LWW clock. Every
  // reducer mutation must stamp the rows it touches (see touch()).
  updatedAtMs: number;
};

export type Mode = "plan" | "run";

export type RunnerState = {
  mode: Mode;
  activeTaskId: string | null;
  activeStartedAt: number | null;
  awaitingNextStart: boolean;
  stopAfterThisTask: boolean;
  // Pause support (extends end time by time paused)
  pausedAt: number | null;
  pauseAccumulatedMs: number;
  // After marking done, optionally auto-start next task after a countdown
  autoStartAt: number | null; // epoch ms when next task should start
  autoStartPausedAt: number | null; // epoch ms when countdown was paused
  autoStartPausedRemainingMs: number | null; // remaining ms when paused
};

export type Settings = {
  // Minutes from midnight local time (e.g. 18:00 => 1080)
  latestFinishMinutes: number;
  // Optional scheduled day-start time; null = "start now"
  scheduledStartMinutes: number | null;
  // Pomodoro rhythm. New tasks get defaultTaskMinutes, and when autoBreak is on
  // a break of defaultBreakMinutes is placed directly after them — visible on
  // the canvas, so the projected finish accounts for the breaks you'll take.
  defaultTaskMinutes: number;
  defaultBreakMinutes: number;
  autoBreak: boolean;
};

export const DEFAULT_TASK_MINUTES = 25;
export const DEFAULT_BREAK_MINUTES = 5;

// v1 tasks predate date/position/updatedAtMs — loadState() migrates them.
export type PersistedTaskV1 = Omit<Task, "date" | "position" | "updatedAtMs">;

export type PersistedStateV1 = {
  version: 1;
  tasks: PersistedTaskV1[];
  runner: RunnerState;
  settings: Settings;
};

export type PersistedStateV2 = {
  version: 2;
  tasks: Task[];
  runner: RunnerState;
  settings: Settings;
};


