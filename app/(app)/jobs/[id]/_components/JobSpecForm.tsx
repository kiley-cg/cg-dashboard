"use client";

// Phase D1: editable spec row on /jobs/[id] — imprint location, qty
// garments, approved-by. Backed by the manual jobVerificationRecord row.
// Future D2 proof captures show as separate read-only rows above.

import { useState, useTransition } from "react";
import { saveJobSpec } from "../_actions";

interface Props {
  jobId: string;
  initial: {
    imprintLocation: string | null;
    qtyGarments: number | null;
    approvedBy: string | null;
    capturedAt: string | null; // ISO
  } | null;
  canEdit: boolean;
}

export function JobSpecForm({ jobId, initial, canEdit }: Props) {
  const [imprintLocation, setImprintLocation] = useState(
    initial?.imprintLocation ?? "",
  );
  const [qtyGarments, setQtyGarments] = useState(
    initial?.qtyGarments != null ? String(initial.qtyGarments) : "",
  );
  const [approvedBy, setApprovedBy] = useState(initial?.approvedBy ?? "");
  const [pending, start] = useTransition();
  const [savedAt, setSavedAt] = useState(initial?.capturedAt ?? null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit || pending) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("jobId", jobId);
      fd.set("imprintLocation", imprintLocation);
      fd.set("qtyGarments", qtyGarments);
      fd.set("approvedBy", approvedBy);
      const result = await saveJobSpec(fd);
      if (result.ok) setSavedAt(new Date().toISOString());
      else setError(result.error);
    });
  }

  if (!canEdit) {
    return (
      <div className="border border-cg-n-200 rounded-card p-4 bg-cg-n-50 text-sm">
        <h3 className="text-xs uppercase tracking-wider font-bold text-cg-n-600 mb-2">
          Verification record (read-only)
        </h3>
        <dl className="grid grid-cols-3 gap-3 text-[12.5px]">
          <Field label="Imprint location" value={initial?.imprintLocation} />
          <Field label="Qty garments" value={initial?.qtyGarments?.toString()} />
          <Field label="Approved by" value={initial?.approvedBy} />
        </dl>
        {savedAt && (
          <p className="text-[11px] text-cg-n-500 mt-2">
            Updated {formatTime(savedAt)}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="border border-cg-n-200 rounded-card p-4 bg-white space-y-3"
    >
      <h3 className="text-xs uppercase tracking-wider font-bold text-cg-n-600">
        Verification record · spec for this job
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block text-[12.5px]">
          <span className="block text-[10.5px] uppercase tracking-wider font-bold text-cg-n-600 mb-1">
            Imprint location
          </span>
          <input
            type="text"
            value={imprintLocation}
            onChange={(e) => setImprintLocation(e.target.value)}
            placeholder="Right chest"
            disabled={pending}
            className="w-full border border-cg-n-300 rounded-input px-2 py-1 bg-white text-[12.5px]"
          />
        </label>
        <label className="block text-[12.5px]">
          <span className="block text-[10.5px] uppercase tracking-wider font-bold text-cg-n-600 mb-1">
            Qty garments
          </span>
          <input
            type="number"
            min={0}
            value={qtyGarments}
            onChange={(e) => setQtyGarments(e.target.value)}
            placeholder="50"
            disabled={pending}
            className="w-full border border-cg-n-300 rounded-input px-2 py-1 bg-white text-[12.5px] tabular-nums"
          />
        </label>
        <label className="block text-[12.5px]">
          <span className="block text-[10.5px] uppercase tracking-wider font-bold text-cg-n-600 mb-1">
            Approved by
          </span>
          <input
            type="text"
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
            placeholder="Kiley"
            disabled={pending}
            className="w-full border border-cg-n-300 rounded-input px-2 py-1 bg-white text-[12.5px]"
          />
        </label>
      </div>
      {error && <p className="text-[11px] text-cg-error">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={[
            "rounded-btn bg-cg-black text-white px-3 py-1 text-[12px] font-semibold hover:bg-cg-n-800",
            pending ? "opacity-60 cursor-wait" : "",
          ].join(" ")}
        >
          {pending ? "Saving…" : "Save spec"}
        </button>
        {savedAt && (
          <span className="text-[11px] text-cg-n-500">
            Updated {formatTime(savedAt)}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-wider font-bold text-cg-n-600">
        {label}
      </dt>
      <dd className="text-[12.5px] text-cg-n-900 mt-0.5">
        {value && value.trim() ? value : <span className="text-cg-n-400 italic">—</span>}
      </dd>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
