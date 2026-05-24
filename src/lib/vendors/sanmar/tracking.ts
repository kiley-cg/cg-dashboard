import {
  getOrderShipmentNotification,
  type OsnShipmentPackage,
} from "../promostandards/orderShipmentNotification";

// SanMar's OSN service. WSDL pattern mirrors their inventory binding
// ("InventoryServiceBindingV2final" → likely
// "OrderShipmentNotificationServiceBindingV1"). Override via
// SANMAR_OSN_WSDL_URL if SanMar gives you a different one.
//
// Auth: SanMar typically reuses SANMAR_WS_ID + SANMAR_WS_PASSWORD across
// PromoStandards services, but they have to enable OSN on your account
// separately. If you see auth errors, email webservices@sanmar.com.

// Per SanMar PO Integration Guide 24.1, their PromoStandards binding
// pattern is "{Service}Binding?WSDL" (no version suffix) — e.g.
// POServiceBinding?WSDL. So OSN should be at
// OrderShipmentNotificationServiceBinding?WSDL. Override via
// SANMAR_OSN_WSDL_URL env or via the probe's ?wsdl= param if not.
const DEFAULT_WSDL_URL =
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBinding?WSDL";

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export async function fetchSanMarTracking(
  poNumber: string,
  opts: { wsdlUrl?: string } = {},
): Promise<OsnShipmentPackage[]> {
  const wsdlUrl = opts.wsdlUrl ?? env("SANMAR_OSN_WSDL_URL") ?? DEFAULT_WSDL_URL;
  const id = env("SANMAR_WS_ID");
  const password = env("SANMAR_WS_PASSWORD");
  if (!id || !password) {
    throw new Error("Missing SANMAR_WS_ID / SANMAR_WS_PASSWORD");
  }
  const result = await getOrderShipmentNotification({
    wsdlUrl,
    id,
    password,
    queryType: "po",
    referenceNumber: poNumber,
  });
  return result.shipments;
}
