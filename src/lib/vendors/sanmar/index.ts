import { getInventoryLevels } from "../promostandards/inventory";
import { mapPromoStandardsInventory } from "../promostandards/map";
import type { InventoryLine } from "../types";

const DEFAULT_WSDL =
  "https://ws.sanmar.com:8080/promostandards/InventoryServiceBindingV2final?WSDL";

export async function fetchSanMarInventory(
  productId: string,
): Promise<InventoryLine[]> {
  const id = process.env.SANMAR_WS_ID;
  const password = process.env.SANMAR_WS_PASSWORD;
  if (!id || !password) {
    throw new Error("SANMAR_WS_ID and SANMAR_WS_PASSWORD must be set");
  }
  const raw = await getInventoryLevels({
    wsdlUrl: process.env.SANMAR_WSDL_URL ?? DEFAULT_WSDL,
    id,
    password,
    productId,
  });
  return mapPromoStandardsInventory(raw);
}
