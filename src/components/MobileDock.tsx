"use client";

import { useRef, useState } from "react";
import { useKeyboardInset } from "@/src/lib/useKeyboardInset";

// Fixed bottom dock for phones: quick add-task row + break/start controls,
// with the BlockActionBar slotted above when a canvas block is selected.
// Owns its own form state — the desktop sidebar form is hidden on mobile,
// so the two never coexist.
export function MobileDock(props: {
  queuedCount: number;
  actionBar: React.ReactNode;
  onAddTask: (title: string, minutes: number) => void;
  onInsertBreak: (minutes: 5 | 10) => void;
  defaultMinutes: number;
  onStartSprint: () => void;
}) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(props.defaultMinutes);
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset();
  const canAdd = title.trim().length > 0;

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    props.onAddTask(trimmed, Math.max(1, Math.round(minutes)));
    setTitle("");
  }

  return (
    <div
      ref={rootRef}
      className="md:hidden fixed inset-x-0 bottom-0 z-40 transition-transform duration-150"
      // iOS keyboard covers position:fixed bottom elements (the layout
      // viewport doesn't shrink). Lift the dock only while focus is inside it.
      style={{
        transform:
          focused && keyboardInset > 0 ? `translateY(-${keyboardInset}px)` : undefined,
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (rootRef.current?.contains(e.relatedTarget as Node)) return;
        setFocused(false);
      }}
    >
      {props.actionBar}
      <div className="border-t border-line bg-white/95 backdrop-blur px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+8px)]">
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            enterKeyHint="done"
            placeholder="What's the next tiny step?"
            aria-label="Task title"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-base outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
          />
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={minutes}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const val = e.target.valueAsNumber;
              if (isNaN(val)) return;
              setMinutes(Math.max(1, Math.round(val)));
            }}
            aria-label="Task duration in minutes"
            className="h-11 w-16 shrink-0 rounded-xl border border-line bg-white px-2 text-center text-base tabular-nums outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canAdd}
            className={[
              "h-11 shrink-0 rounded-xl px-4 text-sm transition-colors",
              canAdd
                ? "border border-line bg-ink text-paper active:bg-black"
                : "border border-line bg-white/40 text-muted cursor-not-allowed",
            ].join(" ")}
          >
            Add
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => props.onInsertBreak(5)}
            className="h-9 rounded-lg border border-line bg-white/60 px-3 text-xs text-muted active:bg-soft transition-colors"
          >
            Break +5
          </button>
          <button
            type="button"
            onClick={() => props.onInsertBreak(10)}
            className="h-9 rounded-lg border border-line bg-white/60 px-3 text-xs text-muted active:bg-soft transition-colors"
          >
            Break +10
          </button>
          <button
            type="button"
            onClick={props.onStartSprint}
            disabled={props.queuedCount === 0}
            className={[
              "ml-auto h-9 rounded-lg px-4 text-sm transition-colors",
              props.queuedCount === 0
                ? "border border-line bg-white/40 text-muted cursor-not-allowed"
                : "border border-teal-700 bg-teal-600 text-white active:bg-teal-700",
            ].join(" ")}
          >
            Start sprint
          </button>
        </div>
      </div>
    </div>
  );
}
