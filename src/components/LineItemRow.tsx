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


  const canVerify = lookup.status === "ok" && available !== null;
  const qtyConfirmed =
    available === null ? 0 : Math.min(line.qtyOrdered, available);

  // A verification is "stale" when the live lookup disagrees with what was
  // captured at verify time — either the vendor's available count moved
  // (stock changed) or the order qty moved (CSR edit). Stale rows get a
  // ⚠ marker + a one-click Re-verify that wipes the old row and writes a
  // new one with current numbers. This caught us when an earlier matcher
  // bug saved fake "full fill" verifications that survived the fix.
  const isStale =
    state.kind === "ok" &&
    lookup.status === "ok" &&
    available !== null &&
    (state.verification.qtyAvailable !== available ||
      (state.verification.qtyOrdered != null &&
        state.verification.qtyOrdered !== line.qtyOrdered));

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

  async function onReverify() {
    if (!canVerify || available === null) return;
    setState({ kind: "saving" });
    // Wipe the stale row first so re-verify is "replace" semantics, not
    // "append another row that masks the old one".
    const del = await fetch(
      `/api/jobs/${encodeURIComponent(jobId)}/verify`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesOrderId,
          sizeLineId: line.sizeLineId,
        }),
      },
    );
    if (!del.ok) {
      const body = await del.text().catch(() => "");
      setState({
        kind: "error",
        message: body || `Re-verify failed (${del.status})`,
      });
      return;
    }
    await onVerify();
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
        ) : lookup.status === "ambiguous" ? (
          <div className="flex flex-col items-end gap-1">
            <Badge tone="danger">Ambiguous style</Badge>
            <p className="text-cg-n-700 text-[10px] max-w-[22rem] text-right">
              S&amp;S has {lookup.candidates.length} products with style
              &ldquo;{lookup.productId}&rdquo;:{" "}
              <span className="font-semibold">
                {lookup.candidates
                  .map((c) => c.brand || `id ${c.styleId}`)
                  .join(", ")}
              </span>
              . Fix in Syncore (e.g. &ldquo;{lookup.candidates[0]?.brand || "Brand"} {lookup.productId}&rdquo;).
            </p>
          </div>
        ) : lookup.status === "no-style" ? (
          <Badge tone="neutral">No SKU</Badge>
        ) : (
          <Badge tone="neutral">Unsupported</Badge>
        )}
      </td>
      <td className="py-3 px-4 text-right tabular-nums align-top">
        {(() => {
          if (!inventoryLine) {
            return <span className="text-cg-n-400">—</span>;
          }
          // Three potential prices, in display order:
          //   - Original Price (regular wholesale, casePrice from the API)
          //   - Sale Price     (current promo, only when below original)
          //   - Program Price  (CG's contracted rate, yourCost)
          // Special case: when only one of these has a value, label it
          // "Original Price" regardless of which field it came from —
          // the category labels only make sense when there's something
          // to compare against. Raw piecePrice (MSRP/retail) is not shown.
          const orig = inventoryLine.casePrice;
          const sale = inventoryLine.salePrice;
          const prog = inventoryLine.yourCost;
          const saleIsLower = sale != null && orig != null && sale < orig;
          const visibleCount =
            (orig != null ? 1 : 0) +
            (saleIsLower ? 1 : 0) +
            (prog != null ? 1 : 0);

          if (visibleCount === 0) {
            return <span className="text-cg-n-400">—</span>;
          }
          if (visibleCount === 1) {
            const value = (orig ?? (saleIsLower ? sale : null) ?? prog) as number;
            return (
              <div className="flex flex-col items-end gap-0.5 text-xs">
                <div className="inline-flex items-baseline gap-2">
                  <span className="text-cg-n-500 uppercase tracking-wider text-[9px]">
                    Original Price
                  </span>
                  <span className="text-cg-n-900 font-semibold">
                    {formatMoney(value)}
                  </span>
                </div>
              </div>
            );
          }
          return (
            <div className="flex flex-col items-end gap-0.5 text-xs">
              {orig != null && (
                <div className="inline-flex items-baseline gap-2">
                  <span className="text-cg-n-500 uppercase tracking-wider text-[9px]">
                    Original Price
                  </span>
                  <span className="text-cg-n-700">{formatMoney(orig)}</span>
                </div>
              )}
              {saleIsLower && sale != null && (
                <div className="inline-flex items-baseline gap-2">
                  <span className="text-cg-success uppercase tracking-wider text-[9px]">
                    Sale Price
                  </span>
                  <span className="text-cg-success">{formatMoney(sale)}</span>
                </div>
              )}
              {prog != null && (
                <div className="inline-flex items-baseline gap-2">
                  <span className="text-cg-n-500 uppercase tracking-wider text-[9px]">
                    Program Price
                  </span>
                  <span className="text-cg-n-900 font-semibold">
                    {formatMoney(prog)}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
      </td>
      <td className="py-3 px-4 text-right align-top">
        {state.kind === "ok" ? (
          <div
            className="flex flex-col items-end gap-0.5"
            title={
              isStale
                ? `STALE — vendor count or order qty changed since verification.\nVerified at ${state.verification.qtyAvailable ?? "?"} available; live count is ${available}.\nOrdered at ${state.verification.qtyOrdered ?? "?"}; live order is ${line.qtyOrdered}.\n\n${tooltip(state.verification)}`
                : tooltip(state.verification)
            }
          >
            <Badge tone={isStale ? "warning" : "success"}>
              {isStale ? "Stale" : "Verified"}
            </Badge>
            <span className="text-cg-n-500 text-[10px] tabular-nums">
              by{" "}
              {displayName(
                state.verification.verifiedByName,
                state.verification.verifiedByEmail,
              )}{" "}
              · {formatTime(state.verification.verifiedAt)}
            </span>
            {isStale && (
              <button
                type="button"
                onClick={onReverify}
                disabled={!canVerify}
                className="text-cg-red text-[10px] underline hover:text-cg-red/80 disabled:opacity-50"
              >
                Re-verify with current data
              </button>
            )}
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
