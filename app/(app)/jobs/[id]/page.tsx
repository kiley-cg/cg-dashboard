import Link from "next/link";
import { auth } from "@/lib/auth";
import { getJobBundle, flattenLines } from "@/lib/syncore/orders";
import { lookupInventory } from "@/lib/vendors/registry";
import {
  autoVerifyClean,
  findVerificationsForJob,
} from "@/lib/db/verifications";
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
  let verifiedKeys: Set<string> = new Set();
  if (userId) {
    const existing = await findVerificationsForJob(id);
    verifiedKeys = await autoVerifyClean({
      jobId: id,
      userId,
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

        {enriched.map(({ salesOrder: so, rows }) => (
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
                  <th className="py-3 px-4 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
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
                      preVerified={verifiedKeys.has(key)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
