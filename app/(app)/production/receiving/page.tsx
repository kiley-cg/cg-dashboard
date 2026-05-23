import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasRoleAccess } from "@/lib/roles";
import {
  listInboundPos,
  type InboundPoView,
  type TrackingEntry,
} from "@/lib/db/receiving";
import { getCustomerDisplayMap } from "@/lib/db/production-po";
import { TrackingForm } from "./_components/TrackingForm";
import { ReceiptToggle } from "./_components/ReceiptToggle";
import { DeleteTrackingButton } from "./_components/DeleteTrackingButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receiving · Color Graphics" };

// CG's Syncore branch id, used to deep-link to the v1 receiving memo.
// Hard-coded since it's stable across the tenant.
const BRANCH_ID = 97;

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

function syncoreReceivingMemoUrl(po: InboundPoView["po"]): string {
  // Deep-link to v1 receiving memo. The user has to be already logged
  // into Syncore for this to work directly; otherwise they'll bounce
  // through /Account/Login. MemoId is omitted because we don't know
  // it yet (Phase 4.2 will source it from the v1 list endpoint we
  // haven't found).
  const params = new URLSearchParams({
    ActionCMD: "Edit",
    Corp: "0",
    BranchID: String(BRANCH_ID),
    PurchaseOrderID: po.poId,
  });
  return `https://us.ateasesystems.net/porder/receivingMemo.asp?${params.toString()}`;
}

export default async function ReceivingPage() {
  const session = await auth();
  const allowed = await hasRoleAccess({
    email: session?.user?.email,
    userId: session?.user?.id,
    required: "production",
  });
  if (!allowed) notFound();

  const inbound = await listInboundPos();
  const customerMap = await getCustomerDisplayMap({
    jobIds: Array.from(new Set(inbound.map((v) => v.po.syncoreJobId))),
  });

  // Group by job so multiple inbound POs for the same job render together.
  const byJob = new Map<string, InboundPoView[]>();
  for (const v of inbound) {
    const list = byJob.get(v.po.syncoreJobId) ?? [];
    list.push(v);
    byJob.set(v.po.syncoreJobId, list);
  }

  // Sort jobs by earliest in_hand_date among their POs.
  const jobsSorted = Array.from(byJob.entries()).sort(([, a], [, b]) => {
    const ea = a.map((v) => v.po.inHandDate ?? "9999-12-31").sort()[0];
    const eb = b.map((v) => v.po.inHandDate ?? "9999-12-31").sort()[0];
    return ea.localeCompare(eb);
  });

  const totalOpen = inbound.filter((v) => !v.receipt?.receivedAt).length;
  const totalReceived = inbound.length - totalOpen;

  return (
    <div className="min-h-screen bg-[#F7F5EF] text-[#1C2B27]">
      <header className="flex flex-wrap items-end justify-between gap-3 px-8 pt-7 pb-4 border-b-2 border-[#1C2B27]">
        <div>
          <p className="text-[11px] tracking-[.14em] uppercase font-bold text-cg-teal">
            Color Graphics · Production · Receiving
          </p>
          <h1 className="text-[34px] font-medium tracking-tight mt-1 font-serif">
            Inbound apparel
          </h1>
        </div>
        <div className="flex gap-3 text-right">
          <Stat label="Awaiting" value={totalOpen} tone="open" />
          <Stat label="Received" value={totalReceived} tone="done" />
          <Link
            href="/production"
            className="self-center text-[13px] text-cg-teal font-semibold hover:underline"
          >
            ← Schedule
          </Link>
        </div>
      </header>

      <main className="mx-8 my-6 flex flex-col gap-5">
        {jobsSorted.length === 0 ? (
          <div className="bg-white border border-[#E3DFD3] rounded-card p-8 text-center text-[#9A917F] italic">
            No inbound apparel POs awaiting receipt. Either the mirror cron
            hasn&apos;t run, or every PO has been received.
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
      </main>

      <footer className="mx-8 mb-6 text-[11.5px] text-[#9A917F] leading-relaxed">
        Phase 4.1 · local receiving state + manual tracking. Syncore
        receiving-memo writeback (Phase 4.2) and SanMar/S&amp;S/Cutter
        &amp; Buck auto-poll (Phase 5) coming next.
      </footer>
    </div>
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
    <div>
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
        <a
          href={syncoreReceivingMemoUrl(po)}
          target="_blank"
          rel="noreferrer"
          className="text-cg-teal hover:underline font-semibold ml-auto"
        >
          Open in Syncore →
        </a>
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
