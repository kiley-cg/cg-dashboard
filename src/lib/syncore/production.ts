// Production-PO helpers.
//
// The Production dashboard mirrors purchase orders out of Syncore v2 and
// renders the in-house decoration ones (CG Embroidery / Transfers /
// Fulfillment) on Kristen's daily schedule. This file holds the pure
// helpers that classify and parse POs — the DB read/write layer lives in
// src/lib/db/production-po.ts and the cron that wires them is at
// /api/cron/sync-production-pos.

import type {
  SyncorePurchaseOrder,
  SyncoreSupplierRef,
} from "./types";

// Syncore tags every Supplier with one of these classes. "In House
// Production" is the bucket we use for our own decoration vendors (CG
// Embroidery, CG Transfers, CG Fulfillment, plus any future ones).
export const IN_HOUSE_SUPPLIER_CLASS = "In House Production";

export type Department =
  | "embroidery"
  | "transfers"
  | "fulfillment"
  | "other";

export function isDecorationPo(po: {
  supplier?: SyncoreSupplierRef | null | undefined;
}): boolean {
  return po.supplier?.class === IN_HOUSE_SUPPLIER_CLASS;
}

/**
 * Map a decoration PO to one of the three production departments. Matches
 * against the supplier name — the names ("Color Graphics Embroidery", etc.)
 * are the stable identifier across tenants. Falls back to "other" so a
 * future fourth in-house vendor doesn't silently disappear from the
 * dashboard.
 */
export function departmentForSupplier(
  name: string | null | undefined,
): Department {
  const n = (name ?? "").toLowerCase();
  if (n.includes("embroidery")) return "embroidery";
  if (n.includes("transfer")) return "transfers";
  if (n.includes("fulfillment") || n.includes("fulfilment")) {
    return "fulfillment";
  }
  return "other";
}

/**
 * Pull a stitch count out of a PO's `decoration_instructions` free-text
 * field. CSR formatting is inconsistent — examples seen in the wild:
 *   "Use PMS 33 instead of green. 20,000 stitches."
 *   "8K stitches, two-color"
 *   "Stitches: 12500"
 * Returns null when nothing parseable is present.
 */
export function parseStitchCount(
  text: string | null | undefined,
): number | null {
  if (!text) return null;
  // Order matters: try "20,000 stitches" before bare "20 stitches".
  const patterns: Array<{ rx: RegExp; kMultiplier?: boolean }> = [
    { rx: /(\d{1,3}(?:,\d{3})+)\s*stitch/i },
    { rx: /(\d+)\s*[kK]\s*stitch/i, kMultiplier: true },
    { rx: /stitch(?:es)?\s*[:=]\s*(\d{1,3}(?:,\d{3})*)/i },
    { rx: /(\d+)\s*stitch/i },
  ];
  for (const { rx, kMultiplier } of patterns) {
    const m = text.match(rx);
    if (!m) continue;
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    return kMultiplier ? n * 1000 : n;
  }
  return null;
}

/**
 * Stitch count for a PO. Real Syncore POs carry it on a structured line
 * item (`type === "StitchCount"`, value in `description` like "7,000"),
 * not in `decoration_instructions` — so we look there first and fall back
 * to the free-text parser only if no structured line is present.
 */
export function stitchCountFromPo(
  po: SyncorePurchaseOrder,
): number | null {
  for (const li of po.line_items) {
    if (li.type === "StitchCount" && li.description) {
      const n = Number(li.description.replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return parseStitchCount(po.decoration_instructions);
}

/**
 * True when the PO's `ship_to.business_name` identifies Color Graphics as
 * the recipient — i.e., the apparel is coming here to be decorated, not
 * to a contract decorator. Used to filter the Inbound view to Kristen's
 * actual receiving load.
 *
 * Permissive match: lowercase, contains "color graphics". Catches "Color
 * Graphics", "Color Graphics, Inc.", etc., without misclassifying a
 * different vendor that happens to start with similar words.
 */
export function isShippingToCg(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const shipTo = (raw as { ship_to?: { business_name?: string | null } | null })
    .ship_to;
  const name = shipTo?.business_name?.trim().toLowerCase() ?? "";
  return name.includes("color graphics");
}

/**
 * Best-effort total quantity from a PO's line items. POs in Syncore can be
 * either flat (one line per SKU with quantity) or nested like sales orders
 * (Asi → Color → Size, with quantity only on Size leaves). Try flat first,
 * fall back to summing Size leaves.
 */
export function totalQuantity(po: SyncorePurchaseOrder): number {
  let topLevel = 0;
  for (const li of po.line_items) {
    if (li.parent_id === 0 && li.visible !== false && (li.quantity ?? 0) > 0) {
      topLevel += li.quantity ?? 0;
    }
  }
  if (topLevel > 0) return topLevel;

  let sizes = 0;
  for (const li of po.line_items) {
    if (li.type === "Size") sizes += li.quantity ?? 0;
  }
  return sizes;
}
