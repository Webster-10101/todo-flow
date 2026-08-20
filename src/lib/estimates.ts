"use client";

import { useCallback, useEffect, useState } from "react";

// How long a Things task is expected to take, remembered per things_id.
//
// Things has no duration field and /world-sync mirrors it read-only, so the
// estimate is app-side and deliberately local: it exists to stop the "drop it
// on the day, then resize the block" faff, not to become another thing to
// maintain. Losing it costs one dropdown.
const KEY = "todoflow.things.minutes.v1";

// Offered on a todo row. Sub-15 values are the point — a lot of the working
// set is two-minute admin, and rounding those up to 15 is what makes a day
// look full when it isn't.
export const ESTIMATE_CHOICES = [2, 5, 10, 15, 20, 25, 30, 45, 60, 90] as const;

export type EstimateMap = Record<string, number>;

export function loadEstimates(): EstimateMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: EstimateMap = {};
    for (const [id, mins] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof mins === "number" && Number.isFinite(mins) && mins > 0) {
        out[id] = Math.round(mins);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function useEstimates() {
  const [map, setMap] = useState<EstimateMap>({});

  // Read after mount — the static export bakes its HTML at build time, so
  // touching localStorage during render would mismatch on hydrate.
  useEffect(() => setMap(loadEstimates()), []);

  const set = useCallback((thingsId: string, minutes: number) => {
    setMap((prev) => {
      const next = { ...prev, [thingsId]: Math.max(1, Math.round(minutes)) };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode / quota — the estimate just doesn't persist */
      }
      return next;
    });
  }, []);

  return { map, set };
}
