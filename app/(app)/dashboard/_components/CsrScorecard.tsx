import type { CsrMetrics } from "../_lib/compute";
import { ISSUE_LABEL } from "./IssueBadge";
import { ISSUE_KINDS, type IssueKind } from "@/lib/syncore/followups";

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

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "warn" | "danger" | "good";
}) {
  const color =
    tone === "danger"
      ? "text-cg-danger"
      : tone === "warn"
        ? "text-cg-warning"
        : tone === "good"
          ? "text-cg-success"
          : "text-cg-n-900";
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-cg-n-500">
        {label}
      </span>
      <span className={`text-xl font-bold ${color}`}>{value}</span>
    </div>
  );
}

export function CsrScorecard({ m }: { m: CsrMetrics }) {
  const total = Math.max(
    1,
    ISSUE_KINDS.reduce((n, k) => n + (m.issueCounts[k] ?? 0), 0),
  );

  const headlineColor =
    m.headlineKpi === 0
      ? "text-cg-success"
      : m.headlineKpi <= 3
        ? "text-cg-warning"
        : "text-cg-danger";

  return (
    <article className="rounded-card border border-cg-n-200 bg-white p-6 shadow-sm">
      <header className="flex items-baseline justify-between mb-4">
        <h3 className="text-lg font-extrabold tracking-tight text-cg-n-900">
          {m.csrName}
        </h3>
        <div className="text-right">
          <div className={`text-4xl font-black tabular-nums ${headlineColor}`}>
            {m.headlineKpi}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-cg-n-500">
            attention score · lower is better
          </div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <Stat label="Workload" value={m.workload} />
        <Stat
          label="Due today"
          value={m.dueToday}
          tone={m.dueToday > 0 ? "warn" : "neutral"}
        />
        <Stat
          label="Overdue"
          value={m.overdue}
          tone={m.overdue > 0 ? "danger" : "good"}
        />
        <Stat
          label="Critical/Rush"
          value={m.criticalRush}
          tone={m.staleCriticalRush > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Completed today"
          value={m.closedToday}
          tone={m.closedToday > 0 ? "good" : "neutral"}
        />
        <Stat
          label="Stale crit/rush"
          value={m.staleCriticalRush}
          tone={m.staleCriticalRush > 0 ? "danger" : "neutral"}
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
