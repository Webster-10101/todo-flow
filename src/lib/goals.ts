"use client";

import { getSupabase } from "./supabase";
import { POSITION_GAP } from "./types";

// Goals layer — season goals with the Things working set grouped underneath.
//
// Data lives in TodoFlow's Supabase project (see supabase/migrations/0002_goals.sql):
// * things_tasks     — read-only mirror written by /world-sync on Al's Mac
// * goals            — app-owned, one row per season goal
// * goal_assignments — app-owned, things_id -> goal_id
//
// The plans in the vault stay canonical for WHAT the goals are; a goal row is
// a title plus a pointer, never a copy of scoreboard text.

export type ThingsPriority = "now" | "this-week" | "soon" | "blocker" | "waiting";

export type ThingsTaskRow = {
  things_id: string;
  name: string;
  priority: ThingsPriority;
  project: string | null;
  who: string | null;
  due: string | null;
  all_tags: string;
  is_urgent: boolean;
  synced_at: string;
};

export type Goal = {
  id: string;
  title: string;
  source: string | null;
  judge_date: string | null;
  colour: string | null;
  position: number;
  archived_at_ms: number | null;
};

export type Assignment = {
  things_id: string;
  goal_id: string;
  position: number;
};

// Starter set derived from the three One Page Plan scoreboards (judge: mid-Nov
// 2026). Offered once, on an empty goals table; Al renames/reshapes in-app.
// Deliberately no "income floor" goal — Silversea/CRS are the floor, not a
// season goal, and minting one just to tidy the Inbox would make it lie.
export const STARTER_GOALS: { title: string; source: string; judge_date: string }[] = [
  {
    title: "Coaching engine ships weekly",
    source: "Projects/Coaching/Coaching — One Page Plan.md",
    judge_date: "2026-11-15",
  },
  {
    title: "3 happy clients + a Pod",
    source: "Projects/Coaching/Coaching — One Page Plan.md",
    judge_date: "2026-11-15",
  },
  {
    title: "FFG mowed",
    source: "Projects/FFG/FFG — One Page Plan.md",
    judge_date: "2026-11-15",
  },
  {
    title: "FFG taps proven",
    source: "Projects/FFG/FFG — One Page Plan.md",
    judge_date: "2026-11-15",
  },
  {
    title: "Spanish · Digitone · Voice",
    source: "Projects/Personal/Life Outside Work — One Page Plan.md",
    judge_date: "2026-11-15",
  },
];

export const PRIORITY_ORDER: ThingsPriority[] = ["now", "this-week", "soon", "blocker", "waiting"];

export function priorityRank(p: string): number {
  const i = PRIORITY_ORDER.indexOf(p as ThingsPriority);
  return i === -1 ? PRIORITY_ORDER.length : i;
}

// ---- reads -----------------------------------------------------------------

export async function fetchGoalsData(): Promise<{
  tasks: ThingsTaskRow[];
  goals: Goal[];
  assignments: Assignment[];
  syncedAt: string | null;
}> {
  const sb = getSupabase();
  if (!sb) return { tasks: [], goals: [], assignments: [], syncedAt: null };

  const [t, g, a] = await Promise.all([
    sb.from("things_tasks").select("*"),
    sb.from("goals").select("*").is("archived_at_ms", null).order("position"),
    sb.from("goal_assignments").select("things_id, goal_id, position"),
  ]);
  if (t.error) throw t.error;
  if (g.error) throw g.error;
  if (a.error) throw a.error;

  const tasks = (t.data ?? []) as ThingsTaskRow[];
  const syncedAt = tasks.reduce<string | null>(
    (acc, r) => (acc && acc > r.synced_at ? acc : r.synced_at),
    null,
  );
  return {
    tasks,
    goals: (g.data ?? []) as Goal[],
    assignments: (a.data ?? []) as Assignment[],
    syncedAt,
  };
}

// ---- writes ----------------------------------------------------------------

export async function assignTask(thingsId: string, goalId: string | null, position: number) {
  const sb = getSupabase();
  if (!sb) return;
  if (goalId === null) {
    const { error } = await sb.from("goal_assignments").delete().eq("things_id", thingsId);
    if (error) throw error;
    return;
  }
  const { error } = await sb.from("goal_assignments").upsert(
    { things_id: thingsId, goal_id: goalId, position, updated_at_ms: Date.now() },
    { onConflict: "user_id,things_id" },
  );
  if (error) throw error;
}

export async function createGoal(
  input: { title: string; source?: string | null; judge_date?: string | null },
  position: number,
): Promise<Goal> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sync not configured");
  const now = Date.now();
  const { data, error } = await sb
    .from("goals")
    .insert({
      title: input.title,
      source: input.source ?? null,
      judge_date: input.judge_date ?? null,
      position,
      created_at_ms: now,
      updated_at_ms: now,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Goal;
}

export async function renameGoal(id: string, title: string) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("goals")
    .update({ title, updated_at_ms: Date.now() })
    .eq("id", id);
  if (error) throw error;
}

// Archive rather than delete: assignments survive, so un-archiving restores
// the group intact. Archived goals simply stop rendering.
export async function archiveGoal(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  const now = Date.now();
  const { error } = await sb
    .from("goals")
    .update({ archived_at_ms: now, updated_at_ms: now })
    .eq("id", id);
  if (error) throw error;
}

export async function seedStarterGoals(): Promise<Goal[]> {
  const out: Goal[] = [];
  for (let i = 0; i < STARTER_GOALS.length; i++) {
    out.push(await createGoal(STARTER_GOALS[i], (i + 1) * POSITION_GAP));
  }
  return out;
}
