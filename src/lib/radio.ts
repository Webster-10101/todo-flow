"use client";

import { useSyncExternalStore } from "react";
import { findStation, type Station } from "./stations";

// One player for the whole app.
//
// The radio button is rendered in several places at once (desktop sidebar,
// mobile utility row, focus bar, run view) and the desktop/mobile twins are
// both mounted — only one is visible. If each of those owned an <audio> we'd
// get overlapping streams and buttons that disagree about what's playing. So
// the element, the hls.js instance and the state all live here at module
// scope, and every button subscribes to the same store.

export type RadioStatus = "idle" | "loading" | "playing" | "error";

export type RadioState = {
  stationId: string | null;
  status: RadioStatus;
  volume: number;
};

const STORE_KEY = "todoflow:radio";
const DEFAULT_VOLUME = 0.7;

let state: RadioState = { stationId: null, status: "idle", volume: DEFAULT_VOLUME };
const listeners = new Set<() => void>();

// Referentially stable server snapshot — useSyncExternalStore re-invokes
// getServerSnapshot during hydration and throws if the identity changes.
const SERVER_STATE: RadioState = { stationId: null, status: "idle", volume: DEFAULT_VOLUME };

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<RadioState>) {
  state = { ...state, ...patch };
  emit();
}

// ---------------------------------------------------------------------------
// The element
// ---------------------------------------------------------------------------

let audio: HTMLAudioElement | null = null;
// hls.js, only ever loaded if an .m3u8 station is picked on a browser without
// native HLS. Typed loosely so the app doesn't pull hls.js types into the
// non-radio build graph.
let hls: { destroy: () => void } | null = null;
// Guards against a slow station resolving after you've already moved on.
let loadToken = 0;

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  const el = new Audio();
  el.preload = "none";
  el.volume = state.volume;
  el.addEventListener("playing", () => setState({ status: "playing" }));
  el.addEventListener("waiting", () => {
    if (state.status === "playing") setState({ status: "loading" });
  });
  el.addEventListener("error", () => {
    // A stop clears src, which fires error — that's us, not the station.
    if (state.stationId) setState({ status: "error" });
  });
  audio = el;
  return el;
}

function teardown() {
  loadToken += 1;
  if (hls) {
    try {
      hls.destroy();
    } catch {
      // a dead instance is still a stopped instance
    }
    hls = null;
  }
  if (audio) {
    audio.pause();
    // Live streams keep pulling bytes while paused — only dropping the source
    // and reloading actually closes the connection.
    audio.removeAttribute("src");
    try {
      audio.load();
    } catch {
      // Safari can throw here mid-teardown; nothing left to clean up
    }
  }
}

function nativeHls(el: HTMLAudioElement): boolean {
  return el.canPlayType("application/vnd.apple.mpegurl") !== "";
}

async function attach(station: Station, el: HTMLAudioElement, token: number) {
  const stream = station.stream;
  if (!stream) return;

  if (stream.kind === "hls" && !nativeHls(el)) {
    const mod = await import("hls.js");
    const Hls = mod.default;
    if (token !== loadToken) return;
    if (!Hls.isSupported()) {
      setState({ status: "error" });
      return;
    }
    const instance = new Hls({ enableWorker: true });
    hls = instance;
    instance.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal && token === loadToken) setState({ status: "error" });
    });
    instance.loadSource(stream.url);
    instance.attachMedia(el);
  } else {
    el.src = stream.url;
  }

  try {
    await el.play();
  } catch {
    if (token === loadToken) setState({ status: "error" });
  }
}

// ---------------------------------------------------------------------------
// Media Session — so the macOS media keys and the lock screen say which
// station is on rather than "TodoFlow". Best-effort; absent in some webviews.
// ---------------------------------------------------------------------------

function publishMediaSession(station: Station | null) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    const ms = navigator.mediaSession;
    ms.metadata = station
      ? new MediaMetadata({ title: station.name, artist: station.note, album: "TodoFlow Radio" })
      : null;
    ms.playbackState = station ? "playing" : "none";
    ms.setActionHandler("pause", station ? () => stop() : null);
    ms.setActionHandler("stop", station ? () => stop() : null);
  } catch {
    // decoration only
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function play(station: Station) {
  if (!station.stream) return;
  teardown();
  const token = ++loadToken;
  const el = ensureAudio();
  el.volume = state.volume;
  setState({ stationId: station.id, status: "loading" });
  persist();
  publishMediaSession(station);
  void attach(station, el, token);
}

export function stop() {
  teardown();
  setState({ stationId: null, status: "idle" });
  publishMediaSession(null);
  persist();
}

/** Play if it isn't the current station, stop if it is. The button's whole job. */
export function toggle(station: Station) {
  if (state.stationId === station.id) stop();
  else play(station);
}

export function setVolume(v: number) {
  const volume = Math.min(1, Math.max(0, v));
  if (audio) audio.volume = volume;
  setState({ volume });
  persist();
}

// Volume only. The station is deliberately not remembered across launches —
// restoring it would either do nothing visible or start making noise when you
// open a work app, and neither is worth the code.
function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ volume: state.volume }));
  } catch {
    // volume memory is a nicety, never a hard dependency
  }
}

let restored = false;

/** Restore the saved volume. Safe to call from any button's mount effect. */
export function restore() {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { volume?: unknown };
    if (typeof parsed.volume === "number" && parsed.volume >= 0 && parsed.volume <= 1) {
      setState({ volume: parsed.volume });
    }
  } catch {
    // corrupt blob — defaults are fine
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRadio(): RadioState & { station: Station | null } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
  return { ...snapshot, station: findStation(snapshot.stationId) };
}
