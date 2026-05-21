import type { DailyHistoryPoint } from "@/lib/db/followups";

interface Props {
  history: DailyHistoryPoint[];
}

function formatDate(d: string): string {
  // d is YYYY-MM-DD (Pacific binning); parse without TZ to avoid date-shift.
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

function formatSnapshotTime(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function todayInPacific(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

function rollingAvg(
  history: DailyHistoryPoint[],
  index: number,
  windowDays: number,
): number {
  const start = Math.max(0, index - windowDays + 1);
  const slice = history.slice(start, index + 1);
  // Only average days where we actually have a within-day window.
  const measured = slice.filter((p) => p.hasFullDayWindow);
  if (measured.length === 0) return 0;
  return measured.reduce((s, p) => s + p.closedThatDay, 0) / measured.length;
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

  const today = todayInPacific();
  // Newest day on top.
  const rows = [...history.entries()].reverse();

  // Averages over completed days that had a full within-day window.
  const measured = history.filter(
    (p) => p.hasFullDayWindow && p.date !== today,
  );
  const overallAvg =
    measured.length === 0
      ? 0
      : measured.reduce((s, p) => s + p.closedThatDay, 0) / measured.length;
  const last7 = measured.slice(-7);
  const last7Avg =
    last7.length === 0
      ? 0
      : last7.reduce((s, p) => s + p.closedThatDay, 0) / last7.length;

  return (
    <section className="rounded-card border border-cg-n-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-cg-n-100 p-4">
        <div>
          <h3 className="text-lg font-extrabold tracking-tight text-cg-n-900">
            Daily follow-up history
          </h3>
          <p className="text-[11px] text-cg-n-500 mt-0.5">
            Counts are follow-ups due that day or overdue (not future-dated).{" "}
            <span className="font-semibold">Beginning FU</span> at the AM
            snapshot, <span className="font-semibold">EOD FU</span> at the PM
            snapshot, <span className="font-semibold">Closed</span> = items
            cleared from the due set during the day.
          </p>
        </div>
        <div className="text-xs text-cg-n-500 tabular-nums whitespace-nowrap">
          <span className="font-semibold text-cg-n-800">
            {overallAvg.toFixed(1)}
          </span>{" "}
          closed/day avg over {measured.length}d ·{" "}
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
              <th className="px-3 py-2 text-right" title="Due or overdue at the AM snapshot — the rep's workload to clear that day.">
                Beginning FU
              </th>
              <th className="px-3 py-2 text-right" title="Due or overdue still open at the PM snapshot — what the rep didn't get to.">
                EOD FU
              </th>
              <th className="px-3 py-2 text-right" title="Items in the BOD due set that aren't in the EOD due set — what the rep cleared.">
                Closed
              </th>
              <th className="px-3 py-2 text-right">7-day avg closed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([idx, point]) => {
              const isToday = point.date === today;
              const bodLabel = formatSnapshotTime(point.bodSnapshotAt);
              const eodLabel = formatSnapshotTime(point.eodSnapshotAt);
              const eodColor =
                point.eodCount === 0
                  ? "text-cg-success"
                  : point.eodCount <= 3
                    ? "text-cg-n-700"
                    : "text-cg-danger";
              return (
                <tr
                  key={point.date}
                  className="border-t border-cg-n-100 hover:bg-cg-n-50"
                >
                  <td className="px-3 py-2 whitespace-nowrap text-cg-n-700">
                    <div className="flex items-center gap-2">
                      <span>{formatDate(point.date)}</span>
                      {isToday && (
                        <span className="rounded-chip bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-cg-warning">
                          in progress
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-cg-n-400">
                      {bodLabel && eodLabel && bodLabel !== eodLabel
                        ? `BOD ${bodLabel} · EOD ${eodLabel} PT`
                        : bodLabel || eodLabel
                          ? `as of ${eodLabel || bodLabel} PT`
                          : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-cg-n-800">
                    {point.bodCount}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-semibold ${eodColor}`}
                  >
                    {point.eodCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-cg-success font-semibold">
                    {!point.hasFullDayWindow
                      ? "—"
                      : point.closedThatDay > 0
                        ? point.closedThatDay
                        : "0"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-cg-n-600">
                    {!point.hasFullDayWindow
                      ? "—"
                      : rollingAvg(history, idx, 7).toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
