// Inbound apparel tab on the production page. Renders the receiving
// list — POs shipping to Color Graphics that production is waiting on —
// with manual tracking entry and a local "mark received" toggle.
//
// Same actions are intended to surface on a future CSR dashboard
// receiving section (with cgOnly: false so CSRs see every job's apparel,
// not just CG-bound). Until then, this tab is the only home.

import {
  listInboundPos,
  type InboundPoView,
  type TrackingEntry,
} from "@/lib/db/receiving";
import { getCustomerDisplayMap } from "@/lib/db/production-po";
import { TrackingForm } from "./TrackingForm";
import { ReceiptToggle } from "./ReceiptToggle";
import { DeleteTrackingButton } from "./DeleteTrackingButton";

const SYNCORE_JOB_DEEP_LINK = "https://www.ateasesystems.net/Job/Details";

interface RawShipTo {
  business_name?: string | null;
  name?: string | null;
}
interface RawShape {
  ship_to?: RawShipTo | null;
}

function customerLabel(
  view: InboundPoView,
  customerMap: Map<string, string>,
): string {
  const fromFollowups = customerMap.get(view.po.syncoreJobId);
  if (fromFollowups) return fromFollowups;
  const raw = view.po.raw as RawShape | null;
  const shipTo = raw?.ship_to?.business_name?.trim();
  if (shipTo) return shipTo;
  return `Job ${view.po.syncoreJobId}`;
}

export async function InboundTab() {
  // cgOnly: true filters to apparel shipping to Color Graphics — Kristen's
  // actual receiving load. Contract-decorator destinations live in the
  // future CSR dashboard view that passes cgOnly: false.
  const inbound = await listInboundPos({ cgOnly: true });
  const customerMap = await getCustomerDisplayMap({
    jobIds: Array.from(new Set(inbound.map((v) => v.po.syncoreJobId))),
  });

  const byJob = new Map<string, InboundPoView[]>();
  for (const v of inbound) {
    const list = byJob.get(v.po.syncoreJobId) ?? [];
    list.push(v);
    byJob.set(v.po.syncoreJobId, list);
  }

  const jobsSorted = Array.from(byJob.entries()).sort(([, a], [, b]) => {
    const ea = a.map((v) => v.po.inHandDate ?? "9999-12-31").sort()[0];
    const eb = b.map((v) => v.po.inHandDate ?? "9999-12-31").sort()[0];
    return ea.localeCompare(eb);
  });

  const totalOpen = inbound.filter((v) => !v.receipt?.receivedAt).length;
  const totalReceived = inbound.length - totalOpen;

  return (
    <section className="mx-8 my-6 flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[12px] text-[#5A5346] leading-relaxed">
          Apparel coming in to Color Graphics. Contract-decorator
          destinations live on the (future) CSR dashboard.
        </p>
        <div className="flex gap-4">
          <Stat label="Awaiting" value={totalOpen} tone="open" />
          <Stat label="Received" value={totalReceived} tone="done" />
        </div>
      </div>

      {jobsSorted.length === 0 ? (
        <div className="bg-white border border-[#E3DFD3] rounded-card p-8 text-center text-[#9A917F] italic">
          No inbound apparel POs awaiting receipt right now.
        </div>
      ) : (
        jobsSorted.map(([jobId, views]) => (
          <JobBlock
            key={jobId}
            jobId={jobId}
            views={views}
            customer={customerLabel(views[0], customerMap)}
          />
        ))
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "open" | "done";
}) {
  return (
    <div className="text-right">
      <span className="block text-[10px] tracking-[.1em] uppercase text-[#9A917F]">
        {label}
      </span>
      <strong
        className="text-xl font-serif"
        style={{ color: tone === "open" ? "#D64545" : "#3A8C5F" }}
      >
        {value}
      </strong>
    </div>
  );
}

function JobBlock({
  jobId,
  views,
  customer,
}: {
  jobId: string;
  views: InboundPoView[];
  customer: string;
}) {
  return (
    <section className="bg-white border border-[#E3DFD3] rounded-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap border-b border-[#E3DFD3] pb-2">
        <span className="font-bold text-base">{customer}</span>
        <span className="text-xs text-[#4A4336] bg-[#ECEFE9] border border-[#D6DCCF] rounded px-2 py-px tabular-nums">
          Job <b className="text-cg-teal font-extrabold text-[13px]">{jobId}</b>
        </span>
        <span className="text-[11.5px] text-[#9A917F]">
          {views.length} PO{views.length === 1 ? "" : "s"}
        </span>
        <a
          href={`${SYNCORE_JOB_DEEP_LINK}/${jobId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[12px] text-cg-teal hover:underline font-semibold"
        >
          Open job in Syncore →
        </a>
      </div>
      {views.map((v) => (
        <InboundPoRow key={v.po.poId} view={v} />
      ))}
    </section>
  );
}

function InboundPoRow({ view }: { view: InboundPoView }) {
  const { po, receipt, tracking } = view;
  const isReceived = !!receipt?.receivedAt;

  return (
    <div
      className={[
        "border border-[#E3DFD3] rounded-card p-3 flex flex-col gap-2 transition",
        isReceived ? "bg-[#F1F7F3] opacity-90" : "bg-[#FCFBF7]",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-[14px]">
          {po.supplierName ?? "Unknown supplier"}
        </span>
        <span className="text-xs text-[#4A4336] bg-[#ECEFE9] border border-[#D6DCCF] rounded px-2 py-px tabular-nums">
          PO{" "}
          <b className="text-cg-teal font-extrabold text-[13px]">
            {po.poNumber != null ? String(po.poNumber) : po.poId}
          </b>
        </span>
        <StatusPill status={po.status} />
        <div className="ml-auto">
          <ReceiptToggle
            poId={po.poId}
            isReceived={isReceived}
            syncoreMemoUpdatedAt={receipt?.syncoreMemoUpdatedAt ?? null}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-[12px] text-[#5A5346]">
        <span>
          <b>Qty</b> {po.totalQuantity ?? "—"}
        </span>
        {po.inHandDate && (
          <span>
            <b>In-hand</b> {po.inHandDate}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-1">
        <span className="text-[10.5px] tracking-[.1em] uppercase font-bold text-[#9A917F]">
          Tracking
        </span>
        {tracking.length === 0 ? (
          <span className="text-[12px] text-[#9A917F] italic">
            None yet —
          </span>
        ) : (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 list-none">
            {tracking.map((t) => (
              <TrackingChip key={t.id} entry={t} />
            ))}
          </ul>
        )}
        <div className="ml-auto">
          <TrackingForm poId={po.poId} />
        </div>
      </div>
    </div>
  );
}

function TrackingChip({ entry }: { entry: TrackingEntry }) {
  return (
    <li className="inline-flex items-center gap-1.5 text-[12px] bg-[#ECEFE9] border border-[#D6DCCF] rounded px-2 py-0.5">
      <span className="font-semibold text-[#4A4336]">{entry.carrier}</span>
      <span className="tabular-nums text-[#1C2B27]">
        {entry.trackingNumber}
      </span>
      {entry.status && (
        <span className="text-[10.5px] text-[#5A5346] italic">
          · {entry.status}
        </span>
      )}
      {entry.eta && (
        <span className="text-[10.5px] text-[#5A5346]">
          · ETA {entry.eta.slice(5)}
        </span>
      )}
      <DeleteTrackingButton trackingId={entry.id} />
    </li>
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
