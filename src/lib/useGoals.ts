"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  archiveGoal,
  assignTask,
  createGoal,
  fetchGoalsData,
  priorityRank,
  renameGoal,
  seedStarterGoals,
  type Assignment,
  type Goal,
  type ThingsTaskRow,
} from "./goals";
import { POSITION_GAP } from "./types";

export type GoalGroup = {
  goal: Goal | null; // null = Inbox (unassigned)
  tasks: ThingsTaskRow[];
};

const COLLAPSED_KEY = "todoflow.goals.collapsed.v1";
export const INBOX_KEY = "__inbox__";

function loadCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function sortTasks(a: ThingsTaskRow, b: ThingsTaskRow) {
  const r = priorityRank(a.priority) - priorityRank(b.priority);
  if (r !== 0) return r;
  if (!!a.due !== !!b.due) return a.due ? -1 : 1;
  if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function useGoals(enabled: boolean) {
  const [tasks, setTasks] = useState<ThingsTaskRow[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const loadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!loadedOnce.current) setLoading(true);
    try {
      const d = await fetchGoalsData();
      setTasks(d.tasks);
      setGoals(d.goals);
      setAssignments(d.assignments);
      setSyncedAt(d.syncedAt);
      setError(null);
      loadedOnce.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    // The mirror changes when /world-sync runs on the Mac, not from inside the
    // app — so re-read whenever the window comes back to the front.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const groups = useMemo<GoalGroup[]>(() => {
    const byGoal = new Map<string, { task: ThingsTaskRow; position: number }[]>();
    const assigned = new Map(assignments.map((a) => [a.things_id, a]));
    const liveGoalIds = new Set(goals.map((g) => g.id));
    const inbox: ThingsTaskRow[] = [];
    for (const t of tasks) {
      const a = assigned.get(t.things_id);
      if (a && liveGoalIds.has(a.goal_id)) {
        if (!byGoal.has(a.goal_id)) byGoal.set(a.goal_id, []);
        byGoal.get(a.goal_id)!.push({ task: t, position: a.position });
      } else {
        inbox.push(t);
      }
    }
    const out: GoalGroup[] = [{ goal: null, tasks: inbox.sort(sortTasks) }];
    for (const g of goals) {
      const items = (byGoal.get(g.id) ?? [])
        // Hand-placed order first; ties (never dragged within the goal) fall
        // back to the priority/due ordering.
        .sort((x, y) => x.position - y.position || sortTasks(x.task, y.task))
        .map((x) => x.task);
      out.push({ goal: g, tasks: items });
    }
    return out;
  }, [tasks, goals, assignments]);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Optimistic: move locally, then write; on failure, reload from the server so
  // the panel never shows a state that didn't stick.
  const moveTask = useCallback(
    async (thingsId: string, goalId: string | null) => {
      const inGoal = assignments.filter((a) => a.goal_id === goalId);
      const position = (inGoal.reduce((m, a) => Math.max(m, a.position), 0) || 0) + POSITION_GAP;
      setAssignments((prev) => {
        const rest = prev.filter((a) => a.things_id !== thingsId);
        return goalId ? [...rest, { things_id: thingsId, goal_id: goalId, position }] : rest;
      });
      try {
        await assignTask(thingsId, goalId, position);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        void refresh();
      }
    },
    [assignments, refresh],
  );

  const addGoal = useCallback(
    async (title: string) => {
      const position = (goals.reduce((m, g) => Math.max(m, g.position), 0) || 0) + POSITION_GAP;
      try {
        const g = await createGoal({ title }, position);
        setGoals((prev) => [...prev, g]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [goals],
  );

  const editGoalTitle = useCallback(async (id: string, title: string) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, title } : g)));
    try {
      await renameGoal(id, title);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const removeGoal = useCallback(async (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    try {
      await archiveGoal(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const seed = useCallback(async () => {
    try {
      const gs = await seedStarterGoals();
      setGoals((prev) => [...prev, ...gs]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return {
    groups,
    goals,
    taskCount: tasks.length,
    syncedAt,
    loading,
    error,
    collapsed,
    toggleCollapsed,
    moveTask,
    addGoal,
    editGoalTitle,
    removeGoal,
    seed,
    refresh,
  };
}
