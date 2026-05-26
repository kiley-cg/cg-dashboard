// Phase D1: job-keyed verification look-back. Search by customer name
// or job number, hit a result, deep-link to /jobs/[id] where the full
// verification trail + editable spec record live.

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { searchJobs } from "@/lib/db/customer-search";
import { PageHelp } from "../_components/PageHelp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verifications · Color Graphics" };

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function VerificationsSearchPage({ searchParams }: Props) {
  const session = await auth();
  // Read access keyed to inventory.view — anyone who can see inventory
  // verifications today can search them. Tighten later if needed.
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "inventory.view",
  });
  if (!allowed) redirect("/");

  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const results = query ? await searchJobs({ query, limit: 30 }) : [];
  const isDigits = /^\d+$/.test(query);
  // If they typed a job# directly and there's an exact match, jump
  // straight to the job page instead of making them click through.
  if (isDigits && results.length === 1 && results[0].jobId === query) {
    redirect(`/jobs/${query}`);
  }

  return (
    <section className="max-w-3xl mx-auto px-6 py-10 space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
            Verification look-back
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight mt-1">
            Find a job
          </h1>
          <p className="text-cg-n-600 text-sm mt-1">
            Search by customer name or job number. Confirm imprint location,
            quantity, who approved — without flipping pages.
          </p>
        </div>
        <PageHelp slug="verifications" title="Verifications" />
      </header>

      <form action="/verifications" method="GET" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Customer name or job #"
          autoFocus
          className="flex-1 border border-cg-n-300 rounded-input px-3 py-2 bg-white text-sm"
        />
        <button
          type="submit"
          className="rounded-btn bg-cg-black text-white px-4 py-1.5 text-sm font-semibold hover:bg-cg-n-800"
        >
          Search
        </button>
      </form>

      {query && (
        <div className="border border-cg-n-200 rounded-card divide-y divide-cg-n-200">
          {results.length === 0 ? (
            <div className="p-6 text-sm text-cg-n-600 italic">
              No matches for <q>{query}</q>.{" "}
              {isDigits ? (
                <>
                  Try the exact job number — or{" "}
                  <Link
                    href={`/jobs/${query}`}
                    className="text-cg-teal underline"
                  >
                    open Job {query} directly
                  </Link>
                  .
                </>
              ) : (
                <>Try a customer name partial, or paste a job #.</>
              )}
            </div>
          ) : (
            results.map((r) => (
              <Link
                key={r.jobId}
                href={`/jobs/${r.jobId}`}
                className="block p-4 hover:bg-cg-n-50 transition"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-cg-teal">
                    Job {r.jobId}
                  </span>
                  {r.customer && (
                    <span className="text-cg-n-700 text-sm">
                      {r.customer}
                    </span>
                  )}
                </div>
                {r.jobDescription && (
                  <p className="text-[12px] text-cg-n-600 mt-1 truncate">
                    {r.jobDescription}
                  </p>
                )}
              </Link>
            ))
          )}
        </div>
      )}
    </section>
  );
}
