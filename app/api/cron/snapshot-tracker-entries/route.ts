// Phase C: snapshot Syncore Job Tracker entries into the local
// tracker_entries_cache so the inbox view can read without going to
// Syncore live. Runs every 30 minutes per vercel.json.
//
// Manual on-demand variant fires the same path from the inbox's
// Refresh button.

import { NextResponse } from "next/server";
import { logCronRun } from "@/lib/cron/log";
import {
  listSnapshotJobIds,
  snapshotJobsConcurrently,
} from "@/lib/syncore/snapshot-tracker-entries";

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

async function handler(req: Request): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? "500") || 500,
    1000,
  );
  const length = Math.min(
    Number(url.searchParams.get("length") ?? "20") || 20,
    100,
  );

  const startedAt = Date.now();
  const jobIds = await listSnapshotJobIds({ limit });
  const results = await snapshotJobsConcurrently({
    jobIds,
    concurrency: 8,
  });

  const summary = {
    jobCount: results.length,
    inserted: results.reduce((sum, r) => sum + r.inserted, 0),
    updated: results.reduce((sum, r) => sum + r.updated, 0),
    errors: results.filter((r) => r.errors).length,
    durationMs: Date.now() - startedAt,
    snapshotLength: length,
  };

  return NextResponse.json({ ok: true, summary });
}

export const POST = logCronRun("/api/cron/snapshot-tracker-entries", handler);
export const GET = logCronRun("/api/cron/snapshot-tracker-entries", handler);
