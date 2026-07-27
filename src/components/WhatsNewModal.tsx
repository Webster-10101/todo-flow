"use client";

import { CHANGELOG, type ChangeKind } from "@/src/lib/changelog";
import { APP_VERSION, BUILD_DATE, BUILD_SHA } from "@/src/lib/version";
import { useEffect } from "react";

const KIND_LABEL: Record<ChangeKind, string> = {
  added: "New",
  changed: "Changed",
  fixed: "Fixed",
};

const KIND_CLASS: Record<ChangeKind, string> = {
  added: "border-teal-200 bg-teal-50 text-teal-900",
  changed: "border-amber-200 bg-amber-50 text-amber-900",
  fixed: "border-line bg-soft text-ink/70",
};

export function WhatsNewModal(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      aria-modal="true"
      role="dialog"
      aria-label="What's new in TodoFlow"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-[560px] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-muted">What&rsquo;s new</div>
            <div className="mt-1 text-lg text-ink">TodoFlow v{APP_VERSION}</div>
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

        <div className="mt-5 space-y-6">
          {CHANGELOG.map((entry) => (
            <section key={entry.version}>
              <div className="flex items-baseline gap-2">
                <h3 className="text-[15px] font-medium text-ink tabular-nums">
                  v{entry.version}
                </h3>
                <span className="text-xs tabular-nums text-muted">{entry.date}</span>
              </div>
              {entry.headline ? (
                <p className="mt-0.5 text-sm text-muted">{entry.headline}</p>
              ) : null}
              <ul className="mt-3 space-y-2">
                {entry.items.map((item, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span
                      className={[
                        "mt-px shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-[1.4]",
                        KIND_CLASS[item.kind],
                      ].join(" ")}
                    >
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="text-sm leading-relaxed text-ink/85">{item.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-6 border-t border-line/60 pt-3 text-[11px] tabular-nums text-muted">
          Build {BUILD_SHA || "local"}
          {BUILD_DATE ? ` · ${BUILD_DATE}` : ""}
        </div>
      </div>
    </div>
  );
}
