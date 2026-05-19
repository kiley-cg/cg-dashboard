import type { TeamMetrics } from "../_lib/compute";

interface Props {
  team: TeamMetrics;
  yesterdayOpen: number | null;
  yesterdayIssues: number | null;
  totalIssuesToday: number;
}

export function TeamSummary({
  team,
  yesterdayOpen,
  yesterdayIssues,
  totalIssuesToday,
}: Props) {
  const openDelta =
    yesterdayOpen !== null ? team.totalWorkload - yesterdayOpen : null;
  const issuesDelta =
    yesterdayIssues !== null ? totalIssuesToday - yesterdayIssues : null;

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <Tile
        label="Open follow-ups"
        value={team.totalWorkload}
        delta={openDelta}
        higherIsWorse
      />
      <Tile
        label="Total issues"
        value={totalIssuesToday}
        delta={issuesDelta}
        higherIsWorse
      />
      <Tile
        label="Overdue"
        value={team.totalOverdue}
        tone={team.totalOverdue > 0 ? "bad" : "good"}
      />
      <Tile
        label="Stale Crit/Rush"
        value={team.totalStaleCriticalRush}
        tone={team.totalStaleCriticalRush > 0 ? "bad" : "good"}
      />
      <Tile
        label="Over workload"
        value={`${team.overWorkloadThreshold} of ${team.csrCount}`}
        sub={`> ${team.workloadThreshold} jobs`}
        tone={team.overWorkloadThreshold > 0 ? "warn" : "neutral"}
      />
      <Tile
        label="Closed today"
        value={team.totalClosedToday}
        tone={team.totalClosedToday > 0 ? "good" : "neutral"}
      />
    </section>
  );
}

function Tile({
  label,
  value,
  delta,
  sub,
  tone = "neutral",
  higherIsWorse = false,
}: {
  label: string;
  value: number | string;
  delta?: number | null;
  sub?: string;
  tone?: "neutral" | "warn" | "bad" | "good";
  higherIsWorse?: boolean;
}) {
  const valueColor =
    tone === "bad"
      ? "text-cg-danger"
      : tone === "warn"
        ? "text-cg-warning"
        : tone === "good"
          ? "text-cg-success"
          : "text-cg-n-900";

  return (
    <div className="rounded-card border border-cg-n-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-cg-n-500 font-semibold">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className={`text-3xl font-black tabular-nums ${valueColor}`}>
          {value}
        </div>
        {delta !== undefined && delta !== null && (
          <DeltaBadge delta={delta} higherIsWorse={higherIsWorse} />
        )}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-cg-n-500">{sub}</div>
      )}
    </div>
  );
}

function DeltaBadge({
  delta,
  higherIsWorse,
}: {
  delta: number;
  higherIsWorse: boolean;
}) {
  if (delta === 0) {
    return (
      <span className="text-[11px] font-semibold text-cg-n-400 tabular-nums">
        flat
      </span>
    );
  }
  const up = delta > 0;
  const bad = higherIsWorse ? up : !up;
  const color = bad ? "text-cg-danger" : "text-cg-success";
  const arrow = up ? "▲" : "▼";
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${color}`}>
      {arrow} {Math.abs(delta)} vs yest.
    </span>
  );
}
