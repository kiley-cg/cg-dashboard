// DB layer for the Production-PO mirror + per-PO schedule state.
//
// The mirror table (production_po_mirror) is a read-through cache of
// Syncore v2 purchase orders, refreshed by /api/cron/sync-production-pos.
// The schedule-state table (po_schedule_state) holds the dashboard-owned
// scheduling/floor status that lives outside Syncore.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./client";
import {
  IN_HOUSE_SUPPLIER_CLASS,
  parseStitchCount,
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
    stitchCount: parseStitchCount(po.decoration_instructions),
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
          sql`${schema.productionPoMirror.supplierClass} IS DISTINCT FROM ${IN_HOUSE_SUPPLIER_CLASS}`,
        ),
      ),
  ]);

  const stateByPoId = new Map<string, PoScheduleState>();
  for (const s of states) stateByPoId.set(s.poId, s);

  const siblingsByJob = new Map<string, MirroredPo[]>();
  for (const s of siblings) {
    const arr = siblingsByJob.get(s.syncoreJobId) ?? [];
    arr.push(s);
    siblingsByJob.set(s.syncoreJobId, arr);
  }

  return decorationPos.map((po) => ({
    po,
    state: stateByPoId.get(po.poId) ?? null,
    apparelSiblings: siblingsByJob.get(po.syncoreJobId) ?? [],
  }));
}

/**
 * Distinct job IDs from the most recent N days of CSR follow-up snapshots.
 * The mirror cron uses this as its seed list since Syncore v2 doesn't
 * expose a global "all open jobs" search — see the planning thread.
 */
export async function getRecentFollowupJobIds(opts: {
  days: number;
}): Promise<string[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - opts.days);
  const rows = await db.execute<{ job_id: number | string }>(sql`
    SELECT DISTINCT job_id
    FROM followup_rows
    WHERE snapshot_at >= ${since.toISOString()}
  `);
  const arr = Array.from(rows as Iterable<{ job_id: number | string }>);
  return arr
    .map((r) => String(r.job_id))
    .filter((id) => id !== "" && id !== "null");
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
    WHERE job_id = ANY(${numericIds}::int[])
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
