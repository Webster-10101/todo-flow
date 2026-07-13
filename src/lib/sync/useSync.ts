"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import type { Settings, Task } from "../types";
import type { Action } from "../todoflowReducer";
import { getSupabase, isSyncConfigured } from "../supabase";
import { useSupabaseAuth } from "../useSupabaseAuth";
import { isNative } from "../platform";
import { Outbox } from "./outbox";
import {
  rowToSettings,
  rowToTask,
  settingsToRow,
  taskToRow,
  tombstoneRow,
  type SettingsRow,
  type TaskRow,
} from "./mapping";

const FLUSH_DEBOUNCE_MS = 750;
const RETRY_INTERVAL_MS = 30_000;
const TOMBSTONE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SETTINGS_STAMP_KEY = "todoflow:settings-stamp";

function getSettingsStamp(): number {
  try {
    return Number(window.localStorage.getItem(SETTINGS_STAMP_KEY)) || 0;
  } catch {
    return 0;
  }
}

function setSettingsStamp(n: number): void {
  try {
    window.localStorage.setItem(SETTINGS_STAMP_KEY, String(n));
  } catch {
    // non-fatal
  }
}

// Local-first sync: the reducer stays the source of truth. Local edits are
// detected by per-id reference diffing (the reducer is immutable), queued in
// a persisted outbox, and upserted debounced. Remote changes arrive via a
// realtime subscription and merge in with per-row last-write-wins. A full
// reconcile runs on sign-in, channel (re)subscribe, browser online, and
// native resume — iOS kills sockets on backgrounding.
export function useSync(args: {
  hydrated: boolean;
  tasks: Task[];
  settings: Settings;
  dispatch: Dispatch<Action>;
}) {
  const { hydrated, tasks, settings, dispatch } = args;
  const { user } = useSupabaseAuth();

  const outboxRef = useRef<Outbox | null>(null);
  if (outboxRef.current === null) {
    outboxRef.current = new Outbox();
    outboxRef.current.load();
  }
  const outbox = outboxRef.current;

  const prevTasksRef = useRef<Map<string, Task> | null>(null);
  const prevSettingsRef = useRef<Settings | null>(null);
  // Stamps of rows we just applied FROM remote — used to keep the dirty
  // detector from echoing them straight back into the outbox.
  const appliedUpsertsRef = useRef(new Map<string, number>());
  const appliedDeletesRef = useRef(new Set<string>());
  const appliedSettingsStampRef = useRef<number | null>(null);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const userRef = useRef(user);
  userRef.current = user;

  const flushTimerRef = useRef<number | null>(null);
  const flushingRef = useRef(false);
  const reconcilingRef = useRef(false);

  const flush = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !userRef.current || flushingRef.current) return;
    const rows = outbox.snapshot();
    if (rows.length === 0) return;
    flushingRef.current = true;
    try {
      const { error } = await sb.from("tasks").upsert(rows);
      if (!error) outbox.ack(rows);
      // On error the rows stay queued; the retry interval picks them up.
    } finally {
      flushingRef.current = false;
    }
  }, [outbox]);

  const scheduleFlush = useCallback(() => {
    if (typeof window === "undefined") return;
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => void flush(), FLUSH_DEBOUNCE_MS);
  }, [flush]);

  const applyIncoming = useCallback(
    (rows: TaskRow[]) => {
      const upserts: Task[] = [];
      const deletions: Array<{ id: string; deletedAtMs: number }> = [];
      for (const row of rows) {
        if (!row?.id) continue;
        // A pending local write that's newer wins — skip the stale inbound copy.
        const pending = outbox.get(row.id);
        if (pending && pending.updated_at_ms >= row.updated_at_ms) continue;
        if (row.deleted_at_ms != null) {
          deletions.push({ id: row.id, deletedAtMs: row.deleted_at_ms });
          appliedDeletesRef.current.add(row.id);
        } else {
          upserts.push(rowToTask(row));
          appliedUpsertsRef.current.set(row.id, row.updated_at_ms);
        }
      }
      if (upserts.length || deletions.length) {
        dispatch({ type: "APPLY_REMOTE_TASKS", upserts, deletions });
      }
    },
    [dispatch, outbox],
  );

  const reconcile = useCallback(async () => {
    const sb = getSupabase();
    const u = userRef.current;
    if (!sb || !u || reconcilingRef.current) return;
    reconcilingRef.current = true;
    try {
      // Live rows plus recent tombstones (older tombstones only matter for
      // devices offline > 30 days — acceptable resurrection window).
      const tombstoneCutoff = Date.now() - TOMBSTONE_WINDOW_MS;
      const { data: rows, error } = await sb
        .from("tasks")
        .select("*")
        .or(`deleted_at_ms.is.null,deleted_at_ms.gte.${tombstoneCutoff}`);
      if (error || !rows) return;

      const serverRows = rows as TaskRow[];
      const localTasks = tasksRef.current;

      if (serverRows.length === 0 && localTasks.length > 0) {
        // First sign-in on a seeded device: local state becomes the server seed.
        await sb.from("tasks").upsert(localTasks.map(taskToRow));
      } else {
        applyIncoming(serverRows);
        // Push rows the server lacks or has older copies of.
        const serverById = new Map(serverRows.map((r) => [r.id, r] as const));
        const pushes = localTasks
          .filter((t) => {
            const sr = serverById.get(t.id);
            return !sr || sr.updated_at_ms < t.updatedAtMs;
          })
          .map(taskToRow);
        if (pushes.length) await sb.from("tasks").upsert(pushes);
      }

      // Settings: single row, same LWW idea using a locally-stored stamp.
      const localStamp = getSettingsStamp();
      const { data: settingsRow } = await sb
        .from("user_settings")
        .select("*")
        .maybeSingle();
      const remote = settingsRow as SettingsRow | null;
      if (remote && remote.updated_at_ms > localStamp) {
        appliedSettingsStampRef.current = remote.updated_at_ms;
        setSettingsStamp(remote.updated_at_ms);
        dispatch({ type: "APPLY_REMOTE_SETTINGS", settings: rowToSettings(remote) });
      } else if (!remote || remote.updated_at_ms < localStamp) {
        await sb
          .from("user_settings")
          .upsert(settingsToRow(settingsRef.current, localStamp || Date.now()));
      }

      // Anything queued while we were away.
      await flush();
    } finally {
      reconcilingRef.current = false;
    }
  }, [applyIncoming, dispatch, flush]);

  // --- Outbound: dirty detection by per-id reference diff ---
  useEffect(() => {
    if (!hydrated || !isSyncConfigured()) return;
    const nextMap = new Map(tasks.map((t) => [t.id, t] as const));
    const prev = prevTasksRef.current;
    // First post-hydrate snapshot: hydrate-time rewrites (day-roll, schedule
    // migration) are baseline state, not local edits to push.
    if (prev === null) {
      prevTasksRef.current = nextMap;
      return;
    }
    if (prev === nextMap) return;
    let dirty = false;
    if (userRef.current) {
      for (const t of tasks) {
        const p = prev.get(t.id);
        if (p === t) continue;
        if (appliedUpsertsRef.current.get(t.id) === t.updatedAtMs) continue; // remote echo
        outbox.enqueue(taskToRow(t));
        dirty = true;
      }
      for (const [id, p] of prev) {
        if (nextMap.has(id)) continue;
        if (appliedDeletesRef.current.delete(id)) continue; // remote deletion echo
        outbox.enqueue(tombstoneRow(p, Date.now()));
        dirty = true;
      }
    }
    prevTasksRef.current = nextMap;
    if (dirty) scheduleFlush();
  }, [tasks, hydrated, outbox, scheduleFlush]);

  // --- Outbound: settings ---
  useEffect(() => {
    if (!hydrated || !isSyncConfigured()) return;
    const prev = prevSettingsRef.current;
    if (prev === null || prev === settings) {
      prevSettingsRef.current = settings;
      return;
    }
    prevSettingsRef.current = settings;
    // Remote application echo — don't push it back.
    if (appliedSettingsStampRef.current !== null) {
      appliedSettingsStampRef.current = null;
      return;
    }
    const stamp = Date.now();
    setSettingsStamp(stamp);
    const sb = getSupabase();
    if (sb && userRef.current) {
      void sb.from("user_settings").upsert(settingsToRow(settings, stamp));
    }
  }, [settings, hydrated]);

  // --- Inbound: realtime subscription (reconcile on every (re)subscribe) ---
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !user) return;
    const channel = sb
      .channel(`tasks-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as TaskRow;
          if (row && typeof row.id === "string" && "updated_at_ms" in row) {
            applyIncoming([row]);
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void reconcile();
      });
    return () => {
      void sb.removeChannel(channel);
    };
  }, [user, applyIncoming, reconcile]);

  // --- Wake-ups: browser online, native resume, slow retry loop ---
  useEffect(() => {
    if (!user) return;
    const onOnline = () => {
      void flush();
      void reconcile();
    };
    window.addEventListener("online", onOnline);

    let resumeListener: PluginListenerHandle | undefined;
    if (isNative()) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) onOnline();
      }).then((h) => {
        resumeListener = h;
      });
    }

    const retryTimer = window.setInterval(() => {
      if (outbox.size > 0) void flush();
    }, RETRY_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      void resumeListener?.remove();
      window.clearInterval(retryTimer);
    };
  }, [user, flush, reconcile, outbox]);
}
