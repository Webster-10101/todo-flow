"use client";

export function Toast(props: { message: string; visible: boolean }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={[
        "pointer-events-none fixed left-6 bottom-6 z-50",
        "transition-opacity duration-200",
        props.visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div
        className={[
          "pointer-events-auto rounded-xl border border-line bg-white/80",
          "backdrop-blur px-4 py-3 text-sm text-ink shadow-soft",
        ].join(" ")}
      >
        {props.message}
      </div>
    </div>
  );
}


