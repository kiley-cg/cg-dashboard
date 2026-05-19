import Link from "next/link";
import {
  benchmarkTone,
  type BenchmarkTone,
  type CsrMetrics,
  type TeamMetrics,
} from "../_lib/compute";
import { ISSUE_LABEL } from "./IssueBadge";
import { ISSUE_KINDS, type IssueKind } from "@/lib/syncore/followups";
import { Sparkline } from "./Sparkline";

// Tailwind needs full class names in source for the JIT to keep them. Mirror
// the IssueBadge dot palette here.
const SEGMENT_BG: Record<IssueKind, string> = {
  artwork: "bg-purple-500",
  backOrder: "bg-cg-n-500",
  development: "bg-cg-black",
  hold: "bg-amber-400",
  inProduction: "bg-cg-info",
  inTransit: "bg-cg-success",
  needsTracking: "bg-cg-teal",
  postDelivery: "bg-cg-red-300",
  problem: "bg-cg-danger",
  waiting: "bg-cg-warning",
  none: "bg-cg-n-300",
};

function formatAvg(avg: number): string {
  return avg < 10 ? avg.toFixed(1) : Math.round(avg).toString();
}

function Stat({
  label,
  value,
  tone = "neutral",
  avg,
  benchmarkTone: bench = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "warn" | "danger" | "good";
  avg?: number;
  benchmarkTone?: BenchmarkTone;
}) {
  const color =
    tone === "danger"
      ? "text-cg-danger"
      : tone === "warn"
        ? "text-cg-warning"
        : tone === "good"
          ? "text-cg-success"
          : "text-cg-n-900";
  const benchColor =
    bench === "bad"
      ? "text-cg-danger"
      : bench === "good"
        ? "text-cg-success"
        : "text-cg-n-400";
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-cg-n-500">
        {label}
      </span>
      <span className={`text-xl font-bold ${color}`}>{value}</span>
      {avg !== undefined && (
        <span className={`text-[10px] tabular-nums ${benchColor}`}>
          team avg {formatAvg(avg)}
        </span>
      )}
    </div>
  );
}

function rankLabel(rank: number): string {
  const j = rank % 10;
  const k = rank % 100;
  if (j === 1 && k !== 11) return `${rank}st`;
  if (j === 2 && k !== 12) return `${rank}nd`;
  if (j === 3 && k !== 13) return `${rank}rd`;
  return `${rank}th`;
}

// Headline coloring relative to the team: quartile-style with simple cuts.
// Lower headlineKpi is better.
function relativeHeadlineColor(
  value: number,
  avg: number,
  rank: number,
  count: number,
): string {
  if (value === 0) return "text-cg-success";
  if (count <= 1) {
    return value > 3 ? "text-cg-danger" : "text-cg-warning";
  }
  const topQuartile = Math.max(1, Math.ceil(count / 4));
  const bottomQuartile = Math.max(1, Math.floor(count * 0.75));
  if (rank <= topQuartile) return "text-cg-success";
  if (rank >= bottomQuartile + 1) return "text-cg-danger";
  // Above average → lean warning even in middle band.
  return value > avg ? "text-cg-warning" : "text-cg-n-800";
}

export function CsrScorecard({
  m,
  team,
  workloadTrend,
}: {
  m: CsrMetrics;
  team?: TeamMetrics;
  workloadTrend?: number[];
}) {
  const total = Math.max(
    1,
    ISSUE_KINDS.reduce((n, k) => n + (m.issueCounts[k] ?? 0), 0),
  );

  const rank = team?.ranks.get(m.csrId);
  const headlineColor = team
    ? relativeHeadlineColor(
        m.headlineKpi,
        team.avgOverdue + team.avgStaleCriticalRush,
        rank ?? 1,
        team.csrCount,
      )
    : m.headlineKpi === 0
      ? "text-cg-success"
      : m.headlineKpi <= 3
        ? "text-cg-warning"
        : "text-cg-danger";

  // 7-day workload delta from the existing trend data (one point per day).
  const recent = workloadTrend ?? [];
  const last7 = recent.slice(-7);
  const sevenDayAgo = recent.length >= 8 ? recent[recent.length - 8] : null;
  const workloadDelta =
    sevenDayAgo !== null ? m.workload - sevenDayAgo : null;

  return (
    <article className="rounded-card border border-cg-n-200 bg-white p-6 shadow-sm">
      <header className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <Link
            href={`/dashboard/csr/${m.csrId}`}
            className="text-lg font-extrabold tracking-tight text-cg-n-900 hover:text-cg-red"
          >
            {m.csrName}
            <span className="ml-1 text-xs font-normal text-cg-n-400">›</span>
          </Link>
          {team && rank !== undefined && (
            <div className="text-[10px] uppercase tracking-wide text-cg-n-500 mt-0.5">
              {rankLabel(rank)} of {team.csrCount} on attention score
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className={`text-4xl font-black tabular-nums ${headlineColor}`}>
            {m.headlineKpi}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-cg-n-500">
            attention score · lower is better
          </div>
          {last7.length >= 2 && (
            <div className="mt-1 flex items-center justify-end gap-2">
              <div className="text-cg-n-500">
                <Sparkline points={last7} width={64} height={18} />
              </div>
              {workloadDelta !== null && (
                <DeltaPill delta={workloadDelta} label="7d" />
              )}
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <Stat
          label="Follow-ups"
          value={m.workload}
          avg={team?.avgWorkload}
          benchmarkTone={
            team ? benchmarkTone(m.workload, team.avgWorkload) : "neutral"
          }
        />
        <Stat
          label="Due today"
          value={m.dueToday}
          tone={m.dueToday > 0 ? "warn" : "neutral"}
          avg={team?.avgDueToday}
          benchmarkTone={
            team ? benchmarkTone(m.dueToday, team.avgDueToday) : "neutral"
          }
        />
        <Stat
          label="Overdue"
          value={m.overdue}
          tone={m.overdue > 0 ? "danger" : "good"}
          avg={team?.avgOverdue}
          benchmarkTone={
            team ? benchmarkTone(m.overdue, team.avgOverdue) : "neutral"
          }
        />
        <Stat
          label="Critical/Rush"
          value={m.criticalRush}
          tone={m.staleCriticalRush > 0 ? "danger" : "neutral"}
          avg={team?.avgCriticalRush}
          benchmarkTone={
            team
              ? benchmarkTone(m.criticalRush, team.avgCriticalRush)
              : "neutral"
          }
        />
        <Stat
          label="Stale crit/rush"
          value={m.staleCriticalRush}
          tone={m.staleCriticalRush > 0 ? "danger" : "neutral"}
          avg={team?.avgStaleCriticalRush}
          benchmarkTone={
            team
              ? benchmarkTone(m.staleCriticalRush, team.avgStaleCriticalRush)
              : "neutral"
          }
        />
      </div>

      <div className="mb-5">
        <div className="flex justify-between text-xs uppercase tracking-wide text-cg-n-500 mb-1.5">
          <span>Issue mix</span>
          <span>{Math.max(total, 0)} open</span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-cg-n-100">
          {ISSUE_KINDS.map((kind) => {
            const n = m.issueCounts[kind] ?? 0;
            if (n === 0) return null;
            const pct = (n / total) * 100;
            return (
              <div
                key={kind}
                className={SEGMENT_BG[kind]}
                style={{ width: `${pct}%` }}
                title={`${ISSUE_LABEL[kind]}: ${n}`}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-cg-n-600">
          {ISSUE_KINDS.filter((k) => (m.issueCounts[k] ?? 0) > 0).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span
                className={`h-1.5 w-1.5 rounded-full ${SEGMENT_BG[k]}`}
                aria-hidden
              />
              {ISSUE_LABEL[k]} {m.issueCounts[k]}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-cg-n-500 mb-1.5">
          Aging on open list
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <AgePill label="< 1d" n={m.agingBuckets.lt1} tone="neutral" />
          <AgePill label="1–3d" n={m.agingBuckets.d1to3} tone="neutral" />
          <AgePill label="3–7d" n={m.agingBuckets.d3to7} tone="warn" />
          <AgePill label="7d+" n={m.agingBuckets.gt7} tone="danger" />
        </div>
      </div>
    </article>
  );
}

function DeltaPill({ delta, label }: { delta: number; label: string }) {
  if (delta === 0) {
    return (
      <span className="text-[10px] font-semibold text-cg-n-400 tabular-nums">
        flat {label}
      </span>
    );
  }
  const up = delta > 0;
  const color = up ? "text-cg-danger" : "text-cg-success";
  const arrow = up ? "▲" : "▼";
  return (
    <span className={`text-[10px] font-semibold tabular-nums ${color}`}>
      {arrow}
      {Math.abs(delta)} {label}
    </span>
  );
}

function AgePill({
  label,
  n,
  tone,
}: {
  label: string;
  n: number;
  tone: "neutral" | "warn" | "danger";
}) {
  const tones = {
    neutral: "bg-cg-n-100 text-cg-n-800",
    warn: "bg-amber-50 text-cg-warning",
    danger: "bg-cg-red-50 text-cg-danger",
  } as const;
  return (
    <div className={`rounded-card py-1.5 ${tones[tone]}`}>
      <div className="text-base font-bold tabular-nums">{n}</div>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}
