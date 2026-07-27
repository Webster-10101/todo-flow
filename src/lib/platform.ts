"use client";

// Single seam between web and the Capacitor iOS shell. Web builds no-op the
// native paths; native builds get real haptics + local notifications.
// Capacitor plugin imports are safe on web — they're JS proxies until called,
// and every call here is gated behind isNative().

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// ---------------------------------------------------------------------------
// Native storage mirror.
//
// WKWebView can evict localStorage under storage pressure — on iOS that means
// silently losing the user's tasks. Preferences is backed by UserDefaults and
// isn't evictable, so every save is mirrored there and used as the fallback
// when localStorage comes back empty on launch. Raw strings only: parsing and
// validation stay in storage.ts.
// ---------------------------------------------------------------------------

const MIRROR_KEY = "todoflow_state_v2";

export async function writeMirroredState(json: string): Promise<void> {
  if (!isNative()) return;
  try {
    await Preferences.set({ key: MIRROR_KEY, value: json });
  } catch {
    // mirroring is a safety net, never a hard dependency
  }
}

export async function readMirroredState(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { value } = await Preferences.get({ key: MIRROR_KEY });
    return value ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Desktop (Electron) seam. The preload script sets window.todoflow; on web and
// iOS it's simply absent and every call below is a no-op.
// ---------------------------------------------------------------------------

export type TrayTimerState = {
  running: boolean;
  title: string;
  endMs: number | null;
  paused: boolean;
  remainingMs: number | null;
  nextTitle: string | null;
  canStart: boolean;
};

export type DaySnapshotBlock = {
  title: string;
  kind: "task" | "break";
  startMinutes: number | null;
  minutes: number;
  status: "queued" | "active" | "done";
  // Best available completion time: the last-modified stamp of a done task.
  doneAtMs: number | null;
};

export type DaySnapshot = {
  date: string;
  updatedAt: string;
  focusedMinutes: number;
  blocks: DaySnapshotBlock[];
};

type DesktopBridge = {
  isDesktop: true;
  publishTimer: (state: TrayTimerState) => void;
  publishDaySnapshot: (snapshot: DaySnapshot) => void;
  onCommand: (handler: (command: string) => void) => () => void;
};

function bridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { todoflow?: DesktopBridge }).todoflow ?? null;
}

export function isDesktop(): boolean {
  return bridge() !== null;
}

export function publishTimerState(state: TrayTimerState): void {
  try {
    bridge()?.publishTimer(state);
  } catch {
    // the menu bar is a nicety — never let it break the app
  }
}

export function publishDaySnapshot(snapshot: DaySnapshot): void {
  try {
    bridge()?.publishDaySnapshot(snapshot);
  } catch {
    // the World HQ feed is best-effort; the app never depends on it
  }
}

export function onDesktopCommand<T extends string>(
  handler: (command: T) => void,
): (() => void) | undefined {
  const b = bridge();
  if (!b) return undefined;
  return b.onCommand((command) => handler(command as T));
}

export type HapticKind = "light" | "medium" | "success" | "warning";

export async function haptic(kind: HapticKind = "light"): Promise<void> {
  if (!isNative()) return;
  try {
    if (kind === "success") {
      await Haptics.notification({ type: NotificationType.Success });
    } else if (kind === "warning") {
      await Haptics.notification({ type: NotificationType.Warning });
    } else {
      await Haptics.impact({
        style: kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light,
      });
    }
  } catch {
    // never let feedback break the app
  }
}

// One well-known id — there is only ever one active-task timer.
const TIMER_NOTIFICATION_ID = 1001;

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (isNative()) {
      const status = await LocalNotifications.checkPermissions();
      if (status.display === "granted") return true;
      if (status.display === "denied") return false;
      const req = await LocalNotifications.requestPermissions();
      return req.display === "granted";
    }
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

// Native: schedule the time's-up notification for the active task at its
// expected end. Fires even when the app is backgrounded — unlike the old
// in-page `new Notification()` check, which iOS never supported. Re-invoke
// on extend/reduce/pause; the fixed id replaces the previous schedule.
export async function scheduleTimerNotification(args: {
  taskTitle: string;
  atMs: number;
}): Promise<void> {
  if (!isNative()) return;
  try {
    await cancelTimerNotification();
    if (args.atMs <= Date.now()) return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: TIMER_NOTIFICATION_ID,
          title: "TodoFlow — time's up",
          body: args.taskTitle || "Task time is up",
          schedule: { at: new Date(args.atMs) },
        },
      ],
    });
  } catch {
    // scheduling is best-effort
  }
}

export async function cancelTimerNotification(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: TIMER_NOTIFICATION_ID }],
    });
  } catch {
    // nothing to cancel
  }
}
