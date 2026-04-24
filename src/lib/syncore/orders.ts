import { syncoreFetch } from "./client";
import {
  SyncoreJobSchema,
  SyncoreLineItemSchema,
  SyncoreSalesOrderSchema,
  type FlatLineItem,
  type SyncoreJob,
  type SyncoreLineItem,
  type SyncoreSalesOrder,
} from "./types";
import { z } from "zod";

// Per docs: nested line items live under the "saleseorders" segment
// (spelling copied verbatim from the Syncore V2 docs — if that's an
// upstream typo they later fix, this one constant is the fix.)
const SALES_ORDERS_SEGMENT = "saleseorders";

export async function getJob(jobId: string | number): Promise<SyncoreJob> {
  const raw = await syncoreFetch<unknown>(
    `/v2/orders/jobs/${encodeURIComponent(String(jobId))}`,
  );
  return SyncoreJobSchema.parse(raw);
}

export async function listSalesOrders(
  jobId: string | number,
): Promise<SyncoreSalesOrder[]> {
  // Endpoint path provisional until the Sales Orders docs page is confirmed.
  // Once confirmed, this is the one place to adjust.
  const raw = await syncoreFetch<unknown>(
    `/v2/orders/jobs/${encodeURIComponent(String(jobId))}/${SALES_ORDERS_SEGMENT}`,
  );
  return z.array(SyncoreSalesOrderSchema).parse(raw);
}

export async function listLineItems(
  jobId: string | number,
  salesOrderId: string | number,
): Promise<SyncoreLineItem[]> {
  const raw = await syncoreFetch<unknown>(
    `/v2/orders/jobs/${encodeURIComponent(String(jobId))}` +
      `/${SALES_ORDERS_SEGMENT}/${encodeURIComponent(String(salesOrderId))}/lineitems`,
  );
  return z.array(SyncoreLineItemSchema).parse(raw);
}

/**
 * Composite fetch for the rep view: job + all sales orders + all line items.
 */
export async function getJobBundle(jobId: string | number): Promise<{
  job: SyncoreJob;
  salesOrders: Array<{
    salesOrder: SyncoreSalesOrder;
    lineItems: SyncoreLineItem[];
  }>;
}> {
  const job = await getJob(jobId);
  const salesOrders = await listSalesOrders(jobId);
  const withItems = await Promise.all(
    salesOrders.map(async (so) => ({
      salesOrder: so,
      lineItems: await listLineItems(jobId, so.id),
    })),
  );
  return { job, salesOrders: withItems };
}

/**
 * Flatten the Color → Size hierarchy into one FlatLineItem per stock-keeping
 * size line. Color parent carries the product_id; Size children carry the
 * quantities. Other line-item types (Comment, Decoration*, etc.) are ignored
 * for inventory purposes.
 */
export function flattenLines(lines: SyncoreLineItem[]): FlatLineItem[] {
  const byId = new Map<number, SyncoreLineItem>();
  for (const l of lines) byId.set(l.line_id, l);

  const flat: FlatLineItem[] = [];
  for (const line of lines) {
    if (line.type !== "Size") continue;
    const parent = byId.get(line.parent_id);
    if (!parent || parent.type !== "Color") continue;

    const productId = parent.product_id;
    if (productId == null) continue;

    flat.push({
      colorLineId: parent.line_id,
      sizeLineId: line.line_id,
      productId: String(productId),
      color: parent.description ?? null,
      size: line.description ?? null,
      qtyOrdered: line.quantity ?? 0,
      sku: line.sku ?? parent.sku ?? null,
      supplierId: parent.supplier?.id ?? line.supplier?.id ?? null,
      supplierName: parent.supplier?.name ?? line.supplier?.name ?? null,
    });
  }
  return flat;
}
