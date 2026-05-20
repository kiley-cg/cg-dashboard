import Link from "next/link";
import {
  PRIORITY_REASON_LABEL,
  type PriorityItem,
  type PriorityReason,
} from "../_lib/compute";
import { IssueBadge, issueKindFromLabel } from "./IssueBadge";
import { LinkSpinner } from "./LinkSpinner";

const SYNCORE_DEEP_LINK = "https://www.ateasesystems.net/Job/Details";

const REASON_TONE: Record<PriorityReason, { bg: string; text: string }> = {
  "stale-critical": { bg: "bg-cg-red-50", text: "text-cg-danger" },
  "long-stuck": { bg: "bg-cg-red-50", text: "text-cg-danger" },
  "overdue-aged": { bg: "bg-amber-50", text: "text-cg-warning" },
  critical: { bg: "bg-cg-red-50", text: "text-cg-danger" },
  overdue: { bg: "bg-amber-50", text: "text-cg-warning" },
};

export function PriorityQueue({ items }: { items: PriorityItem[] }) {
  if (items.length === 0) {
    return (
      <section className="rounded-card border border-cg-n-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-extrabold tracking-tight text-cg-n-900">
          Needs attention
        </h3>
        <p className="mt-3 text-sm text-cg-success">
          Nothing flagged — no overdue, stale, or critical items across the team.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-cg-n-200 bg-white shadow-sm">
      <header className="flex items-baseline justify-between border-b border-cg-n-100 p-4">
        <h3 className="text-lg font-extrabold tracking-tight text-cg-n-900">
          Needs attention
        </h3>
        <span className="text-xs uppercase tracking-wide text-cg-n-500">
          Top {items.length} across team
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cg-n-50">
            <tr className="text-left text-xs uppercase tracking-wide text-cg-n-500">
              <th className="px-3 py-2">Job #</th>
              <th className="px-3 py-2">CSR</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Issue</th>
              <th className="px-3 py-2 text-right">Days open</th>
              <th className="px-3 py-2 text-right">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const tone = REASON_TONE[item.reason];
              return (
                <tr
                  key={`${item.csrId}-${item.jobId}`}
                  className="border-t border-cg-n-100 hover:bg-cg-n-50"
                >
                  <td className="px-3 py-2 font-semibold text-cg-info whitespace-nowrap">
                    <a
                      href={`${SYNCORE_DEEP_LINK}/${item.jobId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      title={item.jobDescription ?? undefined}
                    >
                      {item.jobId}
                    </a>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link
                      href={`/dashboard/csr/${item.csrId}`}
                      className="inline-flex items-center gap-1.5 rounded-chip bg-cg-n-100 px-2 py-0.5 text-xs font-semibold text-cg-n-800 hover:bg-cg-n-200"
                    >
                      {item.csrName}
                      <LinkSpinner size={10} />
                    </Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`inline-flex rounded-chip px-2 py-0.5 text-xs font-semibold ${tone.bg} ${tone.text}`}
                    >
                      {PRIORITY_REASON_LABEL[item.reason]}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-cg-n-700">
                    {item.priority ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <IssueBadge kind={issueKindFromLabel(item.issue)} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-cg-n-800">
                    {item.daysOpen}d
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-cg-danger">
                    {item.daysOverdue > 0 ? `${item.daysOverdue}d` : "—"}
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
