// Calibration probe for the receiving-memo discovery.
//
// Round 1 (#65) found that every candidate path under
// /api/jobs/{jobId}/purchaseorders/{poId}/* returned 405 with the same
// "UnsupportedApiVersion: version '1.0' does not support HTTP method 'GET'"
// message — including obvious nonsense paths. That's suspicious: it may
// mean .NET's API-versioning middleware returns 405 for any unknown sub-
// path under a known parent prefix, rather than 405 only for real-but-
// GET-rejecting routes.
//
// This probe disambiguates "405 = real POST/PUT route" vs "405 = middleware
// noise" by:
//
//   1. Baseline GETs against known routes (the PO itself; supplier-invoices,
//      which we know is real and POST-only via the close-PO flow) to see
//      what a confirmed real route returns for GET.
//   2. A GET against a clearly bogus path to see if 405 comes back for
//      something that definitely does not exist.
//   3. OPTIONS against each receiving candidate — if a route is real, the
//      server should respond with an `Allow:` header listing the methods
//      it accepts (POST/PUT/etc).
//
// All calls are non-mutating.

import { NextResponse } from "next/server";
import { webuiFetchRaw } from "@/lib/syncore/webui";

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

interface ProbeResult {
  label: string;
  method: string;
  path: string;
  status?: number;
  allow?: string;
  contentType?: string;
  bodyPreview?: string;
  error?: string;
}

async function probe(
  label: string,
  method: string,
  path: string,
): Promise<ProbeResult> {
  try {
    const res = await webuiFetchRaw(path, { method });
    return {
      label,
      method,
      path,
      status: res.status,
      allow: res.headers["allow"],
      contentType: res.headers["content-type"],
      bodyPreview: res.body.slice(0, 400),
    };
  } catch (err) {
    return {
      label,
      method,
      path,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handle(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId") ?? "32681";
  const poId = url.searchParams.get("poId") ?? "68776";

  const poBase = `/api/jobs/${jobId}/purchaseorders/${poId}`;

  // Calibration: real GET, real POST-only route hit with GET, and a
  // deliberately bogus sub-path. Compare statuses to interpret OPTIONS
  // results below.
  const calibration: Array<[string, string, string]> = [
    ["baseline-real-GET-job", "GET", `/api/jobs/${jobId}`],
    ["baseline-real-GET-PO", "GET", poBase],
    ["baseline-known-POST-only-GET", "GET", `${poBase}/supplier-invoices`],
    ["baseline-bogus-sub-path-GET", "GET", `${poBase}/totally-fake-xyz123`],
    ["baseline-bogus-sibling-GET", "GET", `/api/jobs/${jobId}/totally-fake-xyz123`],
  ];

  // The candidate receiving paths from round 1, now hit with OPTIONS.
  // A real route should reply with `Allow: POST` (or PUT) header.
  const candidates: string[] = [
    `${poBase}/receiving-memo`,
    `${poBase}/receivingmemo`,
    `${poBase}/receiving-memos`,
    `${poBase}/receivings`,
    `${poBase}/receive`,
    `${poBase}/memo`,
    `${poBase}/memos`,
    `/api/jobs/${jobId}/receivings`,
    `/api/jobs/${jobId}/receiving-memos`,
    `/api/purchaseorders/${poId}/receivings`,
    `/api/purchaseorders/${poId}/receiving-memo`,
  ];

  // Also OPTIONS the known-real routes for comparison — we want to know
  // what a "real route" OPTIONS response actually looks like on this API.
  const optionsCalibration: Array<[string, string]> = [
    ["options-real-PO", poBase],
    ["options-known-POST-only", `${poBase}/supplier-invoices`],
    ["options-bogus-sub-path", `${poBase}/totally-fake-xyz123`],
  ];

  const results = await Promise.all([
    ...calibration.map(([label, method, p]) => probe(label, method, p)),
    ...optionsCalibration.map(([label, p]) => probe(label, "OPTIONS", p)),
    ...candidates.map((p) => probe(`options-candidate`, "OPTIONS", p)),
  ]);

  return NextResponse.json({ jobId, poId, results });
}

export async function GET(req: Request) {
  return handle(req);
}
