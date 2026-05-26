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
  // ?parseSpec=false → metadata-only sweep (no PDF download/parse).
  // Useful as a fast connectivity probe when troubleshooting auth.
  const parseSpecParam = url.searchParams.get("parseSpec");
  const parseSpec = parseSpecParam === "false" ? false : true;
  // ?rootFolderId=<id> → walk a specific subfolder instead of the
  // configured Shared Drive root. Used for range-folder backfills
  // (e.g. one of the "30000-30999" folders).
  const rootFolderId = url.searchParams.get("rootFolderId") ?? undefined;
  // ?limit=N → cap PDFs processed per call (chunk a large backfill).
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  // ?concurrency=N → parallel PDF downloads. Default 4.
  const concurrencyParam = url.searchParams.get("concurrency");
  const concurrency = concurrencyParam ? Number(concurrencyParam) : undefined;

  const startedAt = Date.now();
  try {
    const results = await snapshotProofs({
      modifiedAfter,
      parseSpec,
      rootFolderId,
      limit: Number.isFinite(limit) && limit! > 0 ? limit : undefined,
      concurrency:
        Number.isFinite(concurrency) && concurrency! > 0 ? concurrency : undefined,
    });
    const summary = {
      proofCount: results.length,
      inserted: results.filter((r) => r.outcome === "inserted").length,
      updated: results.filter((r) => r.outcome === "updated").length,
      skipped: results.filter((r) => r.outcome === "skipped").length,
      modifiedAfter: modifiedAfter.toISOString(),
      parseSpec,
      rootFolderId: rootFolderId ?? null,
      limit: limit ?? null,
      concurrency: concurrency ?? null,
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
