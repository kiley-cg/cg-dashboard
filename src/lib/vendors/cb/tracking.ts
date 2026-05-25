// Cutter & Buck tracking lookup via PromoStandards OSN. C&B's services
// run on IIS/.NET (.asmx paths) at api.cbcorporate.com — different from
// SanMar (Tomcat) but same PromoStandards spec, so we reuse the OSN SOAP
// client.
//
// Their Inventory binding is "InventoryService121.asmx" (version 1.2.1).
// We don't yet know exactly what they publish for OSN — common variants
// covered in the probe's scan candidate list.
//
// Auth: CB_WS_ID + CB_WS_PASSWORD (same creds as inventory).

import {
  getOrderShipmentNotification,
  type OsnQueryType,
  type OsnResult,
  type OsnShipmentPackage,
} from "../promostandards/orderShipmentNotification";

// Confirmed via C&B PromoStandards Integration Guide (uploaded by Kiley).
// Endpoint is OrderShipmentNotification.asmx — NO "Service" suffix,
// unlike their other PromoStandards endpoints (InventoryService121,
// ProductData200, etc).
const DEFAULT_WSDL_URL =
  "https://api.cbcorporate.com/promostandards/OrderShipmentNotification.asmx?wsdl";

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export async function fetchCutterBuckTracking(
  poNumber: string,
  opts: { wsdlUrl?: string; queryType?: OsnQueryType } = {},
): Promise<OsnShipmentPackage[]> {
  const result = await fetchCutterBuckTrackingRaw(poNumber, opts);
  return result.shipments;
}

export async function fetchCutterBuckTrackingRaw(
  poNumber: string,
  opts: { wsdlUrl?: string; queryType?: OsnQueryType } = {},
): Promise<OsnResult> {
  const wsdlUrl =
    opts.wsdlUrl ?? env("CB_OSN_WSDL_URL") ?? DEFAULT_WSDL_URL;
  const id = env("CB_WS_ID");
  const password = env("CB_WS_PASSWORD");
  if (!id || !password) {
    throw new Error("Missing CB_WS_ID / CB_WS_PASSWORD");
  }
  return await getOrderShipmentNotification({
    wsdlUrl,
    id,
    password,
    queryType: opts.queryType ?? "po",
    referenceNumber: poNumber,
  });
}
