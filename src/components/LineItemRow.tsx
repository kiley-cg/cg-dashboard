"use client";

import { useState } from "react";
import type { SyncoreLineItem } from "@/lib/syncore/types";
import type { InventoryLookup } from "@/lib/vendors/types";

type Props = {
  orderId: string;
  line: SyncoreLineItem;
  lookup: InventoryLookup;
};

function matchingAvailable(
  lookup: InventoryLookup,
  color: string | null | undefined,
  size: string | null | undefined,
): number | null {
  if (lookup.status !== "ok") return null;
  const exact = lookup.lines.find(
    (l) =>
      (!color || l.color?.toLowerCase() === color.toLowerCase()) &&
      (!size || l.size?.toLowerCase() === size.toLowerCase()),
  );
  if (exact) return exact.quantityAvailable;
  // Fall back to sum across all parts if no exact match was returned.
  return lookup.lines.reduce((n, l) => n + l.quantityAvailable, 0);
}

export function LineItemRow({ orderId, line, lookup }: Props) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "ok" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const available = matchingAvailable(lookup, line.color, line.size);
  const sufficient = available !== null && available >= line.qtyOrdered;
  const canVerify = lookup.status === "ok" && sufficient;

  async function onVerify() {
    if (!canVerify || available === null) return;
    setState({ kind: "saving" });
    const res = await fetch(
      `/api/orders/${encodeURIComponent(orderId)}/verify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineId: line.id,
          qtyConfirmed: line.qtyOrdered,
          snapshot: lookup,
        }),
      },
    );
    if (res.ok) {
      setState({ kind: "ok" });
    } else {
      const body = await res.text().catch(() => "");
      setState({
        kind: "error",
        message: body || `Verify failed (${res.status})`,
      });
    }
  }

  return (
    <tr className="border-t border-cg-border">
      <td className="py-3 pr-4 font-mono text-sm">{line.productId}</td>
      <td className="py-3 pr-4 text-sm">
        {line.color ?? "—"} / {line.size ?? "—"}
      </td>
      <td className="py-3 pr-4 text-right">{line.qtyOrdered}</td>
      <td className="py-3 pr-4 text-right">
        {lookup.status === "ok" ? (
          <span className={sufficient ? "" : "text-cg-red"}>
            {available ?? 0}
          </span>
        ) : lookup.status === "vendor-error" ? (
          <span className="text-cg-red text-xs">vendor error</span>
        ) : (
          <span className="text-cg-muted text-xs">unsupported</span>
        )}
      </td>
      <td className="py-3 text-right">
        {state.kind === "ok" ? (
          <span className="text-green-400 text-sm">Verified ✓</span>
        ) : (
          <button
            onClick={onVerify}
            disabled={!canVerify || state.kind === "saving"}
            className="bg-cg-red disabled:bg-cg-border disabled:text-cg-muted text-white text-sm font-semibold px-3 py-1.5 rounded-card transition hover:brightness-110"
          >
            {state.kind === "saving" ? "Saving…" : "Verify"}
          </button>
        )}
        {state.kind === "error" && (
          <p className="text-cg-red text-xs mt-1">{state.message}</p>
        )}
      </td>
    </tr>
  );
}
