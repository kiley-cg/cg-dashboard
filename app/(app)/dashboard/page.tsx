import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { isManager } from "@/lib/managers";
import { PageHelp } from "../_components/PageHelp";
import {
  getCsrDailyHistory,
  getLatestSnapshotPerCsr,
  getDailyTrend,
  getJobFirstSeenMap,
  getMostRecentSnapshotAt,
  getTeamOpenJobIdsBefore,
  getTeamWorkloadBefore,
  type DailyTrendPoint,
} from "@/lib/db/followups";
import {
  buildPriorityQueue,
  deriveCsrMetrics,
  deriveTeamMetrics,
  detectWorkloadImbalance,
  generateTalkingPoints,
  getOldestOpenJobs,
  groupBundles,
  todayInPacific,
  type CsrMetrics,
  type OldestJob,
  type TalkingPoint,
} from "./_lib/compute";
import Link from "next/link";
import { CsrScorecard } from "./_components/CsrScorecard";
import { TeamRollup } from "./_components/TeamRollup";
import { JobsTable } from "./_components/JobsTable";
import { TalkingPoints } from "./_components/TalkingPoints";
import { OldestJobsList } from "./_components/OldestJobsList";
import { ImbalanceBanner } from "./_components/ImbalanceBanner";
import { TeamSummary } from "./_components/TeamSummary";
import { PriorityQueue } from "./_components/PriorityQueue";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "CSR Performance · Color Graphics",
};

function formatRelative(d: Date | string | number): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "unknown";
  const ms = Date.now() - dt.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function formatPacificTime(d: Date | string | number): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(dt);
}

export default async function DashboardPage() {
  const session = await auth();
  if (!isManager(session?.user?.email)) {
    // Defense-in-depth: middleware should have redirected. Show 404 so the
    // route isn't visibly "forbidden".
    notFound();
  }

  const today = todayInPacific();
  // 24 hours back, in absolute time — used to sum yesterday's open totals
  // across the team for the day-over-day deltas, and to diff open-job
  // sets per CSR for "Closed today".
  const yesterdayCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [bundles, mostRecent, firstSeen, yesterdayTeam, yesterdayOpenJobIds] =
    await Promise.all([
      getLatestSnapshotPerCsr(),
      getMostRecentSnapshotAt(),
      getJobFirstSeenMap(),
      getTeamWorkloadBefore(yesterdayCutoff),
      getTeamOpenJobIdsBefore(yesterdayCutoff),
    ]);

  if (bundles.length === 0) {
    return <EmptyState />;
  }

  const grouped = groupBundles(bundles);
  const csrEntries = Array.from(grouped.entries()).sort(
    ([, a], [, b]) =>
      (a.open?.snapshot.csrName ?? "").localeCompare(
        b.open?.snapshot.csrName ?? "",
      ),
  );

  const metrics: CsrMetrics[] = csrEntries.map(([csrId, bundle]) => {
    const csrName =
      bundle.open?.snapshot.csrName ??
      bundle.completed?.snapshot.csrName ??
      `CSR ${csrId}`;
    return deriveCsrMetrics({
      csrId,
      csrName,
      open: bundle.open,
      completed: bundle.completed,
      prevOpenJobIds: yesterdayOpenJobIds.get(csrId),
      opts: { todayPacific: today, jobFirstSeen: firstSeen },
    });
  });

  // 30-day trend per CSR (one point/day, end-of-day snapshot) + 7-day
  // closed-per-day rolling for the "Avg closed/day" stat on each scorecard.
  const trends = new Map<
    number,
    { workload: DailyTrendPoint[]; overdue: DailyTrendPoint[] }
  >();
  const avgClosedByCsrId = new Map<number, number>();
  await Promise.all(
    metrics.map(async (m) => {
      const [workload, overdue, history] = await Promise.all([
        getDailyTrend({ csrId: m.csrId, status: "open", days: 30 }),
        getDailyTrend({ csrId: m.csrId, status: "open", days: 30 }),
        // Pull a bit extra so we can drop today (partial day) and still
        // average over a full 7 days.
        getCsrDailyHistory({ csrId: m.csrId, days: 8 }),
      ]);
      trends.set(m.csrId, { workload, overdue });
      const completed = history.filter((p) => p.date !== today).slice(-7);
      const avg =
        completed.length === 0
          ? 0
          : completed.reduce((s, p) => s + p.closedThatDay, 0) /
            completed.length;
      avgClosedByCsrId.set(m.csrId, avg);
    }),
  );

  const allRows = bundles.flatMap((b) => b.rows);
  const imbalance = detectWorkloadImbalance(metrics);
  const team = deriveTeamMetrics(metrics);
  const totalIssuesToday = metrics.reduce((s, m) => {
    let n = 0;
    for (const k of Object.keys(m.issueCounts) as Array<
      keyof typeof m.issueCounts
    >) {
      if (k === "none") continue;
      n += m.issueCounts[k] ?? 0;
    }
    return s + n;
  }, 0);
  const priorityItems = buildPriorityQueue({
    metrics,
    jobFirstSeen: firstSeen,
    todayPacific: today,
    limit: 15,
  });
  const now = new Date();

  // Per-CSR talking points + oldest jobs, computed alongside the scorecard
  // so we can render them side-by-side in the same column.
  const enriched: Array<{
    m: CsrMetrics;
    bullets: TalkingPoint[];
    oldest: OldestJob[];
  }> = metrics.map((m) => ({
    m,
    bullets: generateTalkingPoints({
      metrics: m,
      jobFirstSeen: firstSeen,
      todayPacific: today,
      now,
    }),
    oldest: getOldestOpenJobs({
      openRows: m.openRows,
      jobFirstSeen: firstSeen,
      todayPacific: today,
      now,
      limit: 5,
    }),
  }));

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {imbalance && <ImbalanceBanner finding={imbalance} />}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-cg-n-900">
            CSR Performance
          </h1>
          <p className="text-sm text-cg-n-500">
            {mostRecent ? (
              <>
                Snapshot at{" "}
                <span className="font-semibold text-cg-n-700">
                  {formatPacificTime(mostRecent)}
                </span>{" "}
                · {formatRelative(mostRecent)} · for {today}
              </>
            ) : (
              <>today: {today}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/help/dashboard"
            className="text-cg-info hover:underline text-sm"
          >
            Help &amp; FAQ →
          </Link>
          <PageHelp slug="dashboard" title="Manager dashboard" />
        </div>
      </header>

      <TeamSummary
        team={team}
        yesterdayOpen={yesterdayTeam.totalRecords || null}
        yesterdayIssues={yesterdayTeam.totalIssues || null}
        totalIssuesToday={totalIssuesToday}
      />

      <PriorityQueue items={priorityItems} />

      <div className="grid gap-4 md:grid-cols-2">
        {enriched.map(({ m, bullets, oldest }) => (
          <div key={m.csrId} className="space-y-4">
            <CsrScorecard
              m={m}
              team={team}
              workloadTrend={trends.get(m.csrId)?.workload.map((p) => p.totalRecords)}
              avgClosedPerDay={avgClosedByCsrId.get(m.csrId)}
            />
            <TalkingPoints bullets={bullets} csrName={m.csrName} />
            <OldestJobsList jobs={oldest} csrName={m.csrName} />
          </div>
        ))}
      </div>

      <TeamRollup metrics={metrics} trends={trends} />

      <div id="jobs">
        <JobsTable rows={allRows} todayPacific={today} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-cg-n-900 mb-2">
        No snapshots yet
      </h1>
      <p className="text-cg-n-600 mb-4">
        The cron hasn&rsquo;t run. Trigger it manually:
      </p>
      <pre className="inline-block rounded-card bg-cg-n-100 px-4 py-3 text-left text-xs text-cg-n-800">
        curl -X POST -H &quot;x-cron-secret: $CRON_SECRET&quot; \{"\n"}
        {"  "}http://localhost:3000/api/cron/snapshot-followups
      </pre>
    </div>
  );
}
