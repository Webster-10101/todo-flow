"use client";

import type { Task } from "@/src/lib/types";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TaskRow } from "./TaskRow";

const POPOVER_WIDTH = 320;
const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 6;
// Below is preferred unless it has less room than this — flipping above for a
// few pixels of gain makes the popover jump around for no benefit.
const PREFER_BELOW_MIN = 260;
// Never squeeze smaller than this; better to overlap the anchor slightly than
// render a 40px sliver (happens with the keyboard up on a short screen).
const MIN_HEIGHT = 180;

type Placement = {
  left: number;
  maxHeight: number;
  side: "below" | "above";
  anchorTop: number;
  anchorBottom: number;
  visibleTop: number;
  visibleBottom: number;
};

export function SubtasksPopover(props: {
  parent: Task;
  kids: Task[];
  anchor: DOMRect;
  onClose: () => void;
  onAddSubtask: (parentId: string, title: string, minutes: number) => void;
  onEditTitle: (id: string, title: string) => void;
  onEditMinutes: (id: string, minutes: number) => void;
  onEditNotes: (id: string, notes: string) => void;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [placement, setPlacement] = useState<Placement>(() => place(props.anchor));
  // Measured height of the popover as rendered. `maxHeight` is derived from the
  // anchor and viewport alone (never from content), so measuring here can't
  // feed back into the layout and oscillate.
  const [height, setHeight] = useState(0);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    setPlacement(place(props.anchor));
  }, [props.anchor]);

  // Re-place when the visual viewport changes — on iOS the keyboard shrinks
  // visualViewport (not window.innerHeight), which would otherwise leave the
  // popover hidden behind the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => setPlacement(place(props.anchor));
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
    };
  }, [props.anchor]);

  // Track the real rendered height. This replaces a hardcoded 240px guess that
  // was wrong the moment a task had more than a few subtasks — the popover grew
  // past the assumption and its bottom fell off the screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [props]);

  if (!mounted) return null;

  const top = resolveTop(placement, height);

  const node = (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Subtasks for ${props.parent.title || "Untitled task"}`}
      className="fixed z-50 flex flex-col rounded-xl border border-line bg-white shadow-lg p-3 gap-2"
      style={{
        top,
        left: placement.left,
        width: POPOVER_WIDTH,
        maxHeight: placement.maxHeight,
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="text-xs font-medium text-ink truncate">
          {props.parent.title || "Untitled task"}
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="relative -m-1.5 inline-flex h-8 w-8 items-center justify-center text-[16px] leading-none text-muted hover:text-ink transition-colors"
          aria-label="Close subtasks"
          title="Close"
        >
          ×
        </button>
      </div>

      {props.kids.length === 0 ? (
        <div className="text-xs text-muted">No subtasks yet.</div>
      ) : (
        // min-h-0 is load-bearing: without it a flex child refuses to shrink
        // below its content height and the scroll never engages.
        <div className="flex-1 min-h-0 space-y-2 overflow-y-auto">
          {props.kids.map((k) => (
            <TaskRow
              key={k.id}
              task={k}
              compact
              onEditTitle={props.onEditTitle}
              onEditMinutes={props.onEditMinutes}
              onEditNotes={props.onEditNotes}
              onToggleDone={props.onToggleDone}
              onDelete={props.onDelete}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => props.onAddSubtask(props.parent.id, "", 10)}
        className="shrink-0 self-start text-xs text-muted hover:text-ink transition-colors"
      >
        + Add subtask
      </button>
    </div>
  );

  return createPortal(node, document.body);
}

// Horizontal position + which side to open on + how tall it may get. Depends
// only on the anchor and the viewport, never on the popover's content.
function place(anchor: DOMRect): Placement {
  if (typeof window === "undefined") {
    return {
      left: 0,
      maxHeight: 400,
      side: "below",
      anchorTop: 0,
      anchorBottom: 0,
      visibleTop: 0,
      visibleBottom: 0,
    };
  }
  // Use the visual viewport when available — on iOS the keyboard shrinks it
  // while window.innerHeight stays fixed.
  const vv = window.visualViewport;
  const vw = vv?.width ?? window.innerWidth;
  // Bottom edge of the visible area in layout-viewport coordinates (what
  // getBoundingClientRect and position:fixed are relative to).
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const visibleTop = vv ? vv.offsetTop : 0;

  let left = anchor.left;
  if (left + POPOVER_WIDTH + VIEWPORT_PADDING > vw) {
    left = vw - POPOVER_WIDTH - VIEWPORT_PADDING;
  }
  if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;

  const spaceBelow = visibleBottom - anchor.bottom - ANCHOR_GAP - VIEWPORT_PADDING;
  const spaceAbove = anchor.top - ANCHOR_GAP - visibleTop - VIEWPORT_PADDING;
  const side: "below" | "above" =
    spaceBelow >= PREFER_BELOW_MIN || spaceBelow >= spaceAbove ? "below" : "above";

  const maxHeight = Math.max(MIN_HEIGHT, side === "below" ? spaceBelow : spaceAbove);

  return { left, maxHeight, side, anchorTop: anchor.top, anchorBottom: anchor.bottom, visibleTop, visibleBottom };
}

// Vertical position, given the height the popover actually ended up. Opening
// above is bottom-aligned to the anchor, so it needs the real height.
function resolveTop(p: Placement, height: number): number {
  const raw =
    p.side === "below" ? p.anchorBottom + ANCHOR_GAP : p.anchorTop - ANCHOR_GAP - height;
  const lowest = p.visibleBottom - VIEWPORT_PADDING - height;
  return Math.max(p.visibleTop + VIEWPORT_PADDING, Math.min(raw, lowest));
}
