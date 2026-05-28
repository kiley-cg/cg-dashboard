"use client";

// One card per decoration PO (v2 model). Replaces the v1 JobCard which
// rolled multiple POs from the same job into one card.
//
// "use client" because the card participates in client-only filter
// state (FilterProvider). All data still comes from the server via
// props — no client-side fetches.

import type {
  MirroredPo,
  PoScheduleState,
} from "@/lib/db/production-po";
import type { TrackingEntry } from "@/lib/db/receiving";
import type { JobVerificationRecord } from "@/lib/db/verifications";
import type { Department } from "@/lib/syncore/production";
import { ScheduleControl } from "./ScheduleControl";
import { FloorStatusControl } from "./FloorStatusControl";
import { NotesEditor } from "./NotesEditor";
import { InboundSiblingsPanel } from "./InboundSiblingsPanel";
import { PoSelectCheckbox } from "./PoSelectCheckbox";
import { AskAboutJobButton } from "./AskAboutJobButton";
import { useFilter } from "./FilterProvider";

const FLOOR_STATUSES = ["stopped", "in_progress", "done"] as const;
type FloorStatus = (typeof FLOOR_STATUSES)[number];
function asFloorStatus(value: string | null | undefined): FloorStatus {
  return value === "in_progress" || value === "done" ? value : "stopped";
}

export interface DayOption {
  iso: string;
  label: string;
}

const DEPT_CHIP: Record<
  Department,
  { label: string; color: string; tint: string }
> = {
  embroidery: { label: "EMB", color: "#0F6E56", tint: "#EBF4EF" },
  transfers: { label: "TRN", color: "#8A5A2B", tint: "#F7EFE3" },
  fulfillment: { label: "FUL", color: "#3B6FB0", tint: "#EAF0F8" },
  other: { label: "OTH", color: "#6B6356", tint: "#FCFBF7" },
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
  // CSRs put multiple labeled sections in csr_instructions_from_so
  // ("For CSR: ... For Production: ... For Shipping: ..."). Kristen only
  // wants the "For Production" section surfaced on the floor — anything
  // else is noise. If no such section exists, hide the box entirely.
  const raw = po.raw as RawShape | null;
  const s = raw?.csr_instructions_from_so;
  if (!s) return null;
  const match = s.match(/For\s+Production:?\s*([\s\S]*?)(?=\n\s*For\s+\w+\s*:|$)/i);
  const section = match?.[1]?.trim();
  if (!section) return null;
  return section.length > 150 ? section.slice(0, 147) + "…" : section;
}

interface Props {
  po: MirroredPo;
  state: PoScheduleState | null;
  apparelSiblings: MirroredPo[];
  inboundTrackingCount: number;
  trackingCountBySibling: Record<string, number>;
  trackingBySibling: Record<string, TrackingEntry[]>;
  department: Department;
  customer: string | null; // best-effort, may be null
  // CSR-on-this-job name (from latest follow-up snapshot), null when
  // unknown. Powers the "Ask about this Job" composer's default
  // recipient — see AskAboutJobButton.
  csrName: string | null;
  // Drive proof rows for this job (newest first). Empty when no proof
  // has synced. Surfaces decoration spec / Drive link in a right-side
  // panel so Kristen can confirm placement without leaving /production.
  proofs: JobVerificationRecord[];
  weekDays: DayOption[]; // Mon-Fri of the displayed week
}

export function PoCard({
  po,
  state,
  apparelSiblings,
  inboundTrackingCount,
  trackingCountBySibling,
  trackingBySibling,
  department,
  weekDays,
  customer,
  csrName,
  proofs,
}: Props) {
  const chip = DEPT_CHIP[department];
  const display = customer ?? shipToBusinessName(po) ?? `Job ${po.syncoreJobId}`;
  const instructions = csrInstructionsSnippet(po);
  const floorStatus = asFloorStatus(state?.floorStatus);
  const isDone = floorStatus === "done";
  const filter = useFilter();

  // "Inbound ready" — every apparel sibling PO is either Syncore-closed
  // OR has all tracking entries marked delivered. Mirrors the logic in
  // InboundSiblingsPanel so the tile background, the rollup text, and
  // the "Waiting on / All delivered" copy stay in sync.
  const inboundReady =
    apparelSiblings.length > 0 &&
    apparelSiblings.every((s) => {
      const isOpen = s.status === "Open" || s.status === "Approved";
      if (!isOpen) return true;
      const entries = trackingBySibling[s.poId] ?? [];
      return (
        entries.length > 0 &&
        entries.every((t) =>
          (t.status ?? "").toLowerCase().includes("delivered"),
        )
      );
    });

  // Conflict: latest apparel arrival is AFTER the decoration PO's
  // in-hand date — i.e. the blanks won't be on the floor in time to
  // physically meet the customer's needed-by. Same lastArrival logic
  // as InboundSiblingsPanel: prefer tracking ETA, fall back to vendor
  // in-hand. Only flag while we're still waiting on at least one PO
  // (no point screaming about a date that's already past).
  const lastArrival = (() => {
    let max: string | null = null;
    for (const s of apparelSiblings) {
      const isOpen = s.status === "Open" || s.status === "Approved";
      if (!isOpen) continue;
      const entries = trackingBySibling[s.poId] ?? [];
      const allDelivered =
        entries.length > 0 &&
        entries.every((t) =>
          (t.status ?? "").toLowerCase().includes("delivered"),
        );
      if (allDelivered) continue;
      const etas = entries.map((t) => t.eta).filter((d): d is string => !!d);
      const candidate = etas.length > 0 ? etas.sort().slice(-1)[0] : s.inHandDate;
      if (candidate && (!max || candidate > max)) max = candidate;
    }
    return max;
  })();
  const dueDate = po.inHandDate ?? null;
  const conflict =
    !inboundReady &&
    lastArrival != null &&
    dueDate != null &&
    lastArrival > dueDate;

  // Client-side filter — render nothing when this card doesn't match.
  // Keep ALL hooks above this early-return (React rules-of-hooks).
  if (
    !filter.matches({
      dept: department,
      inboundReady,
      customer,
      jobId: po.syncoreJobId,
    })
  ) {
    return null;
  }

  // When all apparel is here, swap the tile's tint to a clear green so
  // the floor can scan a whole day's queue and spot what's actionable.
  // Don't override the department's left-border color — the department
  // chip is still the primary identifier.
  const READY_TINT = "#E5F2E5";
  const READY_BORDER = "#3A8C5F";
  const bgColor = inboundReady && !isDone ? READY_TINT : chip.tint;

  // Frame color precedence:
  //   isDone   → dim (opacity 60%, neutral border)
  //   conflict → red border + faint pink tint (overrides ready/neutral)
  //   ready    → green border + green tint
  //   default  → neutral 1px border, dept tint
  const CONFLICT_BORDER = "#D64545";
  const CONFLICT_TINT = "#FBEBEB";
  const frame =
    isDone
      ? { borderColor: "#E3DFD3", borderWidth: 1, backgroundColor: chip.tint }
      : conflict
        ? { borderColor: CONFLICT_BORDER, borderWidth: 2, backgroundColor: CONFLICT_TINT }
        : inboundReady
          ? { borderColor: READY_BORDER, borderWidth: 2, backgroundColor: READY_TINT }
          : { borderColor: "#E3DFD3", borderWidth: 1, backgroundColor: bgColor };

  return (
    <article
      style={{
        borderLeftColor: chip.color,
        borderLeftWidth: 6,
        ...frame,
      }}
      className={[
        "flex gap-3.5 p-4 pl-[11px] rounded-card hover:-translate-y-px hover:shadow-md transition",
        isDone ? "opacity-60" : "",
      ].join(" ")}
    >
      <PoSelectCheckbox poId={po.poId} />
      <div className="flex-1 min-w-0 flex gap-3">
        <div className="flex-1 min-w-0">
        {/* Identity row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-base">{display}</span>
          <IdChip
            label="Job"
            value={po.syncoreJobId}
            href={`https://www.ateasesystems.net/Job/Details/${po.syncoreJobId}`}
          />
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

        {/* Meta row — Due is the actionable deadline so it gets a
            stronger pill; Qty + Stitches are secondary context. */}
        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[12.5px] text-[#5A5346]">
          {po.inHandDate && (
            <span
              className="inline-flex items-baseline gap-1 rounded-md px-2 py-0.5 bg-white border border-[#D6DCCF] tabular-nums"
              title="In-hand date"
            >
              <span className="text-[10px] uppercase tracking-wider text-[#6B6356] font-semibold">
                Due
              </span>
              <span className="font-bold text-[#1C2B27]">
                {po.inHandDate.slice(5)}
              </span>
            </span>
          )}
          {conflict && lastArrival && (
            <span
              className="text-[#A82424] font-semibold"
              title={`Last apparel arrives ${lastArrival.slice(5)} — after the ${po.inHandDate?.slice(5)} due date`}
            >
              ⚠ apparel late ({lastArrival.slice(5)})
            </span>
          )}
          <span className="text-[#6B6356]">
            <b className="font-semibold text-[#3F3A30]">
              {po.totalQuantity ?? "—"}
            </b>{" "}
            qty
            {department === "embroidery" && po.stitchCount != null && (
              <>
                {" · "}
                <b className="font-semibold text-[#3F3A30] tabular-nums">
                  {po.stitchCount.toLocaleString()}
                </b>{" "}
                stitches
              </>
            )}
          </span>
        </div>

        {/* Inbound apparel status — collapsed badge, expandable to add
            tracking #s per sibling PO without leaving /production. */}
        <InboundSiblingsPanel
          siblings={apparelSiblings}
          trackingCountBySibling={trackingCountBySibling}
          trackingBySibling={trackingBySibling}
          inboundTrackingCount={inboundTrackingCount}
        />

        {instructions && (
          <div className="mt-2 text-[12.5px] text-[#6B6356] bg-[#F3F1E8] border-l-[3px] border-[#E3DFD3] py-1.5 px-2.5 rounded-r">
            {instructions}
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <ScheduleControl
            poId={po.poId}
            currentScheduledDate={state?.scheduledDate ?? null}
            days={weekDays}
          />
          <FloorStatusControl
            poId={po.poId}
            status={floorStatus}
            scheduled={state?.scheduledDate != null}
            syncoreClosedAt={state?.syncoreClosedAt ?? null}
          />
          <AskAboutJobButton jobId={po.syncoreJobId} csrName={csrName} />
        </div>

        <NotesEditor
          poId={po.poId}
          initialNotes={state?.productionNotes ?? null}
        />
        </div>
        <ProofPanel proofs={proofs} />
      </div>
    </article>
  );
}

// Right-side panel summarizing the proof spec(s) for this PO's job.
// Compact by design — Kristen scans many cards; she wants location +
// ink colors + click-through to the PDF, not a full data dump.
type ProofRaw = {
  fileId?: string;
  filename?: string;
  webViewLink?: string | null;
  extracted?: {
    decoration?: string | null;
    salespersonInitials?: string | null;
    productName?: string | null;
    productColor?: string | null;
    imprintLocations?: string[];
    imprintDimensions?: string | null;
    inkColors?: string[];
  };
};

function ProofPanel({ proofs }: { proofs: JobVerificationRecord[] }) {
  if (proofs.length === 0) {
    return (
      <div className="w-44 shrink-0 hidden sm:flex flex-col justify-center text-[11px] text-[#A8A296] italic px-2">
        no proof in Drive
      </div>
    );
  }
  return (
    <div className="w-56 shrink-0 hidden sm:flex flex-col gap-1.5 border-l border-[#E3DFD3] pl-3 text-[12px] text-[#3F3A30]">
      <div className="text-[10px] font-bold tracking-wider text-[#6B6356] uppercase">
        Proof{proofs.length > 1 ? ` · ${proofs.length}` : ""}
      </div>
      {proofs.slice(0, 3).map((p) => {
        const raw = (p.raw ?? {}) as ProofRaw;
        const ex = raw.extracted ?? {};
        const location =
          ex.imprintLocations && ex.imprintLocations.length > 0
            ? ex.imprintLocations.join(", ")
            : p.imprintLocation ?? null;
        return (
          <div key={p.id} className="leading-snug">
            {ex.productName && (
              <div className="font-medium text-[#3F3A30] truncate" title={ex.productName}>
                {ex.productName}
              </div>
            )}
            {location && (
              <div className="text-[#3F3A30]">
                <span className="text-[#6B6356]">on</span> {location}
                {ex.imprintDimensions ? ` · ${ex.imprintDimensions}` : ""}
              </div>
            )}
            {ex.inkColors && ex.inkColors.length > 0 && (
              <div className="text-[#6B6356]">{ex.inkColors.join(", ")}</div>
            )}
            {raw.webViewLink && (
              <a
                href={raw.webViewLink}
                target="_blank"
                rel="noreferrer"
                className="text-cg-teal hover:underline text-[11px] truncate block"
                title={raw.filename ?? "Open in Drive"}
              >
                {raw.filename ? raw.filename : "Open in Drive"} ↗
              </a>
            )}
          </div>
        );
      })}
      {proofs.length > 3 && (
        <div className="text-[11px] text-[#6B6356]">
          + {proofs.length - 3} more
        </div>
      )}
    </div>
  );
}

function IdChip({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <>
      {label} <b className="text-cg-teal font-extrabold text-[13px]">{value}</b>
    </>
  );
  const className =
    "text-xs text-[#4A4336] bg-[#ECEFE9] border border-[#D6DCCF] rounded px-2 py-px tabular-nums";
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`${className} hover:bg-[#DCE3D6] hover:border-cg-teal transition-colors`}
        title={`Open ${label} ${value} in Syncore`}
      >
        {inner}
      </a>
    );
  }
  return <span className={className}>{inner}</span>;
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

