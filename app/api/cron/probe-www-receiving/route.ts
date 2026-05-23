// Probe for a www.ateasesystems.net /api/ receiving endpoint that
// mirrors the close-PO /api/jobs/{jobId}/purchaseorders/{poId}/supplier-invoices
// pattern. If www. exposes a receiving API analogous to that one, we
// can skip the us.ateasesystems.net /porder/receivingMemo.asp dance
// entirely (our existing webui.ts already auths against www.).
//
// Tries a bunch of plausible paths via the authenticated webui session.
// 200 / 201 = jackpot. 404 = endpoint doesn't exist; 401/403 = exists
// but our session isn't allowed.

import { NextResponse } from "next/server";
import { webuiFetch, WebUiError } from "@/lib/syncore/webui";

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
  path: string;
  ok: boolean;
  status?: number;
  bodyKind?: string;
  bodyPreview?: unknown;
  error?: string;
}

async function tryGet(path: string): Promise<ProbeResult> {
  try {
    const body = await webuiFetch<unknown>(path);
    const bodyKind: string = Array.isArray(body) ? "array" : typeof body;
    return {
      path,
      ok: true,
      bodyKind,
      bodyPreview: body,
    };
  } catch (err) {
    if (err instanceof WebUiError) {
      const preview =
        typeof err.body === "object" && err.body !== null
          ? err.body
          : typeof err.body === "string"
            ? err.body.slice(0, 300)
            : undefined;
      return {
        path,
        ok: false,
        status: err.status,
        bodyPreview: preview,
        error: err.message,
      };
    }
    return {
      path,
      ok: false,
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

  // Candidate paths — all GET. None of these should mutate state.
  const candidates = [
    // Mirror the supplier-invoices shape we know works for close.
    `/api/jobs/${jobId}/purchaseorders/${poId}/receiving-memo`,
    `/api/jobs/${jobId}/purchaseorders/${poId}/receivingmemo`,
    `/api/jobs/${jobId}/purchaseorders/${poId}/receiving-memos`,
    `/api/jobs/${jobId}/purchaseorders/${poId}/receivings`,
    `/api/jobs/${jobId}/purchaseorders/${poId}/receive`,
    `/api/jobs/${jobId}/purchaseorders/${poId}/memo`,
    `/api/jobs/${jobId}/purchaseorders/${poId}/memos`,
    // Receiving might be at a different namespace.
    `/api/jobs/${jobId}/receivings`,
    `/api/jobs/${jobId}/receiving-memos`,
    `/api/purchaseorders/${poId}/receivings`,
    `/api/purchaseorders/${poId}/receiving-memo`,
    // Long shot: list all receiving memos for a PO under a top-level
    // namespace.
    `/api/receiving-memos?purchaseOrderID=${poId}`,
    `/api/receivingMemos?purchaseOrderID=${poId}`,
  ];

  const results = await Promise.all(candidates.map(tryGet));
  return NextResponse.json({ jobId, poId, results });
}

export async function GET(req: Request) {
  return handle(req);
}
