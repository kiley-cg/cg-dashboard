"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  jobId: string;
  staleCount: number;
};

export function ClearVerificationsButton({ jobId, staleCount }: Props) {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function onClick() {
    if (
      !window.confirm(
        `Wipe ALL verifications for job ${jobId}? Reps will need to re-verify each row. (${staleCount} ${staleCount === 1 ? "is" : "are"} currently stale.)`,
      )
    ) {
      return;
    }
    setState({ kind: "saving" });
    const res = await fetch(
      `/api/jobs/${encodeURIComponent(jobId)}/verify`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (res.ok) {
      router.refresh();
      setState({ kind: "idle" });
    } else {
      const message = await res.text().catch(() => "");
      setState({ kind: "error", message: message || `failed (${res.status})` });
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={state.kind === "saving"}
        className="text-cg-n-500 text-[11px] underline hover:text-cg-red disabled:opacity-50"
        title="Delete every verification record for this job. Use after a matcher fix when the stored verifications were captured against bad data."
      >
        {state.kind === "saving"
          ? "Clearing…"
          : staleCount > 0
            ? `Clear all verifications (${staleCount} stale)`
            : "Clear all verifications"}
      </button>
      {state.kind === "error" && (
        <p className="text-cg-danger text-[10px]">{state.message}</p>
      )}
    </div>
  );
}
