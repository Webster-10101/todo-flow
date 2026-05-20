let uidCounter = 0;

export function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  uidCounter = (uidCounter + 1) % 10000;
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 11);
  return `${timestamp}-${uidCounter}-${random}`;
}

export function clampMinutes(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.round(n));
}
