"use client";

import { useTransition } from "react";
import {
  markReceivedAction,
  unmarkReceivedAction,
} from "../_actions";

interface Props {
  poId: string;
  isReceived: boolean;
  syncoreMemoUpdatedAt: Date | string | null;
}

export function ReceiptToggle({
  poId,
  isReceived,
  syncoreMemoUpdatedAt,
}: Props) {
  const [pending, start] = useTransition();

  function flip() {
    const fd = new FormData();
    fd.set("poId", poId);
    start(async () => {
      try {
        if (isReceived) {
          await unmarkReceivedAction(fd);
        } else {
          await markReceivedAction(fd);
        }
      } catch (err) {
        alert(
          `Couldn't ${isReceived ? "unmark" : "mark"} received: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
  }

  return (
    <div className="flex items-center gap-2 text-[12px]">
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        className={[
          "border font-semibold rounded px-2 py-0.5 text-[11px] transition",
          isReceived
            ? "bg-[#3A8C5F] text-white border-[#3A8C5F]"
            : "border-[#D64545] text-[#D64545] hover:bg-[#D64545] hover:text-white",
          pending ? "opacity-60 cursor-wait" : "",
        ].join(" ")}
      >
        {pending
          ? "Saving…"
          : isReceived
            ? "✓ Received"
            : "Mark received"}
      </button>
      {isReceived && !syncoreMemoUpdatedAt && (
        <span
          className="text-[10.5px] text-[#8A5A2B]"
          title="Local only — Syncore receiving memo writeback lands in Phase 4.2"
        >
          local · Syncore memo not yet updated
        </span>
      )}
      {isReceived && syncoreMemoUpdatedAt && (
        <span className="text-[10.5px] text-[#3A8C5F]" title="Syncore memo flipped">
          ✓ Syncore memo updated
        </span>
      )}
    </div>
  );
}
