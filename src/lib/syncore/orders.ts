import { syncoreFetch } from "./client";
import { SyncoreOrderSchema, type SyncoreOrder } from "./types";

export async function getOrder(orderNumber: string): Promise<SyncoreOrder> {
  // Endpoint path is provisional; confirm against docs.syncore.app.
  // If the API uses order id vs order number, adjust here only.
  const raw = await syncoreFetch<unknown>(
    `/orders/${encodeURIComponent(orderNumber)}`,
  );
  return SyncoreOrderSchema.parse(raw);
}

export type VerifyWriteback = {
  orderId: string;
  lineId: string;
  verifiedByEmail: string;
  qtyConfirmed: number;
  note?: string;
};

export async function writeVerification(v: VerifyWriteback): Promise<void> {
  // Provisional: Syncore may expose a dedicated /orders/{id}/lines/{lineId}
  // endpoint, a custom-field PATCH, or an order-note append. Centralized here
  // so the real shape is one change once confirmed.
  await syncoreFetch<void>(
    `/orders/${encodeURIComponent(v.orderId)}/lines/${encodeURIComponent(v.lineId)}`,
    {
      method: "PATCH",
      body: {
        status: "verified",
        verifiedBy: v.verifiedByEmail,
        qtyConfirmed: v.qtyConfirmed,
        note: v.note,
      },
    },
  );
}
