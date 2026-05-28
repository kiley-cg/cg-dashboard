import { notFound } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Proof backfill · Admin · Color Graphics",
};

// Sort key: lower bound of the range name. "32000-32999" → 32000.
// Matches the cron's newest-first selection so the row at the top is
// usually the one actively being processed.
function rangeLowerBound(name: string): number {
  const m = name.match(/^(\d+)-/);
  return m ? Number(m[1]) : 0;
}

function formatPct(processed: number, total: number | null): string {
  if (total == null || total === 0) return "—";
  return `${Math.floor((processed / total) * 100)}%`;
}

export default async function ProofBackfillAdminPage() {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.crons",
  });
  if (!allowed) notFound();

  const rows = await db
    .select()
    .from(schema.proofBackfillState)
    .orderBy(desc(schema.proofBackfillState.updatedAt));
  rows.sort(
    (a, b) => rangeLowerBound(b.rangeName) - rangeLowerBound(a.rangeName),
  );

  // Aggregate: how many ranges are done vs in-progress vs not-yet-seeded
  // (totalCount still null), and the cumulative file count.
  const totalRanges = rows.length;
  const doneRanges = rows.filter((r) => r.doneAt != null).length;
  const seedingRanges = rows.filter((r) => r.totalCount == null).length;
  const totalProcessed = rows.reduce((sum, r) => sum + r.processedOffset, 0);
  const totalFiles = rows.reduce(
    (sum, r) => sum + (r.totalCount ?? 0),
    0,
  );

  // Live count of proof rows in the DB — sanity check that the
  // processedOffset matches what's actually been written.
  const [{ count: liveProofRows }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.jobVerificationRecord)
    .where(sql`${schema.jobVerificationRecord.source} = 'proof'`);

  return (
    <section className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <header>
        <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
          Admin
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight mt-1">
          Proof backfill
        </h1>
        <p className="text-cg-n-600 mt-2 text-sm">
          Progress of the slow-drip historical proof sync. The cron at{" "}
          <code className="bg-cg-n-100 px-1 rounded text-xs">
            /api/cron/backfill-proofs
          </code>{" "}
          runs every 4 hours and processes one chunk (200 files) of the
          newest unprocessed range. Manual chunks via{" "}
          <code className="bg-cg-n-100 px-1 rounded text-xs">
            /api/cron/sync-proofs?rootFolderId=…
          </code>{" "}
          also count toward the same{" "}
          <code className="bg-cg-n-100 px-1 rounded text-xs">
            job_verification_record
          </code>{" "}
          table.
        </p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Ranges done" value={`${doneRanges} / ${totalRanges}`} />
        <Stat
          label="Files processed"
          value={`${totalProcessed.toLocaleString()} / ${totalFiles.toLocaleString()}`}
          sub={formatPct(totalProcessed, totalFiles)}
        />
        <Stat
          label="Rows in DB"
          value={liveProofRows.toLocaleString()}
          sub="source='proof'"
        />
        <Stat
          label="Awaiting seed"
          value={String(seedingRanges)}
          sub="totalCount unknown"
        />
      </div>

      <div className="border border-cg-n-200 rounded-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cg-n-50 border-b border-cg-n-200">
            <tr className="text-left text-[11px] uppercase tracking-wider text-cg-n-600">
              <th className="px-4 py-2.5">Range</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Processed</th>
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5 w-40">%</th>
              <th className="px-4 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-cg-n-500 italic"
                >
                  No state rows yet. The next cron run will seed them by
                  walking the Drive root.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const pct =
                r.totalCount != null && r.totalCount > 0
                  ? Math.floor((r.processedOffset / r.totalCount) * 100)
                  : null;
              const status = r.doneAt
                ? { label: "done", tone: "bg-cg-success-tint text-cg-success" }
                : r.totalCount == null
                  ? { label: "seeding", tone: "bg-cg-n-100 text-cg-n-700" }
                  : {
                      label: "in progress",
                      tone: "bg-cg-warning-tint text-cg-warning",
                    };
              return (
                <tr
                  key={r.rangeName}
                  className="border-b border-cg-n-100 last:border-b-0"
                >
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {r.rangeName}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={[
                        "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                        status.tone,
                      ].join(" ")}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.processedOffset.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.totalCount?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {pct == null ? (
                      <span className="text-cg-n-400">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-cg-n-100 rounded overflow-hidden">
                          <div
                            className={`h-full rounded ${
                              r.doneAt
                                ? "bg-cg-success"
                                : "bg-cg-teal"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-cg-n-600 tabular-nums w-9 text-right">
                          {pct}%
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-cg-n-600">
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: "America/Los_Angeles",
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(r.updatedAt)}
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

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-card border border-cg-n-200 bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-cg-n-500 font-semibold">
        {label}
      </div>
      <div className="text-xl font-extrabold text-cg-n-900 tabular-nums mt-0.5">
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-cg-n-500 mt-0.5">{sub}</div>
      )}
    </div>
  );
}
