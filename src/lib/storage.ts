import type {
  PersistedStateV1,
  PersistedStateV2,
  PersistedTaskV1,
  RunnerState,
  Settings,
  Task,
  TaskKind,
  TaskStatus,
} from "./types";
import { DEFAULT_BREAK_MINUTES, DEFAULT_TASK_MINUTES, POSITION_GAP } from "./types";
import { todayLocalISO } from "./dates";
import { readMirroredState, writeMirroredState } from "./platform";

const STORAGE_KEY_V2 = "todoflow:v2";
// Legacy blob — read once for migration, then left untouched as a rollback
// escape hatch for a release or two.
const STORAGE_KEY_V1 = "todoflow:v1";

function isValidTaskStatus(status: unknown): status is TaskStatus {
  return status === "queued" || status === "active" || status === "done";
}

function isValidTaskKind(kind: unknown): kind is TaskKind {
  return kind === "task" || kind === "break";
}

function isValidTaskV1(obj: unknown): obj is PersistedTaskV1 {
  if (!obj || typeof obj !== "object") return false;
  const t = obj as Record<string, unknown>;

  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    (t.notes === undefined || typeof t.notes === "string") &&
    typeof t.estimateMinutes === "number" &&
    typeof t.extraMinutes === "number" &&
    (t.scheduledStartMinutes === undefined ||
      t.scheduledStartMinutes === null ||
      typeof t.scheduledStartMinutes === "number") &&
    isValidTaskStatus(t.status) &&
    isValidTaskKind(t.kind) &&
    (t.parentId === undefined || t.parentId === null || typeof t.parentId === "string") &&
    typeof t.inSprint === "boolean" &&
    typeof t.createdAt === "number"
  );
}

function isValidTaskV2(obj: unknown): obj is Task {
  if (!isValidTaskV1(obj)) return false;
  const t = obj as unknown as Record<string, unknown>;
  return (
    typeof t.date === "string" &&
    typeof t.position === "number" &&
    typeof t.updatedAtMs === "number"
  );
}

// Backfill for a v1 task (or a v2 row saved by an interim build with missing
// fields): today's date, array-index position, fresh stamp.
function migrateTask(t: PersistedTaskV1, index: number, nowMs: number, today: string): Task {
  const withDefaults = {
    ...t,
    parentId: t.parentId ?? null,
    notes: t.notes ?? "",
    scheduledStartMinutes: t.scheduledStartMinutes ?? null,
  };
  const maybeV2 = t as Partial<Task>;
  return {
    ...withDefaults,
    date: typeof maybeV2.date === "string" ? maybeV2.date : today,
    position:
      typeof maybeV2.position === "number" ? maybeV2.position : index * POSITION_GAP,
    updatedAtMs:
      typeof maybeV2.updatedAtMs === "number" ? maybeV2.updatedAtMs : nowMs,
  };
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

  return (
    typeof s.latestFinishMinutes === "number" &&
    (s.scheduledStartMinutes === undefined ||
      s.scheduledStartMinutes === null ||
      typeof s.scheduledStartMinutes === "number")
  );
}

export function getDefaultSettings(): Settings {
  return {
    latestFinishMinutes: 18 * 60,
    scheduledStartMinutes: null,
    defaultTaskMinutes: DEFAULT_TASK_MINUTES,
    defaultBreakMinutes: DEFAULT_BREAK_MINUTES,
    autoBreak: true,
  };
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

function validateRunnerAndSettings(parsed: {
  runner?: unknown;
  settings?: unknown;
}): { runner: RunnerState; settings: Settings } {
  const runner =
    parsed.runner && isValidRunnerState(parsed.runner) ? parsed.runner : getDefaultRunner();
  let settings = getDefaultSettings();
  if (parsed.settings && isValidSettings(parsed.settings)) {
    const s = parsed.settings as Partial<Settings>;
    settings = {
      latestFinishMinutes: s.latestFinishMinutes as number,
      scheduledStartMinutes: s.scheduledStartMinutes ?? null,
      // Backfilled: blobs written before the pomodoro settings existed are
      // still valid (isValidSettings deliberately doesn't require these), so
      // an upgrading user inherits the 25 + 5 defaults rather than NaN.
      defaultTaskMinutes:
        typeof s.defaultTaskMinutes === "number" ? s.defaultTaskMinutes : DEFAULT_TASK_MINUTES,
      defaultBreakMinutes:
        typeof s.defaultBreakMinutes === "number" ? s.defaultBreakMinutes : DEFAULT_BREAK_MINUTES,
      autoBreak: typeof s.autoBreak === "boolean" ? s.autoBreak : true,
    };
  }
  return { runner, settings };
}

// Parse + validate a v2 blob from any source (localStorage or the native
// mirror). Returns null if it isn't a usable v2 payload.
export function parseV2(raw: string): PersistedStateV2 | null {
  const nowMs = Date.now();
  const today = todayLocalISO();
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedStateV2> | null;
    if (!parsed || parsed.version !== 2) return null;
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter(isValidTaskV1)
          .map((t, i) => (isValidTaskV2(t) ? (t as Task) : migrateTask(t, i, nowMs, today)))
      : [];
    return { version: 2, tasks, ...validateRunnerAndSettings(parsed) };
  } catch {
    return null;
  }
}

export function loadState(): PersistedStateV2 | null {
  if (typeof window === "undefined") return null;
  const nowMs = Date.now();
  const today = todayLocalISO();

  // Preferred path: v2 blob.
  try {
    const rawV2 = window.localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = parseV2(rawV2);
      if (parsed) return parsed;
    }
  } catch {
    // fall through to v1
  }

  // Migration path: v1 blob → v2 shape. The v1 blob is left in place as a
  // rollback escape hatch; from now on we only write v2.
  try {
    const rawV1 = window.localStorage.getItem(STORAGE_KEY_V1);
    if (!rawV1) return null;
    const parsed = JSON.parse(rawV1) as Partial<PersistedStateV1> | null;
    if (!parsed || parsed.version !== 1) return null;

    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.filter(isValidTaskV1).map((t, i) => migrateTask(t, i, nowMs, today))
      : [];

    return { version: 2, tasks, ...validateRunnerAndSettings(parsed) };
  } catch {
    return null;
  }
}

export function saveState(state: PersistedStateV2): boolean {
  if (typeof window === "undefined") return false;
  const json = JSON.stringify(state);
  // Mirror to native storage first — it's the copy that survives WKWebView
  // evicting localStorage. Fire-and-forget; it must never block the save.
  void writeMirroredState(json);
  try {
    window.localStorage.setItem(STORAGE_KEY_V2, json);
    return true;
  } catch {
    // quota exceeded or private mode
    return false;
  }
}

// Native fallback: read the UserDefaults mirror when localStorage came back
// empty. Also re-seeds localStorage so the rest of the app behaves normally.
export async function loadMirroredState(): Promise<PersistedStateV2 | null> {
  const raw = await readMirroredState();
  if (!raw) return null;
  const parsed = parseV2(raw);
  if (!parsed) return null;
  try {
    window.localStorage.setItem(STORAGE_KEY_V2, raw);
  } catch {
    // if localStorage is unwritable we still run from the parsed state
  }
  return parsed;
}


