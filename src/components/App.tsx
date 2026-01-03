"use client";

import { useEffect, useMemo, useState } from "react";
import type { RunnerState, Settings, Task } from "@/src/lib/types";
import { getDefaultRunner, getDefaultSettings, getDefaultTasks, loadState, saveState } from "@/src/lib/storage";
import {
  formatClock,
  formatMinutesOfDay,
  getProjectedFinishDate,
  getTodayAtMinutes,
  isProjectedPastCutoff,
} from "@/src/lib/time";
import { useInterval } from "@/src/lib/useInterval";
import { useTransientFlag } from "@/src/lib/useTransientFlag";
import { useDebounce } from "@/src/lib/useDebounce";
import { PlanView } from "./PlanView";
import { RunView } from "./RunView";
import { Toast } from "./Toast";
import confetti from "canvas-confetti";

let uidCounter = 0;

function uid(): string {
  // Modern browsers support crypto.randomUUID
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback: timestamp + counter + random
  uidCounter = (uidCounter + 1) % 10000;
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 11);
  return `${timestamp}-${uidCounter}-${random}`;
}

function clampMinutes(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.round(n));
}

function normalizeTasks(tasks: Task[]) {
  const topLevel = tasks.filter((t) => t.parentId === null);
  const children = tasks.filter((t) => t.parentId !== null);

  // Keep children immediately after their parent (in existing relative order).
  const byParent = new Map<string, Task[]>();
  for (const c of children) {
    const pid = c.parentId as string;
    const arr = byParent.get(pid) ?? [];
    arr.push(c);
    byParent.set(pid, arr);
  }

  const sprintActive = topLevel.filter((t) => t.status === "active" && t.inSprint);
  const sprintQueued = topLevel.filter((t) => t.status === "queued" && t.inSprint);
  const laterQueued = topLevel.filter((t) => t.status === "queued" && !t.inSprint);
  const done = topLevel.filter((t) => t.status === "done");

  const orderedTop = [...sprintActive, ...sprintQueued, ...laterQueued, ...done];
  const out: Task[] = [];
  for (const p of orderedTop) {
    out.push(p);
    const kids = byParent.get(p.id);
    if (kids?.length) out.push(...kids);
  }
  return out;
}

export function App() {
  const [hydrated, setHydrated] = useState(false);

  const [tasks, setTasks] = useState<Task[]>(getDefaultTasks());
  const [runner, setRunner] = useState<RunnerState>(getDefaultRunner());
  const [settings, setSettings] = useState<Settings>(getDefaultSettings());

  const [nowMs, setNowMs] = useState(() => Date.now());
  useInterval(() => setNowMs(Date.now()), 1000);

  const toast = useTransientFlag(1400);
  const saveErrorToast = useTransientFlag(3000);
  const [praise, setPraise] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadState();
    if (loaded) {
      const coerced: Task[] = loaded.tasks.map((t): Task => {
        if (loaded.runner.activeTaskId && t.id === loaded.runner.activeTaskId) {
          return t.status === "done" ? t : { ...t, status: "active" };
        }
        return t.status === "active" ? { ...t, status: "queued" } : t;
      });
      setTasks(normalizeTasks(coerced));
      setRunner({
        ...getDefaultRunner(),
        ...loaded.runner,
      });
      setSettings(loaded.settings);
    }
    setHydrated(true);
  }, []);

  const debouncedSave = useDebounce((state: { version: 1; tasks: Task[]; runner: RunnerState; settings: Settings }) => {
    const success = saveState(state);
    if (!success) {
      saveErrorToast.trigger();
    }
  }, 500);

  useEffect(() => {
    if (!hydrated) return;
    debouncedSave({ version: 1, tasks, runner, settings });
  }, [tasks, runner, settings, hydrated, debouncedSave, saveErrorToast]);

  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const projectedFinish = useMemo(
    () => getProjectedFinishDate({ nowMs, runner, tasks }),
    [nowMs, runner, tasks],
  );
  const cutoff = useMemo(() => getTodayAtMinutes(now, settings.latestFinishMinutes), [now, settings.latestFinishMinutes]);
  const pastCutoff = isProjectedPastCutoff({ now, projectedFinish, settings });

  const queuedSprint = useMemo(
    () => tasks.filter((t) => t.status === "queued" && t.inSprint),
    [tasks],
  );

  const activeTask = useMemo(
    () => (runner.activeTaskId ? tasks.find((t) => t.id === runner.activeTaskId) : null),
    [runner.activeTaskId, tasks],
  );

  const latestFinishOptions = useMemo(
    () =>
      [
        17 * 60 + 30,
        18 * 60,
        18 * 60 + 30,
        19 * 60,
        20 * 60,
        21 * 60,
      ].map((m) => ({ minutes: m, label: formatMinutesOfDay(m) })),
    [],
  );

  // --- Task mutations ---
  function addTask(title: string, minutes: number) {
    const t: Task = {
      id: uid(),
      title,
      estimateMinutes: clampMinutes(minutes),
      extraMinutes: 0,
      status: "queued",
      kind: "task",
      parentId: null,
      inSprint: true,
      createdAt: Date.now(),
    };
    setTasks((prev) => normalizeTasks([t, ...prev]));
  }

  function addSubtask(parentId: string, title: string, minutes: number) {
    const st: Task = {
      id: uid(),
      title,
      estimateMinutes: clampMinutes(minutes),
      extraMinutes: 0,
      status: "queued",
      kind: "task",
      parentId,
      // inherits parent sprint flag at render-time; keep true for simplicity
      inSprint: true,
      createdAt: Date.now(),
    };

    setTasks((prev) => {
      const next = prev.slice();
      const parentIdx = next.findIndex((t) => t.id === parentId);
      if (parentIdx === -1) return normalizeTasks([st, ...next]);
      let insertAt = parentIdx + 1;
      while (insertAt < next.length && next[insertAt].parentId === parentId) insertAt++;
      next.splice(insertAt, 0, st);
      return normalizeTasks(next);
    });
  }

  function editTitle(id: string, title: string) {
    setTasks((prev) => normalizeTasks(prev.map((t) => (t.id === id ? { ...t, title } : t))));
  }

  function editMinutes(id: string, minutes: number) {
    setTasks((prev) =>
      normalizeTasks(prev.map((t) => (t.id === id ? { ...t, estimateMinutes: clampMinutes(minutes) } : t))),
    );
  }

  function toggleDone(id: string) {
    setTasks((prev) =>
      normalizeTasks(
        prev.map((t) => {
          if (t.id !== id && t.parentId !== id) return t;
          // If toggling a parent, toggle all children too.
          if (t.parentId === id) {
            const nextStatus: Task["status"] = prev.find((x) => x.id === id)?.status === "done" ? "queued" : "done";
            return { ...t, status: nextStatus };
          }
          if (t.id !== id) return t;
          const nextStatus: Task["status"] = t.status === "done" ? "queued" : "done";
          const nextSprint = nextStatus === "queued" ? true : t.inSprint;
          return { ...t, status: nextStatus, inSprint: nextSprint };
        }),
      ),
    );
    setRunner((r) => {
      if (r.activeTaskId !== id) return r;
      return { ...r, activeTaskId: null, activeStartedAt: null, awaitingNextStart: true };
    });
    toast.trigger();
  }

  function toggleInSprint(id: string) {
    setTasks((prev) => normalizeTasks(prev.map((t) => (t.id === id ? { ...t, inSprint: !t.inSprint } : t))));
  }

  function deleteTask(id: string) {
    setTasks((prev) => normalizeTasks(prev.filter((t) => t.id !== id && t.parentId !== id)));
    setRunner((r) => (r.activeTaskId === id ? { ...r, activeTaskId: null, activeStartedAt: null, awaitingNextStart: true } : r));
  }

  function reorderSprint(orderedIds: string[]) {
    setTasks((prev) => {
      const topSprintQueued = prev.filter(
        (t) => t.parentId === null && t.status === "queued" && t.inSprint,
      );
      const byId = new Map(topSprintQueued.map((t) => [t.id, t] as const));

      const childrenByParent = new Map<string, Task[]>();
      for (const t of prev) {
        if (!t.parentId) continue;
        const arr = childrenByParent.get(t.parentId) ?? [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      }

      const reorderedTop = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Task[];
      const reorderedWithKids: Task[] = [];
      for (const p of reorderedTop) {
        reorderedWithKids.push(p);
        const kids = childrenByParent.get(p.id);
        if (kids?.length) reorderedWithKids.push(...kids);
      }

      const rest = prev.filter(
        (t) => !(t.parentId === null && t.status === "queued" && t.inSprint),
      );
      return normalizeTasks([...reorderedWithKids, ...rest]);
    });
  }

  function trimToFit() {
    const allowedMs = cutoff.getTime() - now.getTime();
    const allowedMinutes = Math.max(0, Math.floor(allowedMs / 60_000));
    setTasks((prev) => {
      let used = 0;
      const next = prev.map((t) => {
        if (t.status !== "queued" || !t.inSprint) return t;
        const total = clampMinutes(t.estimateMinutes + t.extraMinutes);
        const fits = used + total <= allowedMinutes;
        if (fits) used += total;
        return fits ? t : { ...t, inSprint: false };
      });
      return normalizeTasks(next);
    });
  }

  // --- Runner actions ---
  function getNextStepId(fromTasks: Task[]) {
    const top = fromTasks.filter((t) => t.parentId === null && t.inSprint && t.status !== "done");
    for (const t of top) {
      if (t.kind === "break") {
        if (t.status === "queued") return t.id;
        continue;
      }
      const kids = fromTasks.filter((c) => c.parentId === t.id && c.status !== "done");
      if (kids.length) {
        const nextKid = kids.find((c) => c.status === "queued") ?? null;
        if (nextKid) return nextKid.id;
        continue;
      }
      if (t.status === "queued") return t.id;
    }
    return null;
  }

  function startSprint() {
    const firstId = getNextStepId(tasks);
    if (!firstId) return;
    setTasks((prev) =>
      normalizeTasks(
        prev.map((t) => {
          if (t.status === "active") return { ...t, status: "queued" };
          if (t.id === firstId) return { ...t, status: "active" };
          return t;
        }),
      ),
    );
    setRunner({
      mode: "run",
      activeTaskId: firstId,
      activeStartedAt: Date.now(),
      awaitingNextStart: false,
      stopAfterThisTask: false,
      pausedAt: null,
      pauseAccumulatedMs: 0,
      autoStartAt: null,
      autoStartPausedAt: null,
      autoStartPausedRemainingMs: null,
    });
  }

  function startNext() {
    const nextId = getNextStepId(tasks);
    if (!nextId) return;
    setTasks((prev) =>
      normalizeTasks(
        prev.map((t) => {
          if (t.status === "active") return { ...t, status: "queued" };
          if (t.id === nextId) return { ...t, status: "active" };
          return t;
        }),
      ),
    );
    setRunner((r) => ({
      ...r,
      mode: "run",
      activeTaskId: nextId,
      activeStartedAt: Date.now(),
      awaitingNextStart: false,
      pausedAt: null,
      pauseAccumulatedMs: 0,
      autoStartAt: null,
      autoStartPausedAt: null,
      autoStartPausedRemainingMs: null,
    }));
  }

  function doneActive() {
    if (!runner.activeTaskId) return;
    const activeId = runner.activeTaskId;

    setTasks((prev) =>
      normalizeTasks(
        prev.map((t) => (t.id === activeId ? { ...t, status: "done" } : t)),
      ),
    );
    toast.trigger();
    setPraise(randomPraise());
    fireConfetti();

    setRunner((r) => {
      const shouldExit = r.stopAfterThisTask;
      return {
        mode: shouldExit ? "plan" : "run",
        activeTaskId: null,
        activeStartedAt: null,
        awaitingNextStart: !shouldExit,
        stopAfterThisTask: false,
        pausedAt: null,
        pauseAccumulatedMs: 0,
        autoStartAt: shouldExit ? null : Date.now() + 15_000,
        autoStartPausedAt: null,
        autoStartPausedRemainingMs: null,
      };
    });
  }

  function deleteActive() {
    if (!runner.activeTaskId) return;
    deleteTask(runner.activeTaskId);
  }

  function extendActive(minutes: 5 | 10) {
    if (!runner.activeTaskId) return;
    const id = runner.activeTaskId;
    setTasks((prev) =>
      normalizeTasks(prev.map((t) => (t.id === id ? { ...t, extraMinutes: t.extraMinutes + minutes } : t))),
    );
  }

  function insertBreakNext(minutes: 5 | 10) {
    const breakTask: Task = {
      id: uid(),
      title: "Break",
      estimateMinutes: minutes,
      extraMinutes: 0,
      status: "queued",
      kind: "break",
      parentId: null,
      inSprint: true,
      createdAt: Date.now(),
    };
    setTasks((prev) => normalizeTasks([breakTask, ...prev]));
  }

  function insertBreakInPlan(minutes: 5 | 10) {
    const breakTask: Task = {
      id: uid(),
      title: "Break",
      estimateMinutes: minutes,
      extraMinutes: 0,
      status: "queued",
      kind: "break",
      parentId: null,
      inSprint: true,
      createdAt: Date.now(),
    };
    setTasks((prev) => {
      const sprintActive = prev.filter((t) => t.status === "active" && t.inSprint);
      const sprintQueued = prev.filter((t) => t.status === "queued" && t.inSprint);
      const laterQueued = prev.filter((t) => t.status === "queued" && !t.inSprint);
      const done = prev.filter((t) => t.status === "done");
      return normalizeTasks([...sprintActive, ...sprintQueued, breakTask, ...laterQueued, ...done]);
    });
  }

  function stopAfterThisTask() {
    setRunner((r) => ({ ...r, stopAfterThisTask: true }));
  }

  function togglePause() {
    setRunner((r) => {
      // Pause active countdown
      if (r.activeTaskId && r.activeStartedAt) {
        if (r.pausedAt) {
          const add = Date.now() - r.pausedAt;
          return { ...r, pausedAt: null, pauseAccumulatedMs: r.pauseAccumulatedMs + Math.max(0, add) };
        }
        return { ...r, pausedAt: Date.now() };
      }

      // Pause between-tasks auto-start countdown
      if (r.autoStartAt) {
        if (r.autoStartPausedAt && r.autoStartPausedRemainingMs != null) {
          return {
            ...r,
            autoStartAt: Date.now() + r.autoStartPausedRemainingMs,
            autoStartPausedAt: null,
            autoStartPausedRemainingMs: null,
          };
        }
        const remaining = Math.max(0, r.autoStartAt - Date.now());
        return { ...r, autoStartPausedAt: Date.now(), autoStartPausedRemainingMs: remaining };
      }

      return r;
    });
  }

  function exitToPlan() {
    setTasks((prev) => normalizeTasks(prev.map((t) => (t.status === "active" ? { ...t, status: "queued" } : t))));
    setRunner({ ...getDefaultRunner(), mode: "plan" });
  }

  // Auto-start next task after countdown (15s) unless paused.
  useEffect(() => {
    if (runner.mode !== "run") return;
    if (!runner.autoStartAt) return;
    if (runner.autoStartPausedAt) return;
    const remaining = runner.autoStartAt - nowMs;
    if (remaining > 0) return;
    const nextId = getNextStepId(tasks);
    if (!nextId) {
      setRunner((r) => ({ ...r, autoStartAt: null, awaitingNextStart: true }));
      return;
    }
    startNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.mode, runner.autoStartAt, runner.autoStartPausedAt, nowMs]);

  return (
    <main className="min-h-screen px-4 py-7 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-[980px]">
        <header className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="text-center md:text-left">
            <div className="text-sm text-muted flex items-center justify-center md:justify-start">
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
            <div className="mt-1 text-2xl text-ink tracking-tight">A calm sprint</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 rounded-xl border border-line bg-white/70 px-4 py-3 shadow-soft backdrop-blur">
            <div className="min-w-0">
              <div className="text-xs text-muted">Now</div>
              <div className="text-sm text-ink">{formatClock(now)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted">Projected finish</div>
              <div className="text-sm text-ink">{formatClock(projectedFinish)}</div>
            </div>
            <div className="min-w-0 col-span-2 md:col-span-1">
              <label className="text-xs text-muted" htmlFor="latestFinish">
                Latest finish
              </label>
              <div className="mt-0.5 flex justify-center md:justify-start">
                <select
                  id="latestFinish"
                  value={settings.latestFinishMinutes}
                  onChange={(e) => setSettings((s) => ({ ...s, latestFinishMinutes: Number(e.target.value) }))}
                  className="w-[120px] rounded-lg border border-line bg-white/80 px-2 py-1 text-sm text-ink outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
                >
                  {latestFinishOptions.map((opt) => (
                    <option key={opt.minutes} value={opt.minutes}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </header>

        {pastCutoff ? (
          <div className="mb-6 rounded-xl border border-line bg-white/60 px-5 py-4 text-sm text-ink shadow-soft">
            Projected finish is after {formatClock(cutoff)}. Consider trimming or stopping after this task.
          </div>
        ) : null}

        {runner.mode === "run" ? (
          <RunView
            now={now}
            tasks={tasks}
            runner={runner}
            settings={settings}
            onStartNext={startNext}
            onDoneActive={doneActive}
            onDeleteActive={deleteActive}
            onExtendActive={extendActive}
            onInsertBreakNext={insertBreakNext}
            onStopAfterThisTask={stopAfterThisTask}
            onTogglePause={togglePause}
            onExitToPlan={exitToPlan}
          />
        ) : (
          <PlanView
            now={now}
            tasks={tasks}
            settings={settings}
            projectedFinish={projectedFinish}
            onAddTask={addTask}
            onAddSubtask={addSubtask}
            onInsertBreak={insertBreakInPlan}
            onStartSprint={startSprint}
            onTrimToFit={trimToFit}
            onReorderSprint={reorderSprint}
            onEditTitle={editTitle}
            onEditMinutes={editMinutes}
            onToggleDone={toggleDone}
            onDelete={deleteTask}
            onToggleInSprint={toggleInSprint}
          />
        )}
      </div>

      <Toast message="Marked done" visible={toast.on} />
      <Toast message={praise ?? ""} visible={Boolean(praise) && toast.on} />
      <Toast message="⚠️ Failed to save - storage full" visible={saveErrorToast.on} />
    </main>
  );
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
  // Subtle, calm burst (no loud full-screen party)
  try {
    confetti({
      particleCount: 40,
      spread: 55,
      startVelocity: 22,
      gravity: 0.9,
      scalar: 0.8,
      ticks: 140,
      origin: { x: 0.5, y: 0.15 },
      colors: ["#1F2937", "#6B7280", "#93C5FD", "#A7F3D0", "#FDE68A"],
    });
  } catch {
    // ignore if canvas unavailable
  }
}


