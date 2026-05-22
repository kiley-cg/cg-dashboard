// Mirror Syncore v2 purchase orders into production_po_mirror.
//
// Discovery: Syncore exposes GET /v2/orders/jobs?date_from=&date_to= as a
// paginated jobs-list. Each job carries its purchase_orders[] inline as
// summaries (id, status, supplier with class), so we can identify which
// jobs have in-house decoration POs without an extra per-job fetch. Only
// those jobs get their full PO list pulled into the mirror.
//
// We also re-mirror any job already in production_po_mirror that's missing
// from the jobs-list window (e.g. moved out of WIP since last run) so
// previously-mirrored data doesn't go stale.
//
// Hourly business-hours cadence keeps the mirror fresh enough for
// scheduling decisions without hammering Syncore.

import { NextResponse } from "next/server";
import { listAllJobs, listPurchaseOrders } from "@/lib/syncore/orders";
import { SyncoreError } from "@/lib/syncore/client";
import { IN_HOUSE_SUPPLIER_CLASS } from "@/lib/syncore/production";
import { db, schema } from "@/lib/db/client";
import { upsertJobPos } from "@/lib/db/production-po";

export const dynamic = "force-dynamic";

// Date window for the jobs-list seed. Generous so jobs that take a long
// time to flow through production aren't dropped early; bounded so we
// don't iterate the whole archive.
const JOBS_WINDOW_DAYS = 90;

// Status filter for the jobs-list call. "WIP" is the bucket where
// production actually happens; other statuses (Pending, Closed) rarely
// have actionable decoration POs but we union with the already-mirrored
// set below so we don't drop visibility on edge cases.
const JOBS_LIST_STATUS: string | undefined = "WIP";

// How many jobs to fetch in parallel when calling listPurchaseOrders.
// Syncore docs don't publish a rate limit; 6 is conservative.
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

function todayInPacific(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  const url = new URL(req.url);

  // One-off mode for testing: ?jobId=X mirrors just that job. Skips the
  // full jobs-list scan.
  const adHocJobId = url.searchParams.get("jobId");

  let candidateJobIds: string[];
  let listingMs = 0;
  let jobsFromList = 0;
  let jobsAlreadyMirrored = 0;

  if (adHocJobId) {
    candidateJobIds = [adHocJobId];
  } else {
    const dateTo = todayInPacific();
    const dateFrom = addDaysIso(dateTo, -JOBS_WINDOW_DAYS);
    const listStart = Date.now();
    const jobs = await listAllJobs({
      dateFrom,
      dateTo,
      status: JOBS_LIST_STATUS,
    });
    listingMs = Date.now() - listStart;

    // Only the jobs that carry at least one decoration PO inline are worth
    // a per-job listPurchaseOrders fetch. The embedded summary tells us
    // class without paying for line items.
    const decorationJobIds = new Set<string>();
    for (const job of jobs) {
      const hasDeco = job.purchase_orders.some(
        (po) => po.supplier?.class === IN_HOUSE_SUPPLIER_CLASS,
      );
      if (hasDeco) decorationJobIds.add(String(job.id));
    }
    jobsFromList = decorationJobIds.size;

    // Union with any job we've already mirrored — keeps state fresh even
    // for jobs that have aged out of the WIP window.
    const existing = await db
      .select({ jobId: schema.productionPoMirror.syncoreJobId })
      .from(schema.productionPoMirror);
    for (const row of existing) decorationJobIds.add(row.jobId);

    jobsAlreadyMirrored = decorationJobIds.size - jobsFromList;
    candidateJobIds = Array.from(decorationJobIds);
  }

  if (candidateJobIds.length === 0) {
    return NextResponse.json({
      ok: true,
      jobsConsidered: 0,
      listingMs,
      runs: [],
      totalMs: Date.now() - started,
      note: "No candidate jobs in window.",
    });
  }

  const runs = await runInBatches(
    candidateJobIds,
    JOB_FETCH_CONCURRENCY,
    mirrorOneJob,
  );

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

  const visibleRuns = runs.filter((r) => !r.skipped);

  return NextResponse.json({
    ok: true,
    jobsConsidered: candidateJobIds.length,
    jobsFromList,
    jobsAlreadyMirrored,
    listingMs,
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
