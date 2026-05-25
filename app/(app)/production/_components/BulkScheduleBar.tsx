"use client";

import { useTransition } from "react";
import { bulkSchedulePos, bulkUnschedulePos } from "../_actions";
import { useSelection } from "./SelectionProvider";
import { useCan } from "../../_components/UserPermissionsProvider";

interface DayOption {
  iso: string; // YYYY-MM-DD
  label: string; // "Mon May 25"
}

// Sticky toolbar that appears at the top of /production when at least
// one PO is selected. Pick a day → all selected POs are scheduled to
// that day in one server round-trip. revalidatePath wipes the page
// (and the selection) on completion.
export function BulkScheduleBar({ days }: { days: DayOption[] }) {
  const { selected, clear } = useSelection();
  const [pending, startTransition] = useTransition();
  const canBulkSchedule = useCan("production.bulk_schedule");

  if (selected.size === 0 || !canBulkSchedule) return null;

  const poIds = Array.from(selected);

  function assign(iso: string) {
    startTransition(async () => {
      const fd = new FormData();
      for (const id of poIds) fd.append("poIds", id);
      if (iso === "") {
        await bulkUnschedulePos(fd);
      } else {
        fd.set("scheduledDate", iso);
        await bulkSchedulePos(fd);
      }
      // revalidatePath in the action will refresh data; selection is
      // local state and gets dropped when the page rerenders, but
      // clear() explicitly in case Next doesn't fully remount.
      clear();
    });
  }

  return (
    <div className="sticky top-0 z-30 bg-cg-teal text-white shadow-md">
      <div className="flex flex-wrap items-center gap-3 px-8 py-2.5 text-[13px]">
        <span className="font-semibold">
          {selected.size} PO{selected.size === 1 ? "" : "s"} selected
        </span>
        <span className="opacity-80">Schedule to:</span>
        <select
          disabled={pending}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) assign(v);
            e.target.value = "";
          }}
          className={[
            "border border-white/40 rounded px-1.5 py-0.5 bg-transparent text-white text-[12.5px] tabular-nums",
            "[&_option]:text-[#1C2B27]",
            pending ? "opacity-60 cursor-wait" : "",
          ].join(" ")}
        >
          <option value="">Pick a day…</option>
          {days.map((d) => (
            <option key={d.iso} value={d.iso}>
              {d.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => assign("")}
          disabled={pending}
          className="text-[12.5px] underline opacity-90 hover:opacity-100"
          title="Move selected POs back to Unscheduled"
        >
          Unschedule
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={pending}
          className="ml-auto text-[12.5px] underline opacity-90 hover:opacity-100"
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}
