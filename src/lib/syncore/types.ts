import { z } from "zod";

// Syncore V2 API types.
// Source of truth: https://docs.syncore.app/docs/syncore/
// Structure: Job → Sales Orders (line_items embedded inline per response sample).

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

export const SyncoreClientRefSchema = z
  .object({
    id: z.number(),
    business_name: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .partial({ business_name: true, name: true, email: true });
export type SyncoreClientRef = z.infer<typeof SyncoreClientRefSchema>;

export const SyncoreSupplierRefSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  type: z.string().optional(),
  class: z.string().optional(),
  asi_id: z.union([z.number(), z.string()]).optional(),
});
export type SyncoreSupplierRef = z.infer<typeof SyncoreSupplierRefSchema>;

export const SyncoreLineItemTypeSchema = z.enum([
  "Comment",
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
  description: z.string().optional(),
  product_id: z.number().nullish(),
  quantity: z.number().default(0),
  taxability: z.string().optional(),
  sku: z.string().nullish(),
  price_value: z.number().optional(),
  cost_value: z.number().optional(),
  line_total_value: z.number().optional(),
  supplier: SyncoreSupplierRefSchema.optional(),
  type: SyncoreLineItemTypeSchema.or(z.string()),
  visible: z.union([z.boolean(), z.string()]).optional(),
  from_stock: z.boolean().optional(),
});
export type SyncoreLineItem = z.infer<typeof SyncoreLineItemSchema>;

// Sales Order Status — allowed values per the Syncore V2 docs.
// Note: no "Verified" state exists; v1 verification lives only in our DB.
export const SyncoreSalesOrderStatusSchema = z.enum([
  "Pending",
  "Open",
  "Invoiced",
  "Paid",
]);
export type SyncoreSalesOrderStatus = z.infer<
  typeof SyncoreSalesOrderStatusSchema
>;

// Sales Order — response from GET /v2/orders/jobs/{job_id}/salesorders.
// line_items comes embedded inline per the docs response sample.
export const SyncoreSalesOrderSchema = z
  .object({
    id: z.number(),
    number: z.number().optional(),
    job_number: z.number().optional(),
    date: z.string().optional(),
    // Accept both the documented enum and any future/unknown strings so a
    // new status from Syncore never crashes us.
    status: SyncoreSalesOrderStatusSchema.or(z.string()).optional(),
    client: SyncoreClientRefSchema.optional(),
    sold_to: SyncoreAddressSchema.optional(),
    bill_to: SyncoreAddressSchema.optional(),
    ship_to: SyncoreAddressSchema.optional(),
    line_items: z.array(SyncoreLineItemSchema).default([]),
    customer_order_number: z.string().nullish(),
    customer_instructions: z.string().nullish(),
    description: z.string().optional(),
  })
  .passthrough();
export type SyncoreSalesOrder = z.infer<typeof SyncoreSalesOrderSchema>;

export const SyncoreSalesOrdersListSchema = z.object({
  salesorders: z.array(SyncoreSalesOrderSchema),
  total_results: z.number().optional(),
  links: z
    .object({
      prev: z.string().optional(),
      self: z.string().optional(),
      next: z.string().optional(),
    })
    .partial()
    .optional(),
});
export type SyncoreSalesOrdersList = z.infer<typeof SyncoreSalesOrdersListSchema>;

// Summary shape for the list endpoint — same SO schema but line_items may be
// missing. The passthrough above means the detail endpoint's extra fields
// (totals, payments, etc.) pass through without schema noise.

export const SyncoreJobSchema = z
  .object({
    id: z.number(),
    store: z
      .object({ id: z.number(), name: z.string().optional() })
      .optional(),
    job_class: z.string().optional(),
    status: z.string().optional(),
    date: z.string().optional(),
    estimated_delivery_date: z.string().nullish(),
    description: z.string().optional(),
    job_type: z.string().optional(),
    priority: z.string().optional(),
    product_index: z
      .object({ id: z.number(), name: z.string().optional() })
      .optional(),
    client: SyncoreClientRefSchema.optional(),
  })
  .passthrough();
export type SyncoreJob = z.infer<typeof SyncoreJobSchema>;

// Denormalized row for inventory lookup — one per (product, color, size, qty).
export type FlatLineItem = {
  colorLineId: number;
  sizeLineId: number;
  productId: string;
  color: string | null;
  size: string | null;
  qtyOrdered: number;
  sku: string | null;
  supplierId: number | null;
  supplierName: string | null;
};
