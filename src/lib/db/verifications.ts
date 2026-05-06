import { desc, eq } from "drizzle-orm";
import { db, schema } from "./client";
import type { FlatLineItem } from "@/lib/syncore/types";
import type { InventoryLookup } from "@/lib/vendors/types";
import { matchVariant } from "@/lib/vendors/match";

export type VerificationDetail = {
  verifiedAt: string; // ISO string — keeps the server/client boundary clean
  verifiedByEmail: string | null;
  verifiedByName: string | null;
  qtyOrdered: number | null;
  qtyAvailable: number | null;
  qtyConfirmed: number;
  note: string | null;
};

/**
 * Existing verifications for a job, keyed by `${salesOrderId}:${sizeLineId}`.
 * Returns the most-recent row per key when multiple verifications exist
 * (e.g. someone re-acknowledged a partial-fill row after stock changed).
 */
export async function findVerificationsForJob(
  jobId: string,
): Promise<Map<string, VerificationDetail>> {
  const rows = await db
    .select({
      orderId: schema.verifications.syncoreOrderId,
      lineId: schema.verifications.syncoreLineId,
      verifiedAt: schema.verifications.verifiedAt,
      qtyOrdered: schema.verifications.qtyOrdered,
      qtyAvailable: schema.verifications.qtyAvailable,
      qtyConfirmed: schema.verifications.qtyConfirmed,
      note: schema.verifications.note,
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.verifications)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.verifications.verifiedByUserId),
    )
    .orderBy(desc(schema.verifications.verifiedAt));

  const found = new Map<string, VerificationDetail>();
  for (const r of rows) {
    const [job, salesOrder] = r.orderId.split(":", 2);
    if (job !== jobId) continue;
    const key = `${salesOrder}:${r.lineId}`;
    if (found.has(key)) continue; // first hit wins (rows ordered DESC)
    found.set(key, {
      verifiedAt: r.verifiedAt.toISOString(),
      verifiedByEmail: r.email,
      verifiedByName: r.name,
      qtyOrdered: r.qtyOrdered,
      qtyAvailable: r.qtyAvailable,
      qtyConfirmed: r.qtyConfirmed,
      note: r.note,
    });
  }
  return found;
}

/**
 * Hybrid auto-verify: for any "clean" row (vendor returned data and stock is
 * sufficient) that doesn't yet have a verification record, insert one.
 * Returns the full map (existing + freshly inserted) for rendering.
 *
 * Skipped:
 *  - vendor errors / no SKU / unsupported (nothing to verify)
 *  - partial fills (rep must explicitly acknowledge)
 *  - zero stock (rep must explicitly acknowledge)
 */
/**
 * Whether the job has been "cleared" — i.e. a rep clicked the Clear all
 * verifications button. When true, autoVerifyClean is a no-op so reps
 * keep manual control instead of having every clean row re-verified on
 * the next render.
 */
export async function isJobAutoVerifyDisabled(jobId: string): Promise<boolean> {
  const rows = await db
    .select({ jobId: schema.jobVerificationClears.jobId })
    .from(schema.jobVerificationClears)
    .where(eq(schema.jobVerificationClears.jobId, jobId))
    .limit(1);
  return rows.length > 0;
}

export async function autoVerifyClean(args: {
  jobId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  salesOrders: Array<{
    salesOrderId: number;
    rows: Array<{ line: FlatLineItem; lookup: InventoryLookup }>;
  }>;
  alreadyVerified: Map<string, VerificationDetail>;
}): Promise<Map<string, VerificationDetail>> {
  const { jobId, userId, userEmail, userName, salesOrders, alreadyVerified } =
    args;
  const result = new Map(alreadyVerified);

  // Once a rep has explicitly cleared this job's verifications, never
  // auto-verify again — they want manual control. Re-enabling auto-
  // verify would require deleting the marker from job_verification_clears,
  // which there's no UI for (intentional: the button is one-way).
  if (await isJobAutoVerifyDisabled(jobId)) {
    return result;
  }

  const toInsert: Array<{
    key: string;
    row: typeof schema.verifications.$inferInsert;
  }> = [];

  for (const { salesOrderId, rows } of salesOrders) {
    for (const { line, lookup } of rows) {
      if (lookup.status !== "ok") continue;

      // Use the shared matcher — never sum across variants. If we can't
      // find this exact (color, size), don't auto-verify; surface the row
      // so the rep can investigate. Summing produced fake "full fill"
      // verifications that stuck around even after the matcher was fixed.
      const matched = matchVariant(lookup, line.color, line.size);
      if (!matched) continue;
      const available = matched.quantityAvailable;

      const sufficient = available >= line.qtyOrdered;
      if (!sufficient) continue;

      const key = `${salesOrderId}:${line.sizeLineId}`;
      if (result.has(key)) continue;

      toInsert.push({
        key,
        row: {
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
        },
      });
    }
  }

  if (toInsert.length > 0) {
    try {
      await db.insert(schema.verifications).values(toInsert.map((t) => t.row));
      const now = new Date().toISOString();
      for (const t of toInsert) {
        result.set(t.key, {
          verifiedAt: now,
          verifiedByEmail: userEmail,
          verifiedByName: userName,
          qtyOrdered: t.row.qtyOrdered ?? null,
          qtyAvailable: t.row.qtyAvailable ?? null,
          qtyConfirmed: t.row.qtyConfirmed,
          note: t.row.note ?? null,
        });
      }
    } catch (err) {
      console.error("[auto-verify] insert failed", err);
      // Fall back to manual verification on those rows.
    }
  }

  return result;
}
