import Link from "next/link";
import { getOrder } from "@/lib/syncore/orders";
import { lookupInventory } from "@/lib/vendors/registry";
import { LineItemRow } from "@/components/LineItemRow";

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
      <section className="max-w-5xl mx-auto px-6 py-16">
        <Link href="/" className="text-cg-muted hover:text-cg-text text-sm">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold mt-4">Order {id}</h1>
        <p className="text-cg-red mt-4">
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
    <section className="max-w-5xl mx-auto px-6 py-10">
      <Link href="/" className="text-cg-muted hover:text-cg-text text-sm">
        ← Back
      </Link>
      <div className="flex items-baseline justify-between mt-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold">Order {order.orderNumber}</h1>
          {order.customerName && (
            <p className="text-cg-muted mt-1">{order.customerName}</p>
          )}
        </div>
        {order.status && (
          <span className="text-cg-muted text-sm uppercase tracking-wide">
            {order.status}
          </span>
        )}
      </div>

      <div className="bg-cg-surface border border-cg-border rounded-card overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-cg-bg">
            <tr className="text-cg-muted text-xs uppercase tracking-wider">
              <th className="py-3 px-4">Product</th>
              <th className="py-3 px-4">Color / Size</th>
              <th className="py-3 px-4 text-right">Ordered</th>
              <th className="py-3 px-4 text-right">Available</th>
              <th className="py-3 px-4 text-right"></th>
            </tr>
          </thead>
          <tbody className="px-4">
            {order.lines.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-8 px-4 text-center text-cg-muted text-sm"
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
