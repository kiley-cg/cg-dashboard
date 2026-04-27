"use client";

import { useState } from "react";
import type { FlatLineItem } from "@/lib/syncore/types";
import type { InventoryLookup } from "@/lib/vendors/types";
import type { VerificationDetail } from "@/lib/db/verifications";
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
};

function matchingLine(
  lookup: InventoryLookup,
  color: string | null,
  size: string | null,
) {
  if (lookup.status !== "ok") return null;
  const exact = lookup.lines.find(
    (l) =>
      (!color || l.color?.toLowerCase() === color.toLowerCase()) &&
      (!size || l.size?.toLowerCase() === size.toLowerCase()),
  );
  return exact ?? null;
}

// Color Graphics ships from Olympia, WA (zip 98512), so the closer-to-WA a
// warehouse is, the better. When multiple warehouses can fulfill a line in
// one shipment, prefer them in this order. Each entry is a list of substring
// keywords to match against a warehouse's name OR its ID/abbreviation —
// SanMar returns city names ("Seattle"), S&S returns state abbreviations
// ("NV"), and the matcher handles both. Anything unmatched falls to the
// bottom of the list.
const WAREHOUSE_PRIORITY: ReadonlyArray<readonly string[]> = [
  ["seattle", "wa"],                                  // SanMar Seattle
  ["reno", "nv"],                                     // SanMar Reno + S&S NV
  ["phoenix", "az"],                                  // SanMar Phoenix
  ["dallas", "fort worth", "ft worth", "tx"],         // SanMar Dallas + S&S TX
  ["olathe", "kansas", "ks"],                         // S&S KS
  ["lockport", "illinois", "il"],                     // S&S IL
  ["cincinnati", "ohio", "oh"],                       // SanMar Cincinnati
  ["minneapolis", "mn"],                              // SanMar Minneapolis
  ["atlanta", "ga"],                                  // S&S GA
  ["richmond", "va"],                                 // SanMar Richmond
  ["robbinsville", "cranbury", "nj"],                 // SanMar + S&S NJ
  ["reading", "pa"],                                  // S&S PA
  ["jacksonville", "fl"],                             // SanMar Jacksonville
  ["middleboro", "lakeville", "ma"],                  // S&S MA
];

function warehousePriority(w: { id: string; name?: string }): number {
  const haystack = `${w.name ?? ""} ${w.id ?? ""}`.toLowerCase();
  for (let i = 0; i < WAREHOUSE_PRIORITY.length; i++) {
    if (WAREHOUSE_PRIORITY[i].some((k) => haystack.includes(k))) return i;
  }
  return WAREHOUSE_PRIORITY.length;
}

function matchingAvailable(
  lookup: InventoryLookup,
  color: string | null,
  size: string | null,
): number | null {
  if (lookup.status !== "ok") return null;
  const exact = matchingLine(lookup, color, size);
  if (exact) return exact.quantityAvailable;
  return lookup.lines.reduce((n, l) => n + l.quantityAvailable, 0);
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

function displayName(
  name: string | null,
  email: string | null,
): string {
  // Prefer the name we got from Google. If we only have the email, take the
  // local-part and capitalize each whitespace/dot/hyphen-separated chunk so
  // "kiley" → "Kiley" and "kiley.green" → "Kiley Green".
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
    `Verified by ${who}${v.verifiedByEmail && v.verifiedByName ? ` (${v.verifiedByEmail})` : ""}`,
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
}: Props) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "ok"; verification: VerificationDetail }
    | { kind: "error"; message: string }
  >(verification ? { kind: "ok", verification } : { kind: "idle" });

  const inventoryLine =
    lookup.status === "ok"
      ? matchingLine(lookup, line.color, line.size)
      : null;
  const available = matchingAvailable(lookup, line.color, line.size);
  const sufficient = available !== null && available >= line.qtyOrdered;
  const isPartial = available !== null && available > 0 && !sufficient;
  const warehouses = inventoryLine?.warehouses?.filter((w) => w.quantity > 0) ?? [];

  // "Ships from": pick the highest-priority warehouse (closest to CG in WA)
  // that can fulfill this line in one shipment. Tie-break on quantity to
  // avoid picking a warehouse that's exactly at the line qty over one with
  // ample stock.
  const singleSource =
    line.qtyOrdered > 0
      ? [...warehouses]
          .filter((w) => w.quantity >= line.qtyOrdered)
          .sort((a, b) => {
            const pa = warehousePriority(a);
            const pb = warehousePriority(b);
            if (pa !== pb) return pa - pb;
            return b.quantity - a.quantity;
          })[0] ?? null
      : warehouses[0] ?? null;
  const willSplit = warehouses.length > 0 && !singleSource && available !== null && available > 0;
  const warehousesTooltip = warehouses
    .map((w) => `${w.name ?? w.id}: ${w.quantity.toLocaleString()}`)
    .join("\n");
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
      <td className="py-3 px-4 font-mono text-sm text-cg-n-900">
        {line.sku || line.productId || (
          <span className="text-cg-n-400">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-sm text-cg-n-700">
        {line.color ?? "—"} / {line.size ?? "—"}
      </td>
      <td className="py-3 px-4 text-right tabular-nums">{line.qtyOrdered}</td>
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
            {singleSource && (
              <span
                className="text-cg-n-500 text-[10px]"
                title={warehousesTooltip}
              >
                Ships from {singleSource.name ?? singleSource.id}
              </span>
            )}
            {willSplit && (
              <span
                className="text-cg-warning text-[10px]"
                title={warehousesTooltip}
              >
                Ships from multiple warehouses
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
