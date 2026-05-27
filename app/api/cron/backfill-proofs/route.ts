// Daily slow-drip backfill of historical Drive proofs.
//
// The hourly /api/cron/sync-proofs handles new files (last 30 days,
// whole Drive). This cron handles the historical backlog — Christina
// has thousands of older proofs in range folders like "28000-28999"
// that pre-date the dashboard, and one big sweep won't fit in
// Vercel's 300s budget. Each invocation processes ONE chunk
// (200 files) from the oldest range that isn't done yet.
//
// Progress lives in `proof_backfill_state` so the cron is resumable
// across days. When all ranges hit doneAt, the cron is a no-op.

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { logCronRun } from "@/lib/cron/log";
import { getDriveClient, getProofsFolderId } from "@/lib/drive/client";
import { snapshotProofs } from "@/lib/drive/snapshot-proofs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One chunk per invocation. 200 fits inside 300s with 4-way
// concurrency; smaller keeps the per-day blast radius bounded.
const CHUNK = 200;

// A range folder is named like "28000-28999" or "100-999".
const RANGE_FOLDER_RX = /^(\d+)-(\d+)$/;

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

// Sort key for a range folder name: lower bound of the range as an
// integer. "28000-28999" → 28000. Used so we process oldest ranges
// first (smaller job numbers = older work).
function rangeLowerBound(name: string): number {
  const m = name.match(RANGE_FOLDER_RX);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

// List the Drive root's immediate child folders and seed state rows
// for any range folders we haven't seen before.
async function seedNewRangeFolders(): Promise<void> {
  const drive = getDriveClient();
  const rootId = getProofsFolderId();
  const res = await drive.files.list({
    q: `'${rootId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: "files(id, name)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const folders = (res.data.files ?? []).filter(
    (f) => f.name && RANGE_FOLDER_RX.test(f.name) && f.id,
  );

  for (const f of folders) {
    await db
      .insert(schema.proofBackfillState)
      .values({
        rangeName: f.name!,
        folderId: f.id!,
        processedOffset: 0,
      })
      .onConflictDoNothing();
  }
}

async function handler(req: Request): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    await seedNewRangeFolders();

    // Pick the highest-numbered range that isn't done. Newest first
    // because current production POs reference recent jobs — older
    // ranges (100-999, 1000-1999) are archives and can wait.
    const candidates = await db
      .select()
      .from(schema.proofBackfillState)
      .where(sql`${schema.proofBackfillState.doneAt} IS NULL`);

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        summary: { idle: true, reason: "all ranges done" },
      });
    }
    candidates.sort(
      (a, b) => rangeLowerBound(b.rangeName) - rangeLowerBound(a.rangeName),
    );
    const target = candidates[0];

    // Seed totalCount with a parseSpec=false sweep on first visit so we
    // know how many files this range has. After that we can predict
    // when we're done by comparing processedOffset to totalCount.
    if (target.totalCount == null) {
      const seedResults = await snapshotProofs({
        rootFolderId: target.folderId,
        modifiedAfter: new Date("1970-01-01"),
        parseSpec: false,
      });
      await db
        .update(schema.proofBackfillState)
        .set({ totalCount: seedResults.length, updatedAt: new Date() })
        .where(eq(schema.proofBackfillState.rangeName, target.rangeName));

      return NextResponse.json({
        ok: true,
        summary: {
          rangeName: target.rangeName,
          step: "seeded",
          totalCount: seedResults.length,
          durationMs: Date.now() - startedAt,
        },
      });
    }

    // Process one chunk with parseSpec=true.
    const offset = target.processedOffset;
    const results = await snapshotProofs({
      rootFolderId: target.folderId,
      modifiedAfter: new Date("1970-01-01"),
      parseSpec: true,
      offset,
      limit: CHUNK,
    });

    const newOffset = offset + results.length;
    const isDone = newOffset >= target.totalCount;

    await db
      .update(schema.proofBackfillState)
      .set({
        processedOffset: newOffset,
        doneAt: isDone ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.proofBackfillState.rangeName, target.rangeName));

    return NextResponse.json({
      ok: true,
      summary: {
        rangeName: target.rangeName,
        step: "chunk",
        processed: results.length,
        offsetBefore: offset,
        offsetAfter: newOffset,
        totalCount: target.totalCount,
        done: isDone,
        inserted: results.filter((r) => r.outcome === "inserted").length,
        updated: results.filter((r) => r.outcome === "updated").length,
        skipped: results.filter((r) => r.outcome === "skipped").length,
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

export const POST = logCronRun("/api/cron/backfill-proofs", handler);
export const GET = logCronRun("/api/cron/backfill-proofs", handler);
