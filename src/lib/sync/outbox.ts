"use client";

import type { TaskRow } from "./mapping";

const OUTBOX_KEY = "todoflow:outbox:v1";

// Pending local rows awaiting upsert. Later writes for the same id replace
// earlier ones (only the newest copy of a row matters). Persisted so offline
// edits survive an app relaunch.
export class Outbox {
  private map = new Map<string, TaskRow>();

  load(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(OUTBOX_KEY);
      if (!raw) return;
      const rows = JSON.parse(raw) as TaskRow[];
      if (!Array.isArray(rows)) return;
      for (const r of rows) {
        if (r && typeof r.id === "string") this.map.set(r.id, r);
      }
    } catch {
      // corrupt outbox — drop it rather than crash sync
    }
  }

  private persist(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([...this.map.values()]));
    } catch {
      // quota — the in-memory copy still flushes this session
    }
  }

  enqueue(row: TaskRow): void {
    this.map.set(row.id, row);
    this.persist();
  }

  get(id: string): TaskRow | undefined {
    return this.map.get(id);
  }

  get size(): number {
    return this.map.size;
  }

  snapshot(): TaskRow[] {
    return [...this.map.values()];
  }

  // Remove flushed rows — but only if they weren't re-dirtied (same stamp)
  // while the network call was in flight.
  ack(flushed: TaskRow[]): void {
    for (const row of flushed) {
      const cur = this.map.get(row.id);
      if (cur && cur.updated_at_ms === row.updated_at_ms) {
        this.map.delete(row.id);
      }
    }
    this.persist();
  }
}
