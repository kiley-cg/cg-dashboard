// One card per decoration PO (v2 model). Replaces the v1 JobCard which
// rolled multiple POs from the same job into one card. Phase 1: read-only,
// no scheduling/floor-status toggles yet.

import type {
  MirroredPo,
  PoScheduleState,
} from "@/lib/db/production-po";
import type { Department } from "@/lib/syncore/production";

const DEPT_CHIP: Record<Department, { label: string; color: string }> = {
  embroidery: { label: "EMB", color: "#0F6E56" },
  transfers: { label: "TRN", color: "#8A5A2B" },
  fulfillment: { label: "FUL", color: "#3B6FB0" },
  other: { label: "OTH", color: "#6B6356" },
};

interface RawShipTo {
  business_name?: string | null;
}
interface RawShape {
  ship_to?: RawShipTo | null;
  csr_instructions_from_so?: string | null;
}

function shipToBusinessName(po: MirroredPo): string | null {
  const raw = po.raw as RawShape | null;
  const n = raw?.ship_to?.business_name?.trim();
  return n && n.length > 0 ? n : null;
}

function csrInstructionsSnippet(po: MirroredPo): string | null {
  const raw = po.raw as RawShape | null;
  const s = raw?.csr_instructions_from_so?.trim();
  if (!s) return null;
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

interface Props {
  po: MirroredPo;
  state: PoScheduleState | null;
  apparelSiblings: MirroredPo[];
  department: Department;
  customer: string | null; // best-effort, may be null
}

export function PoCard({
  po,
  apparelSiblings,
  department,
  customer,
}: Props) {
  const chip = DEPT_CHIP[department];
  const display = customer ?? shipToBusinessName(po) ?? `Job ${po.syncoreJobId}`;
  const instructions = csrInstructionsSnippet(po);

  // Inbound apparel summary — how many siblings are still open, the
  // earliest in-hand date so floor knows when shirts are likely landing.
  const totalSiblings = apparelSiblings.length;
  const openSiblings = apparelSiblings.filter(
    (s) => s.status === "Open" || s.status === "Approved",
  ).length;
  const earliestSiblingDate = apparelSiblings
    .map((s) => s.inHandDate)
    .filter((d): d is string => !!d)
    .sort()[0];

  return (
    <article className="flex gap-3.5 p-4 border border-[#E3DFD3] rounded-card bg-[#FCFBF7] hover:-translate-y-px hover:shadow-md transition">
      <div className="flex-1 min-w-0">
        {/* Identity row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-base">{display}</span>
          <IdChip label="Job" value={po.syncoreJobId} />
          <IdChip
            label="PO"
            value={po.poNumber != null ? String(po.poNumber) : po.poId}
          />
          <span
            className="text-[10px] font-bold tracking-wider border rounded px-1.5 py-px"
            style={{ color: chip.color, borderColor: chip.color }}
            title={po.supplierName ?? undefined}
          >
            {chip.label}
          </span>
          <StatusPill status={po.status} />
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-4 text-[12.5px] text-[#5A5346] mt-1.5">
          <span>
            <b>Qty</b> {po.totalQuantity ?? "—"}
          </span>
          {po.inHandDate && (
            <span>
              <b>Due</b> {po.inHandDate.slice(5)}
            </span>
          )}
          {department === "embroidery" && po.stitchCount != null && (
            <span>
              <b>Stitches</b> {po.stitchCount.toLocaleString()}
            </span>
          )}
          {po.supplierName && (
            <span title={po.supplierName} className="text-[#6B6356]">
              {po.supplierName}
            </span>
          )}
        </div>

        {/* Inbound apparel status */}
        {totalSiblings > 0 && (
          <div className="mt-2 text-[12px]">
            <InboundBadge
              total={totalSiblings}
              open={openSiblings}
              earliest={earliestSiblingDate}
            />
          </div>
        )}

        {instructions && (
          <div className="mt-2 text-[12.5px] text-[#6B6356] bg-[#F3F1E8] border-l-[3px] border-[#E3DFD3] py-1.5 px-2.5 rounded-r">
            {instructions}
          </div>
        )}
      </div>
    </article>
  );
}

function IdChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs text-[#4A4336] bg-[#ECEFE9] border border-[#D6DCCF] rounded px-2 py-px tabular-nums">
      {label} <b className="text-cg-teal font-extrabold text-[13px]">{value}</b>
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Open"
      ? { bg: "#E0A800", fg: "#3A2E00" }
      : status === "Approved"
        ? { bg: "#3B6FB0", fg: "#FFFFFF" }
        : { bg: "#6B6356", fg: "#FFFFFF" };
  return (
    <span
      className="text-[10px] font-bold tracking-wider rounded px-1.5 py-0.5"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {status}
    </span>
  );
}

function InboundBadge({
  total,
  open,
  earliest,
}: {
  total: number;
  open: number;
  earliest: string | undefined;
}) {
  // No apparel POs open = green "all here". Some open = yellow "waiting".
  // Receiving-memo wiring lands in Phase 4; for now we treat "Posted" /
  // "Paid" status as a proxy for "received".
  if (open === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[#3A8C5F] font-semibold">
        <Dot color="#3A8C5F" /> Apparel all closed ({total} PO
        {total === 1 ? "" : "s"})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[#8A5A2B] font-semibold">
      <Dot color="#E0A800" /> {open}/{total} apparel PO
      {total === 1 ? "" : "s"} still open
      {earliest ? ` · earliest in-hand ${earliest.slice(5)}` : ""}
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ background: color }}
    />
  );
}
