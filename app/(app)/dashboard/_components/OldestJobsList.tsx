import type { OldestJob } from "../_lib/compute";

const SYNCORE_DEEP_LINK = "https://www.ateasesystems.net/Job/Details";

function ageColor(days: number): string {
  if (days >= 14) return "text-cg-danger";
  if (days >= 7) return "text-cg-warning";
  return "text-cg-n-700";
}

export function OldestJobsList({
  jobs,
  csrName,
}: {
  jobs: OldestJob[];
  csrName: string;
}) {
  return (
    <div className="rounded-card border border-cg-n-200 bg-white p-5 shadow-sm">
      <h4 className="text-xs uppercase tracking-wide text-cg-n-500 font-semibold mb-3">
        Oldest open jobs · {csrName}
      </h4>
      {jobs.length === 0 ? (
        <p className="text-sm text-cg-n-500 italic">
          No open jobs with a known first-seen date yet
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-cg-n-500">
              <th className="pb-1.5 pr-2">Job</th>
              <th className="pb-1.5 pr-2">Issue</th>
              <th className="pb-1.5 pr-2">Priority</th>
              <th className="pb-1.5 text-right">Days open</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.jobId} className="border-t border-cg-n-100">
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  <a
                    href={`${SYNCORE_DEEP_LINK}/${j.jobId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-cg-info hover:underline"
                    title={j.jobDescription ?? undefined}
                  >
                    {j.jobId}
                  </a>
                </td>
                <td className="py-1.5 pr-2 text-cg-n-700">
                  {j.issue ?? "—"}
                </td>
                <td className="py-1.5 pr-2 text-cg-n-700 whitespace-nowrap">
                  {j.priority ?? "—"}
                </td>
                <td
                  className={`py-1.5 text-right tabular-nums font-semibold ${ageColor(j.daysOpen)}`}
                >
                  {j.daysOpen}d
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
