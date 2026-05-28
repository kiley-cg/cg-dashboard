// Production Worksheet matrix view (D2.C). Groups every open
// decoration PO that has a synced Drive proof by (decoration, imprint
// location) so Kristen can scan the floor's work as one document
// instead of one-card-at-a-time on /production.
//
// Each PO can have multiple proofs (multi-item job like Madigan), and
// each proof can have multiple imprint locations (Left Chest + Full
// Back). Every (po, proof, location) tuple is one row in its
// (decoration, location) group.
//
// POs with NO proof in Drive are surfaced under a separate
// "Unmatched" group at the bottom so they're not silently dropped.

import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import {
  getCustomerDisplayMap,
  listOpenDecorationPos,
  type DecorationPoView,
} from "@/lib/db/production-po";
import { findProofsByJobIds } from "@/lib/db/verifications";
import { departmentForSupplier } from "@/lib/syncore/production";
import {
  estimateEmbroidery,
  formatMinutes,
} from "@/lib/production/embroidery-estimate";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Production matrix · Color Graphics",
};

// Shape of the `raw` jsonb on proof rows. Keep in sync with snapshotProofs.
type ProofRaw = {
  fileId?: string;
  filename?: string;
  webViewLink?: string | null;
  extracted?: {
    decoration?: string | null;
    imprintLocations?: string[];
    inkColors?: string[];
    imprintDimensions?: string | null;
    productName?: string | null;
    productColor?: string | null;
    salespersonInitials?: string | null;
    stitches?: number | null;
  };
};

interface MatrixRow {
  poView: DecorationPoView;
  customer: string | null;
  filename: string | null;
  webViewLink: string | null;
  productName: string | null;
  productColor: string | null;
  imprintDimensions: string | null;
  inkColors: string[];
  salesperson: string | null;
  stitches: number | null;
  scheduledDate: string | null;
}

interface MatrixGroup {
  decoration: string;
  location: string;
  rows: MatrixRow[];
  totalQty: number;
  totalEstMinutes: number; // sum of per-row embroidery estimates; 0 for non-embroidery
}

export default async function ProductionMatrixPage() {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "production.view",
  });
  if (!allowed) notFound();

  const decorationPos = await listOpenDecorationPos();
  const jobIds = Array.from(
    new Set(decorationPos.map((v) => v.po.syncoreJobId)),
  );
  const [customerMap, proofsByJobId] = await Promise.all([
    getCustomerDisplayMap({ jobIds }),
    findProofsByJobIds(jobIds),
  ]);

  // Build (decoration, location) → rows. Unmatched POs (no proof in
  // Drive) collected separately under UNMATCHED_KEY.
  const groups = new Map<string, MatrixGroup>();
  const unmatched: MatrixRow[] = [];

  for (const v of decorationPos) {
    const customer = customerMap.get(v.po.syncoreJobId) ?? null;
    const proofs = proofsByJobId.get(v.po.syncoreJobId) ?? [];
    if (proofs.length === 0) {
      unmatched.push({
        poView: v,
        customer,
        filename: null,
        webViewLink: null,
        productName: null,
        productColor: null,
        imprintDimensions: null,
        inkColors: [],
        salesperson: null,
        stitches: null,
        scheduledDate: v.state?.scheduledDate ?? null,
      });
      continue;
    }
    for (const p of proofs) {
      const raw = (p.raw ?? {}) as ProofRaw;
      const ex = raw.extracted ?? {};
      const decoration = ex.decoration ?? "Unknown decoration";
      const locations =
        ex.imprintLocations && ex.imprintLocations.length > 0
          ? ex.imprintLocations
          : p.imprintLocation
            ? [p.imprintLocation]
            : ["Unknown location"];
      const row: MatrixRow = {
        poView: v,
        customer,
        filename: raw.filename ?? null,
        webViewLink: raw.webViewLink ?? null,
        productName: ex.productName ?? null,
        productColor: ex.productColor ?? null,
        imprintDimensions: ex.imprintDimensions ?? null,
        inkColors: ex.inkColors ?? [],
        salesperson: ex.salespersonInitials ?? null,
        stitches: ex.stitches ?? null,
        scheduledDate: v.state?.scheduledDate ?? null,
      };
      // Embroidery estimate per row uses the PO's stitchCount × qty.
      // For non-embroidery decoration types, est is 0 (we haven't
      // built formulas for screen print / pad print yet).
      const dept = departmentForSupplier(v.po.supplierName);
      const est =
        dept === "embroidery"
          ? estimateEmbroidery({
              stitchesPerPiece: v.po.stitchCount,
              pieces: v.po.totalQuantity,
            })
          : null;
      const rowEstMinutes = est?.totalMinutes ?? 0;
      for (const location of locations) {
        const key = `${decoration}|||${location}`;
        const g = groups.get(key);
        if (g) {
          g.rows.push(row);
          g.totalQty += v.po.totalQuantity ?? 0;
          g.totalEstMinutes += rowEstMinutes;
        } else {
          groups.set(key, {
            decoration,
            location,
            rows: [row],
            totalQty: v.po.totalQuantity ?? 0,
            totalEstMinutes: rowEstMinutes,
          });
        }
      }
    }
  }

  // Sort groups by total quantity descending — heaviest work first.
  const sortedGroups = Array.from(groups.values()).sort(
    (a, b) => b.totalQty - a.totalQty,
  );

  const totalGroups = sortedGroups.length;
  const totalEntries = sortedGroups.reduce((s, g) => s + g.rows.length, 0);
  const totalQty = sortedGroups.reduce((s, g) => s + g.totalQty, 0);
  const totalEstMinutes = sortedGroups.reduce(
    (s, g) => s + g.totalEstMinutes,
    0,
  );

  return (
    <section className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-cg-n-500 text-xs font-semibold uppercase tracking-wider">
            Production
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight mt-1">
            Worksheet matrix
          </h1>
          <p className="text-cg-n-600 mt-2 text-sm max-w-2xl">
            Every open decoration PO grouped by (decoration, imprint
            location). One row per imprint area — a job with both a Left
            Chest embroidery and a Full Back print shows up in two groups.
          </p>
        </div>
        <Link
          href="/production"
          className="text-sm text-cg-teal hover:underline whitespace-nowrap"
        >
          ← Back to schedule view
        </Link>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Groups" value={String(totalGroups)} />
        <Stat label="Imprint entries" value={String(totalEntries)} />
        <Stat
          label="Total qty"
          value={totalQty.toLocaleString()}
          sub="across all entries"
        />
        <Stat
          label="Embroidery time"
          value={
            totalEstMinutes > 0 ? formatMinutes(totalEstMinutes) : "—"
          }
          sub="800 spm × 12 heads"
        />
        <Stat
          label="POs without proof"
          value={String(unmatched.length)}
          sub="see bottom section"
        />
      </div>

      <div className="space-y-6">
        {sortedGroups.length === 0 && unmatched.length === 0 && (
          <div className="border border-cg-n-200 rounded-card p-8 text-center text-cg-n-500 italic">
            No open decoration POs.
          </div>
        )}

        {sortedGroups.map((g) => (
          <GroupSection key={`${g.decoration}|${g.location}`} group={g} />
        ))}

        {unmatched.length > 0 && (
          <UnmatchedSection rows={unmatched} />
        )}
      </div>
    </section>
  );
}

function GroupSection({ group }: { group: MatrixGroup }) {
  return (
    <div className="border border-cg-n-200 rounded-card overflow-hidden">
      <header className="bg-cg-n-50 px-4 py-3 border-b border-cg-n-200 flex items-baseline flex-wrap gap-x-4 gap-y-1">
        <div>
          <span className="text-xs uppercase tracking-wider text-cg-n-500 font-semibold">
            {group.decoration}
          </span>
          <span className="ml-2 text-base font-bold text-cg-n-900">
            {group.location}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs text-cg-n-600">
          <span>
            <b className="text-cg-n-900">{group.rows.length}</b>{" "}
            {group.rows.length === 1 ? "entry" : "entries"}
          </span>
          <span>
            <b className="text-cg-n-900 tabular-nums">
              {group.totalQty.toLocaleString()}
            </b>{" "}
            qty
          </span>
          {group.totalEstMinutes > 0 && (
            <span title="Embroidery time estimate at 800 spm × 12 heads + 10m setup per design">
              <b className="text-cg-teal tabular-nums">
                {formatMinutes(group.totalEstMinutes)}
              </b>{" "}
              est
            </span>
          )}
        </div>
      </header>
      <table className="w-full text-sm">
        <thead className="bg-white border-b border-cg-n-100">
          <tr className="text-left text-[10px] uppercase tracking-wider text-cg-n-500">
            <th className="px-3 py-2 w-28">Job · PO</th>
            <th className="px-3 py-2">Customer</th>
            <th className="px-3 py-2">Product · color</th>
            <th className="px-3 py-2 text-right w-16">Qty</th>
            <th className="px-3 py-2 w-20">Est</th>
            <th className="px-3 py-2 w-32">Size · ink</th>
            <th className="px-3 py-2 w-20">Due</th>
            <th className="px-3 py-2 w-20">Sales</th>
            <th className="px-3 py-2 w-24">Proof</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r, idx) => {
            const po = r.poView.po;
            const dept = departmentForSupplier(po.supplierName);
            return (
              <tr
                key={`${po.poId}-${idx}`}
                className="border-b border-cg-n-50 last:border-b-0 align-top"
              >
                <td className="px-3 py-2.5 text-xs tabular-nums">
                  <div>
                    <a
                      href={`https://www.ateasesystems.net/Job/Details/${po.syncoreJobId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cg-teal font-bold hover:underline"
                    >
                      {po.syncoreJobId}
                    </a>
                  </div>
                  <div className="text-cg-n-500">
                    <a
                      href={`https://www.ateasesystems.net/PurchaseOrder/Details/${po.poId}?jobId=${po.syncoreJobId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      PO {po.poNumber ?? po.poId}
                    </a>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-cg-n-900">
                    {r.customer ?? "—"}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-cg-n-400">
                    {dept}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {r.productName ? (
                    <>
                      <div className="text-cg-n-900">{r.productName}</div>
                      {r.productColor && (
                        <div className="text-cg-n-500 text-xs">
                          {r.productColor}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-cg-n-400 italic text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                  {po.totalQuantity?.toLocaleString() ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-xs tabular-nums">
                  {(() => {
                    if (dept !== "embroidery") {
                      return <span className="text-cg-n-400">—</span>;
                    }
                    const est = estimateEmbroidery({
                      stitchesPerPiece: po.stitchCount,
                      pieces: po.totalQuantity,
                    });
                    if (!est) return <span className="text-cg-n-400">—</span>;
                    return (
                      <span
                        className="text-cg-teal font-medium"
                        title={`run ${Math.round(est.runMinutes)}m + setup ${Math.round(est.setupMinutes)}m`}
                      >
                        {est.display}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-3 py-2.5 text-xs text-cg-n-600">
                  {r.imprintDimensions && <div>{r.imprintDimensions}</div>}
                  {r.inkColors.length > 0 && (
                    <div>{r.inkColors.join(", ")}</div>
                  )}
                  {r.stitches != null && (
                    <div>{r.stitches.toLocaleString()} st</div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {po.inHandDate ? po.inHandDate.slice(5) : "—"}
                </td>
                <td className="px-3 py-2.5 text-xs">{r.salesperson ?? "—"}</td>
                <td className="px-3 py-2.5">
                  {r.webViewLink ? (
                    <a
                      href={r.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cg-teal text-xs hover:underline truncate block"
                      title={r.filename ?? "Open in Drive"}
                    >
                      Open ↗
                    </a>
                  ) : (
                    <span className="text-cg-n-400 text-xs">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UnmatchedSection({ rows }: { rows: MatrixRow[] }) {
  const totalQty = rows.reduce(
    (s, r) => s + (r.poView.po.totalQuantity ?? 0),
    0,
  );
  return (
    <div className="border border-dashed border-cg-n-300 rounded-card overflow-hidden">
      <header className="bg-cg-n-50 px-4 py-3 border-b border-cg-n-200 flex items-baseline flex-wrap gap-x-4 gap-y-1">
        <div>
          <span className="text-xs uppercase tracking-wider text-cg-n-500 font-semibold">
            Unmatched · no Drive proof
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs text-cg-n-600">
          <span>
            <b className="text-cg-n-900">{rows.length}</b>{" "}
            {rows.length === 1 ? "PO" : "POs"}
          </span>
          <span>
            <b className="text-cg-n-900 tabular-nums">
              {totalQty.toLocaleString()}
            </b>{" "}
            qty
          </span>
        </div>
      </header>
      <table className="w-full text-sm">
        <thead className="bg-white border-b border-cg-n-100">
          <tr className="text-left text-[10px] uppercase tracking-wider text-cg-n-500">
            <th className="px-3 py-2 w-28">Job · PO</th>
            <th className="px-3 py-2">Customer</th>
            <th className="px-3 py-2 text-right w-16">Qty</th>
            <th className="px-3 py-2 w-20">Due</th>
            <th className="px-3 py-2">Dept</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const po = r.poView.po;
            const dept = departmentForSupplier(po.supplierName);
            return (
              <tr
                key={po.poId}
                className="border-b border-cg-n-50 last:border-b-0"
              >
                <td className="px-3 py-2.5 text-xs tabular-nums">
                  <div>
                    <a
                      href={`https://www.ateasesystems.net/Job/Details/${po.syncoreJobId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cg-teal font-bold hover:underline"
                    >
                      {po.syncoreJobId}
                    </a>
                  </div>
                  <div className="text-cg-n-500">
                    <a
                      href={`https://www.ateasesystems.net/PurchaseOrder/Details/${po.poId}?jobId=${po.syncoreJobId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      PO {po.poNumber ?? po.poId}
                    </a>
                  </div>
                </td>
                <td className="px-3 py-2.5">{r.customer ?? "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {po.totalQuantity?.toLocaleString() ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {po.inHandDate ? po.inHandDate.slice(5) : "—"}
                </td>
                <td className="px-3 py-2.5 text-xs uppercase tracking-wider text-cg-n-500">
                  {dept}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
