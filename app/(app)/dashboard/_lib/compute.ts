// Pure derivations from snapshot data → display metrics. Lives next to the
// page so the route is self-contained.

import type { schema } from "@/lib/db/client";
import type { IssueCounts, IssueKind } from "@/lib/syncore/followups";
import { ISSUE_KINDS } from "@/lib/syncore/followups";

type FollowupRow = typeof schema.followupRows.$inferSelect;
type FollowupSnapshot = typeof schema.followupSnapshots.$inferSelect;

export interface SnapshotBundle {
  snapshot: FollowupSnapshot;
  rows: FollowupRow[];
}

export interface CsrMetrics {
  csrId: number;
  csrName: string;
  // Pulled from the open snapshot.
  workload: number;
  dueToday: number;
  overdue: number;
  criticalRush: number;
  staleCriticalRush: number;
  closedToday: number;
  agingBuckets: { lt1: number; d1to3: number; d3to7: number; gt7: number };
  issueCounts: IssueCounts;
  // Derived.
  headlineKpi: number; // overdue + staleCriticalRush — lower is better
  // Pass-through for drill-down.
  openRows: FollowupRow[];
  completedRows: FollowupRow[];
}

const CRITICAL_PRIORITIES = new Set([
  "critical rush",
  "critical",
]);

function isCritical(priority: string | null): boolean {
  if (!priority) return false;
  return CRITICAL_PRIORITIES.has(priority.trim().toLowerCase());
}

function compareDateStrings(a: string | null, b: string): -1 | 0 | 1 | null {
  if (!a) return null;
  // Both expected as ISO/parseable. Avoid TZ pitfalls by comparing strings
  // when both are YYYY-MM-DD; else fall back to Date.parse.
  if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b)) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  if (da < db) return -1;
  if (da > db) return 1;
  return 0;
}

function ageDays(firstSeen: Date | string | number | undefined | null, now: Date): number | null {
  if (firstSeen == null) return null;
  const d =
    firstSeen instanceof Date ? firstSeen : new Date(firstSeen as string | number);
  if (Number.isNaN(d.getTime())) return null;
  const ms = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function emptyIssueCounts(): IssueCounts {
  return Object.fromEntries(ISSUE_KINDS.map((k) => [k, 0])) as IssueCounts;
}

export interface ComputeOpts {
  todayPacific: string; // YYYY-MM-DD
  jobFirstSeen: Map<number, Date>;
  now?: Date;
}

export function deriveCsrMetrics(args: {
  csrId: number;
  csrName: string;
  open: SnapshotBundle | undefined;
  completed: SnapshotBundle | undefined;
  prevOpen?: SnapshotBundle | undefined;
  opts: ComputeOpts;
}): CsrMetrics {
  const { csrId, csrName, open, completed, prevOpen, opts } = args;
  const now = opts.now ?? new Date();
  const today = opts.todayPacific;

  const openRows = open?.rows ?? [];
  const completedRows = completed?.rows ?? [];

  let dueToday = 0;
  let overdue = 0;
  let criticalRush = 0;
  let staleCriticalRush = 0;
  const buckets = { lt1: 0, d1to3: 0, d3to7: 0, gt7: 0 };

  for (const row of openRows) {
    const cmp = compareDateStrings(row.fuDate, today);
    if (cmp === 0) dueToday++;
    if (cmp === -1) overdue++;

    if (isCritical(row.priority)) {
      criticalRush++;
      if (cmp === -1) staleCriticalRush++;
    }

    const age = ageDays(opts.jobFirstSeen.get(row.jobId), now);
    if (age === null) buckets.lt1++;
    else if (age < 1) buckets.lt1++;
    else if (age <= 3) buckets.d1to3++;
    else if (age <= 7) buckets.d3to7++;
    else buckets.gt7++;
  }

  // "Closed today" — preferred: completed snapshot's totalRecords today.
  // Fallback: diff vs previous open snapshot.
  let closedToday = 0;
  if (completed) {
    closedToday = completed.snapshot.totalRecords;
  } else if (prevOpen && open) {
    const currentJobIds = new Set(open.rows.map((r) => r.jobId));
    closedToday = prevOpen.rows.filter((r) => !currentJobIds.has(r.jobId)).length;
  }

  const issueCounts: IssueCounts =
    (open?.snapshot.issueCounts as IssueCounts | null) ?? emptyIssueCounts();

  return {
    csrId,
    csrName,
    workload: open?.snapshot.totalRecords ?? openRows.length,
    dueToday,
    overdue,
    criticalRush,
    staleCriticalRush,
    closedToday,
    agingBuckets: buckets,
    issueCounts,
    headlineKpi: overdue + staleCriticalRush,
    openRows,
    completedRows,
  };
}

// Group raw bundles by CSR + status for easy lookup in the page.
export function groupBundles(bundles: SnapshotBundle[]): Map<
  number,
  { open?: SnapshotBundle; completed?: SnapshotBundle }
> {
  const map = new Map<number, { open?: SnapshotBundle; completed?: SnapshotBundle }>();
  for (const b of bundles) {
    const cur = map.get(b.snapshot.csrId) ?? {};
    if (b.snapshot.followUpStatus === "open") cur.open = b;
    if (b.snapshot.followUpStatus === "completed") cur.completed = b;
    map.set(b.snapshot.csrId, cur);
  }
  return map;
}

export function todayInPacific(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

export type { IssueKind };
