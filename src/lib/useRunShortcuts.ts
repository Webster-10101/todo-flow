"use client";

import { useEffect } from "react";

// Run-mode keyboard shortcuts. Lifted out of RunView alongside the timer so
// they work whether you're looking at the canvas or the zoomed focus view.
//
// One deliberate change from the old RunView bindings: Escape no longer ends
// the sprint. The canvas is now the normal place to be while running, and
// Escape is a cancel key there (title edits, popovers) — ending the day on it
// would be a nasty misfire. Escape leaves the zoomed view; stopping is a
// button press.
export function useRunShortcuts(args: {
  enabled: boolean;
  hasActive: boolean;
  onTogglePause: () => void;
  onEscape: () => void;
  onDone: () => void;
  onExtend: (minutes: 5 | 10) => void;
  onReduce: (minutes: 5 | 10) => void;
  onInsertBreak: (minutes: 5 | 10) => void;
}) {
  const {
    enabled,
    hasActive,
    onTogglePause,
    onEscape,
    onDone,
    onExtend,
    onReduce,
    onInsertBreak,
  } = args;

  useEffect(() => {
    if (!enabled) return;

    function isTypingTarget(t: EventTarget | null): boolean {
      if (!t || !(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const k = e.key.toLowerCase();
      if (e.key === " " || k === "spacebar") {
        e.preventDefault();
        onTogglePause();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
        return;
      }
      if (!hasActive) return;
      if (k === "d") {
        e.preventDefault();
        onDone();
      } else if (k === "e") {
        e.preventDefault();
        onExtend(5);
      } else if (k === "r") {
        e.preventDefault();
        onReduce(5);
      } else if (k === "b") {
        e.preventDefault();
        onInsertBreak(5);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, hasActive, onTogglePause, onEscape, onDone, onExtend, onReduce, onInsertBreak]);
}
