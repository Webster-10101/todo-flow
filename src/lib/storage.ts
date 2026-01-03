import type { PersistedStateV1, RunnerState, Settings, Task, TaskKind, TaskStatus } from "./types";

const STORAGE_KEY = "todoflow:v1";

function isValidTaskStatus(status: unknown): status is TaskStatus {
  return status === "queued" || status === "active" || status === "done";
}

function isValidTaskKind(kind: unknown): kind is TaskKind {
  return kind === "task" || kind === "break";
}

function isValidTask(obj: unknown): obj is Task {
  if (!obj || typeof obj !== "object") return false;
  const t = obj as Record<string, unknown>;
  
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.estimateMinutes === "number" &&
    typeof t.extraMinutes === "number" &&
    isValidTaskStatus(t.status) &&
    isValidTaskKind(t.kind) &&
    (t.parentId === undefined || t.parentId === null || typeof t.parentId === "string") &&
    typeof t.inSprint === "boolean" &&
    typeof t.createdAt === "number"
  );
}

function isValidRunnerState(obj: unknown): obj is RunnerState {
  if (!obj || typeof obj !== "object") return false;
  const r = obj as Record<string, unknown>;
  
  return (
    (r.mode === "plan" || r.mode === "run") &&
    (r.activeTaskId === null || typeof r.activeTaskId === "string") &&
    (r.activeStartedAt === null || typeof r.activeStartedAt === "number") &&
    typeof r.awaitingNextStart === "boolean" &&
    typeof r.stopAfterThisTask === "boolean" &&
    (r.pausedAt === null || typeof r.pausedAt === "number") &&
    typeof r.pauseAccumulatedMs === "number" &&
    (r.autoStartAt === null || typeof r.autoStartAt === "number") &&
    (r.autoStartPausedAt === null || typeof r.autoStartPausedAt === "number") &&
    (r.autoStartPausedRemainingMs === null || typeof r.autoStartPausedRemainingMs === "number")
  );
}

function isValidSettings(obj: unknown): obj is Settings {
  if (!obj || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  
  return typeof s.latestFinishMinutes === "number";
}

export function getDefaultSettings(): Settings {
  return { latestFinishMinutes: 18 * 60 };
}

export function getDefaultRunner(): RunnerState {
  return {
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
  };
}

export function getDefaultTasks(): Task[] {
  return [];
}

export function loadState(): PersistedStateV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedStateV1> | null;
    if (!parsed || parsed.version !== 1) return null;

    // Validate and filter tasks
    const validTasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter(isValidTask)
          .map((t) => ({ ...t, parentId: t.parentId ?? null }))
      : [];

    // Validate runner state
    const validRunner = parsed.runner && isValidRunnerState(parsed.runner)
      ? parsed.runner
      : getDefaultRunner();

    // Validate settings
    const validSettings = parsed.settings && isValidSettings(parsed.settings)
      ? parsed.settings
      : getDefaultSettings();

    return {
      version: 1,
      tasks: validTasks,
      runner: validRunner,
      settings: validSettings,
    };
  } catch {
    return null;
  }
}

export function saveState(state: PersistedStateV1): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // quota exceeded or private mode
    return false;
  }
}


