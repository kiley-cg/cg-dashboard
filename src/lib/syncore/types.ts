import { z } from "zod";

// Syncore V2 API types.
// Source of truth: https://docs.syncore.app/docs/syncore/
// Structure: Job → Sales Orders (line_items embedded inline per response sample).
//
// Defensive posture: every optional-looking field is `.nullish()` so that
// both missing properties and explicit `null` values deserialize cleanly.
// The API's sample responses show both forms depending on the tenant state.

export const SyncoreAddressSchema = z
  .object({
    business_name: z.string().nullish(),
    name: z.string().nullish(),
    address1: z.string().nullish(),
    address2: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    zip: z.string().nullish(),
    country: z.string().nullish(),
  })
  .partial();
export type SyncoreAddress = z.infer<typeof SyncoreAddressSchema>;

export const SyncoreClientRefSchema = z.object({
  id: z.number(),
  business_name: z.string().nullish(),
  name: z.string().nullish(),
  email: z.string().nullish(),
});
export type SyncoreClientRef = z.infer<typeof SyncoreClientRefSchema>;

export const SyncoreSupplierRefSchema = z.object({
  id: z.number(),
  name: z.string().nullish(),
  type: z.string().nullish(),
  class: z.string().nullish(),
  asi_id: z.union([z.number(), z.string()]).nullish(),
});
export type SyncoreSupplierRef = z.infer<typeof SyncoreSupplierRefSchema>;

// Documented types per the Syncore docs, plus "Asi" which appears on lines
// added via the ASI product-search flow (SKU + supplier live there).
export const SyncoreLineItemTypeSchema = z.enum([
  "Comment",
  "Asi",
  "Pricing",
  "Color",
  "Size",
  "ProductComment",
  "DecorationMethod",
  "SetupCharge",
  "RunCharge",
  "DecorationLocation",
  "DecorationSize",
  "DesignName",
  "StitchCount",
  "DecorationColor",
  "DecorationVendor",
  "ColorAtImprint",
  "DecorationComment",
]);
export type SyncoreLineItemType = z.infer<typeof SyncoreLineItemTypeSchema>;

export const SyncoreLineItemSchema = z.object({
  line_id: z.number(),
  parent_id: z.number().default(0),
  description: z.string().nullish(),
  product_id: z.number().nullish(),
  quantity: z.number().default(0),
  taxability: z.string().nullish(),
  sku: z.string().nullish(),
  price_value: z.number().nullish(),
  cost_value: z.number().nullish(),
  line_total_value: z.number().nullish(),
  supplier: SyncoreSupplierRefSchema.nullish(),
  type: SyncoreLineItemTypeSchema.or(z.string()),
  visible: z.union([z.boolean(), z.string()]).nullish(),
  from_stock: z.boolean().nullish(),
});
export type SyncoreLineItem = z.infer<typeof SyncoreLineItemSchema>;

export const SyncoreSalesOrderStatusSchema = z.enum([
  "Pending",
  "Open",
  "Invoiced",
  "Paid",
]);
export type SyncoreSalesOrderStatus = z.infer<
  typeof SyncoreSalesOrderStatusSchema
>;

export const SyncoreSalesOrderSchema = z
  .object({
    id: z.number(),
    number: z.number().nullish(),
    job_number: z.number().nullish(),
    date: z.string().nullish(),
    status: SyncoreSalesOrderStatusSchema.or(z.string()).nullish(),
    client: SyncoreClientRefSchema.nullish(),
    sold_to: SyncoreAddressSchema.nullish(),
    bill_to: SyncoreAddressSchema.nullish(),
    ship_to: SyncoreAddressSchema.nullish(),
    line_items: z.array(SyncoreLineItemSchema).default([]),
    customer_order_number: z.string().nullish(),
    customer_instructions: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();
export type SyncoreSalesOrder = z.infer<typeof SyncoreSalesOrderSchema>;

export const SyncoreSalesOrdersListSchema = z.object({
  salesorders: z.array(SyncoreSalesOrderSchema),
  total_results: z.number().nullish(),
  links: z
    .object({
      prev: z.string().nullish(),
      self: z.string().nullish(),
      next: z.string().nullish(),
    })
    .partial()
    .nullish(),
});
export type SyncoreSalesOrdersList = z.infer<
  typeof SyncoreSalesOrdersListSchema
>;

// PO summary as embedded inside Job responses (Job.purchase_orders[]).
// Sufficient to fan out to per-PO detail fetches; line items live on the
// detail endpoint.
export const SyncorePurchaseOrderSummarySchema = z
  .object({
    id: z.number(),
    number: z.number().nullish(),
    status: z.string().nullish(),
    sub_total_value: z.number().nullish(),
    tax_value: z.number().nullish(),
    total_value: z.number().nullish(),
    supplier: SyncoreSupplierRefSchema.nullish(),
  })
  .passthrough();
export type SyncorePurchaseOrderSummary = z.infer<
  typeof SyncorePurchaseOrderSummarySchema
>;

export const SyncoreJobSchema = z
  .object({
    id: z.number(),
    store: z
      .object({ id: z.number(), name: z.string().nullish() })
      .nullish(),
    job_class: z.string().nullish(),
    status: z.string().nullish(),
    date: z.string().nullish(),
    estimated_delivery_date: z.string().nullish(),
    description: z.string().nullish(),
    job_type: z.string().nullish(),
    priority: z.string().nullish(),
    product_index: z
      .object({ id: z.number(), name: z.string().nullish() })
      .nullish(),
    client: SyncoreClientRefSchema.nullish(),
    // Per the v2 docs, Job responses embed shallow summaries of both sales
    // orders and purchase orders. We rely on `purchase_orders[]` to discover
    // which POs need a full fetch.
    purchase_orders: z.array(SyncorePurchaseOrderSummarySchema).default([]),
  })
  .passthrough();
export type SyncoreJob = z.infer<typeof SyncoreJobSchema>;

// Full PO from GET /v2/orders/jobs/{job_id}/purchaseorders/{po_id}.
// Loose passthrough — the docs list a lot of fields we don't surface today
// (invoice details, payments, taxes); keep the raw payload in the mirror so
// new fields are accessible without touching this schema.
export const SyncorePurchaseOrderSchema = z
  .object({
    id: z.number(),
    number: z.number().nullish(),
    job_number: z.number().nullish(),
    date: z.string().nullish(),
    status: z.string().nullish(),
    supplier: SyncoreSupplierRefSchema.nullish(),
    supplier_address: SyncoreAddressSchema.nullish(),
    ship_to: SyncoreAddressSchema.nullish(),
    critical_comments: z.string().nullish(),
    in_hand_date: z.string().nullish(),
    ship_via: z.string().nullish(),
    fob: z.string().nullish(),
    repeat_order_number: z.string().nullish(),
    shipping_and_instructions: z.string().nullish(),
    decoration_instructions: z.string().nullish(),
    csr_instructions_from_so: z.string().nullish(),
    line_items: z.array(SyncoreLineItemSchema).default([]),
  })
  .passthrough();
export type SyncorePurchaseOrder = z.infer<typeof SyncorePurchaseOrderSchema>;

// GET /v2/orders/jobs/{job_id}/purchaseorders returns a wrapper envelope
// mirroring salesorders: `{ purchaseorders: [...], total_results, links }`.
// Not a raw array — that mistake was the silent root cause of the cron
// reporting 2333/2333 "404"s in the first probe pass (Zod was actually
// rejecting the response shape, and the SyncoreError message hid it).
export const SyncorePurchaseOrdersListSchema = z.object({
  purchaseorders: z.array(SyncorePurchaseOrderSchema),
  total_results: z.number().nullish(),
  links: z
    .object({
      prev: z.string().nullish(),
      self: z.string().nullish(),
      next: z.string().nullish(),
    })
    .partial()
    .nullish(),
});
export type SyncorePurchaseOrdersList = z.infer<
  typeof SyncorePurchaseOrdersListSchema
>;

// GET /v2/orders/jobs?date_from=&date_to= returns paginated jobs in the
// same envelope shape (jobs / total_results / links). Required for the
// production-PO mirror's job discovery — replaces the followup-rows seed.
export const SyncoreJobsListSchema = z.object({
  jobs: z.array(SyncoreJobSchema),
  total_results: z.number().nullish(),
  links: z
    .object({
      prev: z.string().nullish(),
      self: z.string().nullish(),
      next: z.string().nullish(),
    })
    .partial()
    .nullish(),
});
export type SyncoreJobsList = z.infer<typeof SyncoreJobsListSchema>;

// Quote schema — Syncore docs don't formally document this endpoint yet,
// so the shape is intentionally loose (passthrough). We expect at minimum
// id, status, client, and either line_items inline or a related endpoint
// to resolve them.
export const SyncoreQuoteSchema = z
  .object({
    id: z.number(),
    quote_number: z.union([z.number(), z.string()]).nullish(),
    number: z.union([z.number(), z.string()]).nullish(),
    status: z.string().nullish(),
    date: z.string().nullish(),
    description: z.string().nullish(),
    client: SyncoreClientRefSchema.nullish(),
    line_items: z.array(SyncoreLineItemSchema).default([]),
    customer_order_number: z.string().nullish(),
    customer_instructions: z.string().nullish(),
  })
  .passthrough();
export type SyncoreQuote = z.infer<typeof SyncoreQuoteSchema>;

// Denormalized row for inventory lookup — one per (product, color, size, qty).
// productId (style number) may be null when the source line has no SKU and
// only a placeholder product_id of 0; we still surface the row so the rep
// can see what's on the order, but skip the vendor call.
export type FlatLineItem = {
  colorLineId: number;
  sizeLineId: number;
  productId: string | null;
  color: string | null;
  size: string | null;
  qtyOrdered: number;
  sku: string | null;
  supplierId: number | null;
  supplierName: string | null;
  // Description of the product line that supplied the SKU (auto-filled in
  // Syncore from the vendor's product wizard, e.g. "Richardson 220
  // Relaxed Performance Lite Cap"). Used to disambiguate vendor lookups
  // when a style number is shared across multiple products (S&S allows
  // this; e.g. style 220 → Richardson cap, SoftShirts tee, Paragon hoodie).
  productDescription: string | null;
};
