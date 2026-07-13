"use client";

import type { Task } from "@/src/lib/types";
import { formatMinutesOfDay, getTaskTotalMinutes } from "@/src/lib/time";
import { todayLocalISO } from "@/src/lib/dates";
import { useMemo } from "react";

function formatFocused(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function CompletionView(props: { tasks: Task[]; onBackToPlan: () => void }) {
  // Today's completed sprint work — the sprint just finished, so this IS the
  // sprint summary.
  const summary = useMemo(() => {
    const today = todayLocalISO();
    const done = props.tasks.filter(
      (t) =>
        t.status === "done" && t.inSprint && t.parentId === null && t.date === today,
    );
    if (done.length === 0) return null;
    const minutes = done.reduce((sum, t) => sum + getTaskTotalMinutes(t), 0);
    const starts = done
      .map((t) => t.scheduledStartMinutes)
      .filter((m): m is number => m != null);
    const firstStart = starts.length ? Math.min(...starts) : null;
    return { count: done.length, minutes, firstStart };
  }, [props.tasks]);

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 shadow-soft">
      <div className="text-sm text-emerald-800">All done</div>
      <div className="mt-2 text-3xl md:text-4xl tracking-tight text-emerald-950">
        You finished your sprint.
      </div>
      {summary ? (
        <div className="mt-3 text-[15px] text-emerald-900 tabular-nums">
          {summary.count} task{summary.count === 1 ? "" : "s"} ·{" "}
          {formatFocused(summary.minutes)} focused
          {summary.firstStart != null
            ? ` · started ${formatMinutesOfDay(summary.firstStart)}`
            : ""}
        </div>
      ) : null}
      <div className="mt-3 text-[15px] text-emerald-900/80">
        Take a breath. Enjoy the momentum.
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={props.onBackToPlan}
          className="rounded-lg border border-emerald-700 bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 transition-colors"
        >
          Back to plan
        </button>
      </div>
    </div>
  );
}



