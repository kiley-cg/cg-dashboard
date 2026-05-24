import * as soap from "soap";

// Shared PromoStandards Order Shipment Notification (OSN) SOAP client.
// Same caching pattern as inventory.ts — one WSDL URL → one cached
// SOAP client. SanMar and C&B both expose OSN 1.0.0; this file is the
// vendor-agnostic plumbing, vendor adapters wrap with their own URL +
// credentials.
//
// Spec: PromoStandards OSN 1.0.0 — operation `getOrderShipmentNotification`
// returns shipment packages including tracking#, carrier, ship date,
// and (sometimes) expected delivery.

const clientCache = new Map<string, Promise<soap.Client>>();

async function getClient(wsdlUrl: string): Promise<soap.Client> {
  // Same defensive trim as inventory.ts — env-var paste artifacts.
  const url = wsdlUrl.trim();
  let pending = clientCache.get(url);
  if (!pending) {
    pending = soap.createClientAsync(url).catch((err) => {
      clientCache.delete(url);
      throw err;
    });
    clientCache.set(url, pending);
  }
  return pending;
}

export type OsnQueryType = "po" | "salesOrder" | "shipmentDate";

const QUERY_TYPE_CODE: Record<OsnQueryType, number> = {
  po: 1,
  salesOrder: 2,
  shipmentDate: 3,
};

export interface OsnQueryArgs {
  wsdlUrl: string;
  id: string;
  password: string;
  queryType: OsnQueryType;
  referenceNumber: string;
}

export interface OsnShipmentPackage {
  trackingNumber: string;
  carrier: string | null;
  shipDate: string | null;
  // Some vendors include estimated delivery; many don't.
  expectedDeliveryDate: string | null;
  // Raw shipment fragment for debugging / future field parsing.
  raw: unknown;
}

export interface OsnResult {
  shipments: OsnShipmentPackage[];
  // Vendor sometimes returns a status object alongside the shipments —
  // surface it raw so callers (or probes) can log the diagnostic info.
  raw: unknown;
}

/**
 * Call PromoStandards `getOrderShipmentNotification`. Returns a flattened
 * list of shipments with their tracking#. Throws on SOAP fault / network
 * failure so the cron can surface vendor-specific error messages clearly.
 */
export async function getOrderShipmentNotification(
  args: OsnQueryArgs,
): Promise<OsnResult> {
  const client = await getClient(args.wsdlUrl);
  const [resp] = await client.getOrderShipmentNotificationAsync({
    wsVersion: "1.0.0",
    id: args.id,
    password: args.password,
    queryType: QUERY_TYPE_CODE[args.queryType],
    referenceNumber: args.referenceNumber,
  });

  const shipments = extractShipments(resp);
  return { shipments, raw: resp };
}

/**
 * PromoStandards responses nest deeply and vary by vendor — try a few
 * shapes and yield a flat list. Anything we can't recognise is preserved
 * in `raw` so a probe can post-mortem it.
 */
function extractShipments(resp: unknown): OsnShipmentPackage[] {
  if (!resp || typeof resp !== "object") return [];

  // Common shapes:
  //   resp.ShipmentPackageArray.ShipmentPackage
  //   resp.shipmentPackageArray.shipmentPackage
  //   resp.OrderShipmentNotificationArray....
  //   resp.errorMessage (failure — empty shipments)
  const r = resp as Record<string, unknown>;
  const flat = (val: unknown): unknown[] => {
    if (val == null) return [];
    return Array.isArray(val) ? val : [val];
  };

  const candidates: unknown[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 5 || node == null) return;
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const kLower = k.toLowerCase();
      if (kLower.includes("shipmentpackage") || kLower === "package" || kLower === "shipment") {
        for (const x of flat(v)) candidates.push(x);
      }
      if (v && typeof v === "object") visit(v, depth + 1);
    }
  };
  visit(r, 0);

  // Dedupe by reference identity
  const seen = new Set<unknown>();
  const uniqued = candidates.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  return uniqued
    .map((c) => mapPackage(c))
    .filter((p): p is OsnShipmentPackage => p !== null);
}

function mapPackage(node: unknown): OsnShipmentPackage | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const tracking = findStr(obj, ["trackingNumber", "TrackingNumber", "tracking_number"]);
  if (!tracking) return null;
  const carrier =
    findStr(obj, ["shipmentMethod", "ShipmentMethod", "carrier", "Carrier"]) ?? null;
  const shipDate =
    findStr(obj, ["shipDate", "ShipDate", "shipment_date", "shipDateTime"]) ?? null;
  const eta =
    findStr(obj, [
      "expectedDeliveryDate",
      "ExpectedDeliveryDate",
      "estimatedDeliveryDate",
      "expectedDelivery",
    ]) ?? null;
  return {
    trackingNumber: tracking,
    carrier,
    shipDate,
    expectedDeliveryDate: eta,
    raw: node,
  };
}

function findStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}
