// S&S Activewear tracking lookup.
//
// Per S&S API Developer Guide v2:
// - There is NO per-customer-PO filter at the API level. The /orders
//   endpoint takes optional ?invoiceDate=... or returns ALL open orders.
// - Tracking lives on box-level fields surfaced with ?Boxes=true.
// - Customer PO is on order.poNumber — match client-side.
//
// Strategy: fetch the full open-orders list once per cron sweep (cached
// at module scope with a short TTL), then filter for matching poNumbers
// when our dispatcher calls in for each PO.

import type { OsnShipmentPackage } from "../promostandards/orderShipmentNotification";

const DEFAULT_API_BASE = "https://api.ssactivewear.com/V2";

interface SsTrackingOpts {
  apiBase?: string;
}

interface SsOrder {
  orderNumber?: string;
  invoiceNumber?: string | null;
  poNumber?: string | null;
  shippingCarrier?: string | null;
  shippingMethod?: string | null;
  invoiceDate?: string | null;
  expectedDeliveryDate?: string | null;
  boxes?: SsBox[];
  [key: string]: unknown;
}

interface SsBox {
  trackingNumber?: string | null;
  carrier?: string | null;
  shipDate?: string | null;
  [key: string]: unknown;
}

// In-flight cache for the all-orders list. Sweeps run ~30-45s; a 90s
// TTL means we hit S&S exactly once per cron run, and out-of-band
// probes during testing also reuse the cache without re-fetching.
const ORDERS_TTL_MS = 90_000;
let ordersCache: { fetchedAt: number; orders: SsOrder[] } | null = null;
let pending: Promise<SsOrder[]> | null = null;

async function getAllOpenOrders(apiBase: string): Promise<SsOrder[]> {
  const now = Date.now();
  if (ordersCache && now - ordersCache.fetchedAt < ORDERS_TTL_MS) {
    return ordersCache.orders;
  }
  if (pending) return pending;

  const accountNumber = process.env.SS_WS_ID?.trim();
  const apiKey = process.env.SS_WS_PASSWORD?.trim();
  if (!accountNumber || !apiKey) {
    throw new Error(
      "S&S tracking: SS_WS_ID + SS_WS_PASSWORD must be set (same creds as inventory).",
    );
  }
  const authHeader =
    "Basic " + Buffer.from(`${accountNumber}:${apiKey}`).toString("base64");

  // Boxes=true surfaces the per-box trackingNumber/carrier/shipDate.
  // No filter → all currently-open orders. Past-shipped orders fall
  // off this list once invoiced + cycled out, but the vendor-poll
  // cron only cares about open POs anyway.
  const url = `${apiBase}/orders/?Boxes=true&BoxLines=true&mediaType=json`;

  pending = (async () => {
    const res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: authHeader },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`S&S /orders ${res.status}: ${body.slice(0, 400)}`);
    }
    const data = (await res.json()) as unknown;
    const orders = Array.isArray(data) ? (data as SsOrder[]) : [];
    ordersCache = { fetchedAt: Date.now(), orders };
    return orders;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function fetchSSTracking(
  customerPoNumber: string,
  opts: SsTrackingOpts = {},
): Promise<OsnShipmentPackage[]> {
  const { shipments } = await fetchSSTrackingRaw(customerPoNumber, opts);
  return shipments;
}

export async function fetchSSTrackingRaw(
  customerPoNumber: string,
  opts: SsTrackingOpts = {},
): Promise<{
  shipments: OsnShipmentPackage[];
  raw: unknown;
  url: string;
}> {
  const base = (opts.apiBase ?? process.env.SS_API_BASE_URL?.trim() ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const orders = await getAllOpenOrders(base);

  // Match by poNumber — S&S stores customer PO exactly as we send it.
  const matched = orders.filter(
    (o) => (o.poNumber ?? "").trim() === customerPoNumber.trim(),
  );

  const shipments: OsnShipmentPackage[] = [];
  const seen = new Set<string>();
  for (const order of matched) {
    for (const box of order.boxes ?? []) {
      const tn = (box.trackingNumber ?? "").trim();
      if (!tn || seen.has(tn)) continue;
      seen.add(tn);
      shipments.push({
        trackingNumber: tn,
        carrier:
          (box.carrier?.trim() ||
            order.shippingCarrier?.trim() ||
            null) ?? null,
        shipDate: (box.shipDate ?? null) || (order.invoiceDate ?? null),
        expectedDeliveryDate: order.expectedDeliveryDate ?? null,
        raw: box,
      });
    }
  }

  return {
    shipments,
    raw: { matchedOrderCount: matched.length, matched },
    url: `${base}/orders/?Boxes=true&BoxLines=true&mediaType=json`,
  };
}
