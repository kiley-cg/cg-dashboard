import type { InventoryLine } from "../types";

// Flatten a PromoStandards getInventoryLevels 2.0.0 response into normalized
// inventory rows. Used by every PromoStandards-compliant vendor (SanMar,
// S&S Activewear, etc.) — the schema is part of the open spec.
//
// XML element names are preserved by the soap library, so casing matters:
//   <quantityAvailable><Quantity><value>...        ← Quantity is capital Q
//   <inventoryLocationQuantity><Quantity><value>   ← also capital Q
// We accept either case as a defensive belt-and-suspenders for vendors that
// stray from the spec.

type Qty = {
  Quantity?: { value?: number | string; uom?: string };
  quantity?: { value?: number | string; uom?: string };
};
type Warehouse = {
  inventoryLocationId?: string | number;
  inventoryLocationName?: string;
  inventoryLocationQuantity?: Qty;
};
type PartInventory = {
  partId?: string | number;
  partColor?: string;
  labelSize?: string;
  quantityAvailable?: Qty;
  InventoryLocationArray?: { InventoryLocation?: Warehouse | Warehouse[] };
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

export function mapPromoStandardsInventory(raw: unknown): InventoryLine[] {
  const parts = asArray(
    (raw as {
      Inventory?: {
        PartInventoryArray?: { PartInventory?: PartInventory | PartInventory[] };
      };
    })?.Inventory?.PartInventoryArray?.PartInventory,
  );

  const asOf = new Date().toISOString();

  return parts.map((p): InventoryLine => {
    const warehouses = asArray(
      p.InventoryLocationArray?.InventoryLocation,
    ).map((w) => ({
      id: String(w.inventoryLocationId ?? ""),
      name: w.inventoryLocationName,
      quantity: readQty(w.inventoryLocationQuantity),
    }));

    return {
      color: p.partColor ?? null,
      size: p.labelSize ?? null,
      quantityAvailable: readQty(p.quantityAvailable),
      // Pricing isn't part of the PromoStandards Inventory response —
      // it comes from the separate Pricing service. The vendor wrapper
      // is responsible for merging it in if available.
      yourCost: null,
      msrp: null,
      casePrice: null,
      salePrice: null,
      warehouses: warehouses.length ? warehouses : undefined,
      asOf,
    };
  });
}
