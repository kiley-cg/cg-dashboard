import Link from "next/link";
import { auth } from "@/lib/auth";
import { getJobBundle, flattenLines } from "@/lib/syncore/orders";
import { lookupInventory } from "@/lib/vendors/registry";
import {
  autoVerifyClean,
  findVerificationsForJob,
} from "@/lib/db/verifications";
import { pickConsolidationWarehouse } from "@/lib/vendors/warehouse-priority";
import { estimateFreight } from "@/lib/ups/freight";
import { LineItemRow } from "@/components/LineItemRow";
import { Badge } from "@/components/Badge";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function JobPage({ params }: Props) {
  const { id } = await params;
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
  const enriched = await Promise.all(
    salesOrders.map(async (so) => {
      const flat = flattenLines(so.line_items);
      const lookups = await Promise.all(
        flat.map((line) => lookupInventory(line)),
      );
      return {
        salesOrder: so,
        rows: flat.map((line, i) => ({ line, lookup: lookups[i] })),
      };
    }),
  );

  // Hybrid: auto-verify rows where SanMar can fully fill the order; require
  // explicit click for partial fills, zero stock, or vendor errors.
  let verifications: Awaited<ReturnType<typeof findVerificationsForJob>> =
    new Map();
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

      <div className="space-y-8">
        {enriched.length === 0 && (
          <div className="bg-white border border-cg-n-200 rounded-card p-8 text-center text-cg-n-500 shadow-sm">
            This job has no sales orders yet.
          </div>
        )}

        {await Promise.all(enriched.map(async ({ salesOrder: so, rows }) => {
          // Ship-to: use the Sales Order's destination zip when present so
          // drop-ship orders rank warehouses from the customer's location.
          // Falls back to CG's home zip (98512) inside warehouse-priority.
          const shipToZip =
            (so.ship_to as { zip?: string } | undefined)?.zip ?? null;

          // Multi-line consolidation: if a single warehouse can fulfill
          // every line on this Sales Order, use it as Ships-from for every
          // line so the rep cuts one PO instead of splitting.
          const okRows = rows.filter((r) => r.lookup.status === "ok");
          const consolidationWarehouseId = pickConsolidationWarehouse(
            okRows.map(({ line, lookup }) => {
              const matched =
                lookup.status === "ok"
                  ? lookup.lines.find(
                      (l) =>
                        (!line.color ||
                          l.color?.toLowerCase() ===
                            line.color.toLowerCase()) &&
                        (!line.size ||
                          l.size?.toLowerCase() ===
                            line.size.toLowerCase()),
                    )
                  : null;
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
          const totalQty = okRows.reduce(
            (n, r) => n + r.line.qtyOrdered,
            0,
          );
          const freight = await estimateFreight({
            fromWarehouse: consolidationWarehouse,
            toZip: shipToZip,
            totalQty,
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
                {freight.status === "ok" && (
                  <p
                    className="text-cg-n-700 text-[11px] mt-1 tabular-nums"
                    title={[
                      `UPS ${freight.estimate.serviceName}  ·  ${freight.estimate.isNegotiated ? "negotiated rate" : "list rate"}`,
                      `From: ${freight.fromZip}  →  To: ${freight.toZip}`,
                      `Quantity: ${freight.totalQty.toLocaleString()} pieces`,
                      `Weight: ${freight.totalQty.toLocaleString()} × ${freight.perPieceWeightLbs} lb/piece = ${freight.totalWeightLbs} lbs total`,
                      `Packages: ${freight.estimate.packages} (≤70 lb each, 24×16×16 in default)`,
                      freight.estimate.transitDays != null
                        ? `Transit: ${freight.estimate.transitDays} business day${freight.estimate.transitDays === 1 ? "" : "s"}`
                        : "Transit: not returned",
                      `Total: ${freight.estimate.totalCharge.toLocaleString("en-US", { style: "currency", currency: freight.estimate.currency })}`,
                      "",
                      "Per-piece weight is a 0.5 lb default; refine when SKU weights are wired in.",
                    ].join("\n")}
                  >
                    Estimated freight:{" "}
                    <span className="font-semibold">
                      {freight.estimate.totalCharge.toLocaleString("en-US", {
                        style: "currency",
                        currency: freight.estimate.currency,
                      })}
                    </span>{" "}
                    {freight.estimate.serviceName}
                    {freight.estimate.transitDays != null
                      ? ` · ~${freight.estimate.transitDays}-day transit`
                      : ""}
                    {" · "}
                    {freight.totalWeightLbs} lbs
                    {" · "}
                    <span className="text-cg-n-500">hover for details</span>
                  </p>
                )}
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
