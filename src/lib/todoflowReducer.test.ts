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
