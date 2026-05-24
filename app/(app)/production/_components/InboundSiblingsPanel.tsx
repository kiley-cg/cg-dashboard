"use client";

import { useState, useTransition } from "react";
import type { MirroredPo } from "@/lib/db/production-po";
import { TrackingForm } from "./TrackingForm";
import { pushTrackingToJobLogAction } from "../_actions";

interface Props {
  siblings: MirroredPo[];
  trackingCountBySibling: Record<string, number>;
  inboundTrackingCount: number;
}

// Collapsed: same single-line summary the tile used to show
// ("X/Y apparel POs still open · earliest in-hand MM-DD · N tracking").
// Expanded: a row per sibling with the existing TrackingForm so the floor
// can paste a tracking # without leaving /production. Same TrackingForm
// the Inbound tab uses, same server action — this is just a faster way
// in to the same write path.
export function InboundSiblingsPanel({
  siblings,
  trackingCountBySibling,
  inboundTrackingCount,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const total = siblings.length;
  if (total === 0) return null;

  const open = siblings.filter(
    (s) => s.status === "Open" || s.status === "Approved",
  ).length;
  const earliest = siblings
    .map((s) => s.inHandDate)
    .filter((d): d is string => !!d)
    .sort()[0];

  const allClosed = open === 0;
  const trackingSuffix =
    inboundTrackingCount > 0 ? ` · ${inboundTrackingCount} tracking` : "";

  return (
    <div className="mt-2 text-[12px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 font-semibold hover:underline"
        style={{ color: allClosed ? "#3A8C5F" : "#8A5A2B" }}
        aria-expanded={expanded}
      >
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: allClosed ? "#3A8C5F" : "#E0A800" }}
        />
        {allClosed
          ? `Apparel all closed (${total} PO${total === 1 ? "" : "s"})`
          : `${open}/${total} apparel PO${total === 1 ? "" : "s"} still open`}
        {!allClosed && earliest ? ` · earliest in-hand ${earliest.slice(5)}` : ""}
        {trackingSuffix}
        <span className="text-[10px] text-[#9B9588] ml-1" aria-hidden>
          {expanded ? "▴" : "▾"}
        </span>
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-[#E3DFD3] pl-2.5">
          {siblings.map((s) => {
            const count = trackingCountBySibling[s.poId] ?? 0;
            return (
              <li
                key={s.poId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
              >
                <div className="flex items-baseline gap-1.5 min-w-[180px]">
                  <span className="font-semibold text-[#1C2B27]">
                    PO {s.poNumber ?? s.poId}
                  </span>
                  {s.supplierName && (
                    <span
                      className="text-[#6B6356] truncate"
                      title={s.supplierName}
                    >
                      {s.supplierName}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11.5px] text-[#6B6356]">
                  {s.inHandDate && <span>in-hand {s.inHandDate.slice(5)}</span>}
                  <span
                    className={[
                      "rounded px-1.5 py-px font-semibold",
                      count > 0
                        ? "bg-[#EAF0F8] text-[#3B6FB0]"
                        : "bg-[#F0EEE6] text-[#6B6356]",
                    ].join(" ")}
                  >
                    {count} tracking
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {count > 0 && <PushButton poId={s.poId} />}
                  <TrackingForm poId={s.poId} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Send the PO's tracking numbers to Syncore as a Job Log entry — the
// closest thing to the team's actual workflow ("everyone sees it on the
// job log"). Only enabled when at least one tracking number exists on
// this PO. Disabled while in flight, alerts on failure.
function PushButton({ poId }: { poId: string }) {
  const [pending, start] = useTransition();
  function onClick() {
    start(async () => {
      const fd = new FormData();
      fd.set("poId", poId);
      const result = await pushTrackingToJobLogAction(fd);
      if (result.ok) {
        // No toast system here yet — short native alert keeps the
        // success unmissable on the floor.
        alert("Sent to Syncore Job Log ✓");
      } else {
        alert(`Couldn't send to Syncore Job Log.\n\n${result.error}`);
      }
    });
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={[
        "text-[11px] border border-cg-teal text-cg-teal font-semibold rounded px-2 py-0.5 hover:bg-cg-teal hover:text-white transition",
        pending ? "opacity-60 cursor-wait" : "",
      ].join(" ")}
      title="Append this PO's tracking #s to the Syncore Job Log"
    >
      {pending ? "Sending…" : "→ Job Log"}
    </button>
  );
}
