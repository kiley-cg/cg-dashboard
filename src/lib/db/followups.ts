import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "./client";
import type {
  CsrSnapshot,
  FollowUpStatusKind,
  IssueCounts,
  IssueKind,
} from "@/lib/syncore/followups";
import { ISSUE_KINDS } from "@/lib/syncore/followups";

// --- Insert ---------------------------------------------------------------

export async function insertSnapshot(snap: {
  csrId: number;
  csrName: string;
  status: FollowUpStatusKind;
  followUpDate: string;
  statistics: CsrSnapshot["statistics"];
  rows: CsrSnapshot["rows"];
}): Promise<{ snapshotId: string; rowCount: number }> {
  const snapshotAt = new Date();

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.followupSnapshots)
      .values({
        snapshotAt,
        csrId: snap.csrId,
        csrName: snap.csrName,
        followUpStatus: snap.status,
        followUpDate: snap.followUpDate,
        totalRecords: snap.statistics.totalRecords,
        totalIssues: snap.statistics.totalIssues,
        issueCounts: snap.statistics.issueCounts,
        rawStatistics: snap.statistics.raw,
      })
      .returning({ id: schema.followupSnapshots.id });

    if (snap.rows.length > 0) {
      await tx.insert(schema.followupRows).values(
        snap.rows.map((r) => ({
          snapshotId: inserted.id,
          snapshotAt,
          csrId: snap.csrId,
          csrName: snap.csrName,
          followUpStatus: snap.status,
          jobId: r.jobId,
          fuDate: r.fuDate,
          contact: r.contact,
          jobStatus: r.jobStatus,
          supplier: r.supplier,
          jobDescription: r.jobDescription,
          primaryRep: r.primaryRep,
          priority: r.priority,
          estDelivery: r.estDelivery,
          issue: r.issue,
          raw: r.raw,
        })),
      );
    }

    return { snapshotId: inserted.id, rowCount: snap.rows.length };
  });
}

// --- Reads ----------------------------------------------------------------

export interface SnapshotWithRows {
  snapshot: typeof schema.followupSnapshots.$inferSelect;
  rows: (typeof schema.followupRows.$inferSelect)[];
}

/**
 * Latest snapshot per (CSR, status). For a 2-CSR team with Open + Completed
 * pulls, this returns up to 4 snapshots.
 */
export async function getLatestSnapshotPerCsr(): Promise<SnapshotWithRows[]> {
  // Postgres DISTINCT ON keeps the first row per partition; ORDER BY drives
  // which one. Drizzle doesn't have a first-class DISTINCT ON helper so we
  // use raw SQL for the snapshot-id pick, then re-fetch via the typed query
  // builder so column names and types come back correctly mapped.
  const latestRaw = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT ON (csr_id, follow_up_status) id
    FROM followup_snapshots
    ORDER BY csr_id, follow_up_status, snapshot_at DESC
  `);

  // postgres-js returns rows as an iterable; normalize to a plain array.
  const latestRows: { id: string }[] = Array.from(
    latestRaw as Iterable<{ id: string }>,
  );
  const ids = latestRows.map((r) => r.id);
  if (ids.length === 0) return [];

  const snaps = await db
    .select()
    .from(schema.followupSnapshots)
    .where(inArray(schema.followupSnapshots.id, ids));

  const rowsAll = await db
    .select()
    .from(schema.followupRows)
    .where(inArray(schema.followupRows.snapshotId, ids));

  const rowsBySnap = new Map<string, (typeof schema.followupRows.$inferSelect)[]>();
  for (const r of rowsAll) {
    const list = rowsBySnap.get(r.snapshotId) ?? [];
    list.push(r);
    rowsBySnap.set(r.snapshotId, list);
  }

  return snaps.map((s) => ({ snapshot: s, rows: rowsBySnap.get(s.id) ?? [] }));
}

export interface DailyTrendPoint {
  date: string; // YYYY-MM-DD
  totalRecords: number;
  totalIssues: number;
  issueCounts: IssueCounts;
}

/**
 * One point per day for the given CSR + status, going back N days. Uses the
 * *last* snapshot of each day (intra-day snapshots collapse to end-of-day).
 */
export async function getDailyTrend(opts: {
  csrId: number;
  status: FollowUpStatusKind;
  days: number;
}): Promise<DailyTrendPoint[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - opts.days);

  const rows = await db.execute<{
    day: string;
    total_records: number;
    total_issues: number;
    issue_counts: unknown;
  }>(sql`
    SELECT DISTINCT ON (date_trunc('day', snapshot_at))
      to_char(date_trunc('day', snapshot_at), 'YYYY-MM-DD') AS day,
      total_records,
      total_issues,
      issue_counts
    FROM followup_snapshots
    WHERE csr_id = ${opts.csrId}
      AND follow_up_status = ${opts.status}
      AND snapshot_at >= ${since.toISOString()}
    ORDER BY date_trunc('day', snapshot_at) DESC, snapshot_at DESC
  `);

  const arr = Array.from(
    rows as Iterable<{
      day: string;
      total_records: number | string;
      total_issues: number | string;
      issue_counts: IssueCounts | null;
    }>,
  );

  return arr
    .map((r) => ({
      date: r.day,
      totalRecords: Number(r.total_records),
      totalIssues: Number(r.total_issues),
      issueCounts: (r.issue_counts ?? emptyCounts()) as IssueCounts,
    }))
    .reverse();
}

function emptyCounts(): IssueCounts {
  return Object.fromEntries(ISSUE_KINDS.map((k) => [k, 0])) as IssueCounts;
}

// Postgres timestamp values come back from postgres-js as Date by default,
// but raw SQL aggregates (MIN, etc.) and a few connection configurations
// can leak strings/numbers through. Coerce defensively at the boundary so
// downstream code can always call .getTime().
function asDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Earliest `snapshot_at` we've seen this job in any open list, used for
 * aging. Returns null if the job has never been in a snapshot.
 */
export async function getJobFirstSeen(
  jobId: number,
): Promise<Date | null> {
  const rows = await db
    .select({ snapshotAt: schema.followupRows.snapshotAt })
    .from(schema.followupRows)
    .where(
      and(
        eq(schema.followupRows.jobId, jobId),
        eq(schema.followupRows.followUpStatus, "open"),
      ),
    )
    .orderBy(schema.followupRows.snapshotAt)
    .limit(1);
  return asDate(rows[0]?.snapshotAt);
}

/**
 * Aging (in whole days) for every open job in the latest snapshots.
 * Cheaper than calling getJobFirstSeen() per row.
 */
export async function getJobFirstSeenMap(): Promise<Map<number, Date>> {
  const rows = await db
    .select({
      jobId: schema.followupRows.jobId,
      first: sql<Date>`MIN(${schema.followupRows.snapshotAt})`,
    })
    .from(schema.followupRows)
    .where(eq(schema.followupRows.followUpStatus, "open"))
    .groupBy(schema.followupRows.jobId);

  const map = new Map<number, Date>();
  for (const r of rows) {
    const d = asDate(r.first);
    if (d) map.set(r.jobId, d);
  }
  return map;
}

// --- Diff: closed since last snapshot -------------------------------------

/**
 * Returns the count of jobs that were in the previous open snapshot for this
 * CSR but are no longer in the current one. A reasonable approximation of
 * "closed since last cron run".
 */
export async function getClosedSinceLastSnapshot(opts: {
  csrId: number;
}): Promise<number> {
  const last2 = await db
    .select({ id: schema.followupSnapshots.id })
    .from(schema.followupSnapshots)
    .where(
      and(
        eq(schema.followupSnapshots.csrId, opts.csrId),
        eq(schema.followupSnapshots.followUpStatus, "open"),
      ),
    )
    .orderBy(desc(schema.followupSnapshots.snapshotAt))
    .limit(2);

  if (last2.length < 2) return 0;
  const [current, previous] = last2;

  const result = await db.execute<{ closed: number | string }>(sql`
    SELECT COUNT(*)::int AS closed
    FROM followup_rows prev
    WHERE prev.snapshot_id = ${previous.id}
      AND NOT EXISTS (
        SELECT 1 FROM followup_rows cur
        WHERE cur.snapshot_id = ${current.id}
          AND cur.job_id = prev.job_id
      )
  `);
  const arr = Array.from(result as Iterable<{ closed: number | string }>);
  return arr[0] ? Number(arr[0].closed) : 0;
}

// --- Recent snapshot timestamps for "Last updated" header -----------------

export async function getMostRecentSnapshotAt(): Promise<Date | null> {
  const rows = await db
    .select({ at: schema.followupSnapshots.snapshotAt })
    .from(schema.followupSnapshots)
    .orderBy(desc(schema.followupSnapshots.snapshotAt))
    .limit(1);
  return asDate(rows[0]?.at);
}

// --- Issue heatmap data --------------------------------------------------

export interface IssueHeatmapRow {
  csrId: number;
  csrName: string;
  counts: IssueCounts;
}

export async function getIssueHeatmap(): Promise<IssueHeatmapRow[]> {
  const latest = await getLatestSnapshotPerCsr();
  return latest
    .filter((s) => s.snapshot.followUpStatus === "open")
    .map((s) => ({
      csrId: s.snapshot.csrId,
      csrName: s.snapshot.csrName,
      counts: s.snapshot.issueCounts as IssueCounts,
    }));
}

// --- Day-window helpers ---------------------------------------------------

export function recentSnapshotsSince(days: number) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  return db
    .select()
    .from(schema.followupSnapshots)
    .where(gte(schema.followupSnapshots.snapshotAt, since))
    .orderBy(schema.followupSnapshots.snapshotAt);
}

// Re-export for callers that want IssueKind without an extra import
export type { IssueCounts, IssueKind };
