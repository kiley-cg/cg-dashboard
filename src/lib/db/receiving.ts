// DB layer for inbound apparel-PO receiving + tracking.
//
// Inbound apparel POs are everything in production_po_mirror with
// supplier_class != 'In House Production' (so SanMar, S&S, Cutter & Buck,
// Anico, etc.). They're the things production is WAITING for; decoration
// POs we own are scheduled separately.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./client";
import {
  IN_HOUSE_SUPPLIER_CLASS,
  isShippingToCg,
} from "@/lib/syncore/production";

export type MirroredPo = typeof schema.productionPoMirror.$inferSelect;
export type InboundReceiptState = typeof schema.poInboundState.$inferSelect;
export type TrackingEntry = typeof schema.poTracking.$inferSelect;

export interface InboundPoView {
  po: MirroredPo;
  receipt: InboundReceiptState | null;
  tracking: TrackingEntry[];
}

/**
 * Every inbound apparel PO whose Syncore status is still in flight
 * (Open / Approved — not yet posted), plus our local receipt state and
 * tracking entries. Ordered by in_hand_date ascending so the most-urgent
 * arrivals float to the top.
 *
 * `cgOnly` (default true) restricts to POs whose ship_to is Color
 * Graphics — what Kristen actually receives. The future CSR dashboard
 * will pass `cgOnly: false` to see everything regardless of destination.
 */
export async function listInboundPos(
  opts: { cgOnly?: boolean } = {},
): Promise<InboundPoView[]> {
  const cgOnly = opts.cgOnly ?? true;

  const rawPos = await db
    .select()
    .from(schema.productionPoMirror)
    .where(
      and(
        sql`(${schema.productionPoMirror.supplierClass} IS NULL OR ${schema.productionPoMirror.supplierClass} != ${IN_HOUSE_SUPPLIER_CLASS})`,
        sql`${schema.productionPoMirror.status} NOT IN ('Posted Manually', 'Posted @ease A/P', 'Paid')`,
      ),
    )
    .orderBy(
      sql`COALESCE(${schema.productionPoMirror.inHandDate}, '9999-12-31') ASC`,
      asc(schema.productionPoMirror.syncoreJobId),
    );

  const pos = cgOnly ? rawPos.filter((p) => isShippingToCg(p.raw)) : rawPos;

  if (pos.length === 0) return [];

  const poIds = pos.map((p) => p.poId);

  const [receipts, tracking] = await Promise.all([
    db
      .select()
      .from(schema.poInboundState)
      .where(inArray(schema.poInboundState.poId, poIds)),
    db
      .select()
      .from(schema.poTracking)
      .where(inArray(schema.poTracking.poId, poIds))
      .orderBy(desc(schema.poTracking.createdAt)),
  ]);

  const receiptByPo = new Map<string, InboundReceiptState>();
  for (const r of receipts) receiptByPo.set(r.poId, r);

  const trackingByPo = new Map<string, TrackingEntry[]>();
  for (const t of tracking) {
    const arr = trackingByPo.get(t.poId) ?? [];
    arr.push(t);
    trackingByPo.set(t.poId, arr);
  }

  return pos.map((po) => ({
    po,
    receipt: receiptByPo.get(po.poId) ?? null,
    tracking: trackingByPo.get(po.poId) ?? [],
  }));
}

export async function addTracking(args: {
  poId: string;
  carrier: string;
  trackingNumber: string;
  userId: string | null;
}): Promise<void> {
  await db.insert(schema.poTracking).values({
    poId: args.poId,
    carrier: args.carrier,
    trackingNumber: args.trackingNumber,
    source: "manual",
    enteredByUserId: args.userId,
  });
}

export async function deleteTracking(trackingId: string): Promise<void> {
  await db
    .delete(schema.poTracking)
    .where(eq(schema.poTracking.id, trackingId));
}

export async function markReceived(args: {
  poId: string;
  userId: string | null;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(schema.poInboundState)
    .values({
      poId: args.poId,
      receivedAt: now,
      receivedByUserId: args.userId,
    })
    .onConflictDoUpdate({
      target: schema.poInboundState.poId,
      set: {
        receivedAt: now,
        receivedByUserId: args.userId,
        updatedAt: now,
      },
    });
}

export async function unmarkReceived(poId: string): Promise<void> {
  await db
    .insert(schema.poInboundState)
    .values({ poId, receivedAt: null, receivedByUserId: null })
    .onConflictDoUpdate({
      target: schema.poInboundState.poId,
      set: {
        receivedAt: sql`NULL`,
        receivedByUserId: sql`NULL`,
        syncoreMemoUpdatedAt: sql`NULL`,
        updatedAt: new Date(),
      },
    });
}
