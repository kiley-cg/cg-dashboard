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
 * Flatten the nested line-item tree into one FlatLineItem per stock-keeping
 * Size line. Per the Syncore docs, Size can be a child of Color OR of Comment
 * directly (for products without color variants). The product_id and
 * supplier come from the nearest ancestor that carries them — usually the
 * Color line when present, otherwise the Comment parent.
 */
export function flattenLines(lines: SyncoreLineItem[]): FlatLineItem[] {
  const byId = new Map<number, SyncoreLineItem>();
  for (const l of lines) byId.set(l.line_id, l);

  function walkUp(
    startId: number,
  ): {
    color: SyncoreLineItem | null;
    productHolder: SyncoreLineItem | null;
  } {
    let color: SyncoreLineItem | null = null;
    let productHolder: SyncoreLineItem | null = null;
    let cursor = byId.get(startId);
    const seen = new Set<number>();
    while (cursor && !seen.has(cursor.line_id)) {
      seen.add(cursor.line_id);
      if (!color && cursor.type === "Color") color = cursor;
      if (!productHolder && cursor.product_id != null) productHolder = cursor;
      if (!cursor.parent_id) break;
      cursor = byId.get(cursor.parent_id);
    }
    return { color, productHolder };
  }

  const flat: FlatLineItem[] = [];
  for (const line of lines) {
    if (line.type !== "Size") continue;
    const { color, productHolder } = walkUp(line.parent_id);
    if (!productHolder || productHolder.product_id == null) continue;

    flat.push({
      colorLineId: color?.line_id ?? productHolder.line_id,
      sizeLineId: line.line_id,
      productId: String(productHolder.product_id),
      color: color?.description ?? null,
      size: line.description ?? null,
      qtyOrdered: line.quantity ?? 0,
      sku: line.sku ?? color?.sku ?? productHolder.sku ?? null,
      supplierId:
        color?.supplier?.id ?? productHolder.supplier?.id ?? line.supplier?.id ?? null,
      supplierName:
        color?.supplier?.name ??
        productHolder.supplier?.name ??
        line.supplier?.name ??
        null,
    });
  }
  return flat;
}
