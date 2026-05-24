"use client";

import { useRef, useTransition } from "react";
import { addTrackingAction } from "../_actions";

const CARRIERS = ["UPS", "FedEx", "USPS", "DHL", "Other"];

export function TrackingForm({ poId }: { poId: string }) {
  const [pending, start] = useTransition();
  const numberRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        const result = await addTrackingAction(fd);
        if (numberRef.current) numberRef.current.value = "";
        // The action always writes the local row before auto-pushing
        // to Syncore. If the push failed (Syncore down, expired
        // session, etc.) surface it so the user can retry via the
        // manual "→ Job Log" button; the local add still succeeded.
        if (!result.syncedToJobLog) {
          alert(
            `Saved locally, but couldn't sync to Syncore Job Log.\n\n${result.syncError ?? "Unknown error"}\n\nUse the "→ Job Log" button to retry.`,
          );
        }
      } catch (err) {
        alert(
          `Couldn't add tracking: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-2 text-[12px]"
    >
      <input type="hidden" name="poId" value={poId} />
      <select
        name="carrier"
        defaultValue="UPS"
        disabled={pending}
        className="border border-[#E3DFD3] rounded px-1.5 py-0.5 bg-white"
      >
        {CARRIERS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        ref={numberRef}
        type="text"
        name="trackingNumber"
        placeholder="Tracking #"
        required
        disabled={pending}
        className="border border-[#E3DFD3] rounded px-2 py-0.5 bg-white tabular-nums min-w-[160px]"
      />
      <button
        type="submit"
        disabled={pending}
        className={[
          "border border-cg-teal text-cg-teal font-semibold rounded px-2 py-0.5 text-[11px] hover:bg-cg-teal hover:text-white transition",
          pending ? "opacity-60 cursor-wait" : "",
        ].join(" ")}
        title="Adds the tracking # locally AND posts it to the Syncore Job Log"
      >
        {pending ? "Adding…" : "+ Add & sync"}
      </button>
    </form>
  );
}
