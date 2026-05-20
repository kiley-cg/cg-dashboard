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

// Days since the follow-up date was due. 0 if not yet due. null if no
// fuDate or it can't be parsed. Direct measurement from Syncore — works
// from day 1, before we've accumulated snapshot history.
function daysOverdue(fuDate: string | null, todayPacific: string): number | null {
  if (!fuDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(fuDate)) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(todayPacific)) return null;
  if (fuDate >= todayPacific) return 0;
  const f = Date.parse(fuDate);
  const t = Date.parse(todayPacific);
  if (Number.isNaN(f) || Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((t - f) / (24 * 60 * 60 * 1000)));
}

// "How long has this job been a problem?" — combines two measurements:
//  - Days since we first saw it on the open list (from snapshots)
//  - Days since its follow-up date was due (from Syncore)
// Take the max so the metric is meaningful from day 1 (relies on fuDate)
// and gets richer as we accumulate snapshot history.
function jobStaleDays(args: {
  jobId: number;
  fuDate: string | null;
  jobFirstSeen: Map<number, Date>;
  todayPacific: string;
  now: Date;
}): number | null {
  const fromSnap = ageDays(args.jobFirstSeen.get(args.jobId), args.now);
  const fromFu = daysOverdue(args.fuDate, args.todayPacific);
  if (fromSnap === null && fromFu === null) return null;
  return Math.max(fromSnap ?? 0, fromFu ?? 0);
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
  // Job IDs from the most recent open snapshot taken before ~24h ago.
  // "Closed today" = jobs that were in that set but aren't in `open` now.
  prevOpenJobIds?: Set<number> | undefined;
  opts: ComputeOpts;
}): CsrMetrics {
  const { csrId, csrName, open, completed, prevOpenJobIds, opts } = args;
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

    const age = jobStaleDays({
      jobId: row.jobId,
      fuDate: row.fuDate,
      jobFirstSeen: opts.jobFirstSeen,
      todayPacific: today,
      now,
    });
    if (age === null) buckets.lt1++;
    else if (age < 1) buckets.lt1++;
    else if (age <= 3) buckets.d1to3++;
    else if (age <= 7) buckets.d3to7++;
    else buckets.gt7++;
  }

  // "Closed today" = open jobs from ~24h ago that are no longer on today's
  // open list. The Syncore "completed" view is cumulative (years of
  // history, totalRecords in the thousands), so we can't use it — the
  // disappear-from-open-list diff is the reliable signal.
  let closedToday = 0;
  if (prevOpenJobIds && open) {
    const currentJobIds = new Set(open.rows.map((r) => r.jobId));
    for (const id of prevOpenJobIds) {
      if (!currentJobIds.has(id)) closedToday++;
    }
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

// --- Talking points -------------------------------------------------------
//
// Auto-generated 1:1-prep bullets per CSR. Rules-based — no AI.
// The COO scans these in 10 seconds before a 1:1.

export interface TalkingPoint {
  tone: "alert" | "concern" | "win";
  text: string;
}

const ISSUE_LABEL_LOCAL: Record<IssueKind, string> = {
  artwork: "Artwork",
  backOrder: "Back Order",
  development: "Development",
  hold: "Hold",
  inProduction: "In Production",
  inTransit: "In Transit",
  needsTracking: "Needs Tracking",
  postDelivery: "Post Delivery",
  problem: "Problem",
  waiting: "Waiting",
  none: "None",
};

export function generateTalkingPoints(args: {
  metrics: CsrMetrics;
  jobFirstSeen: Map<number, Date>;
  todayPacific?: string;
  now?: Date;
}): TalkingPoint[] {
  const m = args.metrics;
  const now = args.now ?? new Date();
  const today = args.todayPacific ?? todayInPacific();
  const bullets: TalkingPoint[] = [];

  // 1. Stale Critical/Rush — most urgent. Always lead.
  if (m.staleCriticalRush > 0) {
    let oldest: { jobId: number; days: number; contact: string | null } | null = null;
    for (const r of m.openRows) {
      if (!isCritical(r.priority)) continue;
      // Stale = fuDate strictly before today
      if (compareDateStrings(r.fuDate, today) !== -1) continue;
      const age = jobStaleDays({
        jobId: r.jobId,
        fuDate: r.fuDate,
        jobFirstSeen: args.jobFirstSeen,
        todayPacific: today,
        now,
      });
      if (age === null) continue;
      if (!oldest || age > oldest.days) {
        oldest = { jobId: r.jobId, days: age, contact: r.contact };
      }
    }
    const text = oldest
      ? `${m.staleCriticalRush} Critical/Rush ${m.staleCriticalRush === 1 ? "job is" : "jobs are"} overdue · oldest open ${oldest.days}d (Job #${oldest.jobId}${oldest.contact ? ` — ${oldest.contact}` : ""})`
      : `${m.staleCriticalRush} Critical/Rush ${m.staleCriticalRush === 1 ? "job is" : "jobs are"} overdue`;
    bullets.push({ tone: "alert", text });
  }

  // 2. Long-aging open job — anything > 14 days stale
  let longest: {
    jobId: number;
    days: number;
    issue: string | null;
    contact: string | null;
  } | null = null;
  for (const r of m.openRows) {
    const age = jobStaleDays({
      jobId: r.jobId,
      fuDate: r.fuDate,
      jobFirstSeen: args.jobFirstSeen,
      todayPacific: today,
      now,
    });
    if (age === null || age < 14) continue;
    if (!longest || age > longest.days) {
      longest = { jobId: r.jobId, days: age, issue: r.issue, contact: r.contact };
    }
  }
  if (longest) {
    const issuePart =
      longest.issue && longest.issue.toLowerCase() !== "none"
        ? ` (${longest.issue})`
        : "";
    const contactPart = longest.contact ? ` — ${longest.contact}` : "";
    bullets.push({
      tone: "alert",
      text: `Job #${longest.jobId} has been open ${longest.days}d${issuePart}${contactPart} — long-stuck, dig in`,
    });
  }

  // 3. High overdue total
  if (m.overdue > 5 && bullets.length < 4) {
    bullets.push({
      tone: "concern",
      text: `${m.overdue} follow-ups overdue total — clearing these first should be the priority`,
    });
  }

  // 4. Issue concentration: one issue type owns >40% of open with non-issues
  const totalIssues = ISSUE_KINDS.filter((k) => k !== "none").reduce(
    (s, k) => s + (m.issueCounts[k] ?? 0),
    0,
  );
  if (totalIssues >= 5 && bullets.length < 4) {
    let dominantKind: IssueKind | null = null;
    let dominantCount = 0;
    for (const k of ISSUE_KINDS) {
      if (k === "none") continue;
      const n = m.issueCounts[k] ?? 0;
      if (n > dominantCount) {
        dominantCount = n;
        dominantKind = k;
      }
    }
    if (dominantKind && dominantCount / totalIssues > 0.4 && dominantCount >= 5) {
      const pct = Math.round((dominantCount / totalIssues) * 100);
      bullets.push({
        tone: "concern",
        text: `${dominantCount} ${ISSUE_LABEL_LOCAL[dominantKind]} jobs (${pct}% of issued workload) — focused chase needed`,
      });
    }
  }

  // 5. Heavy workload overall
  if (m.workload > 45 && bullets.length < 4) {
    bullets.push({
      tone: "concern",
      text: `${m.workload} open follow-ups — consider triaging the oldest down to ≤40`,
    });
  }

  // 6. All clear — only if nothing else fired
  if (bullets.length === 0 && m.workload > 0) {
    bullets.push({
      tone: "win",
      text: "Nothing overdue, no stale Critical/Rush — clean slate, keep it up",
    });
  }

  return bullets.slice(0, 5);
}

// --- Oldest open jobs -----------------------------------------------------

export interface OldestJob {
  jobId: number;
  daysOpen: number;
  issue: string | null;
  priority: string | null;
  contact: string | null;
  jobDescription: string | null;
}

export function getOldestOpenJobs(args: {
  openRows: FollowupRow[];
  jobFirstSeen: Map<number, Date>;
  todayPacific?: string;
  now?: Date;
  limit?: number;
}): OldestJob[] {
  const now = args.now ?? new Date();
  const today = args.todayPacific ?? todayInPacific();
  const limit = args.limit ?? 5;
  const enriched: OldestJob[] = [];
  for (const r of args.openRows) {
    const days = jobStaleDays({
      jobId: r.jobId,
      fuDate: r.fuDate,
      jobFirstSeen: args.jobFirstSeen,
      todayPacific: today,
      now,
    });
    // Only include jobs with measurable staleness — 0d entries are jobs
    // that are planned for today/future and not actually neglected, so
    // showing them defeats the point of the "oldest" panel.
    if (days === null || days <= 0) continue;
    enriched.push({
      jobId: r.jobId,
      daysOpen: days,
      issue: r.issue,
      priority: r.priority,
      contact: r.contact,
      jobDescription: r.jobDescription,
    });
  }
  enriched.sort((a, b) => b.daysOpen - a.daysOpen);
  return enriched.slice(0, limit);
}

// --- Workload imbalance ---------------------------------------------------

export interface ImbalanceFinding {
  high: { csrId: number; csrName: string; workload: number };
  low: { csrId: number; csrName: string; workload: number };
  ratio: number;
}

// --- Team metrics & benchmarks --------------------------------------------
//
// Sums + averages across the team for the top-of-page TeamSummary strip and
// the per-card benchmark markers on each scorecard. Pure reduction over the
// metrics array — no new queries.

export interface TeamMetrics {
  csrCount: number;
  // Totals
  totalWorkload: number;
  totalOverdue: number;
  totalCriticalRush: number;
  totalStaleCriticalRush: number;
  totalDueToday: number;
  totalClosedToday: number;
  // Averages (per CSR)
  avgWorkload: number;
  avgOverdue: number;
  avgCriticalRush: number;
  avgStaleCriticalRush: number;
  avgDueToday: number;
  // Workload imbalance bookkeeping
  overWorkloadThreshold: number;
  workloadThreshold: number;
  // Per-CSR rank on the headline attention score (lower is better → rank 1).
  ranks: Map<number, number>;
}

const HEAVY_WORKLOAD_THRESHOLD = 45;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function deriveTeamMetrics(metrics: CsrMetrics[]): TeamMetrics {
  const csrCount = metrics.length;

  const totalWorkload = metrics.reduce((s, m) => s + m.workload, 0);
  const totalOverdue = metrics.reduce((s, m) => s + m.overdue, 0);
  const totalCriticalRush = metrics.reduce((s, m) => s + m.criticalRush, 0);
  const totalStaleCriticalRush = metrics.reduce(
    (s, m) => s + m.staleCriticalRush,
    0,
  );
  const totalDueToday = metrics.reduce((s, m) => s + m.dueToday, 0);
  const totalClosedToday = metrics.reduce((s, m) => s + m.closedToday, 0);

  const overWorkloadThreshold = metrics.filter(
    (m) => m.workload > HEAVY_WORKLOAD_THRESHOLD,
  ).length;

  // Rank by headlineKpi ascending (lower-better = rank 1). Ties get the same
  // rank using the "min" method so two CSRs at 0 are both rank 1.
  const sortedByKpi = [...metrics].sort(
    (a, b) => a.headlineKpi - b.headlineKpi,
  );
  const ranks = new Map<number, number>();
  let lastValue = -1;
  let lastRank = 0;
  sortedByKpi.forEach((m, i) => {
    const rank = m.headlineKpi === lastValue ? lastRank : i + 1;
    ranks.set(m.csrId, rank);
    lastValue = m.headlineKpi;
    lastRank = rank;
  });

  return {
    csrCount,
    totalWorkload,
    totalOverdue,
    totalCriticalRush,
    totalStaleCriticalRush,
    totalDueToday,
    totalClosedToday,
    avgWorkload: mean(metrics.map((m) => m.workload)),
    avgOverdue: mean(metrics.map((m) => m.overdue)),
    avgCriticalRush: mean(metrics.map((m) => m.criticalRush)),
    avgStaleCriticalRush: mean(metrics.map((m) => m.staleCriticalRush)),
    avgDueToday: mean(metrics.map((m) => m.dueToday)),
    overWorkloadThreshold,
    workloadThreshold: HEAVY_WORKLOAD_THRESHOLD,
    ranks,
  };
}

// "Is this CSR's metric meaningfully above or below team average?" Used by the
// scorecard to color the benchmark subtitle. Higher is worse for these
// metrics, so above-avg → bad.
export type BenchmarkTone = "good" | "neutral" | "bad";

export function benchmarkTone(
  value: number,
  avg: number,
  opts: { higherIsWorse?: boolean } = {},
): BenchmarkTone {
  const higherIsWorse = opts.higherIsWorse ?? true;
  if (avg < 1) {
    // When the team average is tiny, raw deltas dominate. Avoid false reds.
    if (value === 0) return "good";
    if (higherIsWorse) return value >= 2 ? "bad" : "neutral";
    return value >= 2 ? "good" : "neutral";
  }
  const ratio = value / avg;
  if (higherIsWorse) {
    if (ratio >= 1.5) return "bad";
    if (ratio <= 0.5) return "good";
    return "neutral";
  }
  if (ratio >= 1.5) return "good";
  if (ratio <= 0.5) return "bad";
  return "neutral";
}

// --- Priority queue -------------------------------------------------------
//
// One ranked list across the whole team of the top items that need attention
// right now. Each row gets a single "reason" tag based on the highest-scoring
// rule it matches.

export type PriorityReason =
  | "stale-critical"
  | "long-stuck"
  | "overdue-aged"
  | "critical"
  | "overdue";

export interface PriorityItem {
  jobId: number;
  csrId: number;
  csrName: string;
  issue: string | null;
  priority: string | null;
  contact: string | null;
  jobDescription: string | null;
  daysOpen: number;
  daysOverdue: number;
  reason: PriorityReason;
  score: number;
}

export const PRIORITY_REASON_LABEL: Record<PriorityReason, string> = {
  "stale-critical": "Stale Critical/Rush",
  "long-stuck": "Long-stuck (14d+)",
  "overdue-aged": "Overdue & aged",
  critical: "Critical/Rush",
  overdue: "Overdue",
};

export function buildPriorityQueue(args: {
  metrics: CsrMetrics[];
  jobFirstSeen: Map<number, Date>;
  todayPacific?: string;
  now?: Date;
  limit?: number;
}): PriorityItem[] {
  const today = args.todayPacific ?? todayInPacific();
  const now = args.now ?? new Date();
  const limit = args.limit ?? 15;

  const items: PriorityItem[] = [];
  for (const m of args.metrics) {
    for (const r of m.openRows) {
      const overdue = daysOverdue(r.fuDate, today) ?? 0;
      const stale =
        jobStaleDays({
          jobId: r.jobId,
          fuDate: r.fuDate,
          jobFirstSeen: args.jobFirstSeen,
          todayPacific: today,
          now,
        }) ?? 0;
      const critical = isCritical(r.priority);

      let reason: PriorityReason | null = null;
      let score = 0;
      if (critical && overdue > 0) {
        reason = "stale-critical";
        score = 1000 + stale * 5 + overdue * 3;
      } else if (stale >= 14) {
        reason = "long-stuck";
        score = 500 + stale * 4;
      } else if (overdue > 0 && stale >= 7) {
        reason = "overdue-aged";
        score = 300 + stale * 3 + overdue * 2;
      } else if (critical) {
        reason = "critical";
        score = 200 + stale;
      } else if (overdue > 0) {
        reason = "overdue";
        score = 100 + overdue * 2;
      }

      if (reason !== null) {
        items.push({
          jobId: r.jobId,
          csrId: m.csrId,
          csrName: m.csrName,
          issue: r.issue,
          priority: r.priority,
          contact: r.contact,
          jobDescription: r.jobDescription,
          daysOpen: stale,
          daysOverdue: overdue,
          reason,
          score,
        });
      }
    }
  }

  items.sort((a, b) => b.score - a.score);
  return items.slice(0, limit);
}

export function detectWorkloadImbalance(
  metrics: CsrMetrics[],
): ImbalanceFinding | null {
  if (metrics.length < 2) return null;
  const sorted = [...metrics].sort((a, b) => b.workload - a.workload);
  const high = sorted[0];
  const low = sorted[sorted.length - 1];
  // Don't flag tiny workloads — noise.
  if (high.workload < 10) return null;
  const ratio = high.workload / Math.max(low.workload, 1);
  // Don't flag mild differences.
  if (ratio < 1.5) return null;
  // Don't flag a tiny absolute gap (e.g., 12 vs 6 has ratio 2.0 but the
  // difference of 6 jobs isn't worth a banner).
  if (high.workload - low.workload < 8) return null;
  return {
    high: { csrId: high.csrId, csrName: high.csrName, workload: high.workload },
    low: { csrId: low.csrId, csrName: low.csrName, workload: low.workload },
    ratio,
  };
}

export type { IssueKind };
