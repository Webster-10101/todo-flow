import { pad2 } from "./time";

// Build a Google Calendar "create event" deep link from a scheduled block.
// One-way and manual: clicking opens Google's event-creation page pre-filled
// with the block's title, time window, and notes. Editing the block later does
// NOT update the event — that's the trade-off until real API sync (Slice C).
//
// Times are sent in local wall-clock form (YYYYMMDDTHHMMSS) alongside `ctz`
// (the IANA timezone), so Google interprets them in the right zone regardless
// of where the calendar's default is set.

function formatLocal(d: Date): string {
  return (
    d.getFullYear().toString() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    "T" +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

function resolveTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function googleCalendarUrl(args: {
  title: string;
  notes?: string;
  startMs: number;
  endMs: number;
}): string {
  const start = new Date(args.startMs);
  const end = new Date(args.endMs);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: args.title.trim() || "Task",
    dates: `${formatLocal(start)}/${formatLocal(end)}`,
  });
  if (args.notes && args.notes.trim()) {
    params.set("details", args.notes.trim());
  }
  const tz = resolveTimeZone();
  if (tz) params.set("ctz", tz);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
