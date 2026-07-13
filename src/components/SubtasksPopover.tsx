"use client";

import type { Task } from "@/src/lib/types";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TaskRow } from "./TaskRow";

const POPOVER_WIDTH = 320;
const VIEWPORT_PADDING = 8;

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
  const [pos, setPos] = useState<{ top: number; left: number }>(() =>
    placeBelow(props.anchor),
  );

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    setPos(placeBelow(props.anchor));
  }, [props.anchor]);

  // Re-place when the visual viewport changes — on iOS the keyboard shrinks
  // visualViewport (not window.innerHeight), which would otherwise leave the
  // popover hidden behind the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => setPos(placeBelow(props.anchor));
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
    };
  }, [props.anchor]);

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

  const node = (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Subtasks for ${props.parent.title || "Untitled task"}`}
      className="fixed z-50 rounded-xl border border-line bg-white shadow-lg p-3 space-y-2"
      style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
    >
      <div className="flex items-center justify-between gap-2">
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
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
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
        className="text-xs text-muted hover:text-ink transition-colors"
      >
        + Add subtask
      </button>
    </div>
  );

  return createPortal(node, document.body);
}

function placeBelow(anchor: DOMRect): { top: number; left: number } {
  if (typeof window === "undefined") return { top: 0, left: 0 };
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
  let top = anchor.bottom + 6;
  // If not enough space below, flip above the anchor.
  const approxHeight = 240;
  if (
    top + approxHeight > visibleBottom &&
    anchor.top - approxHeight - 6 > visibleTop + VIEWPORT_PADDING
  ) {
    top = anchor.top - approxHeight - 6;
  }
  // Last resort: clamp into the visible area (keyboard open, anchor low).
  top = Math.max(visibleTop + VIEWPORT_PADDING, Math.min(top, visibleBottom - approxHeight));
  return { top, left };
}
