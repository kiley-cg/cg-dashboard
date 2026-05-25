import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { listProductionNotes } from "@/lib/db/production-po";
import {
  departmentForSupplier,
  type Department,
} from "@/lib/syncore/production";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Production notes · Color Graphics",
};

const DEPT_CHIP: Record<Department, { label: string; color: string }> = {
  embroidery: { label: "EMB", color: "#0F6E56" },
  transfers: { label: "TRN", color: "#8A5A2B" },
  fulfillment: { label: "FUL", color: "#3B6FB0" },
  other: { label: "OTH", color: "#6B6356" },
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function ProductionNotesPage({ searchParams }: PageProps) {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "production.view",
  });
  if (!allowed) notFound();

  const { q } = await searchParams;
  const query = q?.trim() || undefined;
  const entries = await listProductionNotes({ query });

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <header className="flex items-baseline justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold">Production notes</h1>
          <p className="text-[13px] text-[#6B6356] mt-1">
            Every saved note across all decoration POs — open or closed.
            Search by note text, customer, job, PO number, or supplier.
          </p>
        </div>
        <Link
          href="/production"
          className="text-[13px] text-cg-teal font-semibold hover:underline"
        >
          ← Back to production
        </Link>
      </header>

      <form method="get" className="mb-5">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search notes, customer, job, PO…"
          className="w-full border border-[#D6DCCF] rounded-card bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-cg-teal"
        />
      </form>

      {entries.length === 0 ? (
        <div className="text-[13px] text-[#6B6356] bg-[#F3F1E8] border border-[#E3DFD3] rounded-card px-4 py-6 text-center">
          {query
            ? `No notes match "${query}".`
            : "No production notes yet. Save one from a tile on the production page."}
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => {
            const dept = departmentForSupplier(e.supplierName);
            const chip = DEPT_CHIP[dept];
            return (
              <li
                key={e.poId}
                className="border border-[#E3DFD3] rounded-card bg-[#FCFBF7] p-4"
              >
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="font-bold text-[15px]">{e.customer}</span>
                  {e.jobId && (
                    <IdChip label="Job" value={e.jobId} />
                  )}
                  {e.poNumber != null && (
                    <IdChip label="PO" value={String(e.poNumber)} />
                  )}
                  <span
                    className="text-[10px] font-bold tracking-wider border rounded px-1.5 py-px"
                    style={{ color: chip.color, borderColor: chip.color }}
                    title={e.supplierName ?? undefined}
                  >
                    {chip.label}
                  </span>
                  <span className="text-[11px] text-[#9B9588] ml-auto">
                    {formatWhen(e.updatedAt)}
                    {e.authorName ? ` · ${e.authorName}` : ""}
                  </span>
                </div>
                <div className="text-[13.5px] text-[#1C2B27] whitespace-pre-wrap">
                  {e.notes}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function IdChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs text-[#4A4336] bg-[#ECEFE9] border border-[#D6DCCF] rounded px-2 py-px tabular-nums">
      {label} <b className="text-cg-teal font-extrabold text-[13px]">{value}</b>
    </span>
  );
}

function formatWhen(d: Date | null): string {
  if (!d) return "";
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
  };
  return d.toLocaleDateString("en-US", opts);
}
