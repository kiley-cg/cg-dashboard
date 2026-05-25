import { NextResponse } from "next/server";
import {
  fetchSnapshotForCsr,
  loadCsrRegistry,
  type FollowUpStatusKind,
} from "@/lib/syncore/followups";
import { insertSnapshot } from "@/lib/db/followups";

export const dynamic = "force-dynamic";

interface RunResult {
  csrId: number;
  csrName: string;
  status: FollowUpStatusKind;
  totalRecords: number;
  rowCount: number;
  ms: number;
  error?: string;
}

const STATUSES: FollowUpStatusKind[] = ["open", "completed"];

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  // Vercel Cron uses Authorization: Bearer <CRON_SECRET>; manual curl uses
  // x-cron-secret. Accept either so the route works in both modes.
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

function todayInPacific(): string {
  // en-CA gives YYYY-MM-DD; America/Los_Angeles tracks DST automatically.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

async function snapshotOneCsr(opts: {
  csrId: number;
  csrName: string;
  followUpDate: string;
}): Promise<RunResult[]> {
  const out: RunResult[] = [];

  // Open then Completed sequentially per CSR (gentle on Syncore).
  for (const status of STATUSES) {
    const started = Date.now();
    try {
      const snap = await fetchSnapshotForCsr({
        csrId: opts.csrId,
        status,
        followUpDate: opts.followUpDate,
      });
      const { rowCount } = await insertSnapshot({
        csrId: opts.csrId,
        csrName: opts.csrName,
        status,
        followUpDate: opts.followUpDate,
        statistics: snap.statistics,
        rows: snap.rows,
      });
      out.push({
        csrId: opts.csrId,
        csrName: opts.csrName,
        status,
        totalRecords: snap.statistics.totalRecords,
        rowCount,
        ms: Date.now() - started,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[snapshot-followups] ${opts.csrName} (${status}) failed:`,
        err,
      );
      out.push({
        csrId: opts.csrId,
        csrName: opts.csrName,
        status,
        totalRecords: 0,
        rowCount: 0,
        ms: Date.now() - started,
        error: message,
      });
    }
  }

  return out;
}

async function handle(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const csrs = loadCsrRegistry();
  if (csrs.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "no CSRs configured — set CSR_VALERIE_ID / CSR_JEREMIAH_ID",
      },
      { status: 500 },
    );
  }

  const followUpDate = todayInPacific();
  const started = Date.now();

  // CSRs in parallel; statuses sequential within each CSR.
  const grouped = await Promise.all(
    csrs.map((c) =>
      snapshotOneCsr({
        csrId: c.id,
        csrName: c.name,
        followUpDate,
      }),
    ),
  );
  const runs = grouped.flat();

  return NextResponse.json({
    ok: true,
    followUpDate,
    totalMs: Date.now() - started,
    runs,
  });
}

import { logCronRun } from "@/lib/cron/log";

export const GET = logCronRun("/api/cron/snapshot-followups", handle);
export const POST = logCronRun("/api/cron/snapshot-followups", handle);
