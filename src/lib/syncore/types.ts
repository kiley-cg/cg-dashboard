import { z } from "zod";

// Syncore V2 API types.
// Source of truth: https://docs.syncore.app/docs/syncore/
// Structure: Job → Sales Orders → Line Items (nested Color/Size hierarchy).

export const SyncoreSupplierRefSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  type: z.string().optional(),
  class: z.string().optional(),
  asi_id: z.union([z.number(), z.string()]).optional(),
});
export type SyncoreSupplierRef = z.infer<typeof SyncoreSupplierRefSchema>;

// All recognized line item types per the docs.
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
  // "visible" in the docs appears both as boolean and (incorrectly) as a
  // string literal; accept either.
  visible: z.union([z.boolean(), z.string()]).optional(),
  from_stock: z.boolean().optional(),
});
export type SyncoreLineItem = z.infer<typeof SyncoreLineItemSchema>;

export const SyncoreSalesOrderSchema = z.object({
  id: z.number(),
  status: z.string().optional(),
  description: z.string().optional(),
  // Docs page for Sales Orders to be pasted — this schema is intentionally
  // permissive until we see a real response. z.passthrough keeps unknown
  // fields so we don't lose data.
}).passthrough();
export type SyncoreSalesOrder = z.infer<typeof SyncoreSalesOrderSchema>;

export const SyncoreJobStatusSchema = z.enum([
  "Pending",
  "Submitted",
  "WIP",
  "Delivered",
  "Completed",
]);
export type SyncoreJobStatus = z.infer<typeof SyncoreJobStatusSchema>;

export const SyncoreJobSchema = z.object({
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
  client: z
    .object({
      id: z.number(),
      business_name: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
}).passthrough();
export type SyncoreJob = z.infer<typeof SyncoreJobSchema>;

// Denormalized row for inventory lookup — one per (product, color, size, qty).
// Produced by flattening the Color→Size line-item hierarchy.
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
