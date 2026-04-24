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

// Per docs.syncore.app, the sales-order URL segment is spelled "saleseorders"
// verbatim. If that ever gets fixed upstream, this constant is the one place
// to change.
const SALES_ORDERS_SEGMENT = "saleseorders";

// Paths are relative to SYNCORE_BASE_URL, which is https://api.syncore.app/v2
// (version root). `/orders` is the Orders-API namespace under v2.

export async function getJob(jobId: string | number): Promise<SyncoreJob> {
  const raw = await syncoreFetch<unknown>(
    `/orders/jobs/${encodeURIComponent(String(jobId))}`,
  );
  return SyncoreJobSchema.parse(raw);
}

export async function listSalesOrders(
  jobId: string | number,
): Promise<SyncoreSalesOrder[]> {
  const raw = await syncoreFetch<unknown>(
    `/orders/jobs/${encodeURIComponent(String(jobId))}/${SALES_ORDERS_SEGMENT}`,
  );
  return z.array(SyncoreSalesOrderSchema).parse(raw);
}

export async function getSalesOrder(
  jobId: string | number,
  salesOrderId: string | number,
): Promise<SyncoreSalesOrder> {
  const raw = await syncoreFetch<unknown>(
    `/orders/jobs/${encodeURIComponent(String(jobId))}` +
      `/${SALES_ORDERS_SEGMENT}/${encodeURIComponent(String(salesOrderId))}`,
  );
  return SyncoreSalesOrderSchema.parse(raw);
}

/**
 * Per the docs, line items are also exposed at a separate endpoint — useful
 * if the list-sales-orders response comes back without them embedded. Not
 * used by getJobBundle right now.
 */
export async function listLineItems(
  jobId: string | number,
  salesOrderId: string | number,
): Promise<SyncoreLineItem[]> {
  const raw = await syncoreFetch<unknown>(
    `/orders/jobs/${encodeURIComponent(String(jobId))}` +
      `/${SALES_ORDERS_SEGMENT}/${encodeURIComponent(String(salesOrderId))}/lineitems`,
  );
  return z.array(SyncoreLineItemSchema).parse(raw);
}

/**
 * Fetch a Job plus every Sales Order beneath it with full line items.
 * The list endpoint may or may not inline line_items; if it doesn't, we
 * hit the detail endpoint per SO to fill them in.
 */
export async function getJobBundle(jobId: string | number): Promise<{
  job: SyncoreJob;
  salesOrders: SyncoreSalesOrder[];
}> {
  const [job, summaries] = await Promise.all([
    getJob(jobId),
    listSalesOrders(jobId),
  ]);

  const withItems = await Promise.all(
    summaries.map(async (so) =>
      so.line_items.length > 0 ? so : getSalesOrder(jobId, so.id),
    ),
  );

  return { job, salesOrders: withItems };
}

/**
 * Flatten the nested line-item tree into one FlatLineItem per stock-keeping
 * Size line. Per the Syncore docs, Size can be a child of Color OR of Comment
 * directly (for products without color variants). The product_id and supplier
 * come from the nearest ancestor that carries them — usually the Color line
 * when present, otherwise the Comment parent.
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
        color?.supplier?.id ??
        productHolder.supplier?.id ??
        line.supplier?.id ??
        null,
      supplierName:
        color?.supplier?.name ??
        productHolder.supplier?.name ??
        line.supplier?.name ??
        null,
    });
  }
  return flat;
}
