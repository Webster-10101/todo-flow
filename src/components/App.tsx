"use client";

import { useCallback, useEffect, useState } from "react";
import { useTodoFlow } from "@/src/lib/useTodoFlow";
import {
  formatClock,
  formatMinutesOfDay,
  formatTotalMinutes,
  parseHHMMToMinutes,
} from "@/src/lib/time";
import { useTransientFlag } from "@/src/lib/useTransientFlag";
import { ensureNotificationPermission, haptic } from "@/src/lib/platform";
import { todayLocalISO } from "@/src/lib/dates";
import type { Task } from "@/src/lib/types";
import { isSyncConfigured } from "@/src/lib/supabase";
import { useSupabaseAuth } from "@/src/lib/useSupabaseAuth";
import { AuthSheet } from "./AuthSheet";
import { PlanView } from "./PlanView";
import { RunView } from "./RunView";
import { Toast } from "./Toast";
import { CompletionView } from "./CompletionView";
import { ExportModal } from "./ExportModal";
import { PomodoroSettings } from "./PomodoroSettings";
import { WhatsNewModal } from "./WhatsNewModal";
import { isNewerVersion } from "@/src/lib/changelog";
import { APP_VERSION, BUILD_SHA, LAST_SEEN_VERSION_KEY } from "@/src/lib/version";
import { useDesktopTray, type DesktopCommand } from "@/src/lib/useDesktopTray";
import { useDesktopDaySnapshot } from "@/src/lib/useDesktopDaySnapshot";
import confetti from "canvas-confetti";

export function App() {
  const { state, actions, derived } = useTodoFlow();
  const { tasks, runner, settings, lastCompletion, lastDeletion } = state;
  const {
    now,
    projectedFinish,
    sprintTotalMinutes,
    cutoff,
    pastCutoff,
    saveError,
    sprintIsComplete,
    schedule,
  } = derived;

  const toast = useTransientFlag(1400);
  const saveErrorToast = useTransientFlag(3000);
  const [praise, setPraise] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // Mobile-only: the start-at / latest-finish inputs hide behind the
  // projected-finish pill to keep the canvas above the fold.
  const [daySettingsOpen, setDaySettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [hasUnseenRelease, setHasUnseenRelease] = useState(false);
  const { user } = useSupabaseAuth();

  // Dot on the version chip when this build is newer than the last changelog
  // the user opened. A device with no record is a fresh install, not someone
  // behind — stamp it and stay quiet.
  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(LAST_SEEN_VERSION_KEY);
      if (!seen) {
        window.localStorage.setItem(LAST_SEEN_VERSION_KEY, APP_VERSION);
        return;
      }
      setHasUnseenRelease(isNewerVersion(APP_VERSION, seen));
    } catch {
      // private mode / storage disabled — no dot, no harm
    }
  }, []);

  // macOS menu bar countdown. Commands come back as the same actions the UI
  // calls, so the tray can't drift into its own idea of the timer.
  const handleTrayCommand = useCallback(
    (command: DesktopCommand) => {
      switch (command) {
        case "pause":
        case "resume":
          actions.togglePause();
          break;
        case "done":
          actions.completeActive();
          break;
        case "extend5":
          actions.extendActive(5);
          break;
        case "start":
          if (runner.mode === "run") actions.startNext();
          else actions.startSprint();
          break;
      }
    },
    [actions, runner.mode],
  );
  useDesktopTray({ tasks, runner, onCommand: handleTrayCommand });
  useDesktopDaySnapshot({ tasks, now });

  function openWhatsNew() {
    setWhatsNewOpen(true);
    setHasUnseenRelease(false);
    try {
      window.localStorage.setItem(LAST_SEEN_VERSION_KEY, APP_VERSION);
    } catch {
      // nothing to do
    }
  }

  function handleStartFreshDay() {
    const doneCount = tasks.filter((t) => t.status === "done").length;
    if (doneCount === 0) return;
    const ok = window.confirm(
      `Clear ${doneCount} completed task${doneCount === 1 ? "" : "s"}? Unfinished tasks stay put.`,
    );
    if (ok) actions.startFreshDay();
  }

  function handleStartSprint() {
    // Fire-and-forget; we don't block start on the prompt result. Handles
    // both native (Capacitor local notifications) and web permission flows.
    void ensureNotificationPermission();
    actions.startSprint();
  }

  // Completion feedback — fires whenever a new lastCompletion lands
  useEffect(() => {
    if (!lastCompletion) return;
    setPraise(randomPraise());
    toast.trigger();
    fireConfetti();
    void haptic("success");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCompletion]);

  useEffect(() => {
    if (saveError) saveErrorToast.trigger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveError]);

  return (
    <main className="min-h-screen px-4 pt-7 sm:px-8 sm:pt-10 pb-[calc(1.75rem+env(safe-area-inset-bottom))] sm:pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-[980px]">
        <header className="relative mb-4 md:mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-3 md:gap-4">
          {isSyncConfigured() ? (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              aria-label={user ? "Sync account" : "Sign in to sync"}
              title={user ? `Syncing as ${user.email}` : "Sign in to sync"}
              className="absolute right-0 top-0 z-10 inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white/70 px-3 text-xs text-muted hover:text-ink hover:bg-soft transition-colors"
            >
              <span
                aria-hidden
                className={[
                  "h-2 w-2 rounded-full",
                  user ? "bg-teal-500" : "bg-ink/20",
                ].join(" ")}
              />
              {user ? "Synced" : "Sync"}
            </button>
          ) : null}
          <div className="text-center md:text-left">
            <div className="hidden md:flex text-sm text-muted items-center justify-center md:justify-start">
              <a
                href="https://focusmate.com"
                target="_blank"
                rel="noreferrer"
                className="text-ink/70 hover:text-ink underline underline-offset-4"
              >
                Focusmate
              </a>
              <span className="mx-2 text-muted">·</span>
              TodoFlow
            </div>
            <div className="mt-0 md:mt-1 flex items-center justify-center md:justify-start gap-2">
              <span className="text-2xl md:text-4xl text-ink tracking-tight">Todo Flow</span>
              <button
                type="button"
                onClick={openWhatsNew}
                className="relative self-center rounded-full border border-line bg-white/70 px-2 py-0.5 text-[11px] tabular-nums text-muted hover:text-ink hover:bg-soft transition-colors"
                aria-label={`Version ${APP_VERSION} — what's new`}
                title="What's new"
              >
                v{APP_VERSION}
                {BUILD_SHA ? <span className="opacity-60"> · {BUILD_SHA}</span> : null}
                {hasUnseenRelease ? (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-teal-600 ring-2 ring-paper"
                  />
                ) : null}
              </button>
            </div>
            <div className="mt-1.5 flex justify-center md:justify-start">
              <StreakDots tasks={tasks} />
            </div>
            {/* Mobile status strip: projected finish (tap for day settings) + total */}
            <div className="md:hidden mt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setDaySettingsOpen((v) => !v)}
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm tabular-nums transition-colors",
                  pastCutoff
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : "border-teal-200 bg-teal-50 text-teal-900",
                ].join(" ")}
                aria-expanded={daySettingsOpen}
                aria-label="Projected finish — tap for day settings"
              >
                ends {formatClock(projectedFinish)}
                <span className="text-[10px] opacity-60">{daySettingsOpen ? "▲" : "▼"}</span>
              </button>
              <span className="text-xs text-muted tabular-nums">
                {formatTotalMinutes(sprintTotalMinutes)} planned
              </span>
            </div>
            {daySettingsOpen ? (
              <div className="md:hidden mt-2 flex items-center justify-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted" htmlFor="scheduledStartMobile">
                  Start
                  <input
                    id="scheduledStartMobile"
                    type="time"
                    value={
                      settings.scheduledStartMinutes != null
                        ? formatMinutesOfDay(settings.scheduledStartMinutes)
                        : ""
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (!raw) {
                        actions.setScheduledStart(null);
                        return;
                      }
                      actions.setScheduledStart(parseHHMMToMinutes(raw));
                    }}
                    className="rounded-lg border border-line bg-white/80 px-2 py-1.5 text-ink outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted" htmlFor="latestFinishMobile">
                  Finish by
                  <input
                    id="latestFinishMobile"
                    type="time"
                    value={formatMinutesOfDay(settings.latestFinishMinutes)}
                    onChange={(e) => {
                      const mins = parseHHMMToMinutes(e.target.value);
                      if (mins != null) actions.setLatestFinish(mins);
                    }}
                    className="rounded-lg border border-line bg-white/80 px-2 py-1.5 text-ink outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
                  />
                </label>
              </div>
            ) : null}
            {daySettingsOpen ? (
              <div className="md:hidden mt-2 flex justify-center">
                <PomodoroSettings
                  settings={settings}
                  onChange={actions.setPomodoro}
                  idPrefix="mobile"
                />
              </div>
            ) : null}
          </div>

          <div className="hidden md:grid grid-cols-2 md:grid-cols-4 gap-3 rounded-xl border border-line bg-white/70 px-4 py-3 shadow-soft backdrop-blur">
            <div className="min-w-0">
              <div className="text-xs text-muted">Projected finish</div>
              <div className="mt-0.5 inline-flex items-center rounded-lg border border-line bg-white/70 px-2 py-1 font-mono tabular-nums tracking-widest text-sm text-ink">
                {formatClock(projectedFinish)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted">Total time</div>
              <div className="mt-0.5 inline-flex items-center rounded-lg border border-line bg-white/70 px-2 py-1 font-mono tabular-nums tracking-widest text-sm text-ink">
                {formatTotalMinutes(sprintTotalMinutes)}
              </div>
            </div>
            <div className="min-w-0">
              <label className="text-xs text-muted" htmlFor="scheduledStart">
                Start at
              </label>
              <div className="mt-0.5 flex justify-center md:justify-start">
                <input
                  id="scheduledStart"
                  type="time"
                  value={
                    settings.scheduledStartMinutes != null
                      ? formatMinutesOfDay(settings.scheduledStartMinutes)
                      : ""
                  }
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (!raw) {
                      actions.setScheduledStart(null);
                      return;
                    }
                    const mins = parseHHMMToMinutes(raw);
                    actions.setScheduledStart(mins);
                  }}
                  className="w-[120px] rounded-lg border border-line bg-white/80 px-2 py-1 text-sm text-ink outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
                />
              </div>
            </div>
            <div className="min-w-0">
              <label className="text-xs text-muted" htmlFor="latestFinish">
                Latest finish
              </label>
              <div className="mt-0.5 flex justify-center md:justify-start">
                <input
                  id="latestFinish"
                  type="time"
                  value={formatMinutesOfDay(settings.latestFinishMinutes)}
                  onChange={(e) => {
                    const mins = parseHHMMToMinutes(e.target.value);
                    if (mins != null) actions.setLatestFinish(mins);
                  }}
                  className="w-[120px] rounded-lg border border-line bg-white/80 px-2 py-1 text-sm text-ink outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
                />
              </div>
            </div>
            <div className="col-span-2 md:col-span-4 border-t border-line/60 pt-3">
              <PomodoroSettings
                settings={settings}
                onChange={actions.setPomodoro}
                idPrefix="desktop"
              />
            </div>
          </div>
        </header>

        <div
          className={[
            // Mobile gets the compact header pill instead of this banner.
            "hidden md:block mb-6 rounded-xl border px-5 py-4 text-sm shadow-soft",
            pastCutoff
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : "border-teal-200 bg-teal-50 text-teal-900",
          ].join(" ")}
        >
          {pastCutoff ? (
            <>Projected finish is after {formatClock(cutoff)}. Consider stopping after this task.</>
          ) : (
            <>On track to finish before {formatClock(cutoff)}.</>
          )}
        </div>

        {runner.mode === "run" ? (
          sprintIsComplete ? (
            <CompletionView tasks={tasks} onBackToPlan={actions.exitToPlan} />
          ) : (
            <RunView
              now={now}
              tasks={tasks}
              runner={runner}
              settings={settings}
              onStartNext={actions.startNext}
              onDoneActive={actions.completeActive}
              onDeleteActive={actions.deleteActive}
              onExtendActive={actions.extendActive}
              onReduceActive={actions.reduceActive}
              onInsertBreakNext={actions.insertBreakNext}
              onStopAfterThisTask={actions.stopAfterThisTask}
              onTogglePause={actions.togglePause}
              onExitToPlan={actions.exitToPlan}
            />
          )
        ) : (
          <PlanView
            now={now}
            tasks={tasks}
            settings={settings}
            projectedFinish={projectedFinish}
            schedule={schedule}
            onAddTask={actions.addTask}
            onAddTaskAtTime={actions.addTaskAtTime}
            onAddSubtask={actions.addSubtask}
            onDuplicate={actions.duplicateTask}
            onInsertBreak={actions.insertBreakInPlan}
            onStartSprint={handleStartSprint}
            onReorderSubtasks={actions.reorderSubtasks}
            onSetTaskTime={actions.setTaskTime}
            onEditTitle={actions.editTitle}
            onEditMinutes={actions.editMinutes}
            onEditNotes={actions.editNotes}
            onToggleDone={actions.toggleDone}
            onDelete={actions.deleteTask}
            onToggleInSprint={actions.toggleInSprint}
            onScheduleToSprint={actions.scheduleToSprint}
            onStartFreshDay={handleStartFreshDay}
            onOpenExport={() => setExportOpen(true)}
            onStartTask={actions.startTask}
          />
        )}
      </div>

      <ExportModal open={exportOpen} tasks={tasks} onClose={() => setExportOpen(false)} />
      <WhatsNewModal open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
      <AuthSheet open={authOpen} user={user} onClose={() => setAuthOpen(false)} />

      <Toast message={praise ?? "Marked done"} visible={toast.on} stackIndex={0} />
      <Toast
        message={lastDeletion ? buildDeleteMessage(lastDeletion.tasks) : ""}
        visible={Boolean(lastDeletion)}
        actionLabel="Undo"
        onAction={actions.undoDelete}
        stackIndex={1}
      />
      <Toast
        message="⚠️ Failed to save - storage full"
        visible={saveErrorToast.on}
        stackIndex={2}
      />
    </main>
  );
}

// Last 7 days, today rightmost — filled when the day has ≥1 completed task.
// Read-only history, no pressure mechanics.
function StreakDots({ tasks }: { tasks: Task[] }) {
  const doneDates = new Set(
    tasks.filter((t) => t.status === "done").map((t) => t.date),
  );
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(todayLocalISO(d));
  }
  return (
    <div
      className="flex items-center gap-1"
      title="Days with a completed task (last 7)"
      aria-label="Days with a completed task, last 7 days"
    >
      {days.map((d) => (
        <span
          key={d}
          aria-hidden
          className={[
            "h-1.5 w-1.5 rounded-full",
            doneDates.has(d) ? "bg-teal-500" : "bg-ink/15",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

function buildDeleteMessage(deletedTasks: { parentId: string | null }[]) {
  const topCount = deletedTasks.filter((t) => t.parentId === null).length;
  // If we deleted a parent + kids, count just the parent; otherwise count the leaves.
  const n = topCount > 0 ? topCount : deletedTasks.length;
  return `Deleted ${n} task${n === 1 ? "" : "s"}`;
}

function randomPraise() {
  const lines = [
    "Nice work. Keep it small and steady.",
    "Good job — one step at a time.",
    "That counts. Keep going.",
    "Momentum is built like this.",
    "Done. Breathe, then next.",
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

function fireConfetti() {
  try {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const base = {
      spread: 75,
      startVelocity: 34,
      gravity: 0.95,
      scalar: 0.95,
      ticks: 220,
      colors: ["#064E3B", "#10B981", "#34D399", "#A7F3D0", "#FDE68A", "#93C5FD"],
    };

    confetti({ ...base, particleCount: 110, origin: { x: 0.5, y: 0.18 } });

    setTimeout(
      () => confetti({ ...base, particleCount: 80, angle: 60, origin: { x: 0.08, y: 0.25 } }),
      110,
    );
    setTimeout(
      () => confetti({ ...base, particleCount: 80, angle: 120, origin: { x: 0.92, y: 0.25 } }),
      110,
    );

    setTimeout(
      () =>
        confetti({
          ...base,
          particleCount: 70,
          spread: 110,
          startVelocity: 22,
          gravity: 0.85,
          scalar: 0.8,
          origin: { x: 0.5, y: 0.12 },
        }),
      260,
    );
  } catch {
    // ignore if canvas unavailable
  }
}
