// Mirror Syncore v2 purchase orders into production_po_mirror.
//
// Syncore v2 has no global "list all open POs" search — only per-job
// lookups. To find the set of jobs we care about, we use the same
// follow-ups snapshots the dashboard already maintains as a job-ID seed
// list. Hourly business-hours cadence keeps the mirror fresh enough for
// scheduling decisions without hammering Syncore.

import { NextResponse } from "next/server";
import { listPurchaseOrders } from "@/lib/syncore/orders";
import { SyncoreError } from "@/lib/syncore/client";
import {
  getRecentFollowupJobIds,
  upsertJobPos,
} from "@/lib/db/production-po";

export const dynamic = "force-dynamic";

// Seed window: how far back in follow-ups to look for active job IDs.
// Generous so jobs that close out of follow-ups but still have open
// production POs aren't dropped. Bounded so we don't iterate the whole
// archive.
const FOLLOWUP_SEED_DAYS = 30;

// How many jobs to fetch in parallel. Syncore docs don't publish a rate
// limit; the followups cron does up to 8 simultaneous calls without issue
// (2 CSRs × statuses + paging), so 6 here is conservative.
const JOB_FETCH_CONCURRENCY = 6;

interface JobRunResult {
  jobId: string;
  ok: boolean;
  upserted?: number;
  decorationPoCount?: number;
  apparelPoCount?: number;
  // "skipped" = Syncore returned 404 for the job (archived/closed/no POs).
  // Counted separately from real errors so the failure stat reflects only
  // genuine breakage.
  skipped?: boolean;
  error?: string;
  ms: number;
}

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

async function mirrorOneJob(jobId: string): Promise<JobRunResult> {
  const started = Date.now();
  try {
    const pos = await listPurchaseOrders(jobId);
    const upsert = await upsertJobPos({ jobId, pos });
    return {
      jobId,
      ok: true,
      upserted: upsert.upserted,
      decorationPoCount: upsert.decorationPoCount,
      apparelPoCount: upsert.apparelPoCount,
      ms: Date.now() - started,
    };
  } catch (err) {
    // Syncore returns 404 for archived/closed jobs and for jobs that
    // never had POs attached. Most "failures" we were seeing were these,
    // not real errors — skip silently so the run summary highlights only
    // genuine breakage.
    if (err instanceof SyncoreError && err.status === 404) {
      return {
        jobId,
        ok: true,
        skipped: true,
        upserted: 0,
        decorationPoCount: 0,
        apparelPoCount: 0,
        ms: Date.now() - started,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync-production-pos] job ${jobId} failed:`, err);
    return {
      jobId,
      ok: false,
      error: message,
      ms: Date.now() - started,
    };
  }
}

async function runInBatches<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<JobRunResult>,
): Promise<JobRunResult[]> {
  const out: JobRunResult[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const results = await Promise.all(slice.map(fn));
    out.push(...results);
  }
  return out;
}

async function handle(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const started = Date.now();
  const jobIds = await getRecentFollowupJobIds({ days: FOLLOWUP_SEED_DAYS });

  if (jobIds.length === 0) {
    return NextResponse.json({
      ok: true,
      jobsConsidered: 0,
      runs: [],
      totalMs: Date.now() - started,
      note: "No follow-up rows in window — mirror skipped.",
    });
  }

  const runs = await runInBatches(jobIds, JOB_FETCH_CONCURRENCY, mirrorOneJob);

  const totals = runs.reduce(
    (acc, r) => {
      if (r.skipped) {
        acc.jobsSkipped += 1;
      } else if (r.ok) {
        acc.upserted += r.upserted ?? 0;
        acc.decorationPoCount += r.decorationPoCount ?? 0;
        acc.apparelPoCount += r.apparelPoCount ?? 0;
        acc.jobsOk += 1;
      } else {
        acc.jobsFailed += 1;
      }
      return acc;
    },
    {
      jobsOk: 0,
      jobsSkipped: 0,
      jobsFailed: 0,
      upserted: 0,
      decorationPoCount: 0,
      apparelPoCount: 0,
    },
  );

  // Strip the skipped runs from the payload — they're noise, the count
  // is in `totals.jobsSkipped` if you need it.
  const visibleRuns = runs.filter((r) => !r.skipped);

  return NextResponse.json({
    ok: true,
    jobsConsidered: jobIds.length,
    totals,
    runs: visibleRuns,
    totalMs: Date.now() - started,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
