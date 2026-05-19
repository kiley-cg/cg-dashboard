import type { FlatLineItem } from "../syncore/types";
import { fetchSanMarInventory } from "./sanmar";
import { AmbiguousStyleError, fetchSSInventory } from "./ss";
import { fetchCutterBuckInventory } from "./cb";
import type { InventoryLookup, VendorCode } from "./types";

/**
 * Map a Syncore supplier name to one of our adapters. Match on the
 * lowercased name; if Color Graphics adds another vendor, add a clause
 * here and a thin adapter beside ./sanmar/, ./ss/, ./cb/.
 */
function resolveVendor(supplierName: string | null): VendorCode {
  const name = supplierName?.toLowerCase().trim() ?? "";
  if (!name) return "unknown";
  if (name.includes("sanmar")) return "sanmar";
  if (
    name.includes("s&s") ||
    name.includes("ssactivewear") ||
    name.includes("ss activewear")
  ) {
    return "ss";
  }
  if (name.includes("cutter")) return "cb";
  return "unknown";
}

export type LookupOptions = {
  includeCosts?: boolean;
  includeWeights?: boolean;
  // Auto-filled product description from Syncore (e.g. "Richardson 220
  // Relaxed Performance Lite Cap"). Adapters use this to disambiguate
  // when a style number maps to multiple products in the vendor catalog.
  productDescription?: string | null;
};

export async function lookupInventory(
  line: FlatLineItem,
  opts: LookupOptions = {},
): Promise<InventoryLookup> {
  const vendor = resolveVendor(line.supplierName);
  const productId = line.productId;

  if (!productId) {
    return {
      status: "no-style",
      vendor,
      productId: null,
      message: "Line has no SKU/style number — add it in Syncore.",
    };
  }

  if (vendor === "unknown") {
    return {
      status: "unsupported",
      vendor,
      productId,
      message: `Supplier "${line.supplierName ?? "unknown"}" has no adapter yet.`,
    };
  }

  // Description comes from the Syncore line by default; callers can
  // override it via opts (rare — useful for testing or manual overrides).
  const adapterOpts: LookupOptions = {
    ...opts,
    productDescription: opts.productDescription ?? line.productDescription,
  };

  try {
    const lines =
      vendor === "sanmar"
        ? await fetchSanMarInventory(productId, adapterOpts)
        : vendor === "ss"
          ? await fetchSSInventory(productId, adapterOpts)
          : await fetchCutterBuckInventory(productId, adapterOpts);
    return { status: "ok", vendor, productId, lines };
  } catch (err) {
    if (err instanceof AmbiguousStyleError) {
      return {
        status: "ambiguous",
        vendor,
        productId,
        message: err.message,
        candidates: err.candidates,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[inventory] ${vendor} lookup failed for productId=${productId}`,
      {
        message,
        color: line.color,
        size: line.size,
        stack: err instanceof Error ? err.stack : undefined,
      },
    );
    return { status: "vendor-error", vendor, productId, message };
  }
}
