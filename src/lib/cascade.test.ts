import { describe, expect, it } from "vitest";

import { cascade, DAY_END_MIN, type CascadeBlock } from "./cascade";

let seq = 0;
function block(
  id: string,
  start: number,
  duration: number,
  overrides: Partial<CascadeBlock> = {},
): CascadeBlock {
  seq += 1;
  return { id, start, duration, position: seq * 1000, createdAt: seq, ...overrides };
}

function run(
  placed: { id: string; start: number; duration: number },
  movable: CascadeBlock[],
  extraObstacles: Array<{ start: number; end: number }> = [],
) {
  return cascade({
    movable,
    obstacles: [
      { start: placed.start, end: placed.start + placed.duration },
      ...extraObstacles,
    ],
  });
}

describe("cascade", () => {
  it("returns no moves when nothing collides", () => {
    const result = run({ id: "new", start: 540, duration: 30 }, [
      block("a", 600, 30),
      block("b", 720, 60),
    ]);
    expect(result.moves.size).toBe(0);
    expect(result.clamped).toBe(false);
  });

  it("pushes a colliding block to the end of the placed block", () => {
    const result = run({ id: "new", start: 540, duration: 30 }, [
      block("a", 540, 25),
    ]);
    expect(result.moves.get("a")).toBe(570);
  });

  it("absorbs displacement into gaps — downstream block with room does not move", () => {
    // A at 14:00 (25 min), gap, B at 15:30. Drop C (30 min) on 14:00.
    // A bounces to 14:30–14:55; B's 15:30 start is untouched.
    const result = run({ id: "c", start: 840, duration: 30 }, [
      block("a", 840, 25),
      block("b", 930, 30),
    ]);
    expect(result.moves.get("a")).toBe(870);
    expect(result.moves.has("b")).toBe(false);
  });

  it("chain-pushes when there is no gap to absorb", () => {
    const result = run({ id: "new", start: 540, duration: 30 }, [
      block("a", 540, 30),
      block("b", 570, 30),
      block("c", 600, 30),
    ]);
    expect(result.moves.get("a")).toBe(570);
    expect(result.moves.get("b")).toBe(600);
    expect(result.moves.get("c")).toBe(630);
  });

  it("keeps an auto-break glued to its task through off-grid pushes", () => {
    // 25-min task at 9:00 with its break butted at 9:25 (off-grid, gap 0).
    // A 30-min block dropped at 9:00 pushes task to 9:30, break to 9:55.
    const result = run({ id: "new", start: 540, duration: 30 }, [
      block("task", 540, 25),
      block("break", 565, 5),
    ]);
    expect(result.moves.get("task")).toBe(570);
    expect(result.moves.get("break")).toBe(595);
  });

  it("keeps the glue when the pusher is itself off-grid-sized", () => {
    // 25-min pusher: task lands off-grid at 9:25, break at 9:50 — no snap.
    const result = run({ id: "new", start: 540, duration: 25 }, [
      block("task", 540, 25),
      block("break", 565, 5),
    ]);
    expect(result.moves.get("task")).toBe(565);
    expect(result.moves.get("break")).toBe(590);
  });

  it("pushes a block that overlaps the placed interval from above", () => {
    // Block spans 13:00–14:00; drop lands at 13:30. Block bumps below it.
    const result = run({ id: "new", start: 810, duration: 30 }, [
      block("a", 780, 60),
    ]);
    expect(result.moves.get("a")).toBe(840);
  });

  it("flows the cascade around an immovable obstacle (active block)", () => {
    // Active block pinned 10:00–10:30. Drop at 9:00 (60 min) onto A (9:00,
    // 45 min): A can't sit at 10:00, hops to 10:30.
    const result = run(
      { id: "new", start: 540, duration: 60 },
      [block("a", 540, 45)],
      [{ start: 600, end: 630 }],
    );
    expect(result.moves.get("a")).toBe(630);
  });

  it("clamps the tail at midnight and flags it", () => {
    const result = run({ id: "new", start: DAY_END_MIN - 60, duration: 60 }, [
      block("a", DAY_END_MIN - 60, 45),
    ]);
    expect(result.moves.get("a")).toBe(DAY_END_MIN - 45);
    expect(result.clamped).toBe(true);
  });

  it("orders equal starts by position, then createdAt", () => {
    const result = run({ id: "new", start: 540, duration: 30 }, [
      block("late", 540, 30, { position: 2000, createdAt: 1 }),
      block("early", 540, 30, { position: 1000, createdAt: 2 }),
    ]);
    expect(result.moves.get("early")).toBe(570);
    expect(result.moves.get("late")).toBe(600);
  });

  it("leaves blocks before the placed interval untouched", () => {
    const result = run({ id: "new", start: 600, duration: 30 }, [
      block("before", 540, 30),
      block("hit", 600, 30),
    ]);
    expect(result.moves.has("before")).toBe(false);
    expect(result.moves.get("hit")).toBe(630);
  });
});
