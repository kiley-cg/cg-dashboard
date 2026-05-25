import { NextResponse } from "next/server";
import {
  getJobFirstSeenMap,
  getLatestSnapshotPerCsr,
} from "@/lib/db/followups";
import {
  deriveCsrMetrics,
  groupBundles,
  todayInPacific,
  type CsrMetrics,
} from "../../../(app)/dashboard/_lib/compute";
import { sendCsrDigest } from "@/lib/email/digest";

export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

function buildDashboardUrl(req: Request): string {
  const explicit = process.env.PUBLIC_BASE_URL;
  if (explicit) return `${explicit.replace(/\/$/, "")}/dashboard`;
  // Vercel sets VERCEL_URL to the deployment hostname (no scheme).
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}/dashboard`;
  // Last resort: use the request URL's origin.
  const url = new URL(req.url);
  return `${url.origin}/dashboard`;
}

async function handle(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const today = todayInPacific();
  const [bundles, firstSeen] = await Promise.all([
    getLatestSnapshotPerCsr(),
    getJobFirstSeenMap(),
  ]);

  if (bundles.length === 0) {
    return NextResponse.json({
      ok: false,
      skipped: "no snapshots — run /api/cron/snapshot-followups first",
    });
  }

  const grouped = groupBundles(bundles);
  const metrics: CsrMetrics[] = Array.from(grouped.entries())
    .map(([csrId, bundle]) => {
      const csrName =
        bundle.open?.snapshot.csrName ??
        bundle.completed?.snapshot.csrName ??
        `CSR ${csrId}`;
      return deriveCsrMetrics({
        csrId,
        csrName,
        open: bundle.open,
        completed: bundle.completed,
        opts: { todayPacific: today, jobFirstSeen: firstSeen },
      });
    })
    .sort((a, b) => a.csrName.localeCompare(b.csrName));

  const result = await sendCsrDigest({
    metrics,
    todayPacific: today,
    dashboardUrl: buildDashboardUrl(req),
  });

  return NextResponse.json({
    ok: result.ok,
    skipped: result.skipped,
    error: result.error,
    id: result.id,
    csrCount: metrics.length,
  });
}

import { logCronRun } from "@/lib/cron/log";

export const GET = logCronRun("/api/cron/digest-followups", handle);
export const POST = logCronRun("/api/cron/digest-followups", handle);
