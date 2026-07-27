#!/usr/bin/env node
// Writes CHANGELOG.md from changelog.json so the repo and the in-app "What's
// new" can never disagree — the JSON is the source of truth, the markdown is
// generated. Runs as part of `npm run build` (prebuild).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entries = JSON.parse(readFileSync(join(root, "changelog.json"), "utf8"));

const KIND_LABEL = { added: "Added", changed: "Changed", fixed: "Fixed" };
const KIND_ORDER = ["added", "changed", "fixed"];

const lines = [
  "# Changelog",
  "",
  "Generated from `changelog.json` — edit that, not this file.",
  "",
];

for (const entry of entries) {
  lines.push(`## ${entry.version} — ${entry.date}`, "");
  if (entry.headline) lines.push(`_${entry.headline}_`, "");

  for (const kind of KIND_ORDER) {
    const items = entry.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    lines.push(`### ${KIND_LABEL[kind]}`, "");
    for (const item of items) lines.push(`- ${item.text}`);
    lines.push("");
  }
}

writeFileSync(join(root, "CHANGELOG.md"), lines.join("\n"));
console.log(`CHANGELOG.md written (${entries.length} entries)`);
