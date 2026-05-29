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
 * Captured from a real HAR of Kiley clicking Approve in Syncore's web UI
 * (May 2026, job 32432 / PO 68126). The Approve button fires TWO calls:
 *
 *   1. POST /api/jobs/{jobId}/purchaseorders/{poId}/supplier-invoices
 *      { supplierInvoiceNumber }
 *      — Creates the supplier-invoice record AND returns
 *      isSupplierInvoiceNumberDuplicated. In the UI, true triggers a
 *      "Keep Duplicate #" confirmation dialog; the user can override.
 *      Does NOT itself transition the PO status.
 *
 *   2. PATCH /api/jobs/{jobId}/purchaseorders/{poId}
 *      { field: 21, value: JSON.stringify({
 *          supplierInvoiceDate, supplierInvoiceNumber,
 *          approvalComments: "", statusId: 7,
 *        }) }
 *      — statusId 7 = Posted Manually. THIS is the call that actually
 *      transitions the PO.
 *
 * The v2 REST PATCH /status/postedmanually returns 404 in our tenant
 * (probe #46) and the v2 PUT path is stuck in approval_date /
 * posting_date catch-22s (#47-#53). The v1 field:21 PATCH sidesteps
 * all of it because that's the path the web UI itself uses.
 *
 * Prior to this two-call implementation, we were only doing call #1.
 * Every "close" we performed silently created an invoice record
 * without ever flipping the PO status — which is why 5 POs we
 * "closed" through the dashboard remained Open in Syncore. PRs
 * #169-172 chased the dup flag thinking that was the blocker; it
 * wasn't. The PO mirror cron now picks up the real status because
 * field:21 is the canonical transition.
 *
 * For in-house decoration the signed-in user's name (suffixed with the
 * job/PO label for uniqueness) stands in for the (non-existent)
 * supplier invoice number, so AP reports show who closed what.
 *
 * Returns the response body of the field:21 PATCH (the updated PO).
 */
export async function postPurchaseOrderManually(
  jobId: string | number,
  poId: string | number,
  opts: {
    invoiceNumber?: string;
    invoiceDate?: string; // YYYY-MM-DD
  } = {},
): Promise<unknown> {
  const invoiceNumber = opts.invoiceNumber ?? "In-house production";
  const invoiceDate =
    opts.invoiceDate ??
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
    }).format(new Date());

  const poPath =
    `/api/jobs/${encodeURIComponent(String(jobId))}` +
    `/purchaseorders/${encodeURIComponent(String(poId))}`;

  // Call 1: create the supplier-invoice record (mirrors what the UI's
  // Approve flow does pre-PATCH). We don't act on the duplicate flag —
  // unlike the UI we have no human to prompt, and the field:21 PATCH
  // below proceeds regardless (the UI's "Keep Duplicate #" override
  // does the same). Wrapped in try so a transient AP-side hiccup
  // doesn't block the actual status transition.
  try {
    await webuiFetch(`${poPath}/supplier-invoices`, {
      method: "POST",
      body: { supplierInvoiceNumber: invoiceNumber },
    });
  } catch {
    // Best-effort. The status transition below is what matters.
  }

  // Call 2: the actual approve/post. field 21 is Syncore's "approve"
  // compound field — its value is a JSON-encoded string with all the
  // approval fields. statusId 7 = Posted Manually.
  const approvalPayload = JSON.stringify({
    supplierInvoiceDate: invoiceDate,
    supplierInvoiceNumber: invoiceNumber,
    approvalComments: "",
    statusId: 7,
  });
  return await webuiFetch(poPath, {
    method: "PATCH",
    body: { field: 21, value: approvalPayload },
  });
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
