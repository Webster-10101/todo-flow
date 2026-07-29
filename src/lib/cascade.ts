// Gap-absorbing bounce-down: when a block is placed (dropped, resized, or
// created) onto occupied time, everything it displaces shifts LATER. A block
// only moves once the end of whatever now precedes it has passed its start —
// free space soaks up displacement, so the cascade stops as soon as it can.
// Relative order is preserved by construction (single forward sweep).
//
// Deliberately NO snapping inside the sweep: displaced blocks land at the
// exact end of the block that hit them. That is what keeps an auto-break
// (placed at exactly its task's end, gap 0) glued to its task through any
// push — re-snapping would tear them apart. Off-grid starts are sanctioned
// precedent: breakSlotAfter places breaks off-grid on purpose.
//
// Pure and dependency-free so both the reducer (commit) and the canvas
// (live drag preview) can run it and agree on the result.

export const DAY_START_MIN = 0;
export const DAY_END_MIN = 24 * 60;

export type CascadeBlock = {
  id: string;
  start: number; // minutes from midnight
  duration: number; // minutes
  // Tie-breaks for blocks sharing a start (bad sync merges): match
  // normalizeTasks' position → createdAt ordering, then id for determinism.
  position: number;
  createdAt: number;
};

export type CascadeResult = {
  // ONLY blocks whose start changed: id -> new start. Untouched blocks are
  // absent, so the caller stamps exactly the rows that moved.
  moves: Map<string, number>;
  // The tail hit the midnight wall and got clamped — blocks may overlap
  // there. The day is over-full; that's visible signal, not an error.
  clamped: boolean;
};

export function cascade(args: {
  // Every movable scheduled block: exclude the just-placed block(s), done
  // blocks (they record when work happened — pushing them would falsify
  // history), and the active block.
  movable: CascadeBlock[];
  // Fixed intervals blocks must flow around: the placed interval (caller has
  // already snapped/clamped it so it ends by dayEndMin), plus the active
  // (running) block if one is scheduled.
  obstacles: Array<{ start: number; end: number }>;
  dayEndMin?: number;
}): CascadeResult {
  const dayEndMin = args.dayEndMin ?? DAY_END_MIN;

  const movable = [...args.movable].sort(
    (a, b) =>
      a.start - b.start ||
      a.position - b.position ||
      a.createdAt - b.createdAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const obstacles = [...args.obstacles]
    .filter((o) => o.end > o.start)
    .sort((a, b) => a.start - b.start);

  const moves = new Map<string, number>();
  let clamped = false;
  let cursor = Number.NEGATIVE_INFINITY;

  for (const b of movable) {
    // Gap absorption: only move if whatever now precedes has overrun us.
    let newStart = Math.max(b.start, cursor);

    // Bump past fixed intervals. Obstacles are in start order and the
    // candidate only moves forward, so one pass suffices.
    for (const o of obstacles) {
      if (newStart < o.end && newStart + b.duration > o.start) {
        newStart = o.end;
      }
    }

    // Midnight wall: clamp so the block ends by dayEndMin. If that
    // reintroduces overlap at the tail, so be it — flag and carry on.
    const maxStart = Math.max(DAY_START_MIN, dayEndMin - b.duration);
    if (newStart > maxStart) {
      newStart = maxStart;
      clamped = true;
    }

    if (newStart !== b.start) moves.set(b.id, newStart);
    cursor = newStart + b.duration;
  }

  return { moves, clamped };
}
