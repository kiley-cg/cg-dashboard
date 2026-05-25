// Phase 5b: poll carriers for ETA + delivery status on every po_tracking
// row we have. Today UPS only — Color Graphics's apparel vendors ship
// almost exclusively UPS (SanMar OSN response confirms 100% UPS for the
// open POs we've seen). FedEx/USPS would need a headless browser per the
// CG decision; out of scope for now.
//
// Updates po_tracking.{status, eta, lastPolledAt}. Skips rows polled
// within the last 4 hours (we run every 4 hours and don't want to burn
// UPS quota re-polling the same delivered shipments).
//
// Manual run:
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//     http://localhost:3000/api/cron/poll-carriers?limit=50

import { NextResponse } from "next/server";
import { logCronRun } from "@/lib/cron/log";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchUpsTracking, UpsTrackingError } from "@/lib/ups/tracking";

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

interface RowResult {
  trackingId: string;
  trackingNumber: string;
  outcome: "updated" | "noop" | "skipped" | "error";
  reason?: string;
  status?: string | null;
  eta?: string | null;
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
    Number(url.searchParams.get("limit") ?? "300") || 300,
    1000,
  );

  // Only re-poll if it's been > 4h since last poll, OR never polled.
  // Delivered shipments don't change, but we still re-poll once in
  // case UPS marks an exception — cheap insurance.
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: schema.poTracking.id,
      trackingNumber: schema.poTracking.trackingNumber,
      carrier: schema.poTracking.carrier,
      status: schema.poTracking.status,
      lastPolledAt: schema.poTracking.lastPolledAt,
    })
    .from(schema.poTracking)
    .where(
      and(
        // case-insensitive UPS match — vendor adapters may capitalize
        // differently (e.g. "UPS" vs "Ups").
        sql`lower(${schema.poTracking.carrier}) = 'ups'`,
        or(
          isNull(schema.poTracking.lastPolledAt),
          lt(schema.poTracking.lastPolledAt, cutoff),
        ),
      ),
    )
    .limit(limit);

  const startedAt = Date.now();
  const results: RowResult[] = new Array(rows.length);

  const processOne = async (
    row: (typeof rows)[number],
    index: number,
  ): Promise<void> => {
    try {
      const t = await fetchUpsTracking(row.trackingNumber);
      const eta = t.actualDeliveryDate ?? t.scheduledDeliveryDate ?? null;
      const status =
        t.statusDescription ??
        (t.statusCode ? `code:${t.statusCode}` : null);

      await db
        .update(schema.poTracking)
        .set({
          status,
          eta,
          lastPolledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.poTracking.id, row.id));

      results[index] = {
        trackingId: row.id,
        trackingNumber: row.trackingNumber,
        outcome: "updated",
        status,
        eta,
      };
    } catch (err) {
      // Even on failure, stamp lastPolledAt so we don't hammer a
      // broken tracking # every run. 4h cooldown applies to errors too.
      await db
        .update(schema.poTracking)
        .set({ lastPolledAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.poTracking.id, row.id))
        .catch(() => {
          // Don't fail the whole row if the lastPolledAt stamp fails;
          // the real diagnostic is the original error.
        });

      const msg =
        err instanceof UpsTrackingError
          ? `${err.message}${err.status ? ` [${err.status}]` : ""}`
          : err instanceof Error
            ? err.message
            : String(err);
      results[index] = {
        trackingId: row.id,
        trackingNumber: row.trackingNumber,
        outcome: "error",
        error: msg.slice(0, 300),
      };
    }
  };

  // Concurrency 8 — UPS API tolerates this easily on a prod account
  // and keeps a 300-row sweep under ~40s.
  const CONCURRENCY = 8;
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= rows.length) return;
      await processOne(rows[i], i);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const summary = {
    rowCount: results.length,
    updated: results.filter((r) => r.outcome === "updated").length,
    errors: results.filter((r) => r.outcome === "error").length,
    delivered: results.filter(
      (r) => r.outcome === "updated" && r.status?.toLowerCase().includes("delivered"),
    ).length,
    durationMs: Date.now() - startedAt,
  };

  return NextResponse.json({ ok: true, summary, results });
}

export const POST = logCronRun("/api/cron/poll-carriers", handler);
export const GET = logCronRun("/api/cron/poll-carriers", handler);
