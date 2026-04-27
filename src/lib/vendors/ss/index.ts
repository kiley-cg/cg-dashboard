import { getInventoryLevels } from "../promostandards/inventory";
import { mapPromoStandardsInventory } from "../promostandards/map";
import type { InventoryLine } from "../types";

// S&S Activewear publishes their PromoStandards Inventory 2.0.0 endpoint at
// promostandards.ssactivewear.com. The credentials are typically the partner
// account number (id) and the integration password issued by S&S — distinct
// from the ssactivewear.com website login. Set SS_WS_ID and SS_WS_PASSWORD
// in Vercel env vars.
//
// `?singleWsdl` (WCF feature) returns the WSDL with all <xsd:import/>'d
// schemas inlined into one document. node-soap doesn't reliably follow
// those imports otherwise, leading to "Cannot read properties of undefined
// (reading 'description')" inside its WSDL parser.
const DEFAULT_WSDL =
  "https://promostandards.ssactivewear.com/Inventory/v2/InventoryService.svc?singleWsdl";

export async function fetchSSInventory(
  productId: string,
): Promise<InventoryLine[]> {
  const id = process.env.SS_WS_ID;
  const password = process.env.SS_WS_PASSWORD;
  if (!id || !password) {
    throw new Error("SS_WS_ID and SS_WS_PASSWORD must be set");
  }
  const raw = await getInventoryLevels({
    wsdlUrl: process.env.SS_WSDL_URL ?? DEFAULT_WSDL,
    id,
    password,
    productId,
  });
  return mapPromoStandardsInventory(raw);
}
