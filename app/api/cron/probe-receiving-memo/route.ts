// Find MemoId for a given Purchase Order so we can deep-link / write to
// the v1 receiving memo.
//
// The receiving memo isn't exposed in the v2 PO body (verified May 2026).
// It might live on the v2 Job response, or only on v1. This probe checks
// both:
//   1. v2 GET /orders/jobs/{jobId} — dump full payload, grep for memo_*
//   2. v1 receivingMemo.asp variants — maybe the page works without an
//      explicit MemoId, or there's a list endpoint that maps PO -> Memo
//
// Usage:
//   curl -H "x-cron-secret: $CRON_SECRET" \
//     "https://<host>/api/cron/probe-receiving-memo?jobId=32681&poId=68776"
//
// CRON_SECRET-gated. Temporary — delete after we wire the read path.

import { NextResponse } from "next/server";
import { syncoreFetch, SyncoreError } from "@/lib/syncore/client";
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
  label: string;
  path: string;
  method: string;
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: unknown;
  bodyKeys?: string[];
  memoHits?: string[];
  bodyPreview?: string;
  error?: string;
}

function findMemoMentions(body: unknown): string[] {
  const hits = new Set<string>();
  function walk(node: unknown, path: string) {
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k;
        if (/memo/i.test(k)) hits.add(`${p} = ${JSON.stringify(v)}`);
        walk(v, p);
      }
    }
  }
  walk(body, "");
  return Array.from(hits);
}

async function tryV2(path: string, label: string): Promise<ProbeResult> {
  try {
    const body = await syncoreFetch<unknown>(path);
    const keys =
      body && typeof body === "object" && !Array.isArray(body)
        ? Object.keys(body as Record<string, unknown>)
        : undefined;
    return {
      label,
      path,
      method: "GET",
      ok: true,
      bodyKeys: keys,
      memoHits: findMemoMentions(body),
      body,
    };
  } catch (err) {
    if (err instanceof SyncoreError) {
      return {
        label,
        path,
        method: "GET",
        ok: false,
        status: err.status,
        body: err.body,
        error: err.message,
      };
    }
    return {
      label,
      path,
      method: "GET",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function tryV1Raw(
  path: string,
  label: string,
): Promise<ProbeResult> {
  // webuiFetch throws on text/html responses — we want HTML for this
  // probe so we can scan it for memoID. Inline a minimal fetch.
  try {
    const res = await fetch(
      `https://us.ateasesystems.net${path.startsWith("/") ? path : `/${path}`}`,
      {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
      },
    );
    const ct = res.headers.get("content-type") ?? "";
    // Won't work without cookies — this is intentionally a no-auth probe
    // to see what shape Syncore returns. Real probes go through webui.
    const text = await res.text().catch(() => "");
    return {
      label: `${label} (raw, no auth)`,
      path,
      method: "GET",
      ok: res.ok,
      status: res.status,
      contentType: ct,
      bodyPreview: text.slice(0, 400),
    };
  } catch (err) {
    return {
      label,
      path,
      method: "GET",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function tryV1Auth(
  path: string,
  label: string,
): Promise<ProbeResult> {
  try {
    const body = await webuiFetch<unknown>(path);
    return {
      label,
      path,
      method: "GET",
      ok: true,
      body,
      memoHits: findMemoMentions(body),
    };
  } catch (err) {
    if (err instanceof WebUiError) {
      // If err.body is HTML text, grep it for memoID patterns.
      let memoHits: string[] | undefined;
      let bodyPreview: string | undefined;
      if (typeof err.body === "string") {
        bodyPreview = err.body.slice(0, 400);
        const matches = err.body.match(/[Mm]emo[Ii]d[=:][^&"'\s]+/g);
        if (matches) memoHits = matches.slice(0, 10);
      }
      return {
        label,
        path,
        method: "GET",
        ok: false,
        status: err.status,
        bodyPreview,
        memoHits,
        error: err.message,
      };
    }
    return {
      label,
      path,
      method: "GET",
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
  const jobId = url.searchParams.get("jobId");
  const poId = url.searchParams.get("poId");
  if (!jobId || !poId) {
    return NextResponse.json(
      { ok: false, error: "need ?jobId=X&poId=Y" },
      { status: 400 },
    );
  }

  // 1. Full v2 Job — does memo_id live here?
  const v2Job = await tryV2(`/orders/jobs/${jobId}`, "v2 Job");

  // 2. v1 receiving memo (without explicit MemoId — does it redirect?)
  const v1Probes = await Promise.all([
    tryV1Auth(
      `/porder/receivingMemo.asp?PurchaseOrderID=${poId}`,
      "v1 receivingMemo (no MemoId)",
    ),
    tryV1Auth(
      `/porder/receivingMemoList.asp?PurchaseOrderID=${poId}`,
      "v1 receivingMemoList (guess)",
    ),
    tryV1Auth(
      `/porder/listMemos.asp?PurchaseOrderID=${poId}`,
      "v1 listMemos (guess)",
    ),
  ]);

  return NextResponse.json({
    jobId,
    poId,
    v2Job,
    v1: v1Probes,
  });
}

export async function GET(req: Request) {
  return handle(req);
}
