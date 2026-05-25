// Phase 5 verification probe — pull a vendor's tracking info for a
// single PO so we can confirm the OSN/REST endpoint works end-to-end
// before wiring the auto-poll cron.
//
// Usage:
//   GET ?vendor=sanmar&poNumber=PO-NUMBER-AS-SENT-TO-VENDOR
//
// Iteration helper for SanMar — pass ?wsdl=<full-WSDL-URL> to override
// the default WSDL URL guess without redeploying. The override is also
// passed to the SOAP client so we can probe alternate bindings until we
// find the one SanMar actually publishes.
//
// vendor: sanmar | ss | cb (only sanmar wired today)

import { NextResponse } from "next/server";
import {
  fetchSanMarTracking,
  fetchSanMarTrackingRaw,
} from "@/lib/vendors/sanmar/tracking";
import { fetchSSTracking } from "@/lib/vendors/ss/tracking";
import {
  fetchCutterBuckTracking,
  fetchCutterBuckTrackingRaw,
} from "@/lib/vendors/cb/tracking";
import type { OsnQueryType } from "@/lib/vendors/promostandards/orderShipmentNotification";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// SanMar's PO Integration Guide v24.1 reveals the binding pattern:
// "POServiceBinding?WSDL" — Binding suffix, no version. So OSN is
// almost certainly at "OrderShipmentNotificationServiceBinding?WSDL".
// Listed first as the most likely match, then fallbacks. Both PROD
// (ws.sanmar.com) and TEST (test-ws.sanmar.com) hosts included.
const SANMAR_OSN_CANDIDATES = [
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBinding?WSDL",
  "https://test-ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBinding?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV2final?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV2?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV1final?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV1?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServicev2?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServicev1?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationService?WSDL",
  "https://ws.sanmar.com:8080/promostandards/ShipNoticeServiceBinding?WSDL",
  "https://ws.sanmar.com:8080/promostandards/ShipNoticeServiceBindingV1final?WSDL",
  "https://ws.sanmar.com:8080/promostandards/ShipNoticeServiceBindingV1?WSDL",
];

// Cutter & Buck runs IIS/.NET (.asmx paths). Their Inventory binding is
// InventoryService121.asmx (PromoStandards 1.2.1). OSN versions we'll try.
const CB_OSN_CANDIDATES = [
  "https://api.cbcorporate.com/promostandards/OrderShipmentNotificationService100.asmx?wsdl",
  "https://api.cbcorporate.com/promostandards/OrderShipmentNotificationService110.asmx?wsdl",
  "https://api.cbcorporate.com/promostandards/OrderShipmentNotificationService120.asmx?wsdl",
  "https://api.cbcorporate.com/promostandards/OrderShipmentNotificationService121.asmx?wsdl",
  "https://api.cbcorporate.com/promostandards/OrderShipmentNotificationService200.asmx?wsdl",
  "https://api.cbcorporate.com/promostandards/OrderShipmentNotificationService.asmx?wsdl",
];

// S&S Activewear REST — path variants we'll try if the default 404s or
// returns no shipments. ?poParam= overrides the query-param name too.
const SS_TRACKING_PATH_CANDIDATES = [
  { path: "/orders", poParamName: "poNumber" },
  { path: "/orders", poParamName: "po" },
  { path: "/orders", poParamName: "customerPO" },
  { path: "/orders/", poParamName: "poNumber" },
];

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor");
  const poNumber = url.searchParams.get("poNumber");
  const wsdlOverride = url.searchParams.get("wsdl");
  const scan = url.searchParams.get("scan") === "1";
  if (!vendor) {
    return NextResponse.json(
      { ok: false, error: "missing ?vendor= (sanmar | ss | cb)" },
      { status: 400 },
    );
  }
  if (!poNumber) {
    return NextResponse.json(
      { ok: false, error: "missing ?poNumber=" },
      { status: 400 },
    );
  }

  // Scan mode: hammer every candidate WSDL and report which loaded.
  // Use against any PO number — we just want to know which URL doesn't
  // 404. A 200 with a SOAP fault on getOrderShipmentNotification means
  // the WSDL was valid; a 404 means the path is wrong.
  if (scan && (vendor === "sanmar" || vendor === "cb")) {
    const candidates =
      vendor === "sanmar" ? SANMAR_OSN_CANDIDATES : CB_OSN_CANDIDATES;
    const runOne =
      vendor === "sanmar"
        ? (wsdl: string) => fetchSanMarTracking(poNumber, { wsdlUrl: wsdl })
        : (wsdl: string) => fetchCutterBuckTracking(poNumber, { wsdlUrl: wsdl });
    const startedAt = Date.now();
    const results = await Promise.all(
      candidates.map(async (wsdl) => {
        try {
          const shipments = await runOne(wsdl);
          return {
            wsdl,
            outcome: "ok" as const,
            shipmentCount: shipments.length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const is404 = msg.includes("Code: 404") || msg.includes("Not Found");
          return {
            wsdl,
            outcome: is404 ? ("wsdl-404" as const) : ("wsdl-loaded-call-failed" as const),
            error: msg.slice(0, 400),
          };
        }
      }),
    );
    return NextResponse.json({
      ok: true,
      mode: "scan",
      vendor,
      poNumber,
      candidates: results.filter((r) => r.outcome !== "wsdl-404"),
      all: results,
      durationMs: Date.now() - startedAt,
    });
  }

  // S&S has no WSDL — it's REST. The "scan" for S&S is the path+param
  // matrix instead. Run all combinations and report which yielded
  // shipments.
  if (scan && vendor === "ss") {
    const startedAt = Date.now();
    const results = await Promise.all(
      SS_TRACKING_PATH_CANDIDATES.map(async ({ path, poParamName }) => {
        try {
          const shipments = await fetchSSTracking(poNumber, { path, poParamName });
          return {
            path,
            poParamName,
            outcome: "ok" as const,
            shipmentCount: shipments.length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            path,
            poParamName,
            outcome: "error" as const,
            error: msg.slice(0, 400),
          };
        }
      }),
    );
    return NextResponse.json({
      ok: true,
      mode: "scan",
      vendor,
      poNumber,
      results,
      durationMs: Date.now() - startedAt,
    });
  }

  // Optional ?queryType= to test PO vs salesOrder. Default = po.
  const qt = url.searchParams.get("queryType");
  const queryType: OsnQueryType | undefined =
    qt === "salesOrder" || qt === "po" || qt === "shipmentDate"
      ? qt
      : undefined;
  // ?raw=1 — return the entire SOAP response so we can debug parsing
  // / PO-format issues when shipments[] comes back empty.
  const includeRaw = url.searchParams.get("raw") === "1";

  const startedAt = Date.now();
  try {
    let shipments;
    let raw: unknown = undefined;
    switch (vendor) {
      case "sanmar":
        if (includeRaw) {
          const result = await fetchSanMarTrackingRaw(poNumber, {
            wsdlUrl: wsdlOverride ?? undefined,
            queryType,
          });
          shipments = result.shipments;
          raw = result.raw;
        } else {
          shipments = await fetchSanMarTracking(poNumber, {
            wsdlUrl: wsdlOverride ?? undefined,
            queryType,
          });
        }
        break;
      case "ss":
        shipments = await fetchSSTracking(poNumber);
        break;
      case "cb":
        if (includeRaw) {
          const result = await fetchCutterBuckTrackingRaw(poNumber, {
            wsdlUrl: wsdlOverride ?? undefined,
            queryType,
          });
          shipments = result.shipments;
          raw = result.raw;
        } else {
          shipments = await fetchCutterBuckTracking(poNumber, {
            wsdlUrl: wsdlOverride ?? undefined,
            queryType,
          });
        }
        break;
      case "_skip_":
        return NextResponse.json(
          {
            ok: false,
            error: `${vendor} adapter not implemented yet — sanmar is first`,
          },
          { status: 501 },
        );
      default:
        return NextResponse.json(
          { ok: false, error: `unknown vendor: ${vendor}` },
          { status: 400 },
        );
    }
    return NextResponse.json({
      ok: true,
      vendor,
      poNumber,
      wsdlUrl: wsdlOverride ?? "(default)",
      queryType: queryType ?? "po",
      shipmentCount: shipments.length,
      shipments,
      raw,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        vendor,
        poNumber,
        wsdlUrl: wsdlOverride ?? "(default)",
        error: err instanceof Error ? err.message : String(err),
        detail:
          err && typeof err === "object" && "root" in err
            ? (err as { root: unknown }).root
            : undefined,
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
