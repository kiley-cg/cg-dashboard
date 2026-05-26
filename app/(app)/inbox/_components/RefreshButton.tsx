"use client";

import { useTransition } from "react";
import { refreshInbox } from "../_actions";

export function RefreshButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => refreshInbox())}
      disabled={pending}
      className={[
        "text-xs border border-cg-teal text-cg-teal rounded-input px-3 py-1.5 hover:bg-cg-teal hover:text-white",
        pending ? "opacity-60 cursor-wait" : "",
      ].join(" ")}
      title="Pull the latest tracker entries from Syncore now (skips waiting for the cron)."
    >
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
