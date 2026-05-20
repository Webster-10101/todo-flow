"use client";

import type { Task } from "@/src/lib/types";
import { getTaskTotalMinutes } from "@/src/lib/time";
import { useEffect, useMemo, useRef, useState } from "react";

function buildLine(title: string, mins: number, notes: string, indent: string) {
  const base = `${indent}${title} (${mins}m)`;
  // Single-line note → inline; multi-line → keep first line only inline so the paste stays one-per-task.
  const firstNoteLine = notes.split("\n", 1)[0].trim();
  return firstNoteLine ? `${base} — ${firstNoteLine}` : base;
}

function buildExportLines(tasks: Task[]): string[] {
  const lines: string[] = [];
  const topLevel = tasks.filter((t) => t.parentId === null && t.status !== "done");

  for (const t of topLevel) {
    if (t.kind === "break") continue;

    const kids = tasks.filter((c) => c.parentId === t.id && c.status !== "done");

    if (kids.length === 0) {
      lines.push(buildLine(t.title, getTaskTotalMinutes(t), t.notes ?? "", ""));
      continue;
    }

    // Parent with unfinished kids: emit parent title (no minutes — derived), notes inline if any.
    const parentNote = (t.notes ?? "").split("\n", 1)[0].trim();
    lines.push(parentNote ? `${t.title} — ${parentNote}` : t.title);
    for (const c of kids) {
      lines.push(buildLine(c.title, getTaskTotalMinutes(c), c.notes ?? "", "  "));
    }
  }

  return lines;
}

export function ExportModal(props: { open: boolean; tasks: Task[]; onClose: () => void }) {
  const { open, tasks, onClose } = props;
  const lines = useMemo(() => buildExportLines(tasks), [tasks]);
  const text = useMemo(() => lines.join("\n"), [lines]);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // Focus textarea so the user can ⌘A → ⌘C if they prefer manual copy.
    setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(
    () => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  if (!open) return null;

  const isEmpty = text.length === 0;

  async function handleCopy() {
    if (isEmpty) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select all so the user can ⌘C manually.
      textareaRef.current?.select();
    }
  }

  return (
    <div
      aria-modal="true"
      role="dialog"
      aria-label="Export unfinished tasks"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-[560px] rounded-2xl border border-line bg-white p-6 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-muted">Export unfinished tasks</div>
            <div className="mt-1 text-lg text-ink">Copy and paste into Things 3</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink hover:bg-soft transition-colors"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <textarea
          ref={textareaRef}
          readOnly
          value={isEmpty ? "Nothing to export — all tasks are done." : text}
          rows={Math.min(14, Math.max(4, text.split("\n").length + 1))}
          className="mt-4 w-full rounded-xl border border-line bg-paper/60 px-3 py-2 text-sm font-mono text-ink outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
        />

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={isEmpty}
            className={[
              "rounded-lg px-4 py-2 text-sm transition-colors",
              isEmpty
                ? "border border-line bg-white/40 text-muted cursor-not-allowed"
                : "border border-line bg-ink text-paper hover:bg-black",
            ].join(" ")}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <span className="text-xs text-muted">
            {isEmpty ? "" : `${lines.length} line${lines.length === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>
    </div>
  );
}
