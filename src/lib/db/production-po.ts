// DB layer for the Production-PO mirror + per-PO schedule state.
//
// The mirror table (production_po_mirror) is a read-through cache of
// Syncore v2 purchase orders, refreshed by /api/cron/sync-production-pos.
// The schedule-state table (po_schedule_state) holds the dashboard-owned
// scheduling/floor status that lives outside Syncore.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./client";
import {
  APPAREL_SUPPLIER_IDS,
  IN_HOUSE_SUPPLIER_CLASS,
  isShippingToCg,
  stitchCountFromPo,
  totalQuantity,
} from "@/lib/syncore/production";
import type { SyncorePurchaseOrder } from "@/lib/syncore/types";

// ---------------------------------------------------------------------------
// Mirror upsert (writes from the cron)
// ---------------------------------------------------------------------------

export interface UpsertResult {
  jobId: string;
  upserted: number;
  decorationPoCount: number;
  apparelPoCount: number;
}

/**
 * Upsert every PO under a job into the mirror. Pass the list returned by
 * listPurchaseOrders(jobId). We upsert ALL of them (apparel + decoration)
 * so the page can compute "inbound apparel status" for a decoration card
 * by looking up sibling POs from the same job in one read.
 */
export async function upsertJobPos(args: {
  jobId: string;
  pos: SyncorePurchaseOrder[];
}): Promise<UpsertResult> {
  if (args.pos.length === 0) {
    return {
      jobId: args.jobId,
      upserted: 0,
      decorationPoCount: 0,
      apparelPoCount: 0,
    };
  }

  const rows = args.pos.map((po) => ({
    poId: String(po.id),
    syncoreJobId: args.jobId,
    poNumber: po.number ?? null,
    status: po.status ?? "Unknown",
    supplierId: po.supplier?.id ?? null,
    supplierName: po.supplier?.name ?? null,
    supplierClass: po.supplier?.class ?? null,
    inHandDate: po.in_hand_date ?? null,
    decorationInstructions: po.decoration_instructions ?? null,
    stitchCount: stitchCountFromPo(po),
    totalQuantity: totalQuantity(po),
    raw: po as unknown,
    mirroredAt: new Date(),
  }));

  await db
    .insert(schema.productionPoMirror)
    .values(rows)
    .onConflictDoUpdate({
      target: schema.productionPoMirror.poId,
      set: {
        syncoreJobId: sql`excluded.syncore_job_id`,
        poNumber: sql`excluded.po_number`,
        status: sql`excluded.status`,
        supplierId: sql`excluded.supplier_id`,
        supplierName: sql`excluded.supplier_name`,
        supplierClass: sql`excluded.supplier_class`,
        inHandDate: sql`excluded.in_hand_date`,
        decorationInstructions: sql`excluded.decoration_instructions`,
        stitchCount: sql`excluded.stitch_count`,
        totalQuantity: sql`excluded.total_quantity`,
        raw: sql`excluded.raw`,
        mirroredAt: sql`excluded.mirrored_at`,
      },
    });

  let dec = 0;
  let app = 0;
  for (const r of rows) {
    if (r.supplierClass === IN_HOUSE_SUPPLIER_CLASS) dec++;
    else app++;
  }

  return {
    jobId: args.jobId,
    upserted: rows.length,
    decorationPoCount: dec,
    apparelPoCount: app,
  };
}

// ---------------------------------------------------------------------------
// Reads for the production page
// ---------------------------------------------------------------------------

export type MirroredPo = typeof schema.productionPoMirror.$inferSelect;
export type PoScheduleState = typeof schema.poScheduleState.$inferSelect;

export interface DecorationPoView {
  po: MirroredPo;
  state: PoScheduleState | null;
  // Sibling apparel POs from the same job — used to compute the "inbound
  // status" badge on the card. Empty array if this is a job with no apparel
  // purchase (e.g. customer-supplied garments).
  apparelSiblings: MirroredPo[];
  // Total tracking entries across all apparel siblings for the same job —
  // surfaced on the card so the floor sees how many shipments are en route.
  inboundTrackingCount: number;
}

/**
 * Every decoration PO whose Syncore status is still "open" (not yet posted)
 * plus its per-PO schedule state and any apparel sibling POs from the same
 * job. One query per shape, joined in memory — keeps the SQL boring.
 */
export async function listOpenDecorationPos(): Promise<DecorationPoView[]> {
  // Decoration POs we still care about. Syncore status moves Open →
  // Approved → Posted Manually → Posted @ease A/P → Paid. We treat
  // anything other than the terminal "Posted Manually" / "Paid" as still
  // "in flight" so the floor can see jobs they haven't finished.
  const decorationPos = await db
    .select()
    .from(schema.productionPoMirror)
    .where(
      and(
        eq(schema.productionPoMirror.supplierClass, IN_HOUSE_SUPPLIER_CLASS),
        sql`${schema.productionPoMirror.status} NOT IN ('Posted Manually', 'Posted @ease A/P', 'Paid')`,
      ),
    )
    .orderBy(desc(schema.productionPoMirror.mirroredAt));

  if (decorationPos.length === 0) return [];

  const poIds = decorationPos.map((p) => p.poId);
  const jobIds = Array.from(new Set(decorationPos.map((p) => p.syncoreJobId)));

  const [states, siblings] = await Promise.all([
    db
      .select()
      .from(schema.poScheduleState)
      .where(inArray(schema.poScheduleState.poId, poIds)),
    db
      .select()
      .from(schema.productionPoMirror)
      .where(
        and(
          inArray(schema.productionPoMirror.syncoreJobId, jobIds),
          sql`(${schema.productionPoMirror.supplierClass} IS NULL OR ${schema.productionPoMirror.supplierClass} != ${IN_HOUSE_SUPPLIER_CLASS})`,
          // Apparel allowlist — same as the Inbound tab — so the
          // schedule cards' "X/Y apparel POs · N tracking" badge counts
          // only what Kristen actually receives as garments.
          inArray(
            schema.productionPoMirror.supplierId,
            Array.from(APPAREL_SUPPLIER_IDS),
          ),
        ),
      ),
  ]);

  const stateByPoId = new Map<string, PoScheduleState>();
  for (const s of states) stateByPoId.set(s.poId, s);

  // Only siblings coming TO CG matter for Kristen's planning — apparel
  // shipping to a contract decorator is somebody else's queue. Filter
  // here so the badge counts + tracking aggregate stay scoped to her
  // actual receiving load.
  const cgSiblings = siblings.filter((s) => isShippingToCg(s.raw));

  const siblingsByJob = new Map<string, MirroredPo[]>();
  for (const s of cgSiblings) {
    const arr = siblingsByJob.get(s.syncoreJobId) ?? [];
    arr.push(s);
    siblingsByJob.set(s.syncoreJobId, arr);
  }

  // Aggregate tracking counts across all sibling POs in one query so the
  // card doesn't fan out N queries per render.
  const trackingCountByPoId = new Map<string, number>();
  const siblingPoIds = cgSiblings.map((s) => s.poId);
  if (siblingPoIds.length > 0) {
    const rows = await db
      .select({
        poId: schema.poTracking.poId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.poTracking)
      .where(inArray(schema.poTracking.poId, siblingPoIds))
      .groupBy(schema.poTracking.poId);
    for (const r of rows) trackingCountByPoId.set(r.poId, Number(r.count));
  }

  return decorationPos.map((po) => {
    const jobSiblings = siblingsByJob.get(po.syncoreJobId) ?? [];
    const inboundTrackingCount = jobSiblings.reduce(
      (sum, s) => sum + (trackingCountByPoId.get(s.poId) ?? 0),
      0,
    );
    return {
      po,
      state: stateByPoId.get(po.poId) ?? null,
      apparelSiblings: jobSiblings,
      inboundTrackingCount,
    };
  });
}

/**
 * Best-effort customer-display lookup keyed by Syncore job ID. Joins on
 * the most recent follow-up row for the job; null if the job has never
 * appeared in a follow-up snapshot.
 *
 * Strictly a display convenience — the production page falls back to the
 * PO's `ship_to.business_name` and finally to "Job #XXXXX" when this
 * returns nothing. Phase 2 will add a proper job mirror with the
 * authoritative `client.business_name`.
 */
export async function getCustomerDisplayMap(opts: {
  jobIds: string[];
}): Promise<Map<string, string>> {
  if (opts.jobIds.length === 0) return new Map();
  const numericIds = opts.jobIds
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n));
  if (numericIds.length === 0) return new Map();
  const rows = await db.execute<{
    job_id: number | string;
    job_description: string | null;
    contact: string | null;
  }>(sql`
    SELECT DISTINCT ON (job_id)
      job_id,
      job_description,
      contact
    FROM followup_rows
    WHERE job_id IN (${sql.join(
      numericIds.map((n) => sql`${n}`),
      sql`, `,
    )})
    ORDER BY job_id, snapshot_at DESC
  `);
  const map = new Map<string, string>();
  for (const r of Array.from(
    rows as Iterable<{
      job_id: number | string;
      job_description: string | null;
      contact: string | null;
    }>,
  )) {
    // contact is a person name (e.g. "Jane Smith @ Heritage Bank"), not a
    // company. Prefer it when present, else job_description. Either is
    // better than the bare job number.
    const v = r.contact?.trim() || r.job_description?.trim();
    if (v) map.set(String(r.job_id), v);
  }
  return map;
}

/**
 * Last successful mirror time across all POs, for the page's "last
 * updated" header. Null if the table is empty.
 */
export async function getMostRecentMirrorAt(): Promise<Date | null> {
  const rows = await db
    .select({ at: schema.productionPoMirror.mirroredAt })
    .from(schema.productionPoMirror)
    .orderBy(desc(schema.productionPoMirror.mirroredAt))
    .limit(1);
  if (rows.length === 0) return null;
  const v = rows[0].at;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
