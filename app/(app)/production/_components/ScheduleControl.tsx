"use client";

import { useTransition } from "react";
import { schedulePo, unschedulePo } from "../_actions";

interface DayOption {
  iso: string; // YYYY-MM-DD
  label: string; // "Mon May 25"
}

interface Props {
  poId: string;
  currentScheduledDate: string | null;
  days: DayOption[]; // Mon-Fri of the displayed week
}

/**
 * Per-card scheduling control. Renders a dropdown of the displayed
 * week's days plus an "Unscheduled" option. Posts to the schedule /
 * unschedule server actions and lets revalidatePath redraw the page.
 */
export function ScheduleControl({ poId, currentScheduledDate, days }: Props) {
  const [pending, startTransition] = useTransition();

  const value = currentScheduledDate ?? "";

  function onChange(next: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("poId", poId);
      if (next === "") {
        await unschedulePo(fd);
      } else {
        fd.set("scheduledDate", next);
        await schedulePo(fd);
      }
    });
  }

  return (
    <label className="inline-flex items-center gap-1.5 text-[12px] text-[#5A5346]">
      <span className="font-semibold">Schedule</span>
      <select
        disabled={pending}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "border border-[#E3DFD3] rounded px-1.5 py-0.5 bg-white text-[12px] tabular-nums",
          pending ? "opacity-60 cursor-wait" : "",
        ].join(" ")}
      >
        <option value="">Unscheduled</option>
        {days.map((d) => (
          <option key={d.iso} value={d.iso}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}
