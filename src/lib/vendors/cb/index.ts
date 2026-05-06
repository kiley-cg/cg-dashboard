import * as soap from "soap";
import type { InventoryLine } from "../types";

// Cutter & Buck PromoStandards Inventory 1.2.1.
// Per their docs the request uses productID (capital ID) plus a
// productIDtype="Distributor" param — not the standard 2.0.0 shape — so
// this lives outside the shared promostandards/inventory.ts client.
//
// Endpoint: https://api.cbcorporate.com/promostandards/InventoryService121.asmx
// Auth: id + password issued by CBEDI@cutterbuck.com
// Filters supported: filterColor, filterSize, filterSelection
//   ("Plant_Renton", "Plant_Hebron")

const DEFAULT_WSDL =
  "https://api.cbcorporate.com/promostandards/InventoryService121.asmx?wsdl";

let clientPromise: Promise<soap.Client> | null = null;

async function getClient(): Promise<soap.Client> {
  if (!clientPromise) {
    const url = (process.env.CB_WSDL_URL?.trim() ?? DEFAULT_WSDL).trim();
    clientPromise = soap.createClientAsync(url).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export async function fetchCutterBuckInventory(
  productId: string,
  // C&B has no pricing or weight calls wired yet; opts is accepted for
  // signature parity with sanmar/ss adapters and to avoid a future
  // refactor when getConfigurationAndPricing is added.
  _opts: { includeCosts?: boolean; includeWeights?: boolean } = {},
): Promise<InventoryLine[]> {
  const id = process.env.CB_WS_ID?.trim();
  const password = process.env.CB_WS_PASSWORD?.trim();
  if (!id || !password) {
    throw new Error("CB_WS_ID and CB_WS_PASSWORD must be set");
  }

  // PromoStandards 1.x requires localizationCountry + localizationLanguage
  // on every Inventory request. Their docs sample omits them but C&B's
  // .NET service throws NullReferenceException without them. We also send
  // both productID (capital ID, what C&B's docs show) and productId
  // (standard PromoStandards lowercase) — the WSDL serializer drops
  // whichever the schema doesn't declare.
  const client = await getClient();
  let response: unknown;
  try {
    [response] = (await client.getInventoryLevelsAsync({
      // wsVersion must match the WSDL's targetNamespace: C&B's WSDL is
      // labeled "InventoryService121.asmx" but its namespace is
      // .../InventoryService/1.0.0/, and per the spec the wsVersion field
      // matches the namespace, not the service name. Sending "1.2.1" is
      // what triggered the .NET NRE.
      wsVersion: "1.0.0",
      id,
      password,
      localizationCountry: "US",
      localizationLanguage: "en",
      productID: productId,
      productId: productId,
      productIDtype: "Distributor",
    })) as [unknown];
  } catch (err) {
    // C&B's .NET service throws "Object reference not set" with no detail
    // about which field is null. Inline the outgoing SOAP body into the
    // error message so it surfaces in the registry's existing failure log,
    // then we can compare it against their docs sample to pin down the
    // missing/misnamed field. Redact credentials before logging — the
    // raw request body contains <password> and <id> in plaintext.
    const lastRequest = (client as unknown as { lastRequest?: string })
      .lastRequest;
    const safeRequest = lastRequest
      ? lastRequest
          .replace(/(<password>)[^<]*(<\/password>)/g, "$1[REDACTED]$2")
          .replace(/(<id>)[^<]*(<\/id>)/g, "$1[REDACTED]$2")
      : "(unavailable)";
    const baseMessage = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(
      `${baseMessage}\n--- C&B request body ---\n${safeRequest}`,
    );
    if (err instanceof Error && err.stack) wrapped.stack = err.stack;
    throw wrapped;
  }

  return mapCutterBuckInventory(response, productId);
}

// C&B's actual Inventory response shape (observed from a live LCK00192
// call) doesn't follow PromoStandards 1.x or 2.x:
//   - Variations sit at the response root, not nested under <Inventory>
//   - Color/size are attributeColor / attributeSize (and color is a
//     short code like "ALS", not the human-readable name)
//   - quantityAvailable is a scalar string, not the spec'd Quantity{} obj
//   - Warehouse identity is encoded as an AttributeFlex with name="Plant"
//     and value="Renton" | "Hebron"
//   - Each (color, size) appears once per (plant, validTimestamp). The
//     future-dated rows are *projected incoming stock*, not currently
//     available — we filter them out and aggregate only "now" rows.
//
// We still walk the spec-compliant shapes too, as a defensive fallback
// in case C&B aligns with the spec on other styles.

type FlexAttr = { id?: string; name?: string; value?: string };
type CBVariation = {
  // C&B's observed shape:
  partID?: string | number;
  partDescription?: string;
  attributeColor?: string;
  attributeSize?: string;
  AttributeFlexArray?: { AttributeFlex?: FlexAttr | FlexAttr[] };
  validTimestamp?: string;
  // Spec-compliant shape (kept for fallback):
  partColor?: string;
  labelSize?: string;
  InventoryLocationArray?: { InventoryLocation?: SpecWarehouse | SpecWarehouse[] };
  inventoryLocationArray?: { InventoryLocation?: SpecWarehouse | SpecWarehouse[] };
  // Either shape may report quantityAvailable as scalar (C&B) or nested
  // Quantity (spec). readQty handles both.
  quantityAvailable?: number | string | { Quantity?: { value?: number | string }; quantity?: { value?: number | string } };
};

type SpecWarehouse = {
  inventoryLocationId?: string | number;
  inventoryLocationName?: string;
  inventoryLocationQuantity?: { Quantity?: { value?: number | string }; quantity?: { value?: number | string } };
};

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function readQty(q: CBVariation["quantityAvailable"]): number {
  if (q == null) return 0;
  if (typeof q === "number" || typeof q === "string") return toNum(q);
  return toNum(q.Quantity?.value ?? q.quantity?.value);
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function mapCutterBuckInventory(
  raw: unknown,
  productId: string,
): InventoryLine[] {
  const root = raw as {
    productID?: string;
    // C&B's observed shape: variations directly at root.
    ProductVariationInventoryArray?: {
      ProductVariationInventory?: CBVariation | CBVariation[];
    };
    // Spec-compliant shapes (defensive fallback).
    Inventory?: {
      ProductVariationInventoryArray?: {
        ProductVariationInventory?: CBVariation | CBVariation[];
      };
      PartInventoryArray?: { PartInventory?: CBVariation | CBVariation[] };
    };
  };

  const variations = [
    ...asArray(root.ProductVariationInventoryArray?.ProductVariationInventory),
    ...asArray(
      root.Inventory?.ProductVariationInventoryArray?.ProductVariationInventory,
    ),
    ...asArray(root.Inventory?.PartInventoryArray?.PartInventory),
  ];

  if (variations.length === 0) {
    try {
      console.log(
        `[cb] empty parse for productId=${productId}, raw response:`,
        JSON.stringify(raw, null, 2).slice(0, 4000),
      );
    } catch {
      console.log(`[cb] empty parse for productId=${productId} (unstringifiable)`);
    }
    return [];
  }

  // Group by (color, size). Each (color, size) appears once per
  // (plant, validTimestamp). Skip future-dated rows since those are
  // projected incoming stock, not currently shippable inventory.
  const now = Date.now();
  type Bucket = {
    color: string | null;
    size: string | null;
    warehouses: Map<string, { name: string; quantity: number }>;
  };
  const buckets = new Map<string, Bucket>();

  for (const v of variations) {
    const ts = v.validTimestamp ? Date.parse(v.validTimestamp) : NaN;
    if (Number.isFinite(ts) && ts > now) continue;

    const color = v.attributeColor ?? v.partColor ?? null;
    const size = v.attributeSize ?? v.labelSize ?? null;
    const key = `${color}|${size}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { color, size, warehouses: new Map() };
      buckets.set(key, bucket);
    }

    // Resolve warehouse: prefer C&B's AttributeFlex Plant; fall back to
    // the spec InventoryLocationArray for hypothetical spec-compliant
    // responses.
    const flex = asArray(v.AttributeFlexArray?.AttributeFlex);
    const plant = flex.find((f) => f.name === "Plant")?.value ?? null;
    const specLocs = asArray(
      v.InventoryLocationArray?.InventoryLocation ??
        v.inventoryLocationArray?.InventoryLocation,
    );

    if (plant) {
      const qty = readQty(v.quantityAvailable);
      const existing = bucket.warehouses.get(plant);
      if (existing) existing.quantity += qty;
      else bucket.warehouses.set(plant, { name: plant, quantity: qty });
    } else if (specLocs.length > 0) {
      for (const w of specLocs) {
        const id = String(w.inventoryLocationId ?? "unknown");
        const name = w.inventoryLocationName ?? id;
        const qty = toNum(
          w.inventoryLocationQuantity?.Quantity?.value ??
            w.inventoryLocationQuantity?.quantity?.value,
        );
        const existing = bucket.warehouses.get(id);
        if (existing) existing.quantity += qty;
        else bucket.warehouses.set(id, { name, quantity: qty });
      }
    } else {
      // No warehouse breakdown — record under a synthetic single bucket
      // so the total still surfaces.
      const qty = readQty(v.quantityAvailable);
      const existing = bucket.warehouses.get("unknown");
      if (existing) existing.quantity += qty;
      else bucket.warehouses.set("unknown", { name: "Unknown", quantity: qty });
    }
  }

  const asOf = new Date().toISOString();

  return Array.from(buckets.values()).map((b): InventoryLine => {
    const warehouses = Array.from(b.warehouses.entries()).map(([id, w]) => ({
      id,
      name: w.name,
      quantity: w.quantity,
    }));
    const total = warehouses.reduce((sum, w) => sum + w.quantity, 0);
    return {
      color: b.color,
      size: b.size,
      quantityAvailable: total,
      yourCost: null,
      msrp: null,
      casePrice: null,
      salePrice: null,
      pieceWeightLbs: null,
      warehouses: warehouses.length ? warehouses : undefined,
      asOf,
    };
  });
}
