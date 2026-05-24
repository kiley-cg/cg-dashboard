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
export const maxDuration = 30;

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
