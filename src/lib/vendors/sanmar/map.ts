import type { InventoryLine } from "../types";

// Best-effort flattener for a SanMar getInventoryLevelsResponse.
// PromoStandards responses are deeply nested XML-converted objects; keep this
// defensive — log unexpected shapes and return an empty array rather than throw.

type PartQty = { quantity?: { value?: number | string } };
type Warehouse = {
  inventoryLocationId?: string;
  inventoryLocationName?: string;
  inventoryLocationQuantity?: PartQty;
};
type PartInventory = {
  partColor?: string;
  labelSize?: string;
  quantityAvailable?: PartQty;
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

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function mapSanMarInventory(raw: unknown): InventoryLine[] {
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
      id: w.inventoryLocationId ?? "",
      name: w.inventoryLocationName,
      quantity: toNum(w.inventoryLocationQuantity?.quantity?.value),
    }));

    return {
      color: p.partColor ?? null,
      size: p.labelSize ?? null,
      quantityAvailable: toNum(p.quantityAvailable?.quantity?.value),
      warehouses: warehouses.length ? warehouses : undefined,
      asOf,
    };
  });
}
