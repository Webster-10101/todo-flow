"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "@/src/lib/types";
import type { ThingsTaskRow } from "@/src/lib/goals";
import { INBOX_KEY, type GoalGroup, useGoals } from "@/src/lib/useGoals";

// The goals column. Every open Things task in the working set, grouped under a
// season goal, with the ones nobody has placed yet in an Inbox at the top.
//
// Two rules that matter more than they look:
// * A collapsed group ALWAYS shows its count. Collapsing is how Al makes the
//   list scannable without losing the knowledge that it's all still there.
// * Nothing here writes to Things. Assignment is app-owned; the task rows are
//   a read-only mirror. "→ Today" copies a task onto the day, it doesn't move it.

type Props = {
  enabled: boolean;
  todayTasks: Task[];
  onAddToToday: (title: string) => void;
  onClose?: () => void;
};

const DRAG_MIME = "application/x-todoflow-things-id";

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return `${-diff}d over`;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function relative(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function GoalsPanel({ enabled, todayTasks, onAddToToday, onClose }: Props) {
  const g = useGoals(enabled);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [newGoal, setNewGoal] = useState("");

  const onTodayTitles = useMemo(() => {
    const s = new Set<string>();
    for (const t of todayTasks) {
      if (t.kind === "task" && t.status !== "done" && !t.parentId) s.add(t.title.trim().toLowerCase());
    }
    return s;
  }, [todayTasks]);

  const total = g.taskCount;
  const inbox = g.groups[0]?.tasks.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-1 pb-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium text-ink">Goals</h2>
          <span className="text-xs text-muted tabular-nums">
            {total} open{inbox ? ` · ${inbox} in inbox` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {g.syncedAt ? (
            <span className="text-[11px] text-muted" title={g.syncedAt}>
              synced {relative(g.syncedAt)}
            </span>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close goals"
              className="rounded-md px-1.5 py-0.5 text-muted hover:bg-soft hover:text-ink"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      {!enabled ? (
        <p className="px-1 text-sm text-muted">Sign in to see your goals.</p>
      ) : g.error ? (
        <p className="px-1 text-sm text-red-600">{g.error}</p>
      ) : g.loading ? (
        <p className="px-1 text-sm text-muted">Loading…</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-2">
          {g.groups.map((group) => {
            const key = group.goal?.id ?? INBOX_KEY;
            return (
              <GoalSection
                key={key}
                group={group}
                collapsed={g.collapsed.has(key)}
                onToggle={() => g.toggleCollapsed(key)}
                isDragOver={dragOver === key}
                onDragEnter={() => setDragOver(key)}
                onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                onDropTask={(thingsId) => {
                  setDragOver(null);
                  void g.moveTask(thingsId, group.goal?.id ?? null);
                }}
                onRename={group.goal ? (t) => g.editGoalTitle(group.goal!.id, t) : undefined}
                onArchive={
                  group.goal && group.tasks.length === 0
                    ? () => g.removeGoal(group.goal!.id)
                    : undefined
                }
                goalsForMove={g.goals}
                onMove={(thingsId, goalId) => void g.moveTask(thingsId, goalId)}
                onTodayTitles={onTodayTitles}
                onAddToToday={onAddToToday}
              />
            );
          })}

          {g.goals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-muted">
              No goals yet.{" "}
              <button
                type="button"
                onClick={() => void g.seed()}
                className="text-ink underline underline-offset-2"
              >
                Seed the five from the One Page Plans
              </button>
              , or add your own below.
            </div>
          ) : null}

          <form
            className="pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              const t = newGoal.trim();
              if (!t) return;
              void g.addGoal(t);
              setNewGoal("");
            }}
          >
            <input
              value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              placeholder="New goal…"
              className="w-full rounded-lg border border-line bg-white/60 px-3 py-2 text-sm outline-none placeholder:text-muted/70 focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
            />
          </form>
        </div>
      )}
    </div>
  );
}

// ---- one collapsible goal --------------------------------------------------

function GoalSection(props: {
  group: GoalGroup;
  collapsed: boolean;
  onToggle: () => void;
  isDragOver: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDropTask: (thingsId: string) => void;
  onRename?: (title: string) => void;
  onArchive?: () => void;
  goalsForMove: { id: string; title: string }[];
  onMove: (thingsId: string, goalId: string | null) => void;
  onTodayTitles: Set<string>;
  onAddToToday: (title: string) => void;
}) {
  const { group, collapsed } = props;
  const isInbox = group.goal === null;
  const title = group.goal?.title ?? "Inbox";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== title) props.onRename?.(t);
    else setDraft(title);
  };

  return (
    <section
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          props.onDragEnter();
        }
      }}
      onDragLeave={props.onDragLeave}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DRAG_MIME);
        if (id) {
          e.preventDefault();
          props.onDropTask(id);
        }
      }}
      className={[
        "rounded-xl border bg-white/70 shadow-soft transition-colors",
        props.isDragOver ? "border-ink/40 bg-white" : "border-line",
        isInbox && group.tasks.length ? "border-dashed" : "",
      ].join(" ")}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={props.onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-muted hover:bg-soft hover:text-ink"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className={["transition-transform", collapsed ? "" : "rotate-90"].join(" ")}
            aria-hidden
          >
            <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(title);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-sm outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={props.onToggle}
            onDoubleClick={() => {
              if (props.onRename) {
                setDraft(title);
                setEditing(true);
              }
            }}
            title={props.onRename ? "Double-click to rename" : undefined}
            className={[
              "min-w-0 flex-1 truncate text-left text-sm",
              isInbox ? "text-muted" : "font-medium text-ink",
            ].join(" ")}
          >
            {title}
          </button>
        )}

        {/* The count is the trust mechanism: it never hides, collapsed or not. */}
        <span
          className={[
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums",
            group.tasks.length === 0
              ? "text-muted/60"
              : isInbox
                ? "bg-soft text-ink"
                : "bg-soft text-muted",
          ].join(" ")}
        >
          {group.tasks.length}
        </span>

        {props.onArchive ? (
          <button
            type="button"
            onClick={props.onArchive}
            aria-label={`Archive ${title}`}
            title="Archive goal (it's empty)"
            className="shrink-0 rounded-md px-1 text-muted/60 hover:bg-soft hover:text-ink"
          >
            ×
          </button>
        ) : null}
      </header>

      {!collapsed && group.tasks.length > 0 ? (
        <ul className="border-t border-line/70">
          {group.tasks.map((t) => (
            <TaskLine
              key={t.things_id}
              task={t}
              onToday={props.onTodayTitles.has(t.name.trim().toLowerCase())}
              goals={props.goalsForMove}
              currentGoalId={group.goal?.id ?? null}
              onMove={(goalId) => props.onMove(t.things_id, goalId)}
              onAddToToday={() => props.onAddToToday(t.name)}
            />
          ))}
        </ul>
      ) : null}
      {!collapsed && group.tasks.length === 0 && !isInbox ? (
        <p className="border-t border-line/70 px-3 py-2 text-xs text-muted/70">
          Nothing here yet — drag a task in.
        </p>
      ) : null}
    </section>
  );
}

// ---- one task ----------------------------------------------------------------

function TaskLine(props: {
  task: ThingsTaskRow;
  onToday: boolean;
  goals: { id: string; title: string }[];
  currentGoalId: string | null;
  onMove: (goalId: string | null) => void;
  onAddToToday: () => void;
}) {
  const { task } = props;
  const isNow = task.priority === "now";
  const isBlocker = task.priority === "blocker";
  const isWaiting = task.priority === "waiting";

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, task.things_id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group/row flex items-start gap-2 px-3 py-1.5 hover:bg-soft/70 cursor-grab active:cursor-grabbing"
    >
      {/* Priority as a quiet mark: filled = now, ring = blocker, hollow-grey = waiting. */}
      <span
        aria-hidden
        className={[
          "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
          isNow
            ? "bg-ink"
            : isBlocker
              ? "ring-1 ring-red-500/70"
              : isWaiting
                ? "ring-1 ring-ink/25"
                : "bg-ink/25",
        ].join(" ")}
        title={task.priority}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-5 text-ink break-words">{task.name}</div>
        {(task.due || task.project || task.is_urgent) && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted">
            {task.is_urgent ? <span className="text-red-600">must-do</span> : null}
            {task.due ? <span>{formatDue(task.due)}</span> : null}
            {task.project ? <span>{task.project}</span> : null}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus-within:opacity-100">
        <select
          aria-label="Move to goal"
          value={props.currentGoalId ?? ""}
          onChange={(e) => props.onMove(e.target.value || null)}
          className="max-w-[110px] rounded-md border border-line bg-white/80 px-1 py-0.5 text-[11px] text-muted outline-none"
        >
          <option value="">Inbox</option>
          {props.goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        {props.onToday ? (
          <span className="rounded-md px-1.5 py-0.5 text-[11px] text-muted">on today</span>
        ) : (
          <button
            type="button"
            onClick={props.onAddToToday}
            title="Add to today's plan"
            className="rounded-md border border-line bg-white/80 px-1.5 py-0.5 text-[11px] text-ink hover:bg-soft"
          >
            → Today
          </button>
        )}
      </div>
    </li>
  );
}
