import type { Settings, Task, TaskKind, TaskStatus } from "../types";
import { DEFAULT_BREAK_MINUTES, DEFAULT_TASK_MINUTES } from "../types";

// Wire shape of public.tasks (snake_case). user_id is deliberately absent
// from outbound rows — the column default (auth.uid()) fills it on insert
// and RLS guarantees we only ever touch our own rows.
export type TaskRow = {
  id: string;
  date: string;
  title: string;
  notes: string;
  estimate_minutes: number;
  extra_minutes: number;
  scheduled_start_minutes: number | null;
  status: string;
  kind: string;
  parent_id: string | null;
  in_sprint: boolean;
  position: number;
  created_at_ms: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
};

export type SettingsRow = {
  latest_finish_minutes: number;
  scheduled_start_minutes: number | null;
  // Optional on read: a row written before these columns existed comes back
  // without them, and the client falls back to its defaults.
  default_task_minutes?: number | null;
  default_break_minutes?: number | null;
  auto_break?: boolean | null;
  updated_at_ms: number;
};

export function taskToRow(t: Task): TaskRow {
  return {
    id: t.id,
    date: t.date,
    title: t.title,
    notes: t.notes,
    estimate_minutes: t.estimateMinutes,
    extra_minutes: t.extraMinutes,
    scheduled_start_minutes: t.scheduledStartMinutes,
    status: t.status,
    kind: t.kind,
    parent_id: t.parentId,
    in_sprint: t.inSprint,
    position: t.position,
    created_at_ms: t.createdAt,
    updated_at_ms: t.updatedAtMs,
    deleted_at_ms: null,
  };
}

export function tombstoneRow(t: Task, nowMs: number): TaskRow {
  return { ...taskToRow(t), updated_at_ms: nowMs, deleted_at_ms: nowMs };
}

export function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    estimateMinutes: r.estimate_minutes,
    extraMinutes: r.extra_minutes,
    scheduledStartMinutes: r.scheduled_start_minutes,
    status: r.status as TaskStatus,
    kind: r.kind as TaskKind,
    parentId: r.parent_id,
    inSprint: r.in_sprint,
    createdAt: r.created_at_ms,
    date: r.date,
    position: r.position,
    updatedAtMs: r.updated_at_ms,
  };
}

export function settingsToRow(s: Settings, nowMs: number): SettingsRow {
  return {
    latest_finish_minutes: s.latestFinishMinutes,
    scheduled_start_minutes: s.scheduledStartMinutes,
    default_task_minutes: s.defaultTaskMinutes,
    default_break_minutes: s.defaultBreakMinutes,
    auto_break: s.autoBreak,
    updated_at_ms: nowMs,
  };
}

export function rowToSettings(r: SettingsRow): Settings {
  return {
    latestFinishMinutes: r.latest_finish_minutes,
    scheduledStartMinutes: r.scheduled_start_minutes,
    defaultTaskMinutes: r.default_task_minutes ?? DEFAULT_TASK_MINUTES,
    defaultBreakMinutes: r.default_break_minutes ?? DEFAULT_BREAK_MINUTES,
    autoBreak: r.auto_break ?? true,
  };
}
