"use client";

export function Toast(props: {
  message: string;
  visible: boolean;
  actionLabel?: string;
  onAction?: () => void;
  // Stacks toasts vertically — 0 = bottom-most.
  stackIndex?: number;
}) {
  const idx = props.stackIndex ?? 0;
  // Each stack slot is ~64px tall (toast + spacing).
  const bottomPx = 24 + idx * 64;
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{ bottom: `${bottomPx}px` }}
      className={[
        "pointer-events-none fixed left-6 z-50",
        "transition-opacity duration-200",
        props.visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div
        className={[
          "pointer-events-auto rounded-xl border border-line bg-white/80",
          "backdrop-blur px-4 py-3 text-sm text-ink shadow-soft",
          "flex items-center gap-3",
        ].join(" ")}
      >
        <span>{props.message}</span>
        {props.actionLabel && props.onAction ? (
          <button
            type="button"
            onClick={props.onAction}
            className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs text-ink hover:bg-soft transition-colors"
          >
            {props.actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}


