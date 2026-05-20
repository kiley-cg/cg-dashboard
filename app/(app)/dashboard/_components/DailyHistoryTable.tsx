import type { DailyHistoryPoint } from "@/lib/db/followups";

interface Props {
  history: DailyHistoryPoint[];
}

function formatDate(d: string): string {
  // d is YYYY-MM-DD from Postgres; parse without TZ to avoid date-shift.
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  const dt = new Date(Date.UTC(y, m - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(dt);
}

function rollingAvg(history: DailyHistoryPoint[], index: number, windowDays: number): number {
  const start = Math.max(0, index - windowDays + 1);
  const slice = history.slice(start, index + 1);
  if (slice.length === 0) return 0;
  return slice.reduce((s, p) => s + p.closedThatDay, 0) / slice.length;
}

export function DailyHistoryTable({ history }: Props) {
  if (history.length === 0) {
    return (
      <div className="rounded-card border border-cg-n-200 bg-white p-5 shadow-sm">
        <h4 className="text-xs uppercase tracking-wide text-cg-n-500 font-semibold mb-2">
          Daily follow-up history
        </h4>
        <p className="text-sm text-cg-n-500 italic">
          Not enough snapshot history yet (need at least 2 days).
        </p>
      </div>
    );
  }

  // Newest day on top.
  const rows = [...history.entries()].reverse();

  const overallAvg =
    history.reduce((s, p) => s + p.closedThatDay, 0) / history.length;
  const last7 = history.slice(-7);
  const last7Avg =
    last7.length === 0
      ? 0
      : last7.reduce((s, p) => s + p.closedThatDay, 0) / last7.length;

  return (
    <section className="rounded-card border border-cg-n-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-cg-n-100 p-4">
        <h3 className="text-lg font-extrabold tracking-tight text-cg-n-900">
          Daily follow-up history
        </h3>
        <div className="text-xs text-cg-n-500 tabular-nums">
          <span className="font-semibold text-cg-n-800">
            {overallAvg.toFixed(1)}
          </span>{" "}
          closed/day avg over {history.length}d ·{" "}
          <span className="font-semibold text-cg-n-800">
            {last7Avg.toFixed(1)}
          </span>{" "}
          closed/day last 7d
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cg-n-50">
            <tr className="text-left text-xs uppercase tracking-wide text-cg-n-500">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2 text-right">Open EOD</th>
              <th className="px-3 py-2 text-right">Closed</th>
              <th className="px-3 py-2 text-right">7-day avg closed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([idx, point]) => (
              <tr
                key={point.date}
                className="border-t border-cg-n-100 hover:bg-cg-n-50"
              >
                <td className="px-3 py-2 whitespace-nowrap text-cg-n-700">
                  {formatDate(point.date)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-cg-n-900 font-semibold">
                  {point.openAtEod}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-cg-success font-semibold">
                  {point.closedThatDay > 0 ? point.closedThatDay : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-cg-n-600">
                  {rollingAvg(history, idx, 7).toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
