"use client";

import { useEffect, useState } from "react";

// The day is logically 00:00–24:00; blocks can live anywhere in it.
export { DAY_START_MIN, DAY_END_MIN } from "./cascade";

// Default DISPLAYED window (minutes from midnight). The canvas shows 8am–8pm
// unless scheduled blocks fall outside it, in which case the window expands
// to include them — useful for planning an evening without a 24-row grid
// dominating the normal day.
export const CANVAS_START_MIN = 8 * 60; // 480
export const CANVAS_END_MIN = 20 * 60; // 1200

// Snap granularity for scheduled-start times. Matches Focusmate's 15-min grid.
export const SCHEDULE_SLOT_MIN = 15;

// Snap granularity for DURATION. Deliberately finer than the start grid: a lot
// of the working set is 2–10 minute admin, and a 15-min resize floor made those
// impossible to express — you'd drag a 5-min task and get 15.
export const RESIZE_STEP_MIN = 5;

// Visual density. 2 px/min on desktop → 30-min slot = 60 px (hour = 120 px),
// full 12h day = 1440 px. Mobile 1.5 → 30-min = 45 px, canvas = 1080 px.
// Block heights are strictly proportional to time (hour-long task fills 1 hour
// of grid). Floor is only a visual minimum for sub-10-min tasks so they remain
// tappable; tasks ≥ ~10 min are exactly proportional.
export const PX_PER_MIN_DESKTOP = 2;
export const PX_PER_MIN_MOBILE = 1.5;

export const MIN_BLOCK_HEIGHT_PX = 18;

const MOBILE_QUERY = "(max-width: 639px)";

export function useGridPxPerMin(): number {
  const [pxPerMin, setPxPerMin] = useState<number>(PX_PER_MIN_DESKTOP);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const apply = () =>
      setPxPerMin(mq.matches ? PX_PER_MIN_MOBILE : PX_PER_MIN_DESKTOP);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  return pxPerMin;
}
