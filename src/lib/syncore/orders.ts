import { syncoreFetch } from "./client";
import { webuiFetch } from "./webui";
import {
  SyncoreJobSchema,
  SyncoreJobsListSchema,
  SyncoreLineItemSchema,
  SyncorePurchaseOrderSchema,
  SyncorePurchaseOrdersListSchema,
  SyncoreQuoteSchema,
  SyncoreSalesOrdersListSchema,
  SyncoreSalesOrderSchema,
  SyncoreSupplierRefSchema,
  type FlatLineItem,
  type SyncoreJob,
  type SyncoreLineItem,
  type SyncorePurchaseOrder,
  type SyncoreQuote,
  type SyncoreSalesOrder,
  type SyncoreSupplierRef,
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

export interface ListJobsOpts {
  // Both dates are REQUIRED by Syncore (400 otherwise). Pacific YYYY-MM-DD.
  dateFrom: string;
  dateTo: string;
  // Optional status filter. Documented values include "WIP", "Pending",
  // "Submitted", "Closed". "Open" is rejected as a valid status — only
  // certain ones are accepted; pass what Syncore's UI exposes.
  status?: string;
  page?: number;
  // Default page size when omitted is 25; bumping reduces round-trips.
  count?: number;
}

/**
 * One page of GET /v2/orders/jobs. Returns the inner `jobs` array.
 */
export async function listJobs(opts: ListJobsOpts): Promise<SyncoreJob[]> {
  const raw = await syncoreFetch<unknown>(`/orders/jobs`, {
    searchParams: {
      date_from: opts.dateFrom,
      date_to: opts.dateTo,
      status: opts.status,
      page: opts.page,
      count: opts.count,
    },
  });
  return SyncoreJobsListSchema.parse(raw).jobs;
}

/**
 * Paginate through GET /v2/orders/jobs until the API stops returning
 * full pages. Returns every job in the window matching the (optional)
 * status filter.
 *
 * Bounded by `maxPages` so a runaway response can't burn the cron budget.
 */
export async function listAllJobs(
  opts: ListJobsOpts & { maxPages?: number },
): Promise<SyncoreJob[]> {
  // 25 = Syncore's default. Bigger counts (100) make the API return 400,
  // probably hitting an undocumented page-size cap.
  const count = opts.count ?? 25;
  const maxPages = opts.maxPages ?? 50;
  const out: SyncoreJob[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await listJobs({ ...opts, page, count });
    out.push(...batch);
    if (batch.length < count) break;
  }
  return out;
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

// ---------------------------------------------------------------------------
// Purchase orders & suppliers — used by the Production dashboard's PO mirror.
// ---------------------------------------------------------------------------

export async function listSuppliers(): Promise<SyncoreSupplierRef[]> {
  const raw = await syncoreFetch<unknown>(`/orders/suppliers`);
  return z.array(SyncoreSupplierRefSchema).parse(raw);
}

export async function listPurchaseOrders(
  jobId: string | number,
): Promise<SyncorePurchaseOrder[]> {
  const raw = await syncoreFetch<unknown>(
    `/orders/jobs/${encodeURIComponent(String(jobId))}/purchaseorders`,
  );
  // Wrapped envelope: { purchaseorders: [...], total_results, links }.
  return SyncorePurchaseOrdersListSchema.parse(raw).purchaseorders;
}

export async function getPurchaseOrder(
  jobId: string | number,
  poId: string | number,
): Promise<SyncorePurchaseOrder> {
  const raw = await syncoreFetch<unknown>(
    `/orders/jobs/${encodeURIComponent(String(jobId))}` +
      `/purchaseorders/${encodeURIComponent(String(poId))}`,
  );
  return SyncorePurchaseOrderSchema.parse(raw);
}

/**
 * Drive an in-house decoration PO to "Posted Manually" via the v1 web UI.
 *
 * Syncore's v2 REST API does not actually support this transition for
 * in-house decoration POs:
 *   - PATCH /v2/.../status/postedmanually returns 404 for every spelling
 *     we tried (probe #46).
 *   - PUT /v2/.../purchaseorders/{poId} with status="Posted Manually" or
 *     status="Approved" plus the full body either silently no-ops or
 *     gets stuck on docs-vs-validation catch-22s about approval_date /
 *     posting_date (#47-#53).
 *
 * What the Syncore web UI actually does — captured from devtools when
 * Kiley clicked Approve on an Open PO:
 *
 *   POST https://www.ateasesystems.net/api/jobs/{jobId}/purchaseorders/{poId}/supplier-invoices
 *   { "supplierInvoiceNumber": "Kiley Gustafson" }
 *
 * Cookie session auth (the same v1 session we already use for
 * follow-ups). The v1 server handles the whole Approve → Posted
 * Manually auto-transition internally on that one POST. No dates —
 * Syncore stamps those itself.
 *
 * For in-house decoration the signed-in user's name stands in for the
 * (non-existent) supplier invoice number, so AP reports show the audit
 * footprint of who closed what.
 */
export async function postPurchaseOrderManually(
  jobId: string | number,
  poId: string | number,
  opts: {
    invoiceNumber?: string;
  } = {},
): Promise<unknown> {
  // Capture the response body so closeSyncorePo can log it. Several
  // observed cases of /supplier-invoices returning 200 but the PO
  // status staying Open/Approved in Syncore — without the body it's
  // impossible to tell whether Syncore queued a job, rejected silently,
  // or actually flipped the status.
  const result = await webuiFetch(
    `/api/jobs/${encodeURIComponent(String(jobId))}` +
      `/purchaseorders/${encodeURIComponent(String(poId))}` +
      `/supplier-invoices`,
    {
      method: "POST",
      body: {
        supplierInvoiceNumber: opts.invoiceNumber ?? "In-house production",
      },
    },
  );
  return result;
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
    productDescription: string | null;
    supplierId: number | null;
    supplierName: string | null;
    fallbackProductId: number | null;
  };

  function walkUp(startId: number): WalkResult {
    const out: WalkResult = {
      color: null,
      sku: null,
      productDescription: null,
      supplierId: null,
      supplierName: null,
      fallbackProductId: null,
    };
    let cursor = byId.get(startId);
    const seen = new Set<number>();
    while (cursor && !seen.has(cursor.line_id)) {
      seen.add(cursor.line_id);
      if (!out.color && cursor.type === "Color") out.color = cursor;
      // The product-level line (Asi for product-wizard entries) carries
      // both the SKU and the auto-filled product description — capture
      // them together so they refer to the same line.
      if (!out.sku && cursor.sku) {
        out.sku = cursor.sku;
        if (cursor.description) out.productDescription = cursor.description;
      }
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
      productDescription: ctx.productDescription,
    });
  }
  return flat;
}
