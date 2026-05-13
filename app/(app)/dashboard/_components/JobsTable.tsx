"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { schema } from "@/lib/db/client";
import { IssueBadge, ISSUE_LABEL, issueKindFromLabel } from "./IssueBadge";
import { ISSUE_KINDS } from "@/lib/syncore/followups";

type FollowupRow = typeof schema.followupRows.$inferSelect;

interface Props {
  rows: FollowupRow[];
  todayPacific: string;
}

type SortKey = "priority" | "fuDate" | "csr" | "issue" | "estDelivery";
type SortDir = "asc" | "desc";

const SYNCORE_DEEP_LINK = "https://www.ateasesystems.net/Job/Details";

const PRIORITY_RANK: Record<string, number> = {
  "critical rush": 0,
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 5,
};

function priorityRank(p: string | null): number {
  if (!p) return 99;
  return PRIORITY_RANK[p.trim().toLowerCase()] ?? 50;
}

function comparePriority(a: string | null, b: string | null): number {
  return priorityRank(a) - priorityRank(b);
}

function compareDates(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareString(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

export function JobsTable({ rows, todayPacific }: Props) {
  const csrs = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.csrName) set.add(r.csrName);
    return Array.from(set).sort();
  }, [rows]);

  const searchParams = useSearchParams();

  const [csrFilter, setCsrFilter] = useState<string>("");
  const [issueFilter, setIssueFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"open" | "completed" | "all">(
    "open",
  );
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Heatmap cells link here with ?csr=…&issue=…; sync those params into local
  // filter state so the table refilters when the user clicks one.
  useEffect(() => {
    const csr = searchParams.get("csr");
    const issue = searchParams.get("issue");
    if (csr !== null) setCsrFilter(csr);
    if (issue !== null) setIssueFilter(issue);
  }, [searchParams]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.followUpStatus !== statusFilter) return false;
      if (csrFilter && r.csrName !== csrFilter) return false;
      if (issueFilter) {
        const kind = issueKindFromLabel(r.issue);
        if (kind !== issueFilter) return false;
      }
      return true;
    });
  }, [rows, csrFilter, issueFilter, statusFilter]);

  const sorted = useMemo(() => {
    const sign = sortDir === "asc" ? 1 : -1;
    const cmp =
      sortKey === "priority"
        ? (a: FollowupRow, b: FollowupRow) => comparePriority(a.priority, b.priority)
        : sortKey === "fuDate"
          ? (a: FollowupRow, b: FollowupRow) => compareDates(a.fuDate, b.fuDate)
          : sortKey === "csr"
            ? (a: FollowupRow, b: FollowupRow) => compareString(a.csrName, b.csrName)
            : sortKey === "issue"
              ? (a: FollowupRow, b: FollowupRow) => compareString(a.issue, b.issue)
              : (a: FollowupRow, b: FollowupRow) => compareDates(a.estDelivery, b.estDelivery);
    return [...filtered].sort((a, b) => sign * cmp(a, b));
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  return (
    <section className="rounded-card border border-cg-n-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cg-n-100 p-4">
        <h3 className="text-lg font-extrabold tracking-tight text-cg-n-900">
          Follow-ups ({sorted.length})
        </h3>
        <div className="flex flex-wrap gap-2 text-sm">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as typeof statusFilter)
            }
            className="rounded-input border border-cg-n-200 px-2 py-1 text-sm"
          >
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="all">All</option>
          </select>
          <select
            value={csrFilter}
            onChange={(e) => setCsrFilter(e.target.value)}
            className="rounded-input border border-cg-n-200 px-2 py-1 text-sm"
          >
            <option value="">All CSRs</option>
            {csrs.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={issueFilter}
            onChange={(e) => setIssueFilter(e.target.value)}
            className="rounded-input border border-cg-n-200 px-2 py-1 text-sm"
          >
            <option value="">All issues</option>
            {ISSUE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ISSUE_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cg-n-50">
            <tr className="text-left text-xs uppercase tracking-wide text-cg-n-500">
              <th className="px-3 py-2">Job #</th>
              <Th label="F/U" onClick={() => toggleSort("fuDate")} active={sortKey === "fuDate"} dir={sortDir} />
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Description</th>
              <Th label="CSR" onClick={() => toggleSort("csr")} active={sortKey === "csr"} dir={sortDir} />
              <Th label="Priority" onClick={() => toggleSort("priority")} active={sortKey === "priority"} dir={sortDir} />
              <Th label="Est. Del." onClick={() => toggleSort("estDelivery")} active={sortKey === "estDelivery"} dir={sortDir} />
              <Th label="Issue" onClick={() => toggleSort("issue")} active={sortKey === "issue"} dir={sortDir} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-cg-n-500">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const overdue =
                r.fuDate &&
                /^\d{4}-\d{2}-\d{2}$/.test(r.fuDate) &&
                r.fuDate < todayPacific;
              return (
                <tr
                  key={r.id}
                  className="border-t border-cg-n-100 hover:bg-cg-n-50"
                >
                  <td className="px-3 py-2 font-semibold text-cg-info">
                    <a
                      href={`${SYNCORE_DEEP_LINK}/${r.jobId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {r.jobId}
                    </a>
                  </td>
                  <td
                    className={`px-3 py-2 whitespace-nowrap ${overdue ? "text-cg-danger font-semibold" : "text-cg-n-700"}`}
                  >
                    {r.fuDate ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-cg-n-700 max-w-[160px] truncate">
                    {r.contact ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-cg-n-700 max-w-[260px] truncate">
                    {r.jobDescription ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-cg-n-700">
                    {r.csrName}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <PriorityChip priority={r.priority} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-cg-n-700">
                    {r.estDelivery ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <IssueBadge kind={issueKindFromLabel(r.issue)} />
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

function Th({
  label,
  onClick,
  active,
  dir,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
}) {
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${active ? "text-cg-n-900" : "text-cg-n-500"} hover:text-cg-n-900`}
      >
        {label}
        {active && <span className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function PriorityChip({ priority }: { priority: string | null }) {
  if (!priority) return <span className="text-cg-n-400">—</span>;
  const lower = priority.trim().toLowerCase();
  const danger = lower === "critical rush" || lower === "critical";
  const warn = lower === "high";
  const cls = danger
    ? "bg-cg-red-50 text-cg-danger"
    : warn
      ? "bg-amber-50 text-cg-warning"
      : "bg-cg-n-100 text-cg-n-700";
  return (
    <span className={`inline-flex rounded-chip px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {priority}
    </span>
  );
}
