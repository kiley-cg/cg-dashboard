import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { isManager } from "@/lib/managers";
import {
  getLatestSnapshotPerCsr,
  getDailyTrend,
  getJobFirstSeenMap,
  getMostRecentSnapshotAt,
  type DailyTrendPoint,
} from "@/lib/db/followups";
import {
  deriveCsrMetrics,
  groupBundles,
  todayInPacific,
  type CsrMetrics,
} from "./_lib/compute";
import { CsrScorecard } from "./_components/CsrScorecard";
import { TeamRollup } from "./_components/TeamRollup";
import { JobsTable } from "./_components/JobsTable";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "CSR Performance · Color Graphics",
};

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!isManager(session?.user?.email)) {
    // Defense-in-depth: middleware should have redirected. Show 404 so the
    // route isn't visibly "forbidden".
    notFound();
  }

  const today = todayInPacific();
  const [bundles, mostRecent, firstSeen] = await Promise.all([
    getLatestSnapshotPerCsr(),
    getMostRecentSnapshotAt(),
    getJobFirstSeenMap(),
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
      opts: { todayPacific: today, jobFirstSeen: firstSeen },
    });
  });

  // 30-day trend per CSR (one point/day, end-of-day snapshot).
  const trends = new Map<
    number,
    { workload: DailyTrendPoint[]; overdue: DailyTrendPoint[] }
  >();
  await Promise.all(
    metrics.map(async (m) => {
      const [workload, overdue] = await Promise.all([
        getDailyTrend({ csrId: m.csrId, status: "open", days: 30 }),
        getDailyTrend({ csrId: m.csrId, status: "open", days: 30 }),
      ]);
      trends.set(m.csrId, { workload, overdue });
    }),
  );

  const allRows = bundles.flatMap((b) => b.rows);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-cg-n-900">
            CSR Performance
          </h1>
          <p className="text-sm text-cg-n-500">
            {mostRecent
              ? `Last updated ${formatRelative(mostRecent)} · today: ${today}`
              : `today: ${today}`}
          </p>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {metrics.map((m) => (
          <CsrScorecard key={m.csrId} m={m} />
        ))}
      </div>

      <TeamRollup metrics={metrics} trends={trends} />

      <JobsTable rows={allRows} todayPacific={today} />
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
