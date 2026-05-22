import { syncoreFetch } from "./client";
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
 * Transition a Purchase Order to "Posted Manually" status. Per the v2 docs
 * this is the canonical status for in-house decoration POs once production
 * is complete — distinct from the AP-posting path used for external
 * supplier invoices.
 *
 * Path/shape history (verified May 2026 against test job 32681):
 *   - The documented PATCH /status/postedmanually returns 404 in our
 *     tenant for every spelling we tried (probe #46).
 *   - PUT to the resource with `{status: "Posted Manually"}` alone
 *     returns 200 but does NOT actually apply the change — the PO
 *     stays Open. Syncore's PUT is replace-the-resource semantics: a
 *     partial body silently no-ops on the missing fields.
 *   - PUT with the full PO body (current ship_to, in_hand_date, etc.
 *     plus the new status) actually persists the transition. That's
 *     what we do here.
 *
 * Caller passes `current` — the existing PO snapshot. The mirror's `raw`
 * jsonb column is the canonical source; closeSyncorePo() reads it from
 * there.
 */
// Syncore's GET on a PO returns `ship_to.name` (combined) and
// `ship_to.country` as a display string (e.g. "United States"). The
// PUT endpoint wants `first_name` + `last_name` (separate) and country
// as ISO 3166-1 alpha-2 ("US"). Round-tripping the GET shape directly
// into the PUT yields a 400 from request_model validation, so we
// normalize on the way out.
function normalizeShipToForPut(
  raw: SyncorePurchaseOrder["ship_to"] | undefined | null,
): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const name = (raw.name ?? "").trim();
  const parts = name ? name.split(/\s+/) : [];
  // Fall back to placeholders if the source has no name — Syncore
  // requires both fields, even if all we care about is the status
  // transition. "—" is unambiguously a placeholder for auditors.
  const first_name = parts[0] || "—";
  const last_name = parts.length > 1 ? parts.slice(1).join(" ") : "—";
  return {
    business_name: raw.business_name ?? undefined,
    first_name,
    last_name,
    address1: raw.address1 ?? undefined,
    address2: raw.address2 ?? undefined,
    city: raw.city ?? undefined,
    state: raw.state ?? undefined,
    zip: raw.zip ?? undefined,
    country: normalizeCountryToIso(raw.country),
  };
}

function normalizeCountryToIso(c: string | null | undefined): string | undefined {
  if (!c) return undefined;
  const trimmed = c.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const lc = trimmed.toLowerCase();
  // Cover what we'll actually see; let anything else through and let
  // Syncore complain if it's not a real code.
  if (lc === "united states" || lc === "united states of america" || lc === "usa") {
    return "US";
  }
  if (lc === "canada") return "CA";
  if (lc === "mexico") return "MX";
  return trimmed;
}

// Shared chassis of the PUT body. All the fields Syncore returns on GET
// minus the read-only ones — passing back what we already had keeps
// replace-the-resource PUT semantics from clobbering anything.
function buildPoPutBody(
  current: SyncorePurchaseOrder,
  status: string,
  invoiceDetails: Record<string, unknown>,
): Record<string, unknown> {
  const rawAny = current as unknown as Record<string, unknown>;
  return {
    ship_to: normalizeShipToForPut(current.ship_to),
    critical_comments: current.critical_comments,
    in_hand_date: current.in_hand_date,
    ship_via: current.ship_via,
    fob: current.fob,
    shipping_and_instructions: current.shipping_and_instructions,
    decoration_instructions: current.decoration_instructions,
    artwork_value:
      typeof rawAny.artwork_value === "number" ? rawAny.artwork_value : 0,
    freight_value:
      typeof rawAny.freight_value === "number" ? rawAny.freight_value : 0,
    freight_taxable:
      typeof rawAny.freight_taxable === "boolean"
        ? rawAny.freight_taxable
        : false,
    tax_1_percentage:
      typeof rawAny.tax_1_percentage === "number"
        ? rawAny.tax_1_percentage
        : 0,
    status,
    invoice_details: invoiceDetails,
  };
}

async function putPurchaseOrder(
  jobId: string | number,
  poId: string | number,
  body: Record<string, unknown>,
): Promise<void> {
  await syncoreFetch<unknown>(
    `/orders/jobs/${encodeURIComponent(String(jobId))}` +
      `/purchaseorders/${encodeURIComponent(String(poId))}`,
    { method: "PUT", body },
  );
}

/**
 * Drive an in-house decoration PO to "Posted Manually" via the documented
 * two-step path:
 *
 *   Open → Approved → Posted Manually
 *
 * Why two steps: Syncore rejects setting `posting_date` on a PO that isn't
 * already in a posted status ("Unable to change posting_date for Purchase
 * Order that is not in Posted @ease AP or Posted Manually status") — but
 * the docs also say `posting_date` is required to enter Posted Manually.
 * The only resolution is to go through Approved first.
 *
 * For in-house decoration POs there's no real supplier invoice, so we
 * stamp the signed-in user's name as the invoice number and today's
 * Pacific date as the invoice/approval/posting date. Visible in AP
 * reports as an audit footprint of who closed what.
 */
export async function postPurchaseOrderManually(
  jobId: string | number,
  poId: string | number,
  current: SyncorePurchaseOrder,
  opts: {
    invoiceNumber?: string;
    invoiceDate?: string; // YYYY-MM-DD
  } = {},
): Promise<void> {
  const date = opts.invoiceDate;
  const invoiceNumber = opts.invoiceNumber;

  // Step 1: Open → Approved. Requires supplier_invoice_number,
  // supplier_invoice_date, approval_date per the docs.
  const approvedInvoice: Record<string, unknown> = {
    supplier_invoice_number: invoiceNumber,
    supplier_invoice_date: date,
    approval_date: date,
  };
  await putPurchaseOrder(
    jobId,
    poId,
    buildPoPutBody(current, "Approved", approvedInvoice),
  );

  // Step 2: Approved → Posted Manually. Now we can set posting_date
  // since the PO is in a posted-eligible state.
  const postedInvoice: Record<string, unknown> = {
    ...approvedInvoice,
    posting_date: date,
  };
  await putPurchaseOrder(
    jobId,
    poId,
    buildPoPutBody(current, "Posted Manually", postedInvoice),
  );
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
