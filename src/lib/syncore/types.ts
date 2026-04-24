import { z } from "zod";

// Syncore (Facilisgroup) v2 order shape — defensive schema.
// The real endpoint field names will be confirmed against docs.syncore.app
// on first live call; this schema is permissive where safe.

export const SyncoreLineItemSchema = z.object({
  id: z.coerce.string(),
  sku: z.string().optional(),
  productId: z.coerce.string(),
  productName: z.string().optional(),
  color: z.string().nullish(),
  size: z.string().nullish(),
  qtyOrdered: z.coerce.number().int().nonnegative(),
  vendorCode: z.string().optional(),
  verifiedAt: z.string().nullish(),
});
export type SyncoreLineItem = z.infer<typeof SyncoreLineItemSchema>;

export const SyncoreOrderSchema = z.object({
  id: z.coerce.string(),
  orderNumber: z.coerce.string(),
  status: z.string().optional(),
  customerName: z.string().optional(),
  lines: z.array(SyncoreLineItemSchema).default([]),
});
export type SyncoreOrder = z.infer<typeof SyncoreOrderSchema>;
