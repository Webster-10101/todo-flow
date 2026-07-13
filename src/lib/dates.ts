// Local-calendar day helpers. Tasks are keyed to the user's wall-clock day,
// so these deliberately use local time, not UTC.

export function todayLocalISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ISO YYYY-MM-DD strings compare correctly as plain strings.
export function isBeforeToday(dateISO: string, now: Date = new Date()): boolean {
  return dateISO < todayLocalISO(now);
}
