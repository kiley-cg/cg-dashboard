import Link from "next/link";
import { getOrder } from "@/lib/syncore/orders";
import { lookupInventory } from "@/lib/vendors/registry";
import { LineItemRow } from "@/components/LineItemRow";
import { Badge } from "@/components/Badge";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function OrderPage({ params }: Props) {
  const { id } = await params;

  let order;
  try {
    order = await getOrder(id);
  } catch (err) {
    return (
      <section className="max-w-6xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-cg-n-500 hover:text-cg-n-900 text-sm"
        >
          ← Back
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight mt-4">
          Order {id}
        </h1>
        <p className="text-cg-danger mt-4">
          Could not load order:{" "}
          {err instanceof Error ? err.message : "unknown error"}
        </p>
      </section>
    );
  }

  const lookups = await Promise.all(
    order.lines.map((line) => lookupInventory(line)),
  );

  return (
    <section className="max-w-6xl mx-auto px-6 py-10">
      <Link
        href="/"
        className="text-cg-n-500 hover:text-cg-n-900 text-sm"
      >
        ← Back
      </Link>
      <div className="flex items-baseline justify-between mt-4 mb-8">
        <div>
          <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
            Order
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight mt-1">
            {order.orderNumber}
          </h1>
          {order.customerName && (
            <p className="text-cg-n-600 mt-1">{order.customerName}</p>
          )}
        </div>
        {order.status && <Badge tone="neutral">{order.status}</Badge>}
      </div>

      <div className="bg-white border border-cg-n-200 rounded-card overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-cg-n-50 border-b border-cg-n-200">
            <tr className="text-cg-n-500 text-xs uppercase tracking-wider">
              <th className="py-3 px-4 font-semibold">Product</th>
              <th className="py-3 px-4 font-semibold">Color / Size</th>
              <th className="py-3 px-4 text-right font-semibold">Ordered</th>
              <th className="py-3 px-4 text-right font-semibold">Available</th>
              <th className="py-3 px-4 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {order.lines.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-8 px-4 text-center text-cg-n-500 text-sm"
                >
                  No line items on this order.
                </td>
              </tr>
            )}
            {order.lines.map((line, i) => (
              <LineItemRow
                key={line.id}
                orderId={order.id}
                line={line}
                lookup={lookups[i]}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
