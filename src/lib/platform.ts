"use client";

// Single seam between web and the Capacitor iOS shell. Web builds no-op the
// native paths; native builds get real haptics + local notifications.
// Capacitor plugin imports are safe on web — they're JS proxies until called,
// and every call here is gated behind isNative().

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
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
