import { syncoreFetch } from "./client";
import {
  SyncoreJobSchema,
  SyncoreLineItemSchema,
  SyncoreQuoteSchema,
  SyncoreSalesOrdersListSchema,
  SyncoreSalesOrderSchema,
  type FlatLineItem,
  type SyncoreJob,
  type SyncoreLineItem,
  type SyncoreQuote,
  type SyncoreSalesOrder,
} from "./types";
import { z } from "zod";

// Syncore's spelling is inconsistent in their docs: the list endpoint uses
// "salesorders" but the line-items path uses "saleseorders" with an extra
// "e". Since line_items are embedded in the list response, we never need
// the typo'd segment — but keeping it here documents the divergence.
const SALES_ORDERS_LIST_SEGMENT = "salesorders";
const SALES_ORDER_NESTED_SEGMENT = "saleseorders";

// Paths are relative to SYNCORE_BASE_URL (https://api.syncore.app/v2).
// `/orders` is the Orders API namespace under v2.

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
    `/orders/jobs/${encodeURIComponent(String(jobId))}/${SALES_ORDERS_LIST_SEGMENT}`,
  );
  return SyncoreSalesOrdersListSchema.parse(raw).salesorders;
}

export async function getSalesOrder(
  jobId: string | number,
  salesOrderId: string | number,
): Promise<SyncoreSalesOrder> {
  const raw = await syncoreFetch<unknown>(
    `/orders/jobs/${encodeURIComponent(String(jobId))}` +
      `/${SALES_ORDERS_LIST_SEGMENT}/${encodeURIComponent(String(salesOrderId))}`,
  );
  return SyncoreSalesOrderSchema.parse(raw);
}

/**
 * Per the docs, line items are also exposed at a separate endpoint — useful
 * if the list-sales-orders response comes back without them embedded. Not
 * used by getJobBundle (line_items ship inline).
 */
export async function listLineItems(
  jobId: string | number,
  salesOrderId: string | number,
): Promise<SyncoreLineItem[]> {
  const raw = await syncoreFetch<unknown>(
    `/orders/jobs/${encodeURIComponent(String(jobId))}` +
      `/${SALES_ORDER_NESTED_SEGMENT}/${encodeURIComponent(String(salesOrderId))}/lineitems`,
  );
  return z.array(SyncoreLineItemSchema).parse(raw);
}

/**
 * Fetch a Job plus every Sales Order beneath it with full line items.
 * The list endpoint embeds line_items inline, so one round-trip per level.
 */
export async function getJobBundle(jobId: string | number): Promise<{
  job: SyncoreJob;
  salesOrders: SyncoreSalesOrder[];
}> {
  const [job, salesOrders] = await Promise.all([
    getJob(jobId),
    listSalesOrders(jobId),
  ]);
  return { job, salesOrders };
}

/**
 * Quote lookup. The endpoint isn't formally in the Syncore docs we have,
 * but the conventional path mirrors jobs: /orders/quotes/{id}. If the
 * actual path differs, this is the one place to adjust.
 */
export async function getQuote(quoteId: string | number): Promise<SyncoreQuote> {
  const raw = await syncoreFetch<unknown>(
    `/orders/quotes/${encodeURIComponent(String(quoteId))}`,
  );
  return SyncoreQuoteSchema.parse(raw);
}

export async function listQuoteLineItems(
  quoteId: string | number,
): Promise<SyncoreLineItem[]> {
  const raw = await syncoreFetch<unknown>(
    `/orders/quotes/${encodeURIComponent(String(quoteId))}/lineitems`,
  );
  return z.array(SyncoreLineItemSchema).parse(raw);
}

/**
 * Flatten the nested line-item tree into one FlatLineItem per stock-keeping
 * Size line. Per the Syncore docs, Size can be a child of Color OR Comment.
 * Walks the parent chain collecting:
 *   - the nearest Color (for color description)
 *   - the nearest ancestor SKU (style number for vendor lookups)
 *   - the nearest ancestor supplier
 *   - any non-zero ancestor product_id (last-resort fallback)
 */
export function flattenLines(lines: SyncoreLineItem[]): FlatLineItem[] {
  const byId = new Map<number, SyncoreLineItem>();
  for (const l of lines) byId.set(l.line_id, l);

  type WalkResult = {
    color: SyncoreLineItem | null;
    sku: string | null;
    supplierId: number | null;
    supplierName: string | null;
    fallbackProductId: number | null;
  };

  function walkUp(startId: number): WalkResult {
    const out: WalkResult = {
      color: null,
      sku: null,
      supplierId: null,
      supplierName: null,
      fallbackProductId: null,
    };
    let cursor = byId.get(startId);
    const seen = new Set<number>();
    while (cursor && !seen.has(cursor.line_id)) {
      seen.add(cursor.line_id);
      if (!out.color && cursor.type === "Color") out.color = cursor;
      if (!out.sku && cursor.sku) out.sku = cursor.sku;
      if (!out.supplierId && cursor.supplier?.id != null) {
        out.supplierId = cursor.supplier.id;
      }
      if (!out.supplierName && cursor.supplier?.name) {
        out.supplierName = cursor.supplier.name;
      }
      if (
        out.fallbackProductId == null &&
        cursor.product_id != null &&
        cursor.product_id !== 0
      ) {
        out.fallbackProductId = cursor.product_id;
      }
      if (!cursor.parent_id) break;
      cursor = byId.get(cursor.parent_id);
    }
    return out;
  }

  const flat: FlatLineItem[] = [];
  for (const line of lines) {
    if (line.type !== "Size") continue;
    const ctx = walkUp(line.parent_id);

    // SanMar PromoStandards keys on style number (= SKU). Syncore's
    // product_id is internal-only and useless to vendors. styleNumber may
    // be null if the rep typed the line without going through ASI/TSC
    // search — we still emit the row so they can see what's there.
    //
    // Use logical-OR (not ??) so empty strings fall through. The Color
    // and Size lines come back with sku="" rather than null in real data.
    const sku =
      (line.sku && line.sku.trim()) || (ctx.sku && ctx.sku.trim()) || null;

    flat.push({
      colorLineId: ctx.color?.line_id ?? line.parent_id,
      sizeLineId: line.line_id,
      productId: sku, // style number for vendor lookup; null when unavailable
      color: ctx.color?.description ?? null,
      size: line.description ?? null,
      qtyOrdered: line.quantity ?? 0,
      sku,
      supplierId: line.supplier?.id ?? ctx.supplierId,
      supplierName: line.supplier?.name ?? ctx.supplierName,
    });
  }
  return flat;
}
