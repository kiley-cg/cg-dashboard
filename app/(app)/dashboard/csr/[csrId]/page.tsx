import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { isManager } from "@/lib/managers";
import {
  getCsrDailyHistory,
  getLatestSnapshotPerCsr,
  getDailyTrend,
  getJobFirstSeenMap,
  getMostRecentSnapshotAt,
  getCsrOpenRowsBefore,
} from "@/lib/db/followups";
import {
  deriveCsrMetrics,
  deriveTeamMetrics,
  generateTalkingPoints,
  getOldestOpenJobs,
  groupBundles,
  todayInPacific,
  type CsrMetrics,
} from "../../_lib/compute";
import { CsrScorecard } from "../../_components/CsrScorecard";
import { DailyHistoryTable } from "../../_components/DailyHistoryTable";
import { JobsTable } from "../../_components/JobsTable";
import { TalkingPoints } from "../../_components/TalkingPoints";
import { OldestJobsList } from "../../_components/OldestJobsList";
import { Sparkline } from "../../_components/Sparkline";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ csrId: string }> };

export async function generateMetadata({ params }: Props) {
  const { csrId } = await params;
  return { title: `CSR ${csrId} · Color Graphics` };
}

export default async function CsrDetailPage({ params }: Props) {
  const session = await auth();
  if (!isManager(session?.user?.email)) notFound();

  const { csrId: csrIdStr } = await params;
  const csrId = Number(csrIdStr);
  if (!Number.isFinite(csrId)) notFound();

  const today = todayInPacific();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [bundles, mostRecent, firstSeen, weekAgoRows] = await Promise.all([
    getLatestSnapshotPerCsr(),
    getMostRecentSnapshotAt(),
    getJobFirstSeenMap(),
    getCsrOpenRowsBefore({ csrId, before: sevenDaysAgo }),
  ]);

  if (bundles.length === 0) notFound();

  const grouped = groupBundles(bundles);
  const bundle = grouped.get(csrId);
  if (!bundle || !bundle.open) notFound();

  // Build full team metrics so the scorecard can show benchmarks + rank.
  const allMetrics: CsrMetrics[] = Array.from(grouped.entries()).map(
    ([id, b]) =>
      deriveCsrMetrics({
        csrId: id,
        csrName:
          b.open?.snapshot.csrName ??
          b.completed?.snapshot.csrName ??
          `CSR ${id}`,
        open: b.open,
        completed: b.completed,
        opts: { todayPacific: today, jobFirstSeen: firstSeen },
      }),
  );
  const team = deriveTeamMetrics(allMetrics);
  const m = allMetrics.find((x) => x.csrId === csrId);
  if (!m) notFound();

  const [workloadTrend, issuesTrend, dailyHistory] = await Promise.all([
    getDailyTrend({ csrId, status: "open", days: 30 }),
    getDailyTrend({ csrId, status: "open", days: 30 }),
    getCsrDailyHistory({ csrId, days: 30 }),
  ]);

  // 7-day rolling close rate for the scorecard stat (consistent with main
  // dashboard).
  const last7 = dailyHistory.slice(-7);
  const avgClosedPerDay =
    last7.length === 0
      ? 0
      : last7.reduce((s, p) => s + p.closedThatDay, 0) / last7.length;

  // What changed this week — diff today's open rows against the snapshot
  // closest to 7 days ago.
  const currentJobIds = new Set(m.openRows.map((r) => r.jobId));
  const weekAgoJobIds = new Set(weekAgoRows.map((r) => r.jobId));
  const addedThisWeek = m.openRows.filter((r) => !weekAgoJobIds.has(r.jobId));
  const closedThisWeek = weekAgoRows.filter((r) => !currentJobIds.has(r.jobId));

  const bullets = generateTalkingPoints({
    metrics: m,
    jobFirstSeen: firstSeen,
    todayPacific: today,
  });
  const oldest = getOldestOpenJobs({
    openRows: m.openRows,
    jobFirstSeen: firstSeen,
    todayPacific: today,
    limit: 15,
  });

  const workloadPoints = workloadTrend.map((p) => p.totalRecords);
  const issuesPoints = issuesTrend.map((p) => p.totalIssues);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center text-sm text-cg-n-500 hover:text-cg-n-900"
      >
        ← Back to dashboard
      </Link>

      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-cg-n-900">
          {m.csrName}
        </h1>
        <p className="text-sm text-cg-n-500">
          Snapshot for {today}
          {mostRecent && (
            <>
              {" "}
              · most recent {new Date(mostRecent).toLocaleString("en-US", {
                timeZone: "America/Los_Angeles",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </>
          )}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <CsrScorecard
            m={m}
            team={team}
            workloadTrend={workloadPoints}
            avgClosedPerDay={avgClosedPerDay}
          />
          <TalkingPoints bullets={bullets} csrName={m.csrName} />
        </div>

        <div className="space-y-4">
          <WhatChangedCard
            added={addedThisWeek.length}
            closed={closedThisWeek.length}
            hasBaseline={weekAgoRows.length > 0}
          />
          <TrendCard
            label="30-day workload"
            points={workloadPoints}
            latest={m.workload}
            color="#363639"
          />
          <TrendCard
            label="30-day issues"
            points={issuesPoints}
            latest={issuesPoints.at(-1) ?? 0}
            color="#E01B2B"
          />
        </div>
      </div>

      <DailyHistoryTable history={dailyHistory} />

      <OldestJobsList jobs={oldest} csrName={m.csrName} />

      <div id="jobs">
        <JobsTable
          rows={m.openRows.concat(m.completedRows)}
          todayPacific={today}
        />
      </div>
    </div>
  );
}

function WhatChangedCard({
  added,
  closed,
  hasBaseline,
}: {
  added: number;
  closed: number;
  hasBaseline: boolean;
}) {
  return (
    <div className="rounded-card border border-cg-n-200 bg-white p-5 shadow-sm">
      <h4 className="text-xs uppercase tracking-wide text-cg-n-500 font-semibold mb-3">
        What changed this week
      </h4>
      {!hasBaseline ? (
        <p className="text-sm text-cg-n-500 italic">
          Not enough snapshot history yet (need 7+ days).
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-2xl font-black tabular-nums text-cg-n-900">
              +{added}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-cg-n-500">
              Added to open list
            </div>
          </div>
          <div>
            <div className="text-2xl font-black tabular-nums text-cg-success">
              −{closed}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-cg-n-500">
              Closed / removed
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrendCard({
  label,
  points,
  latest,
  color,
}: {
  label: string;
  points: number[];
  latest: number;
  color: string;
}) {
  return (
    <div className="rounded-card border border-cg-n-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-xs uppercase tracking-wide text-cg-n-500 font-semibold">
          {label}
        </h4>
        <span className="text-lg font-bold tabular-nums text-cg-n-900">
          {latest}
        </span>
      </div>
      <div style={{ color }}>
        <Sparkline points={points} width={240} height={56} stroke={color} />
      </div>
    </div>
  );
}
