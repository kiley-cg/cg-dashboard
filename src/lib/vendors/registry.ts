import type { FlatLineItem } from "../syncore/types";
import { getInventoryLevels } from "./sanmar/client";
import { mapSanMarInventory } from "./sanmar/map";
import type { InventoryLookup, VendorCode } from "./types";

// SanMar is supplier_id 65 in our Syncore tenant (and more broadly, ASI 84863).
// Until Color Graphics has multiple vendor adapters, resolveVendor falls back
// to SanMar when the supplier doesn't match anything explicit.
function resolveVendor(supplierName: string | null): VendorCode {
  const name = supplierName?.toLowerCase().trim() ?? "";
  if (name.includes("sanmar")) return "sanmar";
  // v1 default — revisit when we add a second adapter.
  return "sanmar";
}

export async function lookupInventory(
  line: FlatLineItem,
): Promise<InventoryLookup> {
  const vendor = resolveVendor(line.supplierName);
  const productId = line.productId;

  if (vendor === "unknown") {
    return {
      status: "unsupported",
      vendor,
      productId,
      message: `Supplier "${line.supplierName ?? "unknown"}" has no adapter yet.`,
    };
  }

  try {
    const raw = await getInventoryLevels({
      productId,
      filterColors: line.color ? [line.color] : undefined,
      filterSizes: line.size ? [line.size] : undefined,
    });
    return {
      status: "ok",
      vendor,
      productId,
      lines: mapSanMarInventory(raw),
    };
  } catch (err) {
    return {
      status: "vendor-error",
      vendor,
      productId,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
