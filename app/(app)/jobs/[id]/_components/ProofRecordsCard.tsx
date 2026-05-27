import { Badge } from "@/components/Badge";
import type { JobVerificationRecord } from "@/lib/db/verifications";

// Shape of the `raw` jsonb written by snapshotProofs. Keep in sync with
// src/lib/drive/snapshot-proofs.ts.
type ProofRaw = {
  fileId?: string;
  filename?: string;
  webViewLink?: string | null;
  modifiedAt?: string;
  parentFolderName?: string | null;
  revision?: string | null;
  extracted?: {
    decoration?: string | null;
    salespersonInitials?: string | null;
    productName?: string | null;
    productColor?: string | null;
    imprintLocations?: string[];
    imprintDimensions?: string | null;
    inkColors?: string[];
    stitches?: number | null;
    jobIdFromText?: string | null;
  };
};

function fmtDate(iso: string | Date | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProofRecordsCard({
  proofs,
}: {
  proofs: JobVerificationRecord[];
}) {
  if (proofs.length === 0) {
    return (
      <div className="rounded-xl border border-cg-n-200 bg-white p-5">
        <div className="text-xs font-bold tracking-wider text-cg-n-500 uppercase">
          Drive proofs
        </div>
        <p className="text-sm text-cg-n-500 mt-2">
          No proofs found in Drive for this job. The hourly sync picks up new
          PDFs Christina drops into the proofs folder.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-cg-n-200 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-bold tracking-wider text-cg-n-500 uppercase">
          Drive proofs ({proofs.length})
        </div>
        <span className="text-xs text-cg-n-400">
          auto-extracted from PDF body
        </span>
      </div>
      <div className="space-y-4">
        {proofs.map((p) => {
          const raw = (p.raw ?? {}) as ProofRaw;
          const ex = raw.extracted ?? {};
          return (
            <div
              key={p.id}
              className="rounded-lg border border-cg-n-100 bg-cg-n-50 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {raw.webViewLink ? (
                    <a
                      href={raw.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-cg-n-900 hover:text-cg-r-700 truncate block"
                      title={raw.filename}
                    >
                      {raw.filename ?? "(unnamed)"} ↗
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-cg-n-900 truncate block">
                      {raw.filename ?? "(unnamed)"}
                    </span>
                  )}
                  {raw.parentFolderName && (
                    <span className="text-xs text-cg-n-500">
                      {raw.parentFolderName}
                    </span>
                  )}
                </div>
                <span className="text-xs text-cg-n-500 whitespace-nowrap">
                  {fmtDate(raw.modifiedAt ?? p.capturedAt)}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <Field label="Decoration" value={ex.decoration} />
                <Field
                  label="Imprint location"
                  value={
                    ex.imprintLocations && ex.imprintLocations.length > 0
                      ? ex.imprintLocations.join(", ")
                      : p.imprintLocation
                  }
                />
                <Field label="Imprint size" value={ex.imprintDimensions} />
                <Field label="Salesperson" value={ex.salespersonInitials} />
                <Field label="Product" value={ex.productName} />
                <Field label="Color" value={ex.productColor} />
                {typeof ex.stitches === "number" && (
                  <Field
                    label="Stitches"
                    value={ex.stitches.toLocaleString()}
                  />
                )}
              </dl>

              {ex.inkColors && ex.inkColors.length > 0 && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-cg-n-500 uppercase tracking-wider font-semibold">
                    Ink
                  </span>
                  {ex.inkColors.map((c) => (
                    <Badge key={c} tone="neutral">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  const display = value == null || value === "" ? "—" : String(value);
  const isMissing = display === "—";
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-cg-n-500 font-semibold">
        {label}
      </dt>
      <dd
        className={
          isMissing
            ? "text-cg-n-400 italic"
            : "text-cg-n-900"
        }
      >
        {display}
      </dd>
    </div>
  );
}
