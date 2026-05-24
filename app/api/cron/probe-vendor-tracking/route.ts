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
import { fetchSanMarTracking } from "@/lib/vendors/sanmar/tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// SanMar's published binding name for OSN isn't documented in any
// scraped reference I have; their inventory binding ends in "V2final"
// and OSN exists as both 1.0.0 and 2.0.0 specs, so try the matrix.
// First WSDL that loads + returns a SOAP response wins. Curl this with
// ?scan=1 to iterate; the cron uses whichever SANMAR_OSN_WSDL_URL env
// you lock in.
const SANMAR_OSN_CANDIDATES = [
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV2final?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV2?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV1final?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV1?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServicev2?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServicev1?WSDL",
  "https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationService?WSDL",
  "https://ws.sanmar.com:8080/promostandards/ShipNoticeServiceBindingV1final?WSDL",
  "https://ws.sanmar.com:8080/promostandards/ShipNoticeServiceBindingV1?WSDL",
  "https://edev.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBindingV2final?WSDL",
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
  if (scan && vendor === "sanmar") {
    const startedAt = Date.now();
    const results = await Promise.all(
      SANMAR_OSN_CANDIDATES.map(async (wsdl) => {
        try {
          const shipments = await fetchSanMarTracking(poNumber, { wsdlUrl: wsdl });
          return {
            wsdl,
            outcome: "ok" as const,
            shipmentCount: shipments.length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Split "WSDL loaded but call faulted" vs "WSDL itself 404'd"
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
      poNumber,
      // Anything not labeled wsdl-404 is a candidate — that means the
      // WSDL itself loaded, even if the SOAP call faulted.
      candidates: results.filter((r) => r.outcome !== "wsdl-404"),
      all: results,
      durationMs: Date.now() - startedAt,
    });
  }

  const startedAt = Date.now();
  try {
    let shipments;
    switch (vendor) {
      case "sanmar":
        shipments = await fetchSanMarTracking(poNumber, { wsdlUrl: wsdlOverride ?? undefined });
        break;
      case "ss":
      case "cb":
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
      shipmentCount: shipments.length,
      shipments,
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
