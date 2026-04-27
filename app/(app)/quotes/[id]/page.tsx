import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  getQuote,
  listQuoteLineItems,
  flattenLines,
} from "@/lib/syncore/orders";
import { lookupInventory } from "@/lib/vendors/registry";
import { LineItemRow } from "@/components/LineItemRow";
import { Badge } from "@/components/Badge";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function QuotePage({ params }: Props) {
  const { id } = await params;
  const session = await auth();

  let quote;
  let lineItems;
  try {
    quote = await getQuote(id);
    // Quotes might or might not embed line_items inline. If empty, try the
    // separate endpoint as a fallback.
    lineItems =
      quote.line_items.length > 0
        ? quote.line_items
        : await listQuoteLineItems(id).catch(() => []);
  } catch (err) {
    return (
      <section className="max-w-6xl mx-auto px-6 py-16">
        <Link href="/" className="text-cg-n-500 hover:text-cg-n-900 text-sm">
          ← Back
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight mt-4">
          Quote {id}
        </h1>
        <p className="text-cg-danger mt-4">
          Could not load quote:{" "}
          {err instanceof Error ? err.message : "unknown error"}
        </p>
        <p className="text-cg-n-500 text-sm mt-3">
          The Syncore quotes endpoint isn&apos;t formally documented yet — if
          this 404s every time, the path or auth scheme may be different from
          jobs. Tell me the error and we&apos;ll adjust.
        </p>
      </section>
    );
  }

  const flat = flattenLines(lineItems);
  const lookups = await Promise.all(flat.map((line) => lookupInventory(line)));
  const userEmail = session?.user?.email ?? null;
  const userName = session?.user?.name ?? null;

  return (
    <section className="max-w-6xl mx-auto px-6 py-10">
      <Link href="/" className="text-cg-n-500 hover:text-cg-n-900 text-sm">
        ← Back
      </Link>

      <div className="flex items-baseline justify-between mt-4 mb-8">
        <div>
          <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
            Quote
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight mt-1">
            #{quote.quote_number ?? quote.number ?? quote.id}
          </h1>
          {quote.description && (
            <p className="text-cg-n-700 mt-1">{quote.description}</p>
          )}
          {quote.client?.business_name && (
            <p className="text-cg-n-500 text-sm mt-1">
              {quote.client.business_name}
              {quote.client.name ? ` · ${quote.client.name}` : ""}
            </p>
          )}
        </div>
        {quote.status && <Badge tone="neutral">{quote.status}</Badge>}
      </div>

      <div className="bg-white border border-cg-n-200 rounded-card overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-cg-n-50 border-b border-cg-n-200">
            <tr className="text-cg-n-500 text-xs uppercase tracking-wider">
              <th className="py-3 px-4 font-semibold">Style</th>
              <th className="py-3 px-4 font-semibold">Color / Size</th>
              <th className="py-3 px-4 text-right font-semibold">Ordered</th>
              <th className="py-3 px-4 text-right font-semibold">Available</th>
              <th className="py-3 px-4 text-right font-semibold">Cost</th>
              <th className="py-3 px-4 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {flat.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="py-8 px-4 text-center text-cg-n-500 text-sm"
                >
                  No orderable color/size lines found on this quote.
                </td>
              </tr>
            )}
            {flat.map((flatLine, i) => (
              <LineItemRow
                key={flatLine.sizeLineId}
                jobId={`quote-${id}`}
                salesOrderId={quote.id}
                line={flatLine}
                lookup={lookups[i]}
                verification={null}
                currentUserEmail={userEmail}
                currentUserName={userName}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
