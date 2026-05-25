import { notFound } from "next/navigation";
import { promises as fs } from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasPermission } from "@/lib/rbac";
import { runCronNow } from "./_actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Crons · Admin · Color Graphics" };

interface VercelCron {
  path: string;
  schedule: string;
}

interface RunRow {
  id: string;
  triggeredAt: Date;
  triggeredBy: string;
  durationMs: number | null;
  status: string;
  summary: unknown;
  errorMessage: string | null;
}

export default async function AdminCronsPage() {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.crons",
  });
  if (!allowed) notFound();

  // Parse vercel.json at request time. Could memoize but it's small
  // and changes are rare; live-read keeps the dashboard accurate even
  // if someone edits vercel.json between deploys (won't take effect
  // until deploy anyway, but the dashboard shouldn't lie).
  const raw = await fs.readFile(
    path.join(process.cwd(), "vercel.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as { crons?: VercelCron[] };
  const crons = parsed.crons ?? [];

  // Last 5 runs per cron, fetched in parallel.
  const recentByCron = new Map<string, RunRow[]>();
  await Promise.all(
    crons.map(async (c) => {
      const rows = await db
        .select()
        .from(schema.cronRuns)
        .where(eq(schema.cronRuns.cronPath, c.path))
        .orderBy(desc(schema.cronRuns.triggeredAt))
        .limit(5);
      recentByCron.set(c.path, rows);
    }),
  );

  return (
    <section className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <header>
        <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
          Admin
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight mt-1">
          Scheduled jobs
        </h1>
        <p className="text-cg-n-600 mt-2 text-sm">
          Source: <code className="bg-cg-n-100 px-1 rounded text-xs">vercel.json</code>. Run history is captured for instrumented routes; uninstrumented routes show <em>no history yet</em>.
        </p>
      </header>

      <div className="space-y-4">
        {crons.length === 0 && (
          <div className="border border-cg-n-200 rounded-card p-6 text-sm text-cg-n-600 italic">
            No crons configured.
          </div>
        )}
        {crons.map((c) => {
          const runs = recentByCron.get(c.path) ?? [];
          const last = runs[0];
          return (
            <div
              key={`${c.path}-${c.schedule}`}
              className="border border-cg-n-200 rounded-card overflow-hidden"
            >
              <header className="bg-cg-n-50 px-4 py-3 flex flex-wrap items-baseline gap-3 border-b border-cg-n-200">
                <code className="font-mono text-sm font-semibold text-cg-n-800">
                  {c.path}
                </code>
                <code className="text-xs bg-white border border-cg-n-200 px-1.5 py-0.5 rounded">
                  {c.schedule}
                </code>
                <span className="text-[11px] text-cg-n-500">
                  {humanCron(c.schedule)} · UTC
                </span>
                <form action={runCronNow} className="ml-auto">
                  <input type="hidden" name="path" value={c.path} />
                  <button
                    type="submit"
                    className="text-xs border border-cg-teal text-cg-teal rounded-input px-3 py-1 hover:bg-cg-teal hover:text-white"
                  >
                    Run now
                  </button>
                </form>
              </header>
              {last ? (
                <div className="px-4 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span
                      className={[
                        "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                        last.status === "ok"
                          ? "bg-cg-success-tint text-cg-success"
                          : "bg-cg-error-tint text-cg-error",
                      ].join(" ")}
                    >
                      {last.status}
                    </span>
                    <span className="text-cg-n-700">
                      Last run{" "}
                      {new Intl.DateTimeFormat("en-US", {
                        timeZone: "America/Los_Angeles",
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(last.triggeredAt)}{" "}
                      · {last.durationMs ?? "—"}ms · by {last.triggeredBy}
                    </span>
                  </div>
                  {last.errorMessage && (
                    <pre className="mt-2 text-[11px] text-cg-error bg-cg-error-tint p-2 rounded whitespace-pre-wrap break-words">
                      {last.errorMessage}
                    </pre>
                  )}
                  {last.summary != null && (
                    <pre className="mt-2 text-[11px] text-cg-n-700 bg-cg-n-50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(last.summary, null, 2)}
                    </pre>
                  )}
                  {runs.length > 1 && (
                    <details className="mt-2">
                      <summary className="text-[11px] text-cg-n-500 cursor-pointer hover:text-cg-n-700">
                        {runs.length - 1} earlier run{runs.length - 1 === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-[11px]">
                        {runs.slice(1).map((r) => (
                          <li key={r.id} className="text-cg-n-600">
                            <span
                              className={
                                r.status === "ok"
                                  ? "text-cg-success"
                                  : "text-cg-error"
                              }
                            >
                              {r.status}
                            </span>{" "}
                            ·{" "}
                            {new Intl.DateTimeFormat("en-US", {
                              timeZone: "America/Los_Angeles",
                              dateStyle: "short",
                              timeStyle: "short",
                            }).format(r.triggeredAt)}{" "}
                            · {r.durationMs ?? "—"}ms · {r.triggeredBy}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ) : (
                <div className="px-4 py-3 text-sm text-cg-n-500 italic">
                  No history yet. (Route may not be instrumented with{" "}
                  <code className="text-[11px] bg-cg-n-100 px-1 rounded">
                    logCronRun
                  </code>
                  .)
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Best-effort human readable of a 5-field cron string. Not exhaustive —
// covers the common shapes we use ('0 15 * * 1-5', '30 14-23 * * 1-5',
// '0 15,21 * * 1-5'). Falls back to the raw string otherwise.
function humanCron(s: string): string {
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 5) return s;
  const [m, h, dom, mon, dow] = parts;
  const dowLabel = dow === "1-5" ? "weekdays" : dow === "*" ? "every day" : dow;
  if (dom === "*" && mon === "*") {
    if (h === "*") return `every hour at :${m.padStart(2, "0")} · ${dowLabel}`;
    return `${h}:${m.padStart(2, "0")} · ${dowLabel}`;
  }
  return s;
}
