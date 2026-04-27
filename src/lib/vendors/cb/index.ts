import { getInventoryLevels } from "../promostandards/inventory";
import { mapPromoStandardsInventory } from "../promostandards/map";
import type { InventoryLine } from "../types";

// Cutter & Buck PromoStandards Inventory 2.0.0
// Endpoint: https://api.cbcorporate.com/promostandards/InventoryService200.asmx
// Auth: id + password issued by CBEDI@cutterbuck.com
//
// Pricing is exposed via PromoStandards Pricing & Configuration 1.0.0 at
// /ProductConfigPricing.asmx (priceType="Customer" returns account-specific
// pricing). Wiring that up requires a separate per-vendor pricing call —
// done in a follow-up commit; rows currently render with cost = "—" for C&B.
//
// Per-piece weight + box dims would come from PromoStandards Product Data
// 2.0.0 (/ProductData200.asmx) — also deferred.

const DEFAULT_WSDL =
  "https://api.cbcorporate.com/promostandards/InventoryService200.asmx?wsdl";

export async function fetchCutterBuckInventory(
  productId: string,
): Promise<InventoryLine[]> {
  const id = process.env.CB_WS_ID?.trim();
  const password = process.env.CB_WS_PASSWORD?.trim();
  if (!id || !password) {
    throw new Error("CB_WS_ID and CB_WS_PASSWORD must be set");
  }
  const raw = await getInventoryLevels({
    wsdlUrl: process.env.CB_WSDL_URL?.trim() ?? DEFAULT_WSDL,
    id,
    password,
    productId,
  });
  return mapPromoStandardsInventory(raw);
}
