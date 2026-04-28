"use client";

import { useState } from "react";
import type { FlatLineItem } from "@/lib/syncore/types";
import type { InventoryLookup } from "@/lib/vendors/types";
import type { VerificationDetail } from "@/lib/db/verifications";
import {
  computeSplit,
  pickPrimaryWarehouse,
  warehouseRank,
} from "@/lib/vendors/warehouse-priority";
import { transitDays } from "@/lib/vendors/transit";
import { matchVariant } from "@/lib/vendors/match";
import { Badge } from "./Badge";
import { Button } from "./Button";

type Props = {
  jobId: string;
  salesOrderId: number;
  line: FlatLineItem;
  lookup: InventoryLookup;
  verification: VerificationDetail | null;
  currentUserEmail: string | null;
  currentUserName: string | null;
  // Destination zip used to rank warehouses (defaults to CG's home zip).
  shipToZip: string | null;
  // If a single warehouse can fulfill EVERY line on this Sales Order from
  // itself (and has enough for THIS line), use it as Ships-from instead of
  // the per-line primary. Lets multi-line orders consolidate to one PO.
  consolidationWarehouseId: string | null;
};

function matchingAvailable(
  lookup: InventoryLookup,
  color: string | null,
  size: string | null,
): number | null {
  if (lookup.status !== "ok") return null;
  const matched = matchVariant(lookup, color, size);
  // If we can't find this color/size, return 0 instead of summing
  // across all variations — the rep needs to see "we couldn't match
  // this variant", not a fake aggregate that looks like inventory.
  return matched?.quantityAvailable ?? 0;
}

function formatMoney(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayName(name: string | null, email: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  if (!email) return "unknown";
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function tooltip(v: VerificationDetail): string {
  const who = v.verifiedByName?.trim() || v.verifiedByEmail || "unknown";
  const parts = [
    `Verified by ${who}${
      v.verifiedByEmail && v.verifiedByName ? ` (${v.verifiedByEmail})` : ""
    }`,
    `at ${new Date(v.verifiedAt).toLocaleString()}`,
  ];
  if (v.qtyOrdered != null && v.qtyAvailable != null) {
    parts.push(
      `Confirmed ${v.qtyConfirmed} of ${v.qtyOrdered} ordered (vendor had ${v.qtyAvailable} available at the time)`,
    );
  }
  if (v.note) parts.push(v.note);
  return parts.join("\n");
}

export function LineItemRow({
  jobId,
  salesOrderId,
  line,
  lookup,
  verification,
  currentUserEmail,
  currentUserName,
  shipToZip,
  consolidationWarehouseId,
}: Props) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "ok"; verification: VerificationDetail }
    | { kind: "error"; message: string }
  >(verification ? { kind: "ok", verification } : { kind: "idle" });

  const inventoryLine = matchVariant(lookup, line.color, line.size);
  const available = matchingAvailable(lookup, line.color, line.size);
  const sufficient = available !== null && available >= line.qtyOrdered;
  const isPartial = available !== null && available > 0 && !sufficient;
  const warehouses =
    inventoryLine?.warehouses?.filter((w) => w.quantity > 0) ?? [];

  // Step 1: if the Sales Order has a consolidation warehouse and it can
  // fulfill THIS line from itself, route here.
  // Step 2: otherwise, the highest-priority warehouse with enough stock.
  // Step 3: if no single warehouse can fulfill, compute a split allocation.
  const consolidationMatch =
    consolidationWarehouseId
      ? warehouses.find(
          (w) =>
            w.id === consolidationWarehouseId && w.quantity >= line.qtyOrdered,
        ) ?? null
      : null;
  const primary =
    consolidationMatch ??
    pickPrimaryWarehouse(warehouses, line.qtyOrdered, shipToZip);
  const split =
    !primary && warehouses.length > 0 && available !== null && available > 0
      ? computeSplit(warehouses, line.qtyOrdered, shipToZip)
      : null;

  const sortedWarehouses = [...warehouses].sort(
    (a, b) => warehouseRank(a, shipToZip) - warehouseRank(b, shipToZip),
  );
  const warehousesTooltip = sortedWarehouses
    .map((w) => `${w.name ?? w.id}: ${w.quantity.toLocaleString()}`)
    .join("\n");

  const onSale =
    inventoryLine?.salePrice != null &&
    inventoryLine.yourCost != null &&
    inventoryLine.salePrice < inventoryLine.yourCost;

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
      setState({
        kind: "ok",
        verification: {
          verifiedAt: new Date().toISOString(),
          verifiedByEmail: currentUserEmail,
          verifiedByName: currentUserName,
          qtyOrdered: line.qtyOrdered,
          qtyAvailable: available,
          qtyConfirmed,
          note: isPartial
            ? "manually verified: partial fill"
            : available === 0
              ? "manually verified: no stock"
              : "manually verified",
        },
      });
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
      <td className="py-3 px-4 font-mono text-sm text-cg-n-900 align-top">
        {line.sku || line.productId || (
          <span className="text-cg-n-400">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-sm text-cg-n-700 align-top">
        {line.color ?? "—"} / {line.size ?? "—"}
      </td>
      <td className="py-3 px-4 text-right tabular-nums align-top">
        {line.qtyOrdered}
      </td>
      <td className="py-3 px-4 text-right align-top">
        {lookup.status === "ok" ? (
          <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-2 justify-end">
              <span
                className={`tabular-nums ${sufficient ? "text-cg-n-900" : "text-cg-danger font-semibold"}`}
              >
                {available ?? 0}
              </span>
              {isPartial && <Badge tone="warning">Partial</Badge>}
              {available === 0 && <Badge tone="danger">Out</Badge>}
            </span>
            {primary && (
              <span
                className="text-cg-n-500 text-[10px]"
                title={warehousesTooltip}
              >
                Ships from {primary.name ?? primary.id}
                {(() => {
                  const days = transitDays(primary, shipToZip);
                  return days != null ? ` · ~${days}-day Ground` : "";
                })()}
                {warehouses.length > 0 &&
                  ` · 1 of ${warehouses.length} warehouse${warehouses.length === 1 ? "" : "s"}`}
              </span>
            )}
            {split && (
              <span
                className="text-cg-warning text-[10px] tabular-nums"
                title={warehousesTooltip}
              >
                Split:{" "}
                {split.allocations
                  .map((a) => `${a.qty} ${a.warehouse.name ?? a.warehouse.id}`)
                  .join(" + ")}
                {warehouses.length > 0 &&
                  ` · ${split.allocations.length} of ${warehouses.length} warehouses`}
                {split.remaining > 0 && ` · ${split.remaining} short`}
              </span>
            )}
          </div>
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
      <td className="py-3 px-4 text-right tabular-nums align-top">
        {inventoryLine ? (
          <div className="flex flex-col items-end gap-0.5 text-xs">
            <div className="inline-flex items-baseline gap-2">
              <span className="text-cg-n-500 uppercase tracking-wider text-[9px]">
                Cost
              </span>
              <span className="text-cg-n-900 font-semibold">
                {formatMoney(inventoryLine.yourCost)}
              </span>
            </div>
            {inventoryLine.msrp != null && (
              <div className="inline-flex items-baseline gap-2">
                <span className="text-cg-n-500 uppercase tracking-wider text-[9px]">
                  MSRP
                </span>
                <span className="text-cg-n-700">
                  {formatMoney(inventoryLine.msrp)}
                </span>
              </div>
            )}
            {inventoryLine.casePrice != null && (
              <div className="inline-flex items-baseline gap-2">
                <span className="text-cg-n-500 uppercase tracking-wider text-[9px]">
                  Case
                </span>
                <span className="text-cg-n-500">
                  {formatMoney(inventoryLine.casePrice)}
                </span>
              </div>
            )}
            {onSale && (
              <span className="inline-flex items-center gap-1 mt-0.5">
                <Badge tone="success">
                  Sale {formatMoney(inventoryLine.salePrice)}
                </Badge>
              </span>
            )}
          </div>
        ) : (
          <span className="text-cg-n-400">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-right align-top">
        {state.kind === "ok" ? (
          <div
            className="flex flex-col items-end gap-0.5"
            title={tooltip(state.verification)}
          >
            <Badge tone="success">Verified</Badge>
            <span className="text-cg-n-500 text-[10px] tabular-nums">
              by{" "}
              {displayName(
                state.verification.verifiedByName,
                state.verification.verifiedByEmail,
              )}{" "}
              · {formatTime(state.verification.verifiedAt)}
            </span>
          </div>
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
