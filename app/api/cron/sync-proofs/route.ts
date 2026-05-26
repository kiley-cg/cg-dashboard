// Phase D2.A — sync Christina's Drive proofs into jobVerificationRecord.
// Scheduled hourly in vercel.json; trigger manually via /admin/crons.
//
// Today this writes a stub row per Drive PDF with filename + fileId in
// `raw`. D2.B will add PDF text extraction so imprintLocation /
// qtyGarments / approvedBy get populated.

import { NextResponse } from "next/server";
import { logCronRun } from "@/lib/cron/log";
import { snapshotProofs } from "@/lib/drive/snapshot-proofs";

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

  // ?modifiedAfter=<ISO> — defaults to "last 30 days" to keep each
  // sweep small. Manual triggers can pass ?modifiedAfter=1970-01-01
  // for a full backfill.
  const url = new URL(req.url);
  const modifiedAfterParam = url.searchParams.get("modifiedAfter");
  let modifiedAfter: Date | undefined =
    modifiedAfterParam ? new Date(modifiedAfterParam) : undefined;
  if (!modifiedAfter) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    modifiedAfter = d;
  }

  const startedAt = Date.now();
  try {
    const results = await snapshotProofs({ modifiedAfter });
    const summary = {
      proofCount: results.length,
      inserted: results.filter((r) => r.outcome === "inserted").length,
      updated: results.filter((r) => r.outcome === "updated").length,
      skipped: results.filter((r) => r.outcome === "skipped").length,
      modifiedAfter: modifiedAfter.toISOString(),
      durationMs: Date.now() - startedAt,
    };
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

export const POST = logCronRun("/api/cron/sync-proofs", handler);
export const GET = logCronRun("/api/cron/sync-proofs", handler);
