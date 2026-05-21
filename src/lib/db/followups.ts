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

export interface DailyHistoryPoint {
  date: string; // YYYY-MM-DD (Pacific)
  // Beginning FU = follow-ups due today or overdue, still open at the
  // morning snapshot. The rep's actual workload to clear today.
  bodCount: number;
  // EOD FU = follow-ups due today or overdue, still open at the evening
  // snapshot. The ones she didn't get to.
  eodCount: number;
  // Of the BOD due/overdue set, how many were no longer in the EOD due
  // set — i.e. handled, completed, re-dated to the future, etc. The
  // rep's actual productivity for the day.
  closedThatDay: number;
  bodSnapshotAt: Date | null;
  eodSnapshotAt: Date | null;
  // True only when we have two distinct snapshots (morning AND evening).
  // False on days with only one snapshot, in which case closedThatDay is
  // 0 and should be rendered as "—".
  hasFullDayWindow: boolean;
}

/**
 * Per-day Beginning/EOD/Closed for a CSR, last N days. Pulls the first
 * AND last snapshot of each Pacific day so we can measure within-day
 * movement.
 *
 * All counts filter open rows to `fuDate <= that day` (excluding null
 * fuDates as "parked, not actively due"), so the numbers reflect items
 * the rep was supposed to handle that day rather than the total queue
 * (which is inflated by future-dated follow-ups).
 *
 * "Closed that day" = jobs in the BOD due set that aren't in the EOD
 * due set. Captures completions and re-dating to the future. Note this
 * is per-day within-day movement, distinct from the team-level "Closed
 * today" tile which diffs across calendar days.
 *
 * Days that only have one snapshot (historical pre-EOD-cron data, or
 * weekends) get `hasFullDayWindow: false` and closedThatDay: 0.
 *
 * Returns N entries; we fetch N+1 days internally to keep the array
 * symmetric with the previous version, though the diff is now within-
 * day rather than cross-day.
 */
export async function getCsrDailyHistory(opts: {
  csrId: number;
  days: number;
}): Promise<DailyHistoryPoint[]> {
  const fetchDays = opts.days + 1;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - fetchDays);

  const rows = await db.execute<{
    day: string;
    snapshot_at: string | Date;
    is_bod: boolean;
    is_eod: boolean;
    job_id: number | string | null;
    fu_date: string | null;
  }>(sql`
    WITH ranked AS (
      SELECT
        id AS snapshot_id,
        snapshot_at,
        to_char(
          date_trunc('day', snapshot_at AT TIME ZONE 'America/Los_Angeles'),
          'YYYY-MM-DD'
        ) AS day,
        ROW_NUMBER() OVER (
          PARTITION BY date_trunc('day', snapshot_at AT TIME ZONE 'America/Los_Angeles')
          ORDER BY snapshot_at ASC
        ) AS rn_asc,
        ROW_NUMBER() OVER (
          PARTITION BY date_trunc('day', snapshot_at AT TIME ZONE 'America/Los_Angeles')
          ORDER BY snapshot_at DESC
        ) AS rn_desc
      FROM followup_snapshots
      WHERE csr_id = ${opts.csrId}
        AND follow_up_status = 'open'
        AND snapshot_at >= ${since.toISOString()}
    )
    SELECT
      ranked.day,
      ranked.snapshot_at,
      (ranked.rn_asc = 1) AS is_bod,
      (ranked.rn_desc = 1) AS is_eod,
      r.job_id,
      r.fu_date
    FROM ranked
    LEFT JOIN followup_rows r ON r.snapshot_id = ranked.snapshot_id
    WHERE ranked.rn_asc = 1 OR ranked.rn_desc = 1
    ORDER BY ranked.day ASC, ranked.snapshot_at ASC
  `);

  const arr = Array.from(
    rows as Iterable<{
      day: string;
      snapshot_at: string | Date;
      is_bod: boolean;
      is_eod: boolean;
      job_id: number | string | null;
      fu_date: string | null;
    }>,
  );

  // Per day, track BOD and EOD due-job sets separately. When only one
  // snapshot exists for the day, both flags are true on the same row →
  // bodDue and eodDue end up identical.
  type DayBucket = {
    bodSnapshotAt: Date | null;
    eodSnapshotAt: Date | null;
    bodDue: Set<number>;
    eodDue: Set<number>;
  };
  const byDay = new Map<string, DayBucket>();
  for (const row of arr) {
    let entry = byDay.get(row.day);
    if (!entry) {
      entry = {
        bodSnapshotAt: null,
        eodSnapshotAt: null,
        bodDue: new Set(),
        eodDue: new Set(),
      };
      byDay.set(row.day, entry);
    }
    const snapAt = asDate(row.snapshot_at);
    if (row.is_bod && !entry.bodSnapshotAt) entry.bodSnapshotAt = snapAt;
    if (row.is_eod && !entry.eodSnapshotAt) entry.eodSnapshotAt = snapAt;

    if (row.job_id == null) continue;
    const id = Number(row.job_id);
    if (!Number.isFinite(id)) continue;
    // Only count toward due if there's an explicit fuDate that's today
    // or earlier. Null fuDate = parked, not actively due.
    const fu = row.fu_date?.trim() || null;
    const isDue = !!fu && fu <= row.day;
    if (!isDue) continue;
    if (row.is_bod) entry.bodDue.add(id);
    if (row.is_eod) entry.eodDue.add(id);
  }

  const dayKeys = [...byDay.keys()].sort();
  // Skip the first day (kept for symmetry / future cross-day measurements
  // — same as before).
  const result: DailyHistoryPoint[] = [];
  for (let i = 1; i < dayKeys.length; i++) {
    const day = byDay.get(dayKeys[i])!;
    const hasFullDayWindow =
      day.bodSnapshotAt != null &&
      day.eodSnapshotAt != null &&
      day.bodSnapshotAt.getTime() !== day.eodSnapshotAt.getTime();
    let closed = 0;
    if (hasFullDayWindow) {
      for (const id of day.bodDue) {
        if (!day.eodDue.has(id)) closed++;
      }
    }
    result.push({
      date: dayKeys[i],
      bodCount: day.bodDue.size,
      eodCount: day.eodDue.size,
      closedThatDay: closed,
      bodSnapshotAt: day.bodSnapshotAt,
      eodSnapshotAt: day.eodSnapshotAt,
      hasFullDayWindow,
    });
  }
  return result;
}

// --- Team-wide totals at a past point in time ----------------------------

export interface TeamWorkloadPoint {
  totalRecords: number;
  totalIssues: number;
}

/**
 * Sum the *latest* open snapshot per CSR taken before `before`. Used to
 * compute day-over-day deltas on the team summary strip without re-scanning
 * row data.
 */
export async function getTeamWorkloadBefore(
  before: Date,
): Promise<TeamWorkloadPoint> {
  const rows = await db.execute<{
    total_records: number | string;
    total_issues: number | string;
  }>(sql`
    SELECT total_records, total_issues
    FROM (
      SELECT DISTINCT ON (csr_id)
        csr_id, total_records, total_issues, snapshot_at
      FROM followup_snapshots
      WHERE follow_up_status = 'open'
        AND snapshot_at < ${before.toISOString()}
      ORDER BY csr_id, snapshot_at DESC
    ) latest
  `);
  const arr = Array.from(
    rows as Iterable<{
      total_records: number | string;
      total_issues: number | string;
    }>,
  );
  return arr.reduce<TeamWorkloadPoint>(
    (acc, r) => ({
      totalRecords: acc.totalRecords + Number(r.total_records),
      totalIssues: acc.totalIssues + Number(r.total_issues),
    }),
    { totalRecords: 0, totalIssues: 0 },
  );
}

/**
 * Job IDs from the most recent open snapshot per CSR taken before `before`.
 * One query for the whole team. Used to compute "closed today" as the
 * set difference between yesterday's open list and today's.
 */
export async function getTeamOpenJobIdsBefore(
  before: Date,
): Promise<Map<number, Set<number>>> {
  const rows = await db.execute<{ csr_id: number | string; job_id: number | string }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (csr_id) id, csr_id
      FROM followup_snapshots
      WHERE follow_up_status = 'open'
        AND snapshot_at < ${before.toISOString()}
      ORDER BY csr_id, snapshot_at DESC
    )
    SELECT latest.csr_id AS csr_id, r.job_id AS job_id
    FROM followup_rows r
    JOIN latest ON r.snapshot_id = latest.id
  `);
  const arr = Array.from(
    rows as Iterable<{ csr_id: number | string; job_id: number | string }>,
  );
  const map = new Map<number, Set<number>>();
  for (const r of arr) {
    const csrId = Number(r.csr_id);
    const jobId = Number(r.job_id);
    if (!Number.isFinite(csrId) || !Number.isFinite(jobId)) continue;
    let set = map.get(csrId);
    if (!set) {
      set = new Set();
      map.set(csrId, set);
    }
    set.add(jobId);
  }
  return map;
}

/**
 * Open rows in the most recent open snapshot for the given CSR taken before
 * `before`. Used by the CSR drill-down page to surface jobs added/closed
 * since N days ago.
 */
export async function getCsrOpenRowsBefore(args: {
  csrId: number;
  before: Date;
}): Promise<(typeof schema.followupRows.$inferSelect)[]> {
  const snap = await db
    .select({ id: schema.followupSnapshots.id })
    .from(schema.followupSnapshots)
    .where(
      and(
        eq(schema.followupSnapshots.csrId, args.csrId),
        eq(schema.followupSnapshots.followUpStatus, "open"),
        sql`${schema.followupSnapshots.snapshotAt} < ${args.before.toISOString()}`,
      ),
    )
    .orderBy(desc(schema.followupSnapshots.snapshotAt))
    .limit(1);
  if (snap.length === 0) return [];
  return db
    .select()
    .from(schema.followupRows)
    .where(eq(schema.followupRows.snapshotId, snap[0].id));
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
