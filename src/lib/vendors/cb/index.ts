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
): Promise<InventoryLine[]> {
  const id = process.env.CB_WS_ID?.trim();
  const password = process.env.CB_WS_PASSWORD?.trim();
  if (!id || !password) {
    throw new Error("CB_WS_ID and CB_WS_PASSWORD must be set");
  }

  // C&B's docs sample only shows id/password/productID/productIDtype, but
  // their .NET service throws NullReferenceException if localization fields
  // are absent — they're standard on every other PromoStandards 1.2.1 call.
  // Send both productID (their documented capital-ID form) and productId
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
      productID: productId,
      productIDtype: "Distributor",
    })) as [unknown];
  } catch (err) {
    // C&B's .NET service throws "Object reference not set" with no detail
    // about which field is null. Inline the outgoing SOAP body into the
    // error message so it surfaces in the registry's existing failure log,
    // then we can compare it against their docs sample to pin down the
    // missing/misnamed field.
    const lastRequest = (client as unknown as { lastRequest?: string })
      .lastRequest;
    const baseMessage = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(
      `${baseMessage}\n--- C&B request body ---\n${lastRequest ?? "(unavailable)"}`,
    );
    if (err instanceof Error && err.stack) wrapped.stack = err.stack;
    throw wrapped;
  }

  return mapCutterBuckInventory(response, productId);
}

// Defensive mapping: PromoStandards 1.2.1 Inventory uses
// ProductVariationInventoryArray.ProductVariationInventory[] with
// partColor / labelSize / quantityAvailable, but C&B's response shape
// hasn't been verified against live data yet. Walk both 1.2.1 and 2.0.0
// shapes and skip silently if neither matches — empty result is safer
// than throwing on unknown structure.

type Qty = {
  Quantity?: { value?: number | string; uom?: string };
  quantity?: { value?: number | string; uom?: string };
};

type Warehouse = {
  inventoryLocationId?: string | number;
  inventoryLocationName?: string;
  inventoryLocationQuantity?: Qty;
};

type Variation = {
  partColor?: string;
  labelSize?: string;
  quantityAvailable?: Qty;
  InventoryLocationArray?: { InventoryLocation?: Warehouse | Warehouse[] };
  inventoryLocationArray?: { InventoryLocation?: Warehouse | Warehouse[] };
};

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function readQty(q: Qty | undefined): number {
  return toNum(q?.Quantity?.value ?? q?.quantity?.value);
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
    Inventory?: {
      // 1.2.1 shape
      ProductVariationInventoryArray?: {
        ProductVariationInventory?: Variation | Variation[];
      };
      // 2.0.0 shape — fallback in case C&B's 1.2.1 endpoint actually
      // returns 2.0.0-shaped responses (their own docs are inconsistent).
      PartInventoryArray?: { PartInventory?: Variation | Variation[] };
    };
  };

  const variations = [
    ...asArray(
      root.Inventory?.ProductVariationInventoryArray?.ProductVariationInventory,
    ),
    ...asArray(root.Inventory?.PartInventoryArray?.PartInventory),
  ];

  // One-shot diagnostic: if our two known shapes don't match, dump the
  // raw response so we can see what C&B actually sent and update the
  // mapper. Removable once the shape is confirmed.
  if (variations.length === 0) {
    try {
      console.log(
        `[cb] empty parse for productId=${productId}, raw response:`,
        JSON.stringify(raw, null, 2).slice(0, 4000),
      );
    } catch {
      console.log(`[cb] empty parse for productId=${productId} (unstringifiable)`);
    }
  }

  const asOf = new Date().toISOString();

  return variations.map((p): InventoryLine => {
    const locations = asArray(
      p.InventoryLocationArray?.InventoryLocation ??
        p.inventoryLocationArray?.InventoryLocation,
    );
    const warehouses = locations.map((w, i) => ({
      id: String(w.inventoryLocationId ?? i),
      name: w.inventoryLocationName,
      quantity: readQty(w.inventoryLocationQuantity),
    }));

    return {
      color: p.partColor ?? null,
      size: p.labelSize ?? null,
      quantityAvailable: readQty(p.quantityAvailable),
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
