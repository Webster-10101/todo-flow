"use client";

import type { Settings } from "@/src/lib/types";
import type { PomodoroPatch } from "@/src/lib/useTodoFlow";

// The 25 + 5 rhythm, editable. Shared by the desktop header and the mobile
// day-settings panel so there's one control, not two that drift.
export function PomodoroSettings(props: {
  settings: Settings;
  onChange: (patch: PomodoroPatch) => void;
  idPrefix: string;
}) {
  const { settings, onChange, idPrefix } = props;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
      <label className="flex items-center gap-1.5" htmlFor={`${idPrefix}-focus`}>
        Focus
        <input
          id={`${idPrefix}-focus`}
          type="number"
          min={1}
          value={settings.defaultTaskMinutes}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const val = e.target.valueAsNumber;
            if (isNaN(val)) return;
            onChange({ defaultTaskMinutes: val });
          }}
          className="w-[52px] rounded-lg border border-line bg-white/80 px-2 py-1 text-sm tabular-nums text-ink outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
        />
        min
      </label>

      <label className="flex items-center gap-1.5" htmlFor={`${idPrefix}-break`}>
        Break
        <input
          id={`${idPrefix}-break`}
          type="number"
          min={0}
          value={settings.defaultBreakMinutes}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const val = e.target.valueAsNumber;
            if (isNaN(val)) return;
            onChange({ defaultBreakMinutes: val });
          }}
          disabled={!settings.autoBreak}
          className={[
            "w-[52px] rounded-lg border border-line px-2 py-1 text-sm tabular-nums outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]",
            settings.autoBreak ? "bg-white/80 text-ink" : "bg-white/30 text-muted",
          ].join(" ")}
        />
        min
      </label>

      <label
        className="flex cursor-pointer items-center gap-1.5 select-none"
        htmlFor={`${idPrefix}-autobreak`}
      >
        <input
          id={`${idPrefix}-autobreak`}
          type="checkbox"
          checked={settings.autoBreak}
          onChange={(e) => onChange({ autoBreak: e.target.checked })}
          className="h-4 w-4 rounded border-line accent-teal-600"
        />
        Auto break
      </label>
    </div>
  );
}
