import { and, eq } from "drizzle-orm";
import { db, schema } from "./client";
import type { FlatLineItem } from "@/lib/syncore/types";
import type { InventoryLookup } from "@/lib/vendors/types";

/**
 * Existing verifications for a job, keyed by `${salesOrderId}:${sizeLineId}`.
 * The presence of a key means "already verified at some point" — the row's
 * Verify badge should render green and skip the button.
 */
export async function findVerificationsForJob(
  jobId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({
      orderId: schema.verifications.syncoreOrderId,
      lineId: schema.verifications.syncoreLineId,
    })
    .from(schema.verifications);

  const found = new Set<string>();
  for (const r of rows) {
    // syncoreOrderId is stored as `${jobId}:${salesOrderId}`.
    const [job, salesOrder] = r.orderId.split(":", 2);
    if (job !== jobId) continue;
    found.add(`${salesOrder}:${r.lineId}`);
  }
  return found;
}

/**
 * Hybrid auto-verify: for any "clean" row (vendor returned data and stock is
 * sufficient) that doesn't yet have a verification record, insert one.
 * Returns the set of verified `${salesOrderId}:${sizeLineId}` keys after this
 * run (existing + freshly inserted).
 *
 * Skipped:
 *  - vendor errors / no SKU / unsupported (nothing to verify)
 *  - partial fills (rep must explicitly acknowledge)
 *  - zero stock (rep must explicitly acknowledge)
 */
export async function autoVerifyClean(args: {
  jobId: string;
  userId: string;
  salesOrders: Array<{
    salesOrderId: number;
    rows: Array<{ line: FlatLineItem; lookup: InventoryLookup }>;
  }>;
  alreadyVerified: Set<string>;
}): Promise<Set<string>> {
  const { jobId, userId, salesOrders, alreadyVerified } = args;
  const inserted = new Set(alreadyVerified);

  const toInsert: Array<typeof schema.verifications.$inferInsert> = [];

  for (const { salesOrderId, rows } of salesOrders) {
    for (const { line, lookup } of rows) {
      if (lookup.status !== "ok") continue;

      const exact = lookup.lines.find(
        (l) =>
          (!line.color ||
            l.color?.toLowerCase() === line.color.toLowerCase()) &&
          (!line.size || l.size?.toLowerCase() === line.size.toLowerCase()),
      );
      const available = exact
        ? exact.quantityAvailable
        : lookup.lines.reduce((n, l) => n + l.quantityAvailable, 0);

      const sufficient = available >= line.qtyOrdered;
      if (!sufficient) continue;

      const key = `${salesOrderId}:${line.sizeLineId}`;
      if (inserted.has(key)) continue;

      toInsert.push({
        syncoreOrderId: `${jobId}:${salesOrderId}`,
        syncoreLineId: String(line.sizeLineId),
        vendor: lookup.vendor,
        productId: lookup.productId ?? line.productId ?? "",
        qtyOrdered: line.qtyOrdered,
        qtyAvailable: available,
        qtyConfirmed: line.qtyOrdered,
        vendorSnapshot: lookup,
        verifiedByUserId: userId,
        note: "auto-verified: full fill",
      });
      inserted.add(key);
    }
  }

  if (toInsert.length > 0) {
    try {
      await db.insert(schema.verifications).values(toInsert);
    } catch (err) {
      console.error("[auto-verify] insert failed", err);
      // Don't block page render — fall back to manual verification on those rows.
      for (const v of toInsert) {
        const [, salesOrderId] = v.syncoreOrderId.split(":", 2);
        inserted.delete(`${salesOrderId}:${v.syncoreLineId}`);
      }
    }
  }

  // and/eq imports kept around in case we tighten the query later.
  void and;
  void eq;
  return inserted;
}
