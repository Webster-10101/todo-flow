"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  initialState,
  reducer,
  getNextStepId,
  type Action,
} from "./todoflowReducer";
import { loadState, saveState } from "./storage";
import { uid } from "./ids";
import { useInterval } from "./useInterval";
import {
  computeSprintSchedule,
  getSprintPlannedMinutes,
  getTodayAtMinutes,
  isProjectedPastCutoff,
} from "./time";

export function useTodoFlow() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [hydrated, setHydrated] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [saveError, setSaveError] = useState(false);

  useInterval(() => setNowMs(Date.now()), 1000);

  // Hydrate from localStorage
  useEffect(() => {
    const loaded = loadState();
    if (loaded) {
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
      });
    }
    setHydrated(true);
  }, []);

  // Latest state ref — used by flush handlers and the duplicate action creator
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  // Debounced save
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const ok = saveState({
        version: 1,
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
      saveState({ version: 1, tasks: s.tasks, runner: s.runner, settings: s.settings });
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
      addTask: (title: string, minutes: number) =>
        dispatch({
          type: "ADD_TASK",
          payload: { id: uid(), title, minutes, nowMs: Date.now() },
        }),
      addTaskAtTime: (scheduledStartMinutes: number, minutes = 30) =>
        dispatch({
          type: "ADD_TASK",
          payload: {
            id: uid(),
            title: "",
            minutes,
            nowMs: Date.now(),
            scheduledStartMinutes,
          },
        }),
      addSubtask: (parentId: string, title: string, minutes: number) =>
        dispatch({
          type: "ADD_SUBTASK",
          payload: { id: uid(), parentId, title, minutes, nowMs: Date.now() },
        }),
      editTitle: (id: string, title: string) =>
        dispatch({ type: "EDIT_TITLE", id, title }),
      editMinutes: (id: string, minutes: number) =>
        dispatch({ type: "EDIT_MINUTES", id, minutes }),
      editNotes: (id: string, notes: string) =>
        dispatch({ type: "EDIT_NOTES", id, notes }),
      toggleDone: (id: string) =>
        dispatch({ type: "TOGGLE_DONE", id, nowMs: Date.now() }),
      toggleInSprint: (id: string) =>
        dispatch({ type: "TOGGLE_IN_SPRINT", id }),
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
        dispatch({ type: "REORDER_SPRINT", orderedIds }),
      reorderSubtasks: (parentId: string, orderedChildIds: string[]) =>
        dispatch({ type: "REORDER_SUBTASKS", parentId, orderedChildIds }),
      setTaskTime: (id: string, minutes: number | null) =>
        dispatch({ type: "SET_TASK_TIME", id, minutes }),
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
        dispatch({ type: "EXTEND_ACTIVE", minutes }),
      reduceActive: (minutes: 5 | 10) =>
        dispatch({ type: "REDUCE_ACTIVE", minutes }),
      stopAfterThisTask: () => dispatch({ type: "STOP_AFTER_THIS_TASK" }),
      togglePause: () => dispatch({ type: "TOGGLE_PAUSE", nowMs: Date.now() }),
      exitToPlan: () => dispatch({ type: "EXIT_TO_PLAN" }),
      setLatestFinish: (minutes: number) =>
        dispatch({ type: "SET_LATEST_FINISH", minutes }),
      setScheduledStart: (minutes: number | null) =>
        dispatch({ type: "SET_SCHEDULED_START", minutes }),
      startFreshDay: () => dispatch({ type: "START_FRESH_DAY" }),
      undoDelete: () => dispatch({ type: "UNDO_DELETE" }),
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
