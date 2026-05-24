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

// Best-guess default — SanMar's inventory binding is
// "InventoryServiceBindingV2final", so OSN 1.0.0 is most likely the
// V1final variant. Override via SANMAR_OSN_WSDL_URL env (set on Vercel)
// or via the probe route's ?wsdl= param to iterate without redeploying.
const DEFAULT_WSDL_URL =
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV1final?WSDL";

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
