"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  initialState,
  reducer,
  getNextStepId,
  type Action,
} from "./todoflowReducer";
import { loadMirroredState, loadState, saveState } from "./storage";
import { isNative } from "./platform";
import type { Settings } from "./types";
import { uid } from "./ids";
import { useInterval } from "./useInterval";
import { useSync } from "./sync/useSync";
import {
  computeSprintSchedule,
  getSprintPlannedMinutes,
  getTodayAtMinutes,
  isProjectedPastCutoff,
} from "./time";

export type PomodoroPatch = Partial<
  Pick<Settings, "defaultTaskMinutes" | "defaultBreakMinutes" | "autoBreak">
>;

// The break half of an ADD_TASK payload. Spread in, so autoBreak: false simply
// omits the fields and the reducer places no break.
function autoBreakPayload(settings: Settings) {
  if (!settings.autoBreak) return {};
  if (settings.defaultBreakMinutes <= 0) return {};
  return { breakId: uid(), breakMinutes: settings.defaultBreakMinutes };
}

export function useTodoFlow() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [hydrated, setHydrated] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [saveError, setSaveError] = useState(false);

  useInterval(() => setNowMs(Date.now()), 1000);

  // Hydrate from localStorage, falling back to the native mirror. On iOS,
  // WKWebView can evict localStorage under storage pressure — the mirror is
  // the copy that survives, so an empty read is a "check the mirror" signal,
  // not proof there's nothing to load.
  useEffect(() => {
    let cancelled = false;

    function applyLoaded(loaded: NonNullable<ReturnType<typeof loadState>>) {
      const coercedTasks = loaded.tasks.map((t) => {
        if (loaded.runner.activeTaskId && t.id === loaded.runner.activeTaskId) {
          return t.status === "done" ? t : { ...t, status: "active" as const };
        }
        return t.status === "active" ? { ...t, status: "queued" as const } : t;
      });
      dispatch({
        type: "HYDRATE",
        tasks: coercedTasks,
        runner: { ...initialState.runner, ...loaded.runner },
        settings: loaded.settings,
        nowMs: Date.now(),
      });
    }

    const loaded = loadState();
    if (loaded) {
      applyLoaded(loaded);
      setHydrated(true);
      return;
    }

    if (!isNative()) {
      setHydrated(true);
      return;
    }

    void loadMirroredState().then((mirrored) => {
      if (cancelled) return;
      if (mirrored) applyLoaded(mirrored);
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Latest state ref — used by flush handlers and the duplicate action creator
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  // Cross-device sync (no-op until Supabase env vars are set and the user
  // signs in — the app stays fully local-first either way).
  useSync({ hydrated, tasks: state.tasks, settings: state.settings, dispatch });

  // Debounced save
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const ok = saveState({
        version: 2,
        tasks: state.tasks,
        runner: state.runner,
        settings: state.settings,
      });
      if (!ok) setSaveError(true);
      else setSaveError(false);
    }, 500);
  }, [state, hydrated]);

  // Synchronous flush on tab close / hide — covers the 500ms debounce gap
  useEffect(() => {
    function flush() {
      const s = latestStateRef.current;
      saveState({ version: 2, tasks: s.tasks, runner: s.runner, settings: s.settings });
    }
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  // Auto-start countdown — fire AUTO_START_TICK once the deadline elapses
  useEffect(() => {
    if (state.runner.mode !== "run") return;
    if (!state.runner.autoStartAt) return;
    if (state.runner.autoStartPausedAt) return;
    if (state.runner.autoStartAt > nowMs) return;
    dispatch({ type: "AUTO_START_TICK", nowMs });
  }, [state.runner.mode, state.runner.autoStartAt, state.runner.autoStartPausedAt, nowMs]);

  // Clear lastDeletion after 5s so the Undo toast vanishes
  useEffect(() => {
    if (!state.lastDeletion) return;
    const deletionAt = state.lastDeletion.at;
    const handle = window.setTimeout(() => {
      const s = latestStateRef.current;
      if (s.lastDeletion && s.lastDeletion.at === deletionAt) {
        dispatch({ type: "CLEAR_LAST_DELETION" });
      }
    }, 5000);
    return () => window.clearTimeout(handle);
  }, [state.lastDeletion]);

  const actions = useMemo(
    () => ({
      addTask: (title: string, minutes?: number) => {
        const s = latestStateRef.current.settings;
        dispatch({
          type: "ADD_TASK",
          payload: {
            id: uid(),
            title,
            minutes: minutes ?? s.defaultTaskMinutes,
            nowMs: Date.now(),
            ...autoBreakPayload(s),
          },
        });
      },
      addTaskAtTime: (scheduledStartMinutes: number, minutes?: number) => {
        const s = latestStateRef.current.settings;
        dispatch({
          type: "ADD_TASK",
          payload: {
            id: uid(),
            title: "",
            minutes: minutes ?? s.defaultTaskMinutes,
            nowMs: Date.now(),
            scheduledStartMinutes,
            ...autoBreakPayload(s),
          },
        });
      },
      addSubtask: (parentId: string, title: string, minutes: number) =>
        dispatch({
          type: "ADD_SUBTASK",
          payload: { id: uid(), parentId, title, minutes, nowMs: Date.now() },
        }),
      editTitle: (id: string, title: string) =>
        dispatch({ type: "EDIT_TITLE", id, title, nowMs: Date.now() }),
      editMinutes: (id: string, minutes: number) =>
        dispatch({ type: "EDIT_MINUTES", id, minutes, nowMs: Date.now() }),
      editNotes: (id: string, notes: string) =>
        dispatch({ type: "EDIT_NOTES", id, notes, nowMs: Date.now() }),
      toggleDone: (id: string) =>
        dispatch({ type: "TOGGLE_DONE", id, nowMs: Date.now() }),
      toggleInSprint: (id: string) =>
        dispatch({ type: "TOGGLE_IN_SPRINT", id, nowMs: Date.now() }),
      scheduleToSprint: (id: string) =>
        dispatch({ type: "SCHEDULE_TO_SPRINT", id, nowMs: Date.now() }),
      deleteTask: (id: string) =>
        dispatch({ type: "DELETE_TASK", id, nowMs: Date.now() }),
      duplicateTask: (id: string) => {
        const stateNow = latestStateRef.current;
        const newChildIds: Record<string, string> = {};
        for (const t of stateNow.tasks) {
          if (t.parentId === id) newChildIds[t.id] = uid();
        }
        dispatch({
          type: "DUPLICATE_TASK",
          payload: { id, newParentId: uid(), newChildIds, nowMs: Date.now() },
        });
      },
      reorderSprint: (orderedIds: string[]) =>
        dispatch({ type: "REORDER_SPRINT", orderedIds, nowMs: Date.now() }),
      reorderSubtasks: (parentId: string, orderedChildIds: string[]) =>
        dispatch({ type: "REORDER_SUBTASKS", parentId, orderedChildIds, nowMs: Date.now() }),
      setTaskTime: (id: string, minutes: number | null) =>
        dispatch({ type: "SET_TASK_TIME", id, minutes, nowMs: Date.now() }),
      insertBreakInPlan: (minutes: 5 | 10) =>
        dispatch({
          type: "INSERT_BREAK_PLAN",
          payload: { id: uid(), minutes, nowMs: Date.now() },
        }),
      insertBreakNext: (minutes: 5 | 10) =>
        dispatch({
          type: "INSERT_BREAK_NEXT",
          payload: { id: uid(), minutes, nowMs: Date.now() },
        }),
      startSprint: () => dispatch({ type: "START_SPRINT", nowMs: Date.now() }),
      startNext: () => dispatch({ type: "START_NEXT", nowMs: Date.now() }),
      completeActive: () => dispatch({ type: "COMPLETE_ACTIVE", nowMs: Date.now() }),
      deleteActive: () => dispatch({ type: "DELETE_ACTIVE", nowMs: Date.now() }),
      extendActive: (minutes: 5 | 10) =>
        dispatch({ type: "EXTEND_ACTIVE", minutes, nowMs: Date.now() }),
      reduceActive: (minutes: 5 | 10) =>
        dispatch({ type: "REDUCE_ACTIVE", minutes, nowMs: Date.now() }),
      stopAfterThisTask: () => dispatch({ type: "STOP_AFTER_THIS_TASK" }),
      togglePause: () => dispatch({ type: "TOGGLE_PAUSE", nowMs: Date.now() }),
      exitToPlan: () => dispatch({ type: "EXIT_TO_PLAN", nowMs: Date.now() }),
      setLatestFinish: (minutes: number) =>
        dispatch({ type: "SET_LATEST_FINISH", minutes }),
      setScheduledStart: (minutes: number | null) =>
        dispatch({ type: "SET_SCHEDULED_START", minutes }),
      setPomodoro: (patch: PomodoroPatch) => dispatch({ type: "SET_POMODORO", patch }),
      startFreshDay: () => dispatch({ type: "START_FRESH_DAY" }),
      undoDelete: () => dispatch({ type: "UNDO_DELETE", nowMs: Date.now() }),
    }),
    [],
  );

  // Derived
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const scheduledStartMs = useMemo(() => {
    if (state.settings.scheduledStartMinutes == null) return null;
    return getTodayAtMinutes(new Date(nowMs), state.settings.scheduledStartMinutes).getTime();
  }, [nowMs, state.settings.scheduledStartMinutes]);
  const schedule = useMemo(
    () =>
      computeSprintSchedule({
        nowMs,
        runner: state.runner,
        tasks: state.tasks,
        scheduledStartMs,
      }),
    [nowMs, state.runner, state.tasks, scheduledStartMs],
  );
  const projectedFinish = useMemo(() => {
    if (schedule.rows.length === 0) return new Date(schedule.anchorMs);
    const lastEnd = schedule.rows.reduce((max, r) => Math.max(max, r.endMs), 0);
    return new Date(lastEnd);
  }, [schedule]);
  const sprintTotalMinutes = useMemo(
    () => getSprintPlannedMinutes(state.tasks),
    [state.tasks],
  );
  const cutoff = useMemo(
    () => getTodayAtMinutes(now, state.settings.latestFinishMinutes),
    [now, state.settings.latestFinishMinutes],
  );
  const pastCutoff = isProjectedPastCutoff({ now, projectedFinish, settings: state.settings });

  const sprintIsComplete =
    state.runner.mode === "run" &&
    !state.runner.activeTaskId &&
    getNextStepId(state.tasks) === null;

  return {
    state,
    actions,
    derived: {
      now,
      nowMs,
      projectedFinish,
      sprintTotalMinutes,
      cutoff,
      pastCutoff,
      saveError,
      hydrated,
      sprintIsComplete,
      schedule,
    },
  };
}

export type TodoFlowActions = ReturnType<typeof useTodoFlow>["actions"];
export type TodoFlowDerived = ReturnType<typeof useTodoFlow>["derived"];
export type { Action };
