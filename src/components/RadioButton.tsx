"use client";

const RADIO_URL = "https://www.freelancerad.io/";
// A fixed window name so pressing this five times reuses one tab instead of
// stacking five. (In the Mac app, Electron's setWindowOpenHandler routes this
// out to the real browser via shell.openExternal.)
const RADIO_WINDOW = "freelanceRadio";

function WavesIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M8 6.5v3M5 5v6M11 5v6M2.5 7v2M13.5 7v2" />
    </svg>
  );
}

// Freelance Radio — one press to put focus music on. Deliberately only shown
// while something is running: it's a "start focus" gesture, not furniture.
export function RadioButton(props: { compact?: boolean }) {
  function open() {
    const w = window.open(RADIO_URL, RADIO_WINDOW);
    // Belt and braces against reverse-tabnabbing — rel="noopener" can't be
    // used here because it makes the browser ignore the window name.
    if (w) w.opener = null;
  }

  return (
    <button
      type="button"
      onClick={open}
      title="Freelance Radio — focus music in a new tab"
      aria-label="Open Freelance Radio"
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white/60",
        "text-muted hover:text-ink hover:bg-soft transition-colors",
        props.compact ? "h-9 px-2.5 text-xs" : "px-3 py-2 text-sm",
      ].join(" ")}
    >
      <WavesIcon />
      <span className={props.compact ? "hidden sm:inline" : ""}>Radio</span>
    </button>
  );
}
