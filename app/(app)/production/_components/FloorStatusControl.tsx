"use client";

import { useTransition } from "react";
import { closeSyncorePo, setFloorStatus } from "../_actions";
import { useCan } from "../../_components/UserPermissionsProvider";

const STATUSES = ["stopped", "in_progress", "done"] as const;
type Status = (typeof STATUSES)[number];

// "stopped" is the un-started state. Display label depends on whether a
// schedule day has been picked — that's how we get four user-visible
// statuses (Pending / Scheduled / In Progress / Completed) out of three
// underlying enum values. Keeps the existing data model untouched.
function labelFor(status: Status, scheduled: boolean): string {
  if (status === "in_progress") return "In Progress";
  if (status === "done") return "Completed";
  return scheduled ? "Scheduled" : "Pending";
}

const DOT_COLOR: Record<Status, string> = {
  stopped: "#D64545",
  in_progress: "#3A8C5F",
  done: "#1C2B27",
};

// When the PO has a schedule day picked, Pending becomes Scheduled —
// give it a distinct amber dot so the visual transition is obvious
// when Kristen drops it on a day. "stopped + scheduled" = Scheduled.
const SCHEDULED_DOT = "#E0A800";
function dotFor(status: Status, scheduled: boolean): string {
  if (status === "stopped" && scheduled) return SCHEDULED_DOT;
  return DOT_COLOR[status];
}

interface Props {
  poId: string;
  status: Status;
  scheduled: boolean;
  syncoreClosedAt: Date | string | null;
}

export function FloorStatusControl({
  poId,
  status,
  scheduled,
  syncoreClosedAt,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [closing, startClosing] = useTransition();

  function onChange(next: Status) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("poId", poId);
      fd.set("status", next);
      await setFloorStatus(fd);
    });
  }

  function onClose() {
    startClosing(async () => {
      const fd = new FormData();
      fd.set("poId", poId);
      try {
        const result = await closeSyncorePo(fd);
        if (!result.ok) {
          alert(`Couldn't close PO in Syncore.\n\n${result.error}`);
        }
      } catch (err) {
        // Fallback for thrown exceptions (network, etc). Production builds
        // scrub these messages — useful errors come back via result.error.
        // eslint-disable-next-line no-console
        console.error("[closeSyncorePo] failed:", err);
        alert(
          `Couldn't close PO in Syncore.\n\n${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
  }

  const canClose = useCan("production.close_syncore_po");
  const showCloseButton = canClose && status === "done" && !syncoreClosedAt;
  const closedBadge = status === "done" && syncoreClosedAt;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#5A5346]">
      <label className="inline-flex items-center gap-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ background: dotFor(status, scheduled) }}
        />
        <span className="font-semibold">Status</span>
        <select
          disabled={pending}
          value={status}
          onChange={(e) => onChange(e.target.value as Status)}
          className={[
            "border border-[#E3DFD3] rounded px-1.5 py-0.5 bg-white text-[12px]",
            pending ? "opacity-60 cursor-wait" : "",
          ].join(" ")}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {labelFor(s, scheduled)}
            </option>
          ))}
        </select>
      </label>

      {showCloseButton && (
        <button
          type="button"
          onClick={onClose}
          disabled={closing}
          className={[
            "border border-cg-teal text-cg-teal font-semibold rounded px-2 py-0.5 text-[11px] hover:bg-cg-teal hover:text-white transition",
            closing ? "opacity-60 cursor-wait" : "",
          ].join(" ")}
          title="PATCH this PO to 'Posted Manually' in Syncore"
        >
          {closing ? "Closing…" : "Close in Syncore"}
        </button>
      )}

      {closedBadge && (
        <span
          className="inline-flex items-center gap-1 text-[11px] text-[#3A8C5F] font-semibold"
          title="Syncore PO is Posted Manually"
        >
          ✓ Closed in Syncore
        </span>
      )}
    </div>
  );
}
