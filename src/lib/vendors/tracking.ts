// Vendor tracking dispatcher — mirrors registry.ts's pattern for
// inventory, but for OSN / Order Status calls. One entry point that
// the cron route (and any future on-demand "refresh tracking" UI) can
// call without caring which vendor a PO came from.
//
// Phase 5 v1: SanMar only. S&S and C&B are wired in as soon as we've
// confirmed SanMar's response shape against a real PO.

import type { OsnShipmentPackage } from "./promostandards/orderShipmentNotification";
import { fetchSanMarTracking } from "./sanmar/tracking";
import { fetchSSTracking } from "./ss/tracking";
import { fetchCutterBuckTracking } from "./cb/tracking";
import type { VendorCode } from "./types";

export type { OsnShipmentPackage } from "./promostandards/orderShipmentNotification";

export interface VendorTrackingResult {
  vendor: VendorCode;
  shipments: OsnShipmentPackage[];
}

export function resolveTrackingVendor(supplierName: string | null): VendorCode {
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

/**
 * Fetch tracking shipments for a single PO from the appropriate vendor.
 * Returns an empty list if the vendor isn't yet wired (S&S, C&B today)
 * or if the PO has no shipments. Throws on credential / network errors
 * so the cron can log them per-PO.
 *
 * `poNumber` is the vendor-facing PO number (the one the rep typed in
 * when placing the order), NOT our internal Syncore PO id. For SanMar
 * this is the value sent in the ePO push.
 */
export async function fetchVendorTracking(args: {
  supplierName: string | null;
  poNumber: string;
}): Promise<VendorTrackingResult> {
  const vendor = resolveTrackingVendor(args.supplierName);
  switch (vendor) {
    case "sanmar":
      return { vendor, shipments: await fetchSanMarTracking(args.poNumber) };
    case "ss":
      return { vendor, shipments: await fetchSSTracking(args.poNumber) };
    case "cb":
      return { vendor, shipments: await fetchCutterBuckTracking(args.poNumber) };
    case "unknown":
      return { vendor, shipments: [] };
  }
}
