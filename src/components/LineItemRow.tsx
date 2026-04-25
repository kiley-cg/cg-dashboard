"use client";

import { useState } from "react";
import type { FlatLineItem } from "@/lib/syncore/types";
import type { InventoryLookup } from "@/lib/vendors/types";
import { Badge } from "./Badge";
import { Button } from "./Button";

type Props = {
  jobId: string;
  salesOrderId: number;
  line: FlatLineItem;
  lookup: InventoryLookup;
};

function matchingAvailable(
  lookup: InventoryLookup,
  color: string | null,
  size: string | null,
): number | null {
  if (lookup.status !== "ok") return null;
  const exact = lookup.lines.find(
    (l) =>
      (!color || l.color?.toLowerCase() === color.toLowerCase()) &&
      (!size || l.size?.toLowerCase() === size.toLowerCase()),
  );
  if (exact) return exact.quantityAvailable;
  return lookup.lines.reduce((n, l) => n + l.quantityAvailable, 0);
}

export function LineItemRow({ jobId, salesOrderId, line, lookup }: Props) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "ok" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const available = matchingAvailable(lookup, line.color, line.size);
  const sufficient = available !== null && available >= line.qtyOrdered;
  const isPartial = available !== null && available > 0 && !sufficient;
  // Verify is allowed whenever SanMar returned data — even on partial or zero
  // fills. The recorded qtyConfirmed is capped at what's actually available
  // so the audit trail reflects fillable units, not ordered intent.
  const canVerify = lookup.status === "ok" && available !== null;
  const qtyConfirmed =
    available === null ? 0 : Math.min(line.qtyOrdered, available);

  async function onVerify() {
    if (!canVerify || available === null) return;
    setState({ kind: "saving" });
    const res = await fetch(
      `/api/jobs/${encodeURIComponent(jobId)}/verify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesOrderId,
          sizeLineId: line.sizeLineId,
          colorLineId: line.colorLineId,
          productId: line.productId,
          qtyConfirmed,
          qtyOrdered: line.qtyOrdered,
          qtyAvailable: available,
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
    <tr className="border-t border-cg-n-100">
      <td className="py-3 px-4 font-mono text-sm text-cg-n-900">
        {line.sku || line.productId || (
          <span className="text-cg-n-400">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-sm text-cg-n-700">
        {line.color ?? "—"} / {line.size ?? "—"}
      </td>
      <td className="py-3 px-4 text-right tabular-nums">{line.qtyOrdered}</td>
      <td className="py-3 px-4 text-right">
        {lookup.status === "ok" ? (
          <span className="inline-flex items-center gap-2 justify-end">
            <span
              className={`tabular-nums ${sufficient ? "text-cg-n-900" : "text-cg-danger font-semibold"}`}
            >
              {available ?? 0}
            </span>
            {isPartial && <Badge tone="warning">Partial</Badge>}
            {available === 0 && <Badge tone="danger">Out</Badge>}
          </span>
        ) : lookup.status === "vendor-error" ? (
          <div className="flex flex-col items-end gap-1">
            <Badge tone="danger">Vendor error</Badge>
            {lookup.message && (
              <pre className="text-cg-n-500 text-[10px] max-w-[22rem] whitespace-pre-wrap break-all text-right font-mono">
                {lookup.message}
              </pre>
            )}
          </div>
        ) : lookup.status === "no-style" ? (
          <Badge tone="neutral">No SKU</Badge>
        ) : (
          <Badge tone="neutral">Unsupported</Badge>
        )}
      </td>
      <td className="py-3 px-4 text-right">
        {state.kind === "ok" ? (
          <Badge tone="success">Verified</Badge>
        ) : (
          <Button
            onClick={onVerify}
            disabled={!canVerify || state.kind === "saving"}
            size="sm"
          >
            {state.kind === "saving"
              ? "Saving…"
              : isPartial
                ? `Verify ${qtyConfirmed} of ${line.qtyOrdered}`
                : available === 0
                  ? "Verify (none avail.)"
                  : "Verify"}
          </Button>
        )}
        {state.kind === "error" && (
          <p className="text-cg-danger text-xs mt-1">{state.message}</p>
        )}
      </td>
    </tr>
  );
}
