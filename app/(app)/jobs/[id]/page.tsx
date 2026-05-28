import Link from "next/link";
import { auth } from "@/lib/auth";
import { getJobBundle, flattenLines } from "@/lib/syncore/orders";
import { lookupInventory } from "@/lib/vendors/registry";
import type { InventoryLookup } from "@/lib/vendors/types";
import type { FlatLineItem } from "@/lib/syncore/types";
import {
  autoVerifyClean,
  findVerificationsForJob,
  findJobVerificationRecords,
  isJobAutoVerifyDisabled,
} from "@/lib/db/verifications";
import { hasPermission } from "@/lib/rbac";
import { JobSpecForm } from "./_components/JobSpecForm";
import { pickConsolidationWarehouse } from "@/lib/vendors/warehouse-priority";
import { matchVariant } from "@/lib/vendors/match";
import { estimateFreight } from "@/lib/ups/freight";
import { LineItemRow } from "@/components/LineItemRow";
import { Badge } from "@/components/Badge";
import { ClearVerificationsButton } from "@/components/ClearVerificationsButton";
import { DEFAULT_DECORATOR_ID, decoratorById } from "@/lib/decorators";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    decorator?: string;
    costs?: string;
    freight?: string;
    fromZip?: string;
    toZip?: string;
  }>;
};

function flagOn(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

// Permissive: trim, keep digits/letters only. Returns null when the input
// can't plausibly be a US ZIP, so the caller can fall through to the
// "needs input" branch instead of firing a guaranteed-to-fail UPS call.
function cleanZip(v: string | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (trimmed.length < 3) return null;
  return trimmed;
}

export default async function JobPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const decorator = decoratorById(sp.decorator ?? DEFAULT_DECORATOR_ID);
  const includeCosts = flagOn(sp.costs);
  // Freight estimation needs accurate per-piece weights, so freight=1
  // implies weights=1 even when costs=0.
  const includeFreight = flagOn(sp.freight);
  const includeWeights = includeFreight;
  // Track explicit (URL-param) vs. defaulted ZIPs separately so toggle
  // links only preserve what the rep actually typed — otherwise the URL
  // would balloon with defaults that the next page load would re-supply.
  const explicitFromZip = cleanZip(sp.fromZip);
  const explicitToZip = cleanZip(sp.toZip);
  // FROM defaults to the selected decorator's ZIP (Frontier 97002 / OSI
  // 97232). TO defaults to UPS_SHIPPER_ZIP, which is the same address
  // already used as the shipper identity for UPS negotiated rates — i.e.
  // Color Graphics. Either can be overridden in the form on this page.
  const cgZip = cleanZip(process.env.UPS_SHIPPER_ZIP);
  const freightFromZip = explicitFromZip ?? decorator.zip;
  const freightToZip = explicitToZip ?? cgZip;
  const canQuoteFreight = !!(freightFromZip && freightToZip);
  const session = await auth();
  const userId = session?.user?.id;
  // Phase D1: spec/approval row (read here so we can render the
  // editable form alongside the inventory check).
  const [jobSpecRecords, canEditSpec] = await Promise.all([
    findJobVerificationRecords(id),
    hasPermission({
      email: session?.user?.email,
      userId: session?.user?.id,
      permission: "verifications.record_spec",
    }),
  ]);
  // The manual row is the editable "current" spec. Proof rows from the
  // Drive sync (D2) live on /production tiles — not here, since this
  // page is the inventory-check workflow.
  const manualSpec = jobSpecRecords.find((r) => r.source === "manual") ?? null;

  let bundle;
  try {
    bundle = await getJobBundle(id);
  } catch (err) {
    return (
      <section className="max-w-6xl mx-auto px-6 py-16">
        <Link href="/" className="text-cg-n-500 hover:text-cg-n-900 text-sm">
          ← Back
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight mt-4">
          Job {id}
        </h1>
        <p className="text-cg-danger mt-4">
          Could not load job:{" "}
          {err instanceof Error ? err.message : "unknown error"}
        </p>
      </section>
    );
  }

  const { job, salesOrders } = bundle;

  // Resolve inventory for every line in every sales order up front, so we can
  // fold in auto-verification before rendering the rows.
  //
  // Dedupe by (supplierName, productId): one SanMar/S&S/C&B SOAP call per
  // unique style, reused across every size row on the page. A typical job
  // has 6 colors × 5 sizes = 30 size rows for the same style; without this
  // we'd fire 30 concurrent SOAP calls per style and the vendor would
  // throttle ~half of them, which is exactly the "only half my rows show
  // inventory" symptom reps were reporting.
  const lookupCache = new Map<string, Promise<InventoryLookup>>();
  function lookupOnce(line: FlatLineItem): Promise<InventoryLookup> {
    // Only memoize when there's a productId AND a supplier — the no-style /
    // unsupported branches inside lookupInventory return synchronously and
    // don't hit the network, so caching them saves nothing.
    if (!line.productId || !line.supplierName) {
      return lookupInventory(line, { includeCosts, includeWeights });
    }
    const key = `${line.supplierName.toLowerCase()}|${line.productId}`;
    const cached = lookupCache.get(key);
    if (cached) return cached;
    const pending = lookupInventory(line, { includeCosts, includeWeights });
    lookupCache.set(key, pending);
    return pending;
  }
  const enriched = await Promise.all(
    salesOrders.map(async (so) => {
      const flat = flattenLines(so.line_items);
      const lookups = await Promise.all(flat.map((line) => lookupOnce(line)));
      return {
        salesOrder: so,
        rows: flat.map((line, i) => ({ line, lookup: lookups[i] })),
      };
    }),
  );

  // Hybrid: auto-verify rows where SanMar can fully fill the order; require
  // explicit click for partial fills, zero stock, or vendor errors.
  // autoVerifyClean is a no-op when the job has been "Cleared" — see
  // job_verification_clears in the schema.
  let verifications: Awaited<ReturnType<typeof findVerificationsForJob>> =
    new Map();
  const autoVerifyDisabled = await isJobAutoVerifyDisabled(id);
  if (userId) {
    const existing = await findVerificationsForJob(id);
    verifications = await autoVerifyClean({
      jobId: id,
      userId,
      userEmail: session?.user?.email ?? null,
      userName: session?.user?.name ?? null,
      alreadyVerified: existing,
      salesOrders: enriched.map((e) => ({
        salesOrderId: e.salesOrder.id,
        rows: e.rows,
      })),
    });
  }

  // Count rows whose verification disagrees with the live lookup. Surfaces
  // in the "Clear all verifications" button so reps can see at a glance
  // how many verifications were captured against bad data and need a
  // fresh pass.
  let staleVerificationCount = 0;
  for (const { salesOrder, rows } of enriched) {
    for (const { line, lookup } of rows) {
      const v = verifications.get(`${salesOrder.id}:${line.sizeLineId}`);
      if (!v || lookup.status !== "ok") continue;
      const matched = matchVariant(lookup, line.color, line.size);
      const liveAvailable = matched?.quantityAvailable ?? 0;
      if (
        v.qtyAvailable !== liveAvailable ||
        (v.qtyOrdered != null && v.qtyOrdered !== line.qtyOrdered)
      ) {
        staleVerificationCount++;
      }
    }
  }

  // User-entered ship-from → ship-to freight estimate. This is the only
  // freight CG actually pays (vendor → decorator is free over $200), and
  // it's quoted from the actual line items on the sales orders so the
  // total reflects real styles/sizes/quantities. ZIPs come from the form
  // below; no implicit defaults.
  const decoratorFreight =
    !includeFreight || !freightFromZip || !freightToZip
      ? null
      : await (async () => {
          const allLines: {
            qtyOrdered: number;
            pieceWeightLbs: number | null;
          }[] = [];
          for (const { rows } of enriched) {
            for (const { line, lookup } of rows) {
              if (lookup.status !== "ok") continue;
              const matched = matchVariant(lookup, line.color, line.size);
              if (!matched) continue;
              allLines.push({
                qtyOrdered: line.qtyOrdered,
                pieceWeightLbs: matched.pieceWeightLbs ?? null,
              });
            }
          }
          if (allLines.length === 0) return null;
          return estimateFreight({
            toZip: freightToZip,
            shipments: [
              {
                fromWarehouse: { id: "user-entered", name: "Ship from" },
                fromZip: freightFromZip,
                lines: allLines,
              },
            ],
          });
        })();

  return (
    <section className="max-w-6xl mx-auto px-6 py-10">
      <Link href="/" className="text-cg-n-500 hover:text-cg-n-900 text-sm">
        ← Back
      </Link>

      <div className="flex items-baseline justify-between mt-4 mb-8">
        <div>
          <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
            Job
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight mt-1">
            #{job.id}
          </h1>
          {job.description && (
            <p className="text-cg-n-700 mt-1">{job.description}</p>
          )}
          {job.client?.business_name && (
            <p className="text-cg-n-500 text-sm mt-1">
              {job.client.business_name}
              {job.client.name ? ` · ${job.client.name}` : ""}
            </p>
          )}
        </div>
        {job.status && <Badge tone="neutral">{job.status}</Badge>}
      </div>

      {/* Phase D1: per-job spec / approval record. Editable by users with
          verifications.record_spec; everyone else sees a read-only view. */}
      <div className="mb-6">
        <JobSpecForm
          jobId={id}
          initial={
            manualSpec
              ? {
                  imprintLocation: manualSpec.imprintLocation,
                  qtyGarments: manualSpec.qtyGarments,
                  approvedBy: manualSpec.approvedBy,
                  capturedAt: manualSpec.capturedAt.toISOString(),
                }
              : null
          }
          canEdit={canEditSpec}
        />
      </div>

      {(() => {
        const buildHref = (overrides: {
          costs?: boolean;
          freight?: boolean;
          decorator?: string;
        }) => {
          const next = new URLSearchParams();
          const c = overrides.costs ?? includeCosts;
          const f = overrides.freight ?? includeFreight;
          const d = overrides.decorator ?? decorator.id;
          if (c) next.set("costs", "1");
          if (f) next.set("freight", "1");
          if (d !== DEFAULT_DECORATOR_ID) next.set("decorator", d);
          // Preserve only ZIPs the rep explicitly typed; defaulted values
          // will re-default on the next page load.
          if (explicitFromZip) next.set("fromZip", explicitFromZip);
          if (explicitToZip) next.set("toZip", explicitToZip);
          const qs = next.toString();
          return `/jobs/${id}${qs ? `?${qs}` : ""}`;
        };
        return (
          <div className="bg-white border border-cg-n-200 rounded-card p-4 mb-6 shadow-sm">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 text-xs">
                <span className="text-cg-n-500 uppercase tracking-wider font-semibold">
                  Show:
                </span>
                <Link
                  href={buildHref({ costs: !includeCosts })}
                  className={
                    includeCosts
                      ? "text-white bg-cg-red px-2 py-1 rounded font-semibold"
                      : "text-cg-n-500 border border-cg-n-200 px-2 py-1 rounded hover:text-cg-n-900"
                  }
                >
                  Costs {includeCosts ? "on" : "off"}
                </Link>
                <Link
                  href={buildHref({ freight: !includeFreight })}
                  className={
                    includeFreight
                      ? "text-white bg-cg-red px-2 py-1 rounded font-semibold"
                      : "text-cg-n-500 border border-cg-n-200 px-2 py-1 rounded hover:text-cg-n-900"
                  }
                >
                  Freight {includeFreight ? "on" : "off"}
                </Link>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-cg-n-500 uppercase tracking-wider font-semibold">
                    Decorator:
                  </span>
                  <span className="text-cg-n-900 font-semibold">
                    {decorator.name}
                  </span>
                  <span className="text-cg-n-500">({decorator.zip})</span>
                </div>
                {(verifications.size > 0 || autoVerifyDisabled) && (
                  <ClearVerificationsButton
                    jobId={id}
                    staleCount={staleVerificationCount}
                    autoVerifyDisabled={autoVerifyDisabled}
                  />
                )}
              </div>
            </div>
            {includeFreight && (
              // Plain GET form: the browser submits with fromZip/toZip as
              // URL params, the page re-renders server-side with the quote.
              // Hidden inputs carry the other params so we don't lose them.
              <form
                method="get"
                action={`/jobs/${id}`}
                className="mt-3 flex flex-wrap items-end gap-3 text-xs"
              >
                <input type="hidden" name="freight" value="1" />
                {includeCosts && <input type="hidden" name="costs" value="1" />}
                {decorator.id !== DEFAULT_DECORATOR_ID && (
                  <input type="hidden" name="decorator" value={decorator.id} />
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-cg-n-500 uppercase tracking-wider font-semibold">
                    Ship from
                  </span>
                  <input
                    type="text"
                    name="fromZip"
                    defaultValue={freightFromZip ?? ""}
                    placeholder="ZIP"
                    inputMode="numeric"
                    maxLength={10}
                    className="w-28 border border-cg-n-300 rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-cg-red"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-cg-n-500 uppercase tracking-wider font-semibold">
                    Ship to
                  </span>
                  <input
                    type="text"
                    name="toZip"
                    defaultValue={freightToZip ?? ""}
                    placeholder="ZIP"
                    inputMode="numeric"
                    maxLength={10}
                    className="w-28 border border-cg-n-300 rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-cg-red"
                  />
                </label>
                <button
                  type="submit"
                  className="bg-cg-red text-white text-xs font-semibold px-3 py-1.5 rounded hover:opacity-90"
                >
                  Quote freight
                </button>
              </form>
            )}
            {!includeFreight ? (
              <p className="text-cg-n-400 text-xs mt-3">
                Freight off. Toggle on above to quote a shipment.
              </p>
            ) : !canQuoteFreight ? (
              <p className="text-cg-n-400 text-xs mt-3">
                Enter ship-from and ship-to ZIPs to quote freight for this
                job&rsquo;s line items.
              </p>
            ) : decoratorFreight?.status === "ok" ? (() => {
              const s = decoratorFreight.shipments[0];
              const fmt = (n: number) =>
                n.toLocaleString("en-US", {
                  style: "currency",
                  currency: decoratorFreight.currency,
                });
              const hasNegotiated = s.estimate.negotiatedTotalCharge != null;
              const originLabel =
                freightFromZip === decorator.zip
                  ? decorator.name
                  : `ZIP ${freightFromZip}`;
              const destinationLabel =
                cgZip && freightToZip === cgZip
                  ? "Color Graphics"
                  : `ZIP ${freightToZip}`;
              return (
                <div className="mt-3">
                  <p className="text-cg-n-500 text-[10px] uppercase tracking-wider font-semibold">
                    Freight: {originLabel} → {destinationLabel}
                  </p>
                  {hasNegotiated ? (
                    <div className="flex items-baseline gap-4 flex-wrap mt-1">
                      <div>
                        <p className="text-cg-n-500 text-[10px] uppercase tracking-wider font-semibold">
                          Negotiated
                        </p>
                        <p className="text-2xl font-bold tabular-nums text-cg-n-900">
                          {fmt(s.estimate.negotiatedTotalCharge as number)}
                        </p>
                      </div>
                      <div>
                        <p className="text-cg-n-500 text-[10px] uppercase tracking-wider font-semibold">
                          List
                        </p>
                        <p className="text-base font-semibold tabular-nums text-cg-n-500 line-through decoration-cg-n-400">
                          {fmt(s.estimate.listTotalCharge)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold tabular-nums mt-1">
                      {fmt(decoratorFreight.totalCharge)}
                    </p>
                  )}
                  <p className="text-cg-n-500 text-xs mt-1">
                    {s.weight.totalQty.toLocaleString()} pcs ·{" "}
                    {s.weight.totalWeightLbs} lbs · {s.estimate.packages} pkg
                    {s.estimate.transitDays != null
                      ? ` · ~${s.estimate.transitDays}-day transit`
                      : ""}
                    {hasNegotiated
                      ? ` · negotiated rate (list ${fmt(s.estimate.listTotalCharge)})`
                      : ` · list rate × ${s.estimate.calibrationFactor.toFixed(2)} calibration (raw ${fmt(s.estimate.listTotalCharge)})`}
                    {s.weight.skippedLines > 0
                      ? ` · ${s.weight.skippedLines} line${s.weight.skippedLines === 1 ? "" : "s"} (${s.weight.skippedQty} pcs) skipped — no vendor weight`
                      : ""}
                  </p>
                </div>
              );
            })() : decoratorFreight?.status === "skipped" ? (
              <p className="text-cg-n-400 text-xs mt-3">
                Freight estimate: {decoratorFreight.reason}
              </p>
            ) : decoratorFreight?.status === "error" ? (
              <p className="text-cg-danger text-xs mt-3" title={decoratorFreight.message}>
                Freight estimate failed (hover for details)
              </p>
            ) : (
              <p className="text-cg-n-400 text-xs mt-3">
                No quotable lines yet.
              </p>
            )}
          </div>
        );
      })()}

      <div className="space-y-8">
        {enriched.length === 0 && (
          <div className="bg-white border border-cg-n-200 rounded-card p-8 text-center text-cg-n-500 shadow-sm">
            This job has no sales orders yet.
          </div>
        )}

        {enriched.map(({ salesOrder: so, rows }) => {
          // Warehouse priority is about the vendor → decorator leg (vendors
          // ship blanks to the decorator, not directly to the end customer),
          // so rank against the decorator's zip — Frontier 97002, OSI 97232
          // — not the sales order's customer ship-to. For BB18007 with a SE
          // customer, this is the difference between picking Jacksonville
          // (closest to customer) and Phoenix (closest to Frontier in OR).
          const shipToZip = decorator.zip;

          // Multi-line consolidation: if a single warehouse can fulfill
          // every line on this Sales Order, use it as Ships-from for every
          // line so the rep cuts one PO instead of splitting.
          const okRows = rows.filter((r) => r.lookup.status === "ok");
          const consolidationWarehouseId = pickConsolidationWarehouse(
            okRows.map(({ line, lookup }) => {
              const matched = matchVariant(lookup, line.color, line.size);
              return {
                qtyOrdered: line.qtyOrdered,
                warehouses: matched?.warehouses ?? [],
              };
            }),
            shipToZip,
          );

          return (
          <div
            key={so.id}
            className="bg-white border border-cg-n-200 rounded-card overflow-hidden shadow-sm"
          >
            <div className="px-5 py-3 border-b border-cg-n-100 flex items-baseline justify-between">
              <div>
                <p className="text-cg-n-500 text-xs uppercase tracking-wider font-semibold">
                  Sales Order
                </p>
                <p className="font-bold tracking-tight">
                  #{so.number ?? so.id}
                  {so.customer_order_number
                    ? ` · PO ${so.customer_order_number}`
                    : ""}
                </p>
                {consolidationWarehouseId && (
                  <p className="text-cg-success text-[11px] mt-1">
                    Consolidates to a single warehouse
                  </p>
                )}
              </div>
              {so.status && <Badge tone="neutral">{so.status}</Badge>}
            </div>

            <table className="w-full text-left">
              <thead className="bg-cg-n-50 border-b border-cg-n-200">
                <tr className="text-cg-n-500 text-xs uppercase tracking-wider">
                  <th className="py-3 px-4 font-semibold">Style</th>
                  <th className="py-3 px-4 font-semibold">Color / Size</th>
                  <th className="py-3 px-4 text-right font-semibold">
                    Ordered
                  </th>
                  <th className="py-3 px-4 text-right font-semibold">
                    Available
                  </th>
                  <th className="py-3 px-4 text-right font-semibold">Pricing</th>
                  <th className="py-3 px-4 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-8 px-4 text-center text-cg-n-500 text-sm"
                    >
                      No orderable color/size lines found on this sales
                      order.
                    </td>
                  </tr>
                )}
                {rows.map(({ line, lookup }) => {
                  const key = `${so.id}:${line.sizeLineId}`;
                  return (
                    <LineItemRow
                      key={line.sizeLineId}
                      jobId={id}
                      salesOrderId={so.id}
                      line={line}
                      lookup={lookup}
                      verification={verifications.get(key) ?? null}
                      currentUserEmail={session?.user?.email ?? null}
                      currentUserName={session?.user?.name ?? null}
                      shipToZip={shipToZip}
                      consolidationWarehouseId={consolidationWarehouseId}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          );
        })}
      </div>
    </section>
  );
}
