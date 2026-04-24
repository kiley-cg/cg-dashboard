import Link from "next/link";
import { getJobBundle, flattenLines } from "@/lib/syncore/orders";
import { lookupInventory } from "@/lib/vendors/registry";
import { LineItemRow } from "@/components/LineItemRow";
import { Badge } from "@/components/Badge";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function JobPage({ params }: Props) {
  const { id } = await params;

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
        {salesOrders.length === 0 && (
          <div className="bg-white border border-cg-n-200 rounded-card p-8 text-center text-cg-n-500 shadow-sm">
            This job has no sales orders yet.
          </div>
        )}

        {await Promise.all(
          salesOrders.map(async ({ salesOrder, lineItems }) => {
            const flat = flattenLines(lineItems);
            const lookups = await Promise.all(
              flat.map((line) => lookupInventory(line)),
            );

            return (
              <div
                key={salesOrder.id}
                className="bg-white border border-cg-n-200 rounded-card overflow-hidden shadow-sm"
              >
                <div className="px-5 py-3 border-b border-cg-n-100 flex items-baseline justify-between">
                  <div>
                    <p className="text-cg-n-500 text-xs uppercase tracking-wider font-semibold">
                      Sales Order
                    </p>
                    <p className="font-bold tracking-tight">
                      #{salesOrder.id}
                      {salesOrder.description
                        ? ` · ${salesOrder.description}`
                        : ""}
                    </p>
                  </div>
                  {salesOrder.status && (
                    <Badge tone="neutral">{salesOrder.status}</Badge>
                  )}
                </div>

                <table className="w-full text-left">
                  <thead className="bg-cg-n-50 border-b border-cg-n-200">
                    <tr className="text-cg-n-500 text-xs uppercase tracking-wider">
                      <th className="py-3 px-4 font-semibold">Product</th>
                      <th className="py-3 px-4 font-semibold">
                        Color / Size
                      </th>
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
                    {flat.length === 0 && (
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
                    {flat.map((line, i) => (
                      <LineItemRow
                        key={line.sizeLineId}
                        jobId={id}
                        salesOrderId={salesOrder.id}
                        line={line}
                        lookup={lookups[i]}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }),
        )}
      </div>
    </section>
  );
}
