import type { ImbalanceFinding } from "../_lib/compute";

export function ImbalanceBanner({ finding }: { finding: ImbalanceFinding }) {
  const { high, low, ratio } = finding;
  return (
    <div className="rounded-card border border-cg-warning/30 bg-amber-50 px-5 py-3 flex items-start gap-3">
      <span
        className="h-2 w-2 rounded-full bg-cg-warning mt-2 shrink-0"
        aria-hidden
      />
      <div className="text-sm text-cg-n-800">
        <span className="font-semibold">Workload imbalance:</span>{" "}
        <span className="font-semibold">{high.csrName}</span> at{" "}
        <span className="tabular-nums font-semibold">{high.workload}</span>{" "}
        follow-ups vs{" "}
        <span className="font-semibold">{low.csrName}</span> at{" "}
        <span className="tabular-nums font-semibold">{low.workload}</span> (
        {ratio.toFixed(1)}× gap). Consider redistributing some open jobs.
      </div>
    </div>
  );
}
