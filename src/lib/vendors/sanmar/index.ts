import { getInventoryLevels } from "../promostandards/inventory";
import { mapPromoStandardsInventory } from "../promostandards/map";
import type { InventoryLine } from "../types";
import { fetchSanMarPricing, type SanMarPriceRow } from "./pricing";
import {
  fetchSanMarPieceWeights,
  type SanMarPieceWeightRow,
} from "./productInfo";

const DEFAULT_WSDL =
  "https://ws.sanmar.com:8080/promostandards/InventoryServiceBindingV2final?WSDL";

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function priceKey(color: string | null, size: string | null): string {
  return `${norm(color)}|${norm(size)}`;
}

export async function fetchSanMarInventory(
  productId: string,
): Promise<InventoryLine[]> {
  const id = process.env.SANMAR_WS_ID;
  const password = process.env.SANMAR_WS_PASSWORD;
  if (!id || !password) {
    throw new Error("SANMAR_WS_ID and SANMAR_WS_PASSWORD must be set");
  }

  // Inventory, pricing, and per-piece weights run in parallel. Pricing
  // and weights are optional — they require SANMAR_CUSTOMER_NUMBER and
  // failures are logged but never block the inventory result.
  const [raw, prices, weights] = await Promise.all([
    getInventoryLevels({
      wsdlUrl: process.env.SANMAR_WSDL_URL ?? DEFAULT_WSDL,
      id,
      password,
      productId,
    }),
    fetchSanMarPricing(productId).catch((err) => {
      console.error("[sanmar] pricing fetch failed", {
        productId,
        message: err instanceof Error ? err.message : String(err),
      });
      return [] as SanMarPriceRow[];
    }),
    fetchSanMarPieceWeights(productId).catch((err) => {
      console.error("[sanmar] weight fetch failed", {
        productId,
        message: err instanceof Error ? err.message : String(err),
      });
      return [] as SanMarPieceWeightRow[];
    }),
  ]);

  const lines = mapPromoStandardsInventory(raw);

  if (prices.length > 0) {
    const priceByKey = new Map<string, SanMarPriceRow>();
    for (const p of prices) priceByKey.set(priceKey(p.color, p.size), p);
    for (const line of lines) {
      const match = priceByKey.get(priceKey(line.color, line.size));
      if (!match) continue;
      line.yourCost = match.myPrice ?? match.salePrice ?? match.piecePrice;
      line.msrp = match.piecePrice;
      line.casePrice = match.casePrice;
      line.salePrice = match.salePrice;
    }
  }

  if (weights.length > 0) {
    const weightByKey = new Map<string, SanMarPieceWeightRow>();
    for (const w of weights) weightByKey.set(priceKey(w.color, w.size), w);
    for (const line of lines) {
      const match = weightByKey.get(priceKey(line.color, line.size));
      if (match?.pieceWeightLbs != null) {
        line.pieceWeightLbs = match.pieceWeightLbs;
      }
    }
  }

  return lines;
}
