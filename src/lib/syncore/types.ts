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
  })
  .passthrough();
export type SyncoreJob = z.infer<typeof SyncoreJobSchema>;

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
};
