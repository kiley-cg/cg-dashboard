import type { SyncoreLineItem } from "../syncore/types";
import { getInventoryLevels } from "./sanmar/client";
import { mapSanMarInventory } from "./sanmar/map";
import type { InventoryLookup, VendorCode } from "./types";

function resolveVendor(line: SyncoreLineItem): VendorCode {
  const code = line.vendorCode?.toLowerCase().trim();
  if (!code) return "sanmar"; // v1 default; swap once we add vendor #2
  if (code === "sanmar" || code === "sm") return "sanmar";
  return "unknown";
}

export async function lookupInventory(
  line: SyncoreLineItem,
): Promise<InventoryLookup> {
  const vendor = resolveVendor(line);
  const productId = line.productId;

  if (vendor === "unknown") {
    return {
      status: "unsupported",
      vendor,
      productId,
      message: `Vendor code "${line.vendorCode}" has no adapter yet.`,
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
