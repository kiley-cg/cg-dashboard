"use client";

import { useState } from "react";
import type { MirroredPo } from "@/lib/db/production-po";
import type { TrackingEntry } from "@/lib/db/receiving";
import { TrackingForm } from "./TrackingForm";
import { DeleteTrackingButton } from "./DeleteTrackingButton";

interface Props {
  siblings: MirroredPo[];
  trackingCountBySibling: Record<string, number>;
  trackingBySibling: Record<string, TrackingEntry[]>;
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
  trackingBySibling,
  inboundTrackingCount,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  // Per-sibling "show tracking #s" expansion state. Keyed by poId.
  const [trackingOpenByPoId, setTrackingOpenByPoId] = useState<
    Record<string, boolean>
  >({});

  const total = siblings.length;
  if (total === 0) return null;

  // A PO is "still arriving" if Syncore says Open/Approved AND we don't
  // have evidence everything shipped to us has been delivered. The
  // Syncore status alone isn't enough — the floor often receives apparel
  // weeks before anyone manually posts the PO in Syncore. If we have
  // tracking and every entry shows delivered, treat the PO as here.
  const isFullyDelivered = (poId: string): boolean => {
    const entries = trackingBySibling[poId] ?? [];
    if (entries.length === 0) return false;
    return entries.every((t) =>
      (t.status ?? "").toLowerCase().includes("delivered"),
    );
  };

  const syncoreOpen = siblings.filter(
    (s) => s.status === "Open" || s.status === "Approved",
  );
  // Effective "still arriving" set: Syncore-open AND not fully delivered.
  const stillArriving = syncoreOpen.filter((s) => !isFullyDelivered(s.poId));
  const open = stillArriving.length;
  const allClosed = open === 0;

  // "Last arrival" — when's the LAST package expected to land. Only
  // consider POs still actually arriving; ignore ones already delivered.
  // Prefer each PO's latest tracking ETA, fall back to the vendor's
  // promised in-hand date for POs with no tracking yet.
  const lastArrival = (() => {
    let max: string | null = null;
    for (const s of stillArriving) {
      const etas = (trackingBySibling[s.poId] ?? [])
        .map((t) => t.eta)
        .filter((d): d is string => !!d);
      const candidate = etas.length > 0 ? etas.sort().slice(-1)[0] : s.inHandDate;
      if (candidate && (!max || candidate > max)) max = candidate;
    }
    return max;
  })();

  return (
    <div className="mt-2 text-[12px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-2 hover:underline w-full text-left"
        aria-expanded={expanded}
      >
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ background: allClosed ? "#3A8C5F" : "#E0A800" }}
        />
        <span
          className="font-semibold uppercase tracking-wider text-[10.5px]"
          style={{ color: allClosed ? "#3A8C5F" : "#8A5A2B" }}
        >
          Apparel
        </span>
        {allClosed ? (
          <span style={{ color: "#3A8C5F" }} className="font-semibold">
            all {total} delivered
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span style={{ color: "#8A5A2B" }} className="font-semibold tabular-nums">
              {total - open}/{total} in
            </span>
            {lastArrival && (
              <span className="text-[#5A5346]">
                <span className="text-[#8B8579]">arrives</span>{" "}
                <span className="font-semibold text-[#3F3A30] tabular-nums">
                  {lastArrival.slice(5)}
                </span>
              </span>
            )}
            {inboundTrackingCount > 0 && (
              <span className="text-[#5A5346] tabular-nums">
                {inboundTrackingCount} tracking
              </span>
            )}
          </span>
        )}
        <span className="text-[10px] text-[#9B9588] ml-auto shrink-0" aria-hidden>
          {expanded ? "▴" : "▾"}
        </span>
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-[#E3DFD3] pl-2.5">
          {siblings.map((s) => {
            const count = trackingCountBySibling[s.poId] ?? 0;
            const entries = trackingBySibling[s.poId] ?? [];
            const trackingOpen = trackingOpenByPoId[s.poId] ?? false;
            // Latest known ETA across this PO's tracking entries — the
            // "this PO is ready" date that contributes to the job-level
            // readyBy at the top of the panel.
            let siblingReadyBy: string | null = null;
            for (const t of entries) {
              if (t.eta && (!siblingReadyBy || t.eta > siblingReadyBy)) {
                siblingReadyBy = t.eta;
              }
            }
            return (
              <li key={s.poId} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
                    {siblingReadyBy && (
                      <span
                        className="text-[#3B6FB0]"
                        title="Latest known UPS delivery date across this PO's tracking #s"
                      >
                        ready {siblingReadyBy.slice(5)}
                      </span>
                    )}
                    {count > 0 ? (
                      // Clickable when there are entries to show.
                      <button
                        type="button"
                        onClick={() =>
                          setTrackingOpenByPoId((prev) => ({
                            ...prev,
                            [s.poId]: !trackingOpen,
                          }))
                        }
                        className="rounded px-1.5 py-px font-semibold bg-[#EAF0F8] text-[#3B6FB0] hover:bg-[#DBE6F4] inline-flex items-center gap-1"
                        aria-expanded={trackingOpen}
                        title={
                          trackingOpen ? "Hide tracking #s" : "Show tracking #s"
                        }
                      >
                        {count} tracking
                        <span className="text-[9px]" aria-hidden>
                          {trackingOpen ? "▴" : "▾"}
                        </span>
                      </button>
                    ) : (
                      <span className="rounded px-1.5 py-px font-semibold bg-[#F0EEE6] text-[#6B6356]">
                        0 tracking
                      </span>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <TrackingForm poId={s.poId} />
                  </div>
                </div>
                {trackingOpen && entries.length > 0 && (
                  <ul className="ml-[180px] space-y-0.5 text-[11.5px] text-[#3C342B]">
                    {entries.map((t) => {
                      const delivered = (t.status ?? "")
                        .toLowerCase()
                        .includes("delivered");
                      return (
                        <li
                          key={t.id}
                          className="flex items-center gap-2 font-mono"
                        >
                          <span className="text-[#6B6356] w-9 shrink-0 not-italic font-sans text-[11px] uppercase tracking-wider">
                            {t.carrier}
                          </span>
                          <span className="select-all">{t.trackingNumber}</span>
                          {t.source === "api" && (
                            <span
                              className="text-[9px] uppercase tracking-wider text-[#3B6FB0] font-sans"
                              title="Auto-populated from vendor API"
                            >
                              api
                            </span>
                          )}
                          {t.eta && (
                            <span
                              className="text-[10.5px] font-sans text-[#6B6356]"
                              title={
                                delivered
                                  ? "Actual delivery date"
                                  : "Scheduled delivery (UPS)"
                              }
                            >
                              {delivered ? "delivered " : "ETA "}
                              {t.eta.slice(5)}
                            </span>
                          )}
                          {t.status && (
                            <span
                              className={[
                                "text-[10px] font-sans uppercase tracking-wider rounded px-1 py-px",
                                delivered
                                  ? "bg-[#E5F2E5] text-[#3A8C5F]"
                                  : "bg-[#F0EEE6] text-[#6B6356]",
                              ].join(" ")}
                              title={t.status}
                            >
                              {abbrevStatus(t.status)}
                            </span>
                          )}
                          <DeleteTrackingButton trackingId={t.id} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Shorten UPS status strings to a chip-sized abbreviation. Full text
// is on the title= attribute for the curious. "Delivered" / "In Transit"
// / "Out for Delivery" cover ~95% of in-the-wild values; anything else
// falls through to the first 12 chars.
function abbrevStatus(s: string): string {
  const lower = s.toLowerCase();
  if (lower.includes("delivered")) return "delivered";
  if (lower.includes("out for delivery")) return "OFD";
  if (lower.includes("in transit") || lower === "i") return "in transit";
  if (lower.includes("origin scan") || lower.includes("label")) return "label";
  if (lower.includes("exception") || lower.includes("delay")) return "exception";
  return s.length > 12 ? s.slice(0, 12) + "…" : s;
}

