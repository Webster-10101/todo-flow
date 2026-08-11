"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATIONS, type Station } from "@/src/lib/stations";
import { restore, setVolume, stop, toggle, useRadio } from "@/src/lib/radio";

// A fixed window name so pressing a link-out row five times reuses one tab
// instead of stacking five. (In the Mac app, Electron's setWindowOpenHandler
// routes this out to the real browser via shell.openExternal.)
const RADIO_WINDOW = "todoflowRadio";

const PANEL_WIDTH = 296;
const PANEL_MAX_HEIGHT = 460;
const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 6;

function openExternal(url: string) {
  const w = window.open(url, RADIO_WINDOW);
  // Belt and braces against reverse-tabnabbing — rel="noopener" can't be used
  // here because it makes the browser ignore the window name.
  if (w) w.opener = null;
}

function WavesIcon(props: { size?: number }) {
  const s = props.size ?? 13;
  return (
    <svg
      width={s}
      height={s}
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

function StopIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4.5 3.2v9.6a.5.5 0 0 0 .76.43l7.5-4.8a.5.5 0 0 0 0-.86l-7.5-4.8a.5.5 0 0 0-.76.43Z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6.5 3.5H3.5v9h9v-3M9.5 2.5h4v4M13 3l-6 6" />
    </svg>
  );
}

// Three bars that only animate while a station is actually through — a still
// icon means loading or stopped, so the button reads at a glance.
function LiveBars() {
  return (
    <span className="inline-flex items-end gap-[2px] h-[11px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-current animate-[radio-bar_900ms_ease-in-out_infinite]"
          style={{
            height: 4 + i * 3,
            animationDelay: `${i * 140}ms`,
            transformOrigin: "bottom",
          }}
        />
      ))}
    </span>
  );
}

type Placement = { left: number; top: number; maxHeight: number };

function place(anchor: DOMRect): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Right-align to the anchor where there's room — these buttons live at the
  // right-hand end of their rows, so left-aligning would push the panel off.
  let left = anchor.right - PANEL_WIDTH;
  left = Math.min(left, vw - PANEL_WIDTH - VIEWPORT_PADDING);
  left = Math.max(VIEWPORT_PADDING, left);

  const roomBelow = vh - anchor.bottom - ANCHOR_GAP - VIEWPORT_PADDING;
  const roomAbove = anchor.top - ANCHOR_GAP - VIEWPORT_PADDING;

  // The focus bar sits at the bottom of the screen, so above is the common
  // case there; the sidebar button is near the top and opens downward.
  if (roomBelow >= Math.min(PANEL_MAX_HEIGHT, 260) || roomBelow >= roomAbove) {
    return {
      left,
      top: anchor.bottom + ANCHOR_GAP,
      maxHeight: Math.max(180, Math.min(PANEL_MAX_HEIGHT, roomBelow)),
    };
  }
  const maxHeight = Math.max(180, Math.min(PANEL_MAX_HEIGHT, roomAbove));
  return { left, top: anchor.top - ANCHOR_GAP - maxHeight, maxHeight };
}

function StationRow(props: { station: Station; isCurrent: boolean; loading: boolean; failed: boolean }) {
  const { station, isCurrent, loading, failed } = props;
  const linkOnly = !station.stream;

  return (
    <div
      className={[
        "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        isCurrent ? "bg-soft" : "hover:bg-soft",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => (linkOnly ? openExternal(station.homepage) : toggle(station))}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        title={
          linkOnly
            ? `Open ${station.name} in the browser`
            : isCurrent
              ? `Stop ${station.name}`
              : `Play ${station.name}`
        }
      >
        <span
          className={[
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
            isCurrent
              ? "border-transparent bg-ink text-white"
              : "border-line bg-white/70 text-muted group-hover:text-ink",
          ].join(" ")}
        >
          {linkOnly ? <ExternalIcon /> : isCurrent ? <StopIcon /> : <PlayIcon />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm text-ink">{station.name}</span>
            {isCurrent && !loading && !failed ? (
              <span className="shrink-0 text-ink">
                <LiveBars />
              </span>
            ) : null}
          </span>
          <span className="block truncate text-xs text-muted">
            {isCurrent && failed
              ? "Stream didn't load — try the site"
              : isCurrent && loading
                ? "Tuning in…"
                : station.note}
          </span>
        </span>
      </button>

      {station.stream ? (
        <button
          type="button"
          onClick={() => openExternal(station.homepage)}
          className="shrink-0 rounded-md p-1.5 text-muted opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100"
          title={`Open ${station.name}'s site`}
          aria-label={`Open ${station.name}'s site`}
        >
          <ExternalIcon />
        </button>
      ) : null}
    </div>
  );
}

function RadioPanel(props: { anchor: DOMRect; onClose: () => void }) {
  const radio = useRadio();
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement>(() => place(props.anchor));

  // The parent passes a fresh arrow each render; holding it in a ref keeps the
  // key listener from tearing down and re-binding on every one.
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  useLayoutEffect(() => setPlacement(place(props.anchor)), [props.anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    // Capture, so Escape closes the panel instead of the run view behind it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const dial = STATIONS.filter((s) => s.group === "dial");
  const more = STATIONS.filter((s) => s.group === "more");

  const rowProps = (s: Station) => ({
    station: s,
    isCurrent: radio.stationId === s.id,
    loading: radio.status === "loading",
    failed: radio.status === "error",
  });

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={props.onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label="Radio"
        className="fixed z-[61] flex flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-soft"
        style={{
          left: placement.left,
          top: placement.top,
          width: PANEL_WIDTH,
          maxHeight: placement.maxHeight,
        }}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
          <span className="text-xs uppercase tracking-wide text-muted">Radio</span>
          {radio.stationId ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-md px-2 py-0.5 text-xs text-muted hover:bg-soft hover:text-ink transition-colors"
            >
              Stop
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1">
          {dial.map((s) => (
            <StationRow key={s.id} {...rowProps(s)} />
          ))}
          {more.length ? (
            <>
              <div className="mt-2 px-2 pb-1 text-xs uppercase tracking-wide text-muted">
                Try these
              </div>
              {more.map((s) => (
                <StationRow key={s.id} {...rowProps(s)} />
              ))}
            </>
          ) : null}
        </div>

        <label className="flex items-center gap-2 border-t border-line px-3 py-2.5 text-xs text-muted">
          <span className="shrink-0">Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(radio.volume * 100)}
            onChange={(e) => setVolume(e.currentTarget.valueAsNumber / 100)}
            className="h-1 w-full cursor-pointer accent-teal-600"
            aria-label="Radio volume"
          />
        </label>
      </div>
    </>,
    document.body,
  );
}

// One press to put something on. Every instance of this button drives the same
// player (see radio.ts), so the sidebar copy and the focus-bar copy always
// agree about what's playing.
export function RadioButton(props: { compact?: boolean }) {
  const radio = useRadio();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEffect(() => restore(), []);

  // Reposition rather than leave the panel floating over the wrong spot.
  useEffect(() => {
    if (!anchor) return;
    const replace = () => {
      const el = btnRef.current;
      if (el) setAnchor(el.getBoundingClientRect());
    };
    window.addEventListener("resize", replace);
    window.addEventListener("scroll", replace, true);
    return () => {
      window.removeEventListener("resize", replace);
      window.removeEventListener("scroll", replace, true);
    };
  }, [anchor]);

  const playing = radio.station !== null;
  const label = radio.station ? radio.station.name : "Radio";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() =>
          setAnchor((a) => (a ? null : (btnRef.current?.getBoundingClientRect() ?? null)))
        }
        title={
          radio.station
            ? `${radio.station.name} — change station or stop`
            : "Radio — pick a station"
        }
        aria-label="Radio"
        aria-expanded={anchor !== null}
        className={[
          "inline-flex shrink-0 items-center gap-1.5 rounded-lg border transition-colors",
          playing
            ? "border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100"
            : "border-line bg-white/60 text-muted hover:text-ink hover:bg-soft",
          props.compact ? "h-9 px-2.5 text-xs" : "px-3 py-2 text-sm",
        ].join(" ")}
      >
        {playing && radio.status === "playing" ? <LiveBars /> : <WavesIcon />}
        <span className={props.compact ? "hidden sm:inline max-w-[110px] truncate" : "max-w-[150px] truncate"}>
          {label}
        </span>
      </button>
      {anchor ? <RadioPanel anchor={anchor} onClose={() => setAnchor(null)} /> : null}
    </>
  );
}
