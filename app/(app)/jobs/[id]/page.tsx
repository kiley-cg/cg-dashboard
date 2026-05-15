import Link from "next/link";
import { auth } from "@/lib/auth";
import { getJobBundle, flattenLines } from "@/lib/syncore/orders";
import { lookupInventory } from "@/lib/vendors/registry";
import type { InventoryLookup } from "@/lib/vendors/types";
import type { FlatLineItem } from "@/lib/syncore/types";
import {
  autoVerifyClean,
  findVerificationsForJob,
  isJobAutoVerifyDisabled,
} from "@/lib/db/verifications";
import { pickConsolidationWarehouse, pickPrimaryWarehouse, computeSplit } from "@/lib/vendors/warehouse-priority";
import { matchVariant } from "@/lib/vendors/match";
import { estimateFreight, type FreightShipmentInput } from "@/lib/ups/freight";
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
  const freightFromZip = cleanZip(sp.fromZip);
  const freightToZip = cleanZip(sp.toZip);
  // Decorator-leg quote only fires when the rep has explicitly entered
  // both ZIPs — no implicit "default to CG home" or "default to decorator
  // zip" fallback, since those silently steered every quote at the same
  // pair regardless of the actual job's destination.
  const canQuoteFreight = !!(freightFromZip && freightToZip);
  const session = await auth();
  const userId = session?.user?.id;

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
          // Preserve the freight ZIPs across toggle clicks so the quote
          // doesn't disappear when the rep flips costs on/off.
          if (freightFromZip) next.set("fromZip", freightFromZip);
          if (freightToZip) next.set("toZip", freightToZip);
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
              return (
                <div className="mt-3">
                  <p className="text-2xl font-bold tabular-nums">
                    {decoratorFreight.totalCharge.toLocaleString("en-US", {
                      style: "currency",
                      currency: decoratorFreight.currency,
                    })}
                  </p>
                  <p className="text-cg-n-500 text-xs mt-1">
                    {freightFromZip} → {freightToZip}:{" "}
                    {s.weight.totalQty.toLocaleString()} pcs ·{" "}
                    {s.weight.totalWeightLbs} lbs · {s.estimate.packages} pkg
                    {s.estimate.transitDays != null
                      ? ` · ~${s.estimate.transitDays}-day transit`
                      : ""}
                    {s.estimate.isNegotiated
                      ? " · negotiated rate"
                      : ` · list rate × ${s.estimate.calibrationFactor.toFixed(2)} calibration (raw $${s.estimate.rawTotalCharge.toFixed(2)})`}
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

        {await Promise.all(enriched.map(async ({ salesOrder: so, rows }) => {
          // Warehouse priority and per-SO freight are both about the
          // vendor → decorator leg (vendors ship blanks to the decorator,
          // not directly to the end customer), so rank against the
          // decorator's zip — Frontier 97002, OSI 97232 — not the sales
          // order's customer ship-to. For BB18007 with a SE customer,
          // this is the difference between picking Jacksonville (closest
          // to customer) and Phoenix (closest to Frontier in OR).
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

          // Per-SO freight estimate via UPS Ratetimeintransit.
          // Only attempted when consolidation worked (one origin warehouse).
          // Multi-warehouse splits → skipped (would need N quotes summed).
          const consolidationWarehouse = consolidationWarehouseId
            ? rows
                .map((r) => {
                  const lookup = r.lookup;
                  if (lookup.status !== "ok") return null;
                  return lookup.lines
                    .flatMap((l) => l.warehouses ?? [])
                    .find((w) => w.id === consolidationWarehouseId);
                })
                .find((w) => w != null) ?? null
            : null;
          // Build per-warehouse shipments by replicating the same Ships-from
          // logic used in LineItemRow: honor the SO consolidation warehouse
          // when it covers the line; otherwise pick the highest-priority
          // warehouse with full stock; otherwise allocate via computeSplit
          // across multiple warehouses. Then group lines by warehouse so we
          // can hit UPS once per warehouse and sum the totals.
          const shipmentMap = new Map<
            string,
            {
              warehouse: { id: string; name?: string };
              lines: Array<{
                qtyOrdered: number;
                pieceWeightLbs: number | null;
              }>;
            }
          >();
          function addToShipment(
            warehouse: { id: string; name?: string },
            qty: number,
            pieceWeightLbs: number | null,
          ) {
            if (qty <= 0) return;
            const existing = shipmentMap.get(warehouse.id);
            if (existing) {
              existing.lines.push({ qtyOrdered: qty, pieceWeightLbs });
            } else {
              shipmentMap.set(warehouse.id, {
                warehouse: { id: warehouse.id, name: warehouse.name },
                lines: [{ qtyOrdered: qty, pieceWeightLbs }],
              });
            }
          }
          for (const { line, lookup } of okRows) {
            if (lookup.status !== "ok") continue;
            const matched = matchVariant(lookup, line.color, line.size);
            const warehouses = (matched?.warehouses ?? []).filter(
              (w) => w.quantity > 0,
            );
            if (warehouses.length === 0) continue;
            const pieceWeightLbs = matched?.pieceWeightLbs ?? null;

            // Honor consolidation if it can cover this line.
            let primary: { id: string; name?: string } | null = null;
            if (consolidationWarehouseId) {
              primary =
                warehouses.find(
                  (w) =>
                    w.id === consolidationWarehouseId &&
                    w.quantity >= line.qtyOrdered,
                ) ?? null;
            }
            if (!primary) {
              primary = pickPrimaryWarehouse(
                warehouses,
                line.qtyOrdered,
                shipToZip,
              );
            }
            if (primary) {
              addToShipment(primary, line.qtyOrdered, pieceWeightLbs);
            } else {
              // Line must split across warehouses.
              const split = computeSplit(
                warehouses,
                line.qtyOrdered,
                shipToZip,
              );
              for (const a of split.allocations) {
                addToShipment(a.warehouse, a.qty, pieceWeightLbs);
              }
            }
          }
          const shipments: FreightShipmentInput[] = Array.from(
            shipmentMap.values(),
          ).map((s) => ({
            fromWarehouse: s.warehouse,
            lines: s.lines,
          }));
          const freight = !includeFreight
            ? ({ status: "skipped", reason: "Freight off — toggle 'Freight' above to quote." } as const)
            : await estimateFreight({
                toZip: shipToZip,
                shipments,
              });

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
                {freight.status === "ok" && (() => {
                  const totalWeight = freight.shipments.reduce(
                    (n, s) => n + s.weight.totalWeightLbs,
                    0,
                  );
                  const totalPackages = freight.shipments.reduce(
                    (n, s) => n + s.estimate.packages,
                    0,
                  );
                  const totalQty = freight.shipments.reduce(
                    (n, s) => n + s.weight.totalQty,
                    0,
                  );
                  const realWeightLines = freight.shipments.reduce(
                    (n, s) => n + s.weight.linesWithRealWeight,
                    0,
                  );
                  const totalLines = freight.shipments.reduce(
                    (n, s) => n + s.weight.totalLines,
                    0,
                  );
                  const tooltipLines: string[] = [
                    `UPS Ground · ${freight.shipments.length} shipment${freight.shipments.length === 1 ? "" : "s"} · ${freight.shipments[0].estimate.isNegotiated ? "negotiated rate" : "list rate"}`,
                    `Destination zip: ${shipToZip ?? "98512"}`,
                    `Quantity: ${totalQty.toLocaleString()} pieces across ${totalLines} line${totalLines === 1 ? "" : "s"}`,
                    `Real vendor weights: ${realWeightLines} of ${totalLines} line${totalLines === 1 ? "" : "s"}`,
                    `Total weight: ${totalWeight} lbs across ${totalPackages} package${totalPackages === 1 ? "" : "s"} (≤70 lb each, 24×16×16 in default dims)`,
                    "",
                  ];
                  for (const s of freight.shipments) {
                    tooltipLines.push(
                      `• ${s.warehouseName} (${s.fromZip}): ${s.weight.totalQty.toLocaleString()} pcs · ${s.weight.totalWeightLbs} lbs · ${s.estimate.packages} pkg · ${s.estimate.transitDays != null ? `~${s.estimate.transitDays}d` : "transit ?"} · ${s.estimate.totalCharge.toLocaleString("en-US", { style: "currency", currency: s.estimate.currency })}`,
                    );
                  }
                  if (freight.skipped.length > 0) {
                    tooltipLines.push("", "Could not quote:");
                    for (const sk of freight.skipped) {
                      tooltipLines.push(`• ${sk.warehouseName}: ${sk.reason}`);
                    }
                  }
                  tooltipLines.push(
                    "",
                    "Box dimensions use a default; precise dims would require an extra SanMar API call per style.",
                  );
                  return (
                    <p
                      className="text-cg-n-700 text-[11px] mt-1 tabular-nums"
                      title={tooltipLines.join("\n")}
                    >
                      Estimated freight:{" "}
                      <span className="font-semibold">
                        {freight.totalCharge.toLocaleString("en-US", {
                          style: "currency",
                          currency: freight.currency,
                        })}
                      </span>{" "}
                      Ground
                      {freight.maxTransitDays != null
                        ? ` · ~${freight.maxTransitDays}-day transit`
                        : ""}
                      {" · "}
                      {totalWeight} lbs
                      {freight.shipments.length > 1
                        ? ` · ${freight.shipments.length} shipments`
                        : ""}
                      {freight.skipped.length > 0
                        ? ` · ${freight.skipped.length} unquoted`
                        : ""}
                      {" · "}
                      <span className="text-cg-n-500">hover for details</span>
                    </p>
                  );
                })()}
                {freight.status === "skipped" && (
                  <p className="text-cg-n-400 text-[10px] mt-1">
                    Freight estimate: {freight.reason}
                  </p>
                )}
                {freight.status === "error" && (
                  <p
                    className="text-cg-danger text-[10px] mt-1"
                    title={freight.message}
                  >
                    Freight estimate failed (hover for details)
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
        }))}
      </div>
    </section>
  );
}
