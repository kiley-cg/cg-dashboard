// Phase 5: poll vendor APIs for tracking #s on open apparel POs.
//
// Runs 2x daily (8am + 2pm Pacific) via vercel.json. For each open
// apparel PO, calls the vendor's tracking adapter; for each shipment
// returned, inserts into po_tracking with source="api" (dedup keyed on
// poId + trackingNumber so re-runs are idempotent). Any newly added
// tracking # also auto-posts to the Syncore Job Log so everyone at CG
// sees it without a manual click.
//
// Today: SanMar wired. S&S and C&B return empty until their adapters
// land (resolveTrackingVendor falls through cleanly).
//
// Manual run:
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//     http://localhost:3000/api/cron/poll-vendor-tracking?limit=10

import { NextResponse } from "next/server";
import { logCronRun } from "@/lib/cron/log";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { addTrackingIfMissing } from "@/lib/db/receiving";
import { fetchVendorTracking } from "@/lib/vendors/tracking";
import { APPAREL_SUPPLIER_IDS } from "@/lib/syncore/production";
import { pushPoTrackingToJobLog } from "@/lib/syncore/job-tracker-push";
import { fetchUpsTracking } from "@/lib/ups/tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

interface PoResult {
  poId: string;
  jobId: string;
  poNumber: number | null;
  supplier: string | null;
  vendor: string;
  // What happened: "polled" with shipmentCount, "skipped" (vendor not
  // wired / no PO number / etc.), "error" with message.
  outcome: "polled" | "skipped" | "error";
  shipmentCount?: number;
  added?: number;
  jobLogSynced?: boolean;
  reason?: string;
  error?: string;
}

async function handler(req: Request): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  // Default to a sweep that comfortably covers all open apparel POs in
  // the mirror today (~300-400). Cap at 1000 so a malformed query can't
  // pull the entire history. The scheduled 2x-daily cron runs without
  // params and gets the default.
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? "500") || 500,
    1000,
  );

  const startedAt = Date.now();

  // Open apparel POs only — same filter as the production page uses for
  // sibling lookups. We poll each PO at most once per cron run.
  const pos = await db
    .select({
      poId: schema.productionPoMirror.poId,
      jobId: schema.productionPoMirror.syncoreJobId,
      poNumber: schema.productionPoMirror.poNumber,
      supplier: schema.productionPoMirror.supplierName,
      status: schema.productionPoMirror.status,
    })
    .from(schema.productionPoMirror)
    .where(
      and(
        inArray(
          schema.productionPoMirror.supplierId,
          Array.from(APPAREL_SUPPLIER_IDS),
        ),
        sql`${schema.productionPoMirror.status} NOT IN ('Posted Manually', 'Posted @ease A/P', 'Paid')`,
      ),
    )
    .orderBy(desc(schema.productionPoMirror.mirroredAt))
    .limit(limit);

  const results: PoResult[] = [];

  // Process one PO end-to-end (vendor lookup → dedup insert → Job Log
  // push). Returns a single PoResult. Pulled out so we can run several
  // POs in parallel — a serial loop over 200 POs at ~1.8s/SOAP-call
  // would burn 6 minutes and time out at the Vercel edge.
  const processPo = async (po: (typeof pos)[number]): Promise<PoResult> => {
    if (po.poNumber == null) {
      return {
        poId: po.poId,
        jobId: po.jobId,
        poNumber: null,
        supplier: po.supplier,
        vendor: "unknown",
        outcome: "skipped",
        reason: "no PO number on mirror",
      };
    }

    const vendorPoNumber = `${po.jobId}-${po.poNumber}`;

    try {
      const { vendor, shipments } = await fetchVendorTracking({
        supplierName: po.supplier,
        poNumber: vendorPoNumber,
      });

      if (vendor === "unknown") {
        return {
          poId: po.poId,
          jobId: po.jobId,
          poNumber: po.poNumber,
          supplier: po.supplier,
          vendor,
          outcome: "skipped",
          reason: `unrecognized supplier "${po.supplier}"`,
        };
      }

      let added = 0;
      for (const s of shipments) {
        const carrier = s.carrier ?? "Unknown";
        const inserted = await addTrackingIfMissing({
          poId: po.poId,
          carrier,
          trackingNumber: s.trackingNumber,
          source: "api",
        });
        if (!inserted) continue;
        added++;
        // Synchronous UPS Track call on newly-inserted UPS rows so the
        // Job Log push below can include ETA / delivery status inline.
        // Skips non-UPS carriers; failures here are non-fatal (the
        // 4-hourly poll-carriers cron will fill these in later).
        if (carrier.toUpperCase() === "UPS" && s.trackingNumber.startsWith("1Z")) {
          try {
            const t = await fetchUpsTracking(s.trackingNumber);
            const eta = t.actualDeliveryDate ?? t.scheduledDeliveryDate ?? null;
            const status =
              t.statusDescription ?? (t.statusCode ? `code:${t.statusCode}` : null);
            await db
              .update(schema.poTracking)
              .set({
                eta,
                status,
                lastPolledAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.poTracking.poId, po.poId),
                  eq(schema.poTracking.trackingNumber, s.trackingNumber),
                ),
              );
          } catch {
            // UPS hiccup — fine, poll-carriers will retry.
          }
        }
      }

      let jobLogSynced = false;
      if (added > 0) {
        const push = await pushPoTrackingToJobLog(po.poId);
        jobLogSynced = push.ok;
      }

      return {
        poId: po.poId,
        jobId: po.jobId,
        poNumber: po.poNumber,
        supplier: po.supplier,
        vendor,
        outcome: "polled",
        shipmentCount: shipments.length,
        added,
        jobLogSynced,
      };
    } catch (err) {
      return {
        poId: po.poId,
        jobId: po.jobId,
        poNumber: po.poNumber,
        supplier: po.supplier,
        vendor: "error",
        outcome: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // Bounded-concurrency runner — fixed pool of workers pulling from a
  // shared queue. WSDL is cached after the first SOAP client load, so
  // most per-PO cost is one HTTP round-trip. 16 in flight keeps the
  // route under Vercel's edge timeout at limit=500 and is well below
  // any plausible vendor rate limit.
  const CONCURRENCY = 16;
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= pos.length) return;
      results[i] = await processPo(pos[i]);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const summary = {
    poCount: results.length,
    polled: results.filter((r) => r.outcome === "polled").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    errors: results.filter((r) => r.outcome === "error").length,
    totalAdded: results.reduce((sum, r) => sum + (r.added ?? 0), 0),
    durationMs: Date.now() - startedAt,
  };

  return NextResponse.json({ ok: true, summary, results });
}

// Vercel cron uses POST internally (per the existing snapshot-followups
// pattern). Support GET too for easier manual / curl invocation.
export const POST = logCronRun("/api/cron/poll-vendor-tracking", handler);
export const GET = logCronRun("/api/cron/poll-vendor-tracking", handler);
