"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Task } from "./types";
import { getTaskTotalMinutes } from "./time";
import { todayLocalISO } from "./dates";
import { isDesktop, publishDaySnapshot, type DaySnapshot } from "./platform";

// Writing on every keystroke would be silly; a couple of seconds of lag is
// invisible to a sync that runs a few times a day.
const DEBOUNCE_MS = 2000;

/**
 * Leaves today's plan and actuals on disk for `/world-sync` to mirror into
 * World HQ. Desktop only — it's the one shell with filesystem access, and the
 * sync runs on the same Mac.
 */
export function useDesktopDaySnapshot(args: { tasks: Task[]; now: Date }) {
  const { tasks, now } = args;
  // Depend on the date string, not the Date object — `now` ticks every second.
  const date = todayLocalISO(now);
  const timerRef = useRef<number | null>(null);

  const snapshot = useMemo<DaySnapshot>(() => {
    const blocks = tasks
      .filter((t) => t.parentId === null && t.inSprint && t.date === date)
      .sort((a, b) => {
        const aStart = a.scheduledStartMinutes ?? Number.POSITIVE_INFINITY;
        const bStart = b.scheduledStartMinutes ?? Number.POSITIVE_INFINITY;
        return aStart - bStart;
      })
      .map((t) => ({
        title: t.title || (t.kind === "break" ? "Break" : "Untitled"),
        kind: t.kind,
        startMinutes: t.scheduledStartMinutes,
        minutes: getTaskTotalMinutes(t),
        status: t.status,
        doneAtMs: t.status === "done" ? t.updatedAtMs : null,
      }));

    // Time actually spent on finished work — breaks don't count as focus.
    const focusedMinutes = blocks
      .filter((b) => b.status === "done" && b.kind === "task")
      .reduce((sum, b) => sum + b.minutes, 0);

    return {
      date,
      updatedAt: new Date().toISOString(),
      focusedMinutes,
      blocks,
    };
  }, [tasks, date]);

  useEffect(() => {
    if (!isDesktop()) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => publishDaySnapshot(snapshot), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [snapshot]);
}
