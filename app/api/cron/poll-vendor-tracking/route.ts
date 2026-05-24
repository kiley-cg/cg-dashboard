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
import { and, desc, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { addTrackingIfMissing } from "@/lib/db/receiving";
import { fetchVendorTracking } from "@/lib/vendors/tracking";
import { APPAREL_SUPPLIER_IDS } from "@/lib/syncore/production";
import { pushPoTrackingToJobLog } from "@/lib/syncore/job-tracker-push";

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
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? "100") || 100,
    500,
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

  for (const po of pos) {
    if (po.poNumber == null) {
      results.push({
        poId: po.poId,
        jobId: po.jobId,
        poNumber: null,
        supplier: po.supplier,
        vendor: "unknown",
        outcome: "skipped",
        reason: "no PO number on mirror",
      });
      continue;
    }

    // SanMar / C&B / S&S all want the customer-facing PO number, which
    // for Color Graphics is `{jobId}-{poNumber}` (matches the ePO push
    // format we see in the Syncore Job Log).
    const vendorPoNumber = `${po.jobId}-${po.poNumber}`;

    try {
      const { vendor, shipments } = await fetchVendorTracking({
        supplierName: po.supplier,
        poNumber: vendorPoNumber,
      });

      if (vendor === "unknown" || vendor === "ss" || vendor === "cb") {
        results.push({
          poId: po.poId,
          jobId: po.jobId,
          poNumber: po.poNumber,
          supplier: po.supplier,
          vendor,
          outcome: "skipped",
          reason:
            vendor === "unknown"
              ? `unrecognized supplier "${po.supplier}"`
              : `${vendor} adapter not implemented yet`,
        });
        continue;
      }

      let added = 0;
      for (const s of shipments) {
        const inserted = await addTrackingIfMissing({
          poId: po.poId,
          carrier: s.carrier ?? "Unknown",
          trackingNumber: s.trackingNumber,
          source: "api",
        });
        if (inserted) added++;
      }

      // Only push to Syncore Job Log when we actually added something
      // new — avoids spamming the log on re-runs that find no changes.
      let jobLogSynced = false;
      if (added > 0) {
        const push = await pushPoTrackingToJobLog(po.poId);
        jobLogSynced = push.ok;
      }

      results.push({
        poId: po.poId,
        jobId: po.jobId,
        poNumber: po.poNumber,
        supplier: po.supplier,
        vendor,
        outcome: "polled",
        shipmentCount: shipments.length,
        added,
        jobLogSynced,
      });
    } catch (err) {
      results.push({
        poId: po.poId,
        jobId: po.jobId,
        poNumber: po.poNumber,
        supplier: po.supplier,
        vendor: "error",
        outcome: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
export const POST = handler;
export const GET = handler;
