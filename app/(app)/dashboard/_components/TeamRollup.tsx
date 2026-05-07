import type { CsrMetrics } from "../_lib/compute";
import type { DailyTrendPoint } from "@/lib/db/followups";
import { ISSUE_KINDS } from "@/lib/syncore/followups";
import { ISSUE_LABEL } from "./IssueBadge";
import { Sparkline } from "./Sparkline";

interface Props {
  metrics: CsrMetrics[];
  trends: Map<number, { workload: DailyTrendPoint[]; overdue: DailyTrendPoint[] }>;
}

export function TeamRollup({ metrics, trends }: Props) {
  const max = Math.max(
    1,
    ...metrics.flatMap((m) => ISSUE_KINDS.map((k) => m.issueCounts[k] ?? 0)),
  );

  return (
    <section className="rounded-card border border-cg-n-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-extrabold tracking-tight text-cg-n-900 mb-4">
        Team rollup
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2 pr-4 text-xs uppercase tracking-wide text-cg-n-500 font-semibold">
                CSR
              </th>
              {ISSUE_KINDS.map((k) => (
                <th
                  key={k}
                  className="py-2 px-1.5 text-[10px] uppercase tracking-wide text-cg-n-500 font-semibold text-center align-bottom"
                >
                  <span className="inline-block whitespace-nowrap" style={{ writingMode: "horizontal-tb" }}>
                    {ISSUE_LABEL[k]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.csrId} className="border-t border-cg-n-100">
                <td className="py-2 pr-4 font-semibold text-cg-n-900 whitespace-nowrap">
                  {m.csrName}
                </td>
                {ISSUE_KINDS.map((k) => {
                  const n = m.issueCounts[k] ?? 0;
                  // Intensity 0..1 used as a Tailwind bg-opacity proxy.
                  const intensity = n === 0 ? 0 : 0.15 + 0.85 * (n / max);
                  return (
                    <td
                      key={k}
                      className="px-1.5 py-2 text-center"
                      title={`${m.csrName} · ${ISSUE_LABEL[k]}: ${n}`}
                    >
                      <div
                        className="rounded-md py-1.5 text-xs font-bold tabular-nums"
                        style={{
                          backgroundColor:
                            intensity === 0
                              ? "#F7F7F8"
                              : `rgba(224, 27, 43, ${intensity})`,
                          color: intensity > 0.5 ? "white" : "#363639",
                        }}
                      >
                        {n}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <div className="text-xs uppercase tracking-wide text-cg-n-500 mb-3">
          30-day trend
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {metrics.map((m) => {
            const t = trends.get(m.csrId);
            const workloadPoints = (t?.workload ?? []).map((p) => p.totalRecords);
            const overduePoints = (t?.overdue ?? []).map((p) => p.totalIssues);
            return (
              <div
                key={m.csrId}
                className="rounded-card border border-cg-n-100 p-3"
              >
                <div className="text-sm font-semibold text-cg-n-900 mb-2">
                  {m.csrName}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <TrendBox
                    label="Open"
                    latest={workloadPoints.at(-1) ?? m.workload}
                    points={workloadPoints}
                    color="#363639"
                  />
                  <TrendBox
                    label="Issues"
                    latest={overduePoints.at(-1) ?? 0}
                    points={overduePoints}
                    color="#E01B2B"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TrendBox({
  label,
  latest,
  points,
  color,
}: {
  label: string;
  latest: number;
  points: number[];
  color: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wide text-cg-n-500">
          {label}
        </span>
        <span className="text-sm font-bold tabular-nums text-cg-n-900">
          {latest}
        </span>
      </div>
      <div style={{ color }}>
        <Sparkline points={points} stroke={color} />
      </div>
    </div>
  );
}
