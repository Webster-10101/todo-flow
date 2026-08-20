import { describe, expect, it } from "vitest";

import { initialState, reducer, type State } from "./todoflowReducer";
import type { Task } from "./types";

const NOW = new Date("2026-07-29T10:00:00").getTime();

let seq = 0;
function task(overrides: Partial<Task> & { id: string }): Task {
  seq += 1;
  return {
    title: overrides.id,
    notes: "",
    estimateMinutes: 25,
    extraMinutes: 0,
    scheduledStartMinutes: null,
    status: "queued",
    kind: "task",
    parentId: null,
    inSprint: true,
    createdAt: NOW - 1000 + seq,
    date: "2026-07-29",
    position: seq * 1000,
    updatedAtMs: NOW - 1000,
    ...overrides,
  };
}

function stateWith(tasks: Task[]): State {
  return { ...initialState, tasks };
}

function startOf(s: State, id: string): number | null {
  const t = s.tasks.find((x) => x.id === id);
  return t ? t.scheduledStartMinutes : null;
}

describe("reducer bounce-down wiring", () => {
  it("SET_TASK_TIME pushes the block it lands on, gap-absorbing", () => {
    // a 9:00–9:25, gap, b 10:30. Move c onto 9:00 → a bounces to 9:30, b stays.
    const s = stateWith([
      task({ id: "a", scheduledStartMinutes: 540 }),
      task({ id: "b", scheduledStartMinutes: 630, estimateMinutes: 30 }),
      task({ id: "c", scheduledStartMinutes: 720, estimateMinutes: 30 }),
    ]);
    const out = reducer(s, { type: "SET_TASK_TIME", id: "c", minutes: 540, nowMs: NOW });
    expect(startOf(out, "c")).toBe(540);
    expect(startOf(out, "a")).toBe(570);
    expect(startOf(out, "b")).toBe(630);
  });

  it("SET_TASK_TIME keeps a task and its break glued through the push", () => {
    const s = stateWith([
      task({ id: "t", scheduledStartMinutes: 540, estimateMinutes: 25 }),
      task({ id: "brk", scheduledStartMinutes: 565, estimateMinutes: 5, kind: "break" }),
      task({ id: "mover", scheduledStartMinutes: 720, estimateMinutes: 30 }),
    ]);
    const out = reducer(s, { type: "SET_TASK_TIME", id: "mover", minutes: 540, nowMs: NOW });
    expect(startOf(out, "t")).toBe(570);
    expect(startOf(out, "brk")).toBe(595); // exactly t's end — still glued
  });

  it("SET_TASK_TIME stamps only the rows that moved", () => {
    const s = stateWith([
      task({ id: "a", scheduledStartMinutes: 540 }),
      task({ id: "far", scheduledStartMinutes: 900 }),
      task({ id: "mover", scheduledStartMinutes: 720, estimateMinutes: 30 }),
    ]);
    const out = reducer(s, { type: "SET_TASK_TIME", id: "mover", minutes: 540, nowMs: NOW });
    expect(out.tasks.find((t) => t.id === "a")?.updatedAtMs).toBe(NOW);
    expect(out.tasks.find((t) => t.id === "far")?.updatedAtMs).toBe(NOW - 1000);
  });

  it("ADD_TASK places the auto-break even when the slot after is occupied", () => {
    // Occupier at 9:25 used to make breakSlotAfter drop the break silently.
    const s = stateWith([
      task({ id: "occupier", scheduledStartMinutes: 565, estimateMinutes: 30 }),
    ]);
    const out = reducer(s, {
      type: "ADD_TASK",
      payload: {
        id: "new",
        title: "New",
        minutes: 25,
        nowMs: NOW,
        scheduledStartMinutes: 540,
        breakId: "new-brk",
        breakMinutes: 5,
      },
    });
    expect(startOf(out, "new")).toBe(540);
    expect(startOf(out, "new-brk")).toBe(565); // glued to the task
    expect(startOf(out, "occupier")).toBe(570); // bounced past the pair
  });

  it("EDIT_MINUTES growing a block pushes the one below instead of overlapping", () => {
    const s = stateWith([
      task({ id: "grow", scheduledStartMinutes: 540, estimateMinutes: 25 }),
      task({ id: "below", scheduledStartMinutes: 570, estimateMinutes: 30 }),
    ]);
    const out = reducer(s, { type: "EDIT_MINUTES", id: "grow", minutes: 60, nowMs: NOW });
    expect(startOf(out, "below")).toBe(600);
  });

  it("cascade never moves done blocks", () => {
    const s = stateWith([
      task({ id: "done", scheduledStartMinutes: 540, status: "done" }),
      task({ id: "mover", scheduledStartMinutes: 720, estimateMinutes: 30 }),
    ]);
    const out = reducer(s, { type: "SET_TASK_TIME", id: "mover", minutes: 540, nowMs: NOW });
    expect(startOf(out, "mover")).toBe(540);
    expect(startOf(out, "done")).toBe(540); // history untouched, overlap allowed
  });

  it("SET_TASK_TIME clamps so the block ends by midnight", () => {
    const s = stateWith([
      task({ id: "mover", scheduledStartMinutes: 540, estimateMinutes: 60 }),
    ]);
    const out = reducer(s, { type: "SET_TASK_TIME", id: "mover", minutes: 1425, nowMs: NOW });
    expect(startOf(out, "mover")).toBe(1380); // 23:00, ends 24:00
  });
});

describe("MOVE_TASK_GROUP", () => {
  it("moves every block by the same delta, preserving the gaps between them", () => {
    // a 9:00, b 10:00 (35-min gap). +60 → 10:00 and 11:00, gap intact.
    const s = stateWith([
      task({ id: "a", scheduledStartMinutes: 540 }),
      task({ id: "b", scheduledStartMinutes: 600 }),
    ]);
    const out = reducer(s, {
      type: "MOVE_TASK_GROUP",
      ids: ["a", "b"],
      deltaMinutes: 60,
      nowMs: NOW,
    });
    expect(startOf(out, "a")).toBe(600);
    expect(startOf(out, "b")).toBe(660);
  });

  it("moves earlier too — negative delta", () => {
    const s = stateWith([
      task({ id: "a", scheduledStartMinutes: 600 }),
      task({ id: "b", scheduledStartMinutes: 660 }),
    ]);
    const out = reducer(s, {
      type: "MOVE_TASK_GROUP",
      ids: ["a", "b"],
      deltaMinutes: -60,
      nowMs: NOW,
    });
    expect(startOf(out, "a")).toBe(540);
    expect(startOf(out, "b")).toBe(600);
  });

  it("bounces unselected blocks off every landed group member", () => {
    // Group a 9:00, b 10:00 lands +30; victim at 10:30 collides with b's new
    // 10:30–10:55 interval and bounces to 10:55.
    const s = stateWith([
      task({ id: "a", scheduledStartMinutes: 540 }),
      task({ id: "b", scheduledStartMinutes: 600 }),
      task({ id: "victim", scheduledStartMinutes: 630, estimateMinutes: 30 }),
    ]);
    const out = reducer(s, {
      type: "MOVE_TASK_GROUP",
      ids: ["a", "b"],
      deltaMinutes: 30,
      nowMs: NOW,
    });
    expect(startOf(out, "a")).toBe(570);
    expect(startOf(out, "b")).toBe(630);
    expect(startOf(out, "victim")).toBe(655);
  });

  it("clamps the delta so the whole group stays inside the day", () => {
    // b ends at 23:25 → only 35 min of headroom; both blocks move by 35.
    const s = stateWith([
      task({ id: "a", scheduledStartMinutes: 1320 }),
      task({ id: "b", scheduledStartMinutes: 1380 }),
    ]);
    const out = reducer(s, {
      type: "MOVE_TASK_GROUP",
      ids: ["a", "b"],
      deltaMinutes: 120,
      nowMs: NOW,
    });
    expect(startOf(out, "a")).toBe(1355);
    expect(startOf(out, "b")).toBe(1415); // ends 24:00
  });

  it("ignores done blocks in the selection and stamps only movers", () => {
    const s = stateWith([
      task({ id: "d", scheduledStartMinutes: 540, status: "done" }),
      task({ id: "m", scheduledStartMinutes: 600 }),
    ]);
    const out = reducer(s, {
      type: "MOVE_TASK_GROUP",
      ids: ["d", "m"],
      deltaMinutes: 60,
      nowMs: NOW,
    });
    expect(startOf(out, "d")).toBe(540); // history untouched
    expect(startOf(out, "m")).toBe(660);
    expect(out.tasks.find((t) => t.id === "d")?.updatedAtMs).toBe(NOW - 1000);
    expect(out.tasks.find((t) => t.id === "m")?.updatedAtMs).toBe(NOW);
  });
});

// Pressing play used to swap the whole view out, so nobody could see where the
// running block sat. Now the canvas stays up — the block has to move to where
// the clock actually is, or it lies about what's happening.
describe("starting a task places its block at now", () => {
  // NOW is 10:00 local → minute-of-day 600.
  it("START_TASK moves the block to now and bounces what it lands on", () => {
    const s = stateWith([
      task({ id: "a", scheduledStartMinutes: 610 }), // 10:10, 25 min
      task({ id: "b", scheduledStartMinutes: 720, estimateMinutes: 30 }), // 12:00
    ]);
    const out = reducer(s, { type: "START_TASK", id: "b", nowMs: NOW });
    expect(startOf(out, "b")).toBe(600); // pinned to the timer
    expect(startOf(out, "a")).toBe(630); // bounced clear of b's 600–630
    expect(out.runner.activeTaskId).toBe("b");
  });

  it("starting a parent places the parent block, not the subtask", () => {
    const s = stateWith([
      task({ id: "p", scheduledStartMinutes: 720 }),
      task({ id: "c1", parentId: "p", estimateMinutes: 20 }),
      task({ id: "c2", parentId: "p", estimateMinutes: 20 }),
    ]);
    const out = reducer(s, { type: "START_TASK", id: "p", nowMs: NOW });
    expect(out.runner.activeTaskId).toBe("c1"); // the leaf runs
    expect(startOf(out, "p")).toBe(600); // the canvas block moves
    expect(startOf(out, "c1")).toBe(null); // subtasks aren't scheduled
  });

  it("START_NEXT places the next block at now too", () => {
    const s = stateWith([
      task({ id: "a", scheduledStartMinutes: 540, status: "done" }),
      task({ id: "b", scheduledStartMinutes: 900 }), // 15:00
    ]);
    const out = reducer(s, { type: "START_NEXT", nowMs: NOW });
    expect(out.runner.activeTaskId).toBe("b");
    expect(startOf(out, "b")).toBe(600);
    expect(startOf(out, "a")).toBe(540); // done blocks are history
  });

  it("leaves the rest of the day alone when nothing overlaps", () => {
    const s = stateWith([
      task({ id: "later", scheduledStartMinutes: 900 }),
      task({ id: "go", scheduledStartMinutes: 1000, estimateMinutes: 30 }),
    ]);
    const out = reducer(s, { type: "START_TASK", id: "go", nowMs: NOW });
    expect(startOf(out, "go")).toBe(600);
    expect(startOf(out, "later")).toBe(900);
  });
});

describe("START_FRESH_DAY", () => {
  const ids = (s: State) => s.tasks.map((t) => t.id).sort();
  const find = (s: State, id: string) => s.tasks.find((t) => t.id === id);

  it("clears today's canvas: done go, unfinished drop to Later, breaks vanish", () => {
    const s = stateWith([
      task({ id: "done1", scheduledStartMinutes: 540, status: "done" }),
      task({ id: "brk", scheduledStartMinutes: 565, kind: "break", estimateMinutes: 5 }),
      task({ id: "open1", scheduledStartMinutes: 600 }),
      task({ id: "open2", scheduledStartMinutes: 700 }),
    ]);
    const out = reducer(s, { type: "START_FRESH_DAY", nowMs: NOW });

    expect(ids(out)).toEqual(["open1", "open2"]);
    for (const id of ["open1", "open2"]) {
      expect(find(out, id)?.inSprint).toBe(false);
      expect(find(out, id)?.scheduledStartMinutes).toBe(null);
      expect(find(out, id)?.updatedAtMs).toBe(NOW);
    }
  });

  it("leaves earlier days' completions alone — that's the history", () => {
    const s = stateWith([
      task({ id: "yesterday", status: "done", date: "2026-07-28", scheduledStartMinutes: 540 }),
      task({ id: "today", status: "done", date: "2026-07-29", scheduledStartMinutes: 600 }),
    ]);
    const out = reducer(s, { type: "START_FRESH_DAY", nowMs: NOW });
    expect(ids(out)).toEqual(["yesterday"]);
  });

  it("clears today's out-of-sprint completions too", () => {
    const s = stateWith([
      task({ id: "sideDone", status: "done", inSprint: false }),
      task({ id: "backlog", status: "queued", inSprint: false }),
    ]);
    const out = reducer(s, { type: "START_FRESH_DAY", nowMs: NOW });
    expect(ids(out)).toEqual(["backlog"]);
    // Untouched rows keep their stamp so sync doesn't see a phantom edit.
    expect(find(out, "backlog")?.updatedAtMs).toBe(NOW - 1000);
  });

  it("never yanks the block that's running", () => {
    const s: State = {
      ...stateWith([
        task({ id: "running", status: "active", scheduledStartMinutes: 600 }),
        task({ id: "next", scheduledStartMinutes: 700 }),
      ]),
      runner: { ...initialState.runner, mode: "run", activeTaskId: "running" },
    };
    const out = reducer(s, { type: "START_FRESH_DAY", nowMs: NOW });
    expect(find(out, "running")?.inSprint).toBe(true);
    expect(find(out, "running")?.scheduledStartMinutes).toBe(600);
    expect(find(out, "next")?.inSprint).toBe(false);
  });

  it("takes subtasks down with a swept parent and keeps them under a parked one", () => {
    const s = stateWith([
      task({ id: "p1", status: "done", scheduledStartMinutes: 540 }),
      task({ id: "p1a", status: "done", parentId: "p1" }),
      task({ id: "p2", scheduledStartMinutes: 600 }),
      task({ id: "p2a", parentId: "p2" }),
    ]);
    const out = reducer(s, { type: "START_FRESH_DAY", nowMs: NOW });
    expect(ids(out)).toEqual(["p2", "p2a"]);
    // The child's inSprint is untouched — the Later list has no parent filter,
    // so flipping it would surface the subtask as a top-level row.
    expect(find(out, "p2a")?.inSprint).toBe(true);
  });

  it("parks tasks into Later in canvas order, after what's already there", () => {
    const s = stateWith([
      task({ id: "backlog", inSprint: false, position: 5000 }),
      task({ id: "late", scheduledStartMinutes: 700, position: 10 }),
      task({ id: "early", scheduledStartMinutes: 600, position: 20 }),
    ]);
    const out = reducer(s, { type: "START_FRESH_DAY", nowMs: NOW });
    const later = out.tasks
      .filter((t) => !t.inSprint && t.status === "queued")
      .sort((a, b) => a.position - b.position)
      .map((t) => t.id);
    expect(later).toEqual(["backlog", "early", "late"]);
  });

  it("is a no-op on an already-clear day", () => {
    const s = stateWith([task({ id: "backlog", inSprint: false })]);
    const out = reducer(s, { type: "START_FRESH_DAY", nowMs: NOW });
    expect(out).toBe(s);
  });

  it("undo restores the whole day — removals and parked tasks alike", () => {
    const s = stateWith([
      task({ id: "done1", scheduledStartMinutes: 540, status: "done" }),
      task({ id: "brk", scheduledStartMinutes: 565, kind: "break", estimateMinutes: 5 }),
      task({ id: "open1", scheduledStartMinutes: 600 }),
    ]);
    const cleared = reducer(s, { type: "START_FRESH_DAY", nowMs: NOW });
    const out = reducer(cleared, { type: "UNDO_DELETE", nowMs: NOW + 1000 });

    expect(ids(out)).toEqual(["brk", "done1", "open1"]);
    expect(find(out, "open1")?.inSprint).toBe(true);
    expect(find(out, "open1")?.scheduledStartMinutes).toBe(600);
    expect(out.lastDeletion).toBe(null);
  });
});

describe("BATCH_TASKS", () => {
  it("folds the selected blocks into one parent, keeping day order", () => {
    const s = stateWith([
      task({ id: "a", scheduledStartMinutes: 540, estimateMinutes: 5 }),
      task({ id: "b", scheduledStartMinutes: 600, estimateMinutes: 2 }),
      task({ id: "c", scheduledStartMinutes: 660, estimateMinutes: 10 }),
    ]);
    const out = reducer(s, {
      type: "BATCH_TASKS",
      payload: { ids: ["c", "a"], parentId: "batch", title: "Admin batch", nowMs: NOW },
    });
    const parent = out.tasks.find((t) => t.id === "batch");
    expect(parent).toBeTruthy();
    // Starts where the earliest member did, and the members become its kids in
    // the order they sat on the day.
    expect(parent?.scheduledStartMinutes).toBe(540);
    const kids = out.tasks.filter((t) => t.parentId === "batch");
    expect(kids.map((t) => t.id)).toEqual(["a", "c"]);
    for (const k of kids) expect(k.scheduledStartMinutes).toBeNull();
    // Untouched blocks stay where they were.
    expect(startOf(out, "b")).toBe(600);
    // The parent carries no duration of its own — the kids are the duration.
    expect(parent?.estimateMinutes).toBe(0);
  });

  it("refuses to batch the running block, or a single selection", () => {
    const running = stateWith([
      task({ id: "a", scheduledStartMinutes: 540, status: "active" }),
      task({ id: "b", scheduledStartMinutes: 600 }),
    ]);
    const out = reducer(running, {
      type: "BATCH_TASKS",
      payload: { ids: ["a", "b"], parentId: "batch", title: "Admin batch", nowMs: NOW },
    });
    // Only "b" was eligible, so nothing happens rather than a batch of one.
    expect(out).toBe(running);

    const one = stateWith([task({ id: "a", scheduledStartMinutes: 540 })]);
    expect(
      reducer(one, {
        type: "BATCH_TASKS",
        payload: { ids: ["a"], parentId: "batch", title: "Admin batch", nowMs: NOW },
      }),
    ).toBe(one);
  });

  it("does not nest — a block that already has subtasks is left alone", () => {
    const s = stateWith([
      task({ id: "parent", scheduledStartMinutes: 540, estimateMinutes: 0 }),
      task({ id: "kid", parentId: "parent", estimateMinutes: 15 }),
      task({ id: "a", scheduledStartMinutes: 600, estimateMinutes: 5 }),
      task({ id: "b", scheduledStartMinutes: 660, estimateMinutes: 5 }),
    ]);
    const out = reducer(s, {
      type: "BATCH_TASKS",
      payload: { ids: ["parent", "a", "b"], parentId: "batch", title: "Admin", nowMs: NOW },
    });
    expect(out.tasks.find((t) => t.id === "parent")?.parentId).toBeNull();
    expect(out.tasks.filter((t) => t.parentId === "batch").map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
