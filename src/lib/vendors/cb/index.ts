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

  const client = await getClient();
  const [response] = (await client.getInventoryLevelsAsync({
    wsVersion: "1.2.1",
    id,
    password,
    productID: productId,
    productIDtype: "Distributor",
  })) as [unknown];

  return mapCutterBuckInventory(response);
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

function mapCutterBuckInventory(raw: unknown): InventoryLine[] {
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
