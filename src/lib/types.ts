export type TaskKind = "task" | "break";
export type TaskStatus = "queued" | "active" | "done";

export type Task = {
  id: string;
  title: string;
  estimateMinutes: number;
  extraMinutes: number;
  status: TaskStatus;
  kind: TaskKind;
  // If set, this task is a subtask belonging under a parent task.
  parentId: string | null;
  inSprint: boolean;
  createdAt: number;
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
};

export type PersistedStateV1 = {
  version: 1;
  tasks: Task[];
  runner: RunnerState;
  settings: Settings;
};


