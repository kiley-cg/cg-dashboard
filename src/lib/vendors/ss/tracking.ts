// S&S Activewear tracking lookup. Their REST API at api.ssactivewear.com/v2
// supports filtering orders by customer PO number; each order's shipments[]
// carries the tracking numbers.
//
// Auth: HTTP Basic with SS_WS_ID (account number) + SS_WS_PASSWORD (API key).
// Same creds as the inventory adapter.
//
// Endpoint matrix (we don't yet know which path S&S actually publishes for
// tracking — their docs hint at /orders supporting a poNumber filter; the
// probe route's ?scan=1 mode iterates the matrix so we can lock it in
// against a real PO).

import type { OsnShipmentPackage } from "../promostandards/orderShipmentNotification";

const DEFAULT_API_BASE = "https://api.ssactivewear.com/v2";

interface SsTrackingOpts {
  apiBase?: string;
  // Override which query-parameter name carries the PO number, since
  // S&S's docs are slightly ambiguous. Default = "poNumber".
  poParamName?: string;
  // Override path. Default = "/orders".
  path?: string;
}

export async function fetchSSTracking(
  customerPoNumber: string,
  opts: SsTrackingOpts = {},
): Promise<OsnShipmentPackage[]> {
  const accountNumber = process.env.SS_WS_ID?.trim();
  const apiKey = process.env.SS_WS_PASSWORD?.trim();
  if (!accountNumber || !apiKey) {
    throw new Error(
      "S&S tracking: SS_WS_ID + SS_WS_PASSWORD must be set (same creds as inventory).",
    );
  }
  const base = (opts.apiBase ?? process.env.SS_API_BASE_URL?.trim() ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const path = opts.path ?? "/orders";
  const param = opts.poParamName ?? "poNumber";

  const authHeader =
    "Basic " + Buffer.from(`${accountNumber}:${apiKey}`).toString("base64");

  const url = `${base}${path}?${param}=${encodeURIComponent(customerPoNumber)}&mediatype=json`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: authHeader },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`S&S ${path} ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as unknown;

  return extractShipments(data);
}

// S&S response shape (best guess from their docs):
//   [
//     {
//       orderNumber, poNumber, ...,
//       shipments: [
//         {
//           trackingNumber, shipDate, carrier, ...
//         }
//       ]
//     }
//   ]
// They sometimes return a single object instead of an array, and they
// sometimes nest shipments under "ShipmentInfo". The deep walk handles
// both. Borrows the same tolerant approach as the PromoStandards OSN
// parser — we don't want a minor schema variant to silently drop data.
function extractShipments(data: unknown): OsnShipmentPackage[] {
  if (data == null) return [];
  const out: OsnShipmentPackage[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const tracking =
      firstStr(obj, ["trackingNumber", "TrackingNumber", "tracking_number"]);
    if (tracking && !seen.has(tracking)) {
      seen.add(tracking);
      out.push({
        trackingNumber: tracking,
        carrier:
          firstStr(obj, ["carrier", "Carrier", "carrierName"]) ?? null,
        shipDate:
          firstStr(obj, [
            "shipDate",
            "ShipDate",
            "shippedDate",
            "shipmentDate",
          ]) ?? null,
        expectedDeliveryDate:
          firstStr(obj, [
            "expectedDeliveryDate",
            "estimatedDeliveryDate",
            "deliveryDate",
          ]) ?? null,
        raw: node,
      });
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") visit(v, depth + 1);
    }
  };
  visit(data, 0);
  return out;
}

function firstStr(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}
