import { getInventoryLevels } from "../promostandards/inventory";
import { mapPromoStandardsInventory } from "../promostandards/map";
import type { InventoryLine } from "../types";
import { fetchSanMarPricing, type SanMarPriceRow } from "./pricing";
import {
  fetchSanMarProductInfo,
  type SanMarProductInfoRow,
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
  opts: { includeCosts?: boolean; includeWeights?: boolean } = {},
): Promise<InventoryLine[]> {
  const id = process.env.SANMAR_WS_ID;
  const password = process.env.SANMAR_WS_PASSWORD;
  if (!id || !password) {
    throw new Error("SANMAR_WS_ID and SANMAR_WS_PASSWORD must be set");
  }

  // Three SanMar calls run in parallel:
  //   - Inventory (always): availability per (color, size, warehouse)
  //   - Pricing (gated on ?costs=1): per-variant price tiers
  //   - Product Info (always): the catalogColor↔color name map. We need
  //     this on every render — not just freight requests — to translate
  //     SanMar's abbreviated mainframe color (e.g. "AnchorGyHt") that
  //     the Inventory service returns into the canonical full name
  //     ("Anchor Grey Heather") that Syncore sales orders use.
  const [raw, prices, productInfo] = await Promise.all([
    getInventoryLevels({
      wsdlUrl: process.env.SANMAR_WSDL_URL ?? DEFAULT_WSDL,
      id,
      password,
      productId,
    }),
    opts.includeCosts
      ? fetchSanMarPricing(productId).catch((err) => {
          console.error("[sanmar] pricing fetch failed", {
            productId,
            message: err instanceof Error ? err.message : String(err),
          });
          return [] as SanMarPriceRow[];
        })
      : Promise.resolve([] as SanMarPriceRow[]),
    fetchSanMarProductInfo(productId).catch((err) => {
      console.error("[sanmar] productInfo fetch failed", {
        productId,
        message: err instanceof Error ? err.message : String(err),
      });
      return [] as SanMarProductInfoRow[];
    }),
  ]);

  const lines = mapPromoStandardsInventory(raw);

  // Surface a one-line summary per productId: how many variants came back,
  // total qty across them, and a sample of color/size pairs. When a rep
  // says "SanMar shows stock for X but the app shows 0", this log answers
  // whether the API agreed with the website at all.
  const totalQty = lines.reduce((n, l) => n + l.quantityAvailable, 0);
  console.log("[sanmar] inventory", {
    productId,
    variants: lines.length,
    totalQty,
    sample: lines.slice(0, 5).map((l) => ({
      color: l.color,
      size: l.size,
      qty: l.quantityAvailable,
    })),
  });
  if (lines.length === 0) {
    console.log("[sanmar] empty response — raw payload", {
      productId,
      raw: JSON.stringify(raw).slice(0, 2000),
    });
  }

  // Pricing and weight keying both use the abbreviated form (which is
  // what line.color holds at this point). Do them BEFORE the canonical-
  // name substitution below, otherwise the keys diverge.
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

  if (opts.includeWeights && productInfo.length > 0) {
    const weightByKey = new Map<string, SanMarProductInfoRow>();
    for (const w of productInfo) {
      weightByKey.set(priceKey(w.abbreviatedColor, w.size), w);
    }
    for (const line of lines) {
      const match = weightByKey.get(priceKey(line.color, line.size));
      if (match?.pieceWeightLbs != null) {
        line.pieceWeightLbs = match.pieceWeightLbs;
      }
    }
  }

  // Replace each line's color with the canonical full catalog name from
  // Product Info. The Inventory service returns abbreviated/mainframe
  // forms ("AnchorGyHt", "BlkHthr", "Shad Grey Twst") that don't align
  // with what Syncore puts on sales orders ("Anchor Grey Heather",
  // "Black Heather", "Shadow Grey Twist"). After this substitution the
  // matcher can do exact comparisons against Syncore's color, with the
  // fuzzy heuristics in match.ts only firing when Product Info has no
  // entry for some abbreviated form (rare; safety net).
  if (productInfo.length > 0) {
    const fullByAbbrev = new Map<string, string>();
    for (const row of productInfo) {
      if (row.abbreviatedColor && row.fullColor) {
        fullByAbbrev.set(norm(row.abbreviatedColor), row.fullColor);
      }
    }
    for (const line of lines) {
      if (!line.color) continue;
      const full = fullByAbbrev.get(norm(line.color));
      if (full) line.color = full;
    }
  }

  return lines;
}
