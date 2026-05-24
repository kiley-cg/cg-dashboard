// Shared "push a PO's tracking #s into its Syncore Job Log entry"
// helper. Used by both the auto-sync on user "Add" (the server action
// in app/(app)/production/_actions.ts) and the Phase 5 vendor-tracking
// cron, so the format stays identical no matter which path the entry
// came from.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { listTrackingForPo } from "@/lib/db/receiving";
import { addJobTrackerEntry, WebUiError } from "@/lib/syncore/webui";

export type PushResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

export async function pushPoTrackingToJobLog(poId: string): Promise<PushResult> {
  const [poRow, trackingEntries] = await Promise.all([
    db
      .select({
        syncoreJobId: schema.productionPoMirror.syncoreJobId,
        poNumber: schema.productionPoMirror.poNumber,
        supplierName: schema.productionPoMirror.supplierName,
      })
      .from(schema.productionPoMirror)
      .where(eq(schema.productionPoMirror.poId, poId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    listTrackingForPo(poId),
  ]);

  if (!poRow) return { ok: false, error: `PO ${poId} not found in mirror` };
  if (trackingEntries.length === 0) {
    return { ok: false, error: "No tracking numbers entered yet for this PO" };
  }

  const poLabel =
    poRow.poNumber != null ? `${poRow.syncoreJobId}-${poRow.poNumber}` : poId;
  const carriersSeen = new Set(
    trackingEntries.map((t) => t.carrier).filter(Boolean),
  );
  const carrierText =
    carriersSeen.size === 1
      ? Array.from(carriersSeen)[0]
      : carriersSeen.size > 1
        ? "mixed"
        : "carrier unknown";
  const supplierTail = poRow.supplierName ? ` (${poRow.supplierName})` : "";

  const header = `Tracking — ${carrierText} — PO ${poLabel}${supplierTail}`;
  const body = trackingEntries
    .map((t) => `  ${t.carrier}: ${t.trackingNumber}`)
    .join("\n");
  const description = `${header}\n${body}`;

  try {
    const ok = await addJobTrackerEntry({
      jobId: poRow.syncoreJobId,
      description,
    });
    if (!ok) return { ok: false, error: "Syncore returned Result=false" };
    return { ok: true };
  } catch (err) {
    if (err instanceof WebUiError) {
      return { ok: false, error: err.message, status: err.status };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
