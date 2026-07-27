import entries from "@/changelog.json";

export type ChangeKind = "added" | "changed" | "fixed";

export type ChangeItem = {
  kind: ChangeKind;
  text: string;
};

export type ChangelogEntry = {
  version: string;
  date: string;
  headline: string;
  items: ChangeItem[];
};

// changelog.json is the single source of truth — the app renders it and
// scripts/gen-changelog.mjs writes CHANGELOG.md from it. Newest entry first.
export const CHANGELOG = entries as ChangelogEntry[];

export const LATEST_ENTRY: ChangelogEntry | undefined = CHANGELOG[0];

// Semver compare, newest-wins. Only used to decide whether to show the
// "something new" dot, so a malformed version just means no dot.
export function isNewerVersion(a: string, b: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10));
  const [aMaj = 0, aMin = 0, aPatch = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPatch = 0] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch > bPatch;
}
