// Auto-rollover for overdue scheduled POs.
//
// Every morning before Kristen comes in, sweep po_schedule_state for
// any PO whose scheduled_date is before today AND that hasn't been
// finished (floor_status != 'done') AND isn't already closed in Syncore.
// Bump it to today's Pacific date so it lands on the current day's
// schedule instead of being marooned in the past.
//
// Why this exists: the day-by-day schedule view only renders POs whose
// scheduled_date matches the active day. Without rollover, an overdue
// PO would silently disappear from the floor's view — they'd have to
// navigate backwards through week arrows to find it. Rolling forward
// keeps everything in one place.
//
// Preserves the original placement via po_schedule_state.carried_from_date
// (set on the first rollover only, so the look-back shows the original
// day, not whatever yesterday's rollover did). Posts a Job Tracker
// entry per PO so CSRs see the change without checking the dashboard.

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { addJobTrackerEntry } from "@/lib/syncore/webui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function formatScheduleDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

interface OverdueRow {
  poId: string;
  scheduledDate: string;
  carriedFromDate: string | null;
  syncoreJobId: string;
  poNumber: number | null;
  supplierName: string | null;
}

async function run(): Promise<{
  today: string;
  candidates: number;
  rolled: number;
  trackerPosted: number;
  trackerFailed: number;
}> {
  const today = todayInPacific();

  // Find candidates: scheduled in the past, not done, not closed in
  // Syncore, with a mirror row (so we know it's still a real PO and
  // can post a Job Tracker entry).
  const overdue = (await db
    .select({
      poId: schema.poScheduleState.poId,
      scheduledDate: schema.poScheduleState.scheduledDate,
      carriedFromDate: schema.poScheduleState.carriedFromDate,
      syncoreJobId: schema.productionPoMirror.syncoreJobId,
      poNumber: schema.productionPoMirror.poNumber,
      supplierName: schema.productionPoMirror.supplierName,
    })
    .from(schema.poScheduleState)
    .innerJoin(
      schema.productionPoMirror,
      eq(schema.poScheduleState.poId, schema.productionPoMirror.poId),
    )
    .where(
      and(
        sql`${schema.poScheduleState.scheduledDate} IS NOT NULL`,
        sql`${schema.poScheduleState.scheduledDate} < ${today}`,
        sql`${schema.poScheduleState.floorStatus} != 'done'`,
        sql`${schema.poScheduleState.syncoreClosedAt} IS NULL`,
        // Don't touch POs Syncore has already closed (Posted Manually /
        // Paid). The mirror row is the source of truth for "is this
        // still in flight" beyond our local floor_status flag.
        sql`${schema.productionPoMirror.status} NOT IN ('Posted Manually', 'Posted @ease A/P', 'Paid')`,
      ),
    )) as OverdueRow[];

  if (overdue.length === 0) {
    return {
      today,
      candidates: 0,
      rolled: 0,
      trackerPosted: 0,
      trackerFailed: 0,
    };
  }

  // Single UPDATE for all candidates. carried_from_date only gets set
  // the FIRST time we roll a PO forward — subsequent rolls keep the
  // original placement so the look-back stays honest.
  const poIds = overdue.map((r) => r.poId);
  const now = new Date();
  await db
    .update(schema.poScheduleState)
    .set({
      scheduledDate: today,
      carriedFromDate: sql`COALESCE(${schema.poScheduleState.carriedFromDate}, ${schema.poScheduleState.scheduledDate})`,
      updatedAt: now,
    })
    .where(sql`${schema.poScheduleState.poId} IN (${sql.join(
      poIds.map((id) => sql`${id}`),
      sql`, `,
    )})`);

  // Job Tracker writeback — best-effort, per PO. Tracker failures
  // don't roll back the schedule change.
  let trackerPosted = 0;
  let trackerFailed = 0;
  for (const row of overdue) {
    const poLabel =
      row.poNumber != null ? `${row.syncoreJobId}-${row.poNumber}` : row.poId;
    const supplierTail = row.supplierName ? ` (${row.supplierName})` : "";
    const description =
      `Production auto-rolled to ${formatScheduleDate(today)} — PO ${poLabel}${supplierTail} ` +
      `(was ${formatScheduleDate(row.scheduledDate)}).`;
    try {
      await addJobTrackerEntry({
        jobId: row.syncoreJobId,
        description,
      });
      trackerPosted++;
    } catch (err) {
      trackerFailed++;
      console.error(
        `[rollover-overdue-pos] tracker post failed for PO ${row.poId}:`,
        err,
      );
    }
  }

  return {
    today,
    candidates: overdue.length,
    rolled: overdue.length,
    trackerPosted,
    trackerFailed,
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  try {
    const result = await run();
    return NextResponse.json({
      ok: true,
      ms: Date.now() - started,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rollover-overdue-pos] failed:", err);
    return NextResponse.json(
      { ok: false, error: message, ms: Date.now() - started },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  return GET(req);
}
