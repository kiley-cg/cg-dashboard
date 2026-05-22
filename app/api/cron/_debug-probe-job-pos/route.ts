// Debug probe for the production-PO mirror.
//
// The cron is seeing 2333/2333 jobs return 404 from
// /v2/orders/jobs/{id}/purchaseorders even though /v2/orders/jobs/{id}
// works. This endpoint pokes the same Syncore tenant from inside the
// server so we can see exactly what's coming back, including the response
// body our normal error path swallows.
//
// Usage:
//   curl -H "x-cron-secret: $CRON_SECRET" \
//     "https://<host>/api/_debug/probe-job-pos?id=32681"
//
// Gated on CRON_SECRET so it isn't a public read path.

import { NextResponse } from "next/server";
import { getJob, listPurchaseOrders } from "@/lib/syncore/orders";
import { syncoreFetch } from "@/lib/syncore/client";
import { SyncoreError } from "@/lib/syncore/client";

export const dynamic = "force-dynamic";

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
  body?: unknown;
  error?: string;
}

async function tryPath(path: string): Promise<ProbeResult> {
  try {
    const body = await syncoreFetch<unknown>(path);
    return { path, ok: true, body };
  } catch (err) {
    if (err instanceof SyncoreError) {
      return {
        path,
        ok: false,
        status: err.status,
        body: err.body,
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
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing ?id=<job_id>" },
      { status: 400 },
    );
  }

  // 1. Confirm the Job endpoint works and surface its embedded
  //    purchase_orders[] so we can see suppliers + classes for this tenant.
  let job: unknown = null;
  let jobError: string | undefined;
  let embeddedPos: unknown = null;
  try {
    const j = await getJob(id);
    job = {
      id: j.id,
      status: j.status,
      job_class: j.job_class,
      description: j.description,
      client: j.client,
      purchase_orders_count: j.purchase_orders.length,
    };
    embeddedPos = j.purchase_orders;
  } catch (err) {
    jobError = err instanceof Error ? err.message : String(err);
  }

  // 2. Hammer multiple plausible variants of the PO list/sub-endpoint.
  //    Whichever returns 200 (or returns a non-empty body) is the truth.
  const candidates = [
    `/orders/jobs/${id}/purchaseorders`,
    `/orders/jobs/${id}/purchase-orders`,
    `/orders/jobs/${id}/purchase_orders`,
    `/orders/jobs/${id}/purchaseeorders`,
    `/orders/jobs/${id}/pos`,
    `/orders/jobs/${id}/po`,
    // SalesOrder-style nesting in case PO mirrors it:
    `/orders/jobs/${id}/salesorders/purchaseorders`,
  ];

  const probes = await Promise.all(candidates.map(tryPath));

  // 3. If the Job endpoint reported any embedded POs, try fetching the
  //    first one's detail by id under each candidate base path.
  let firstPoDetailProbes: ProbeResult[] | undefined;
  type EmbeddedPo = { id?: number | string } | null | undefined;
  const firstEmbedded = (
    Array.isArray(embeddedPos) ? (embeddedPos[0] as EmbeddedPo) : null
  );
  const firstPoId =
    firstEmbedded && typeof firstEmbedded === "object" && firstEmbedded.id
      ? String(firstEmbedded.id)
      : null;

  if (firstPoId) {
    const detailCandidates = [
      `/orders/jobs/${id}/purchaseorders/${firstPoId}`,
      `/orders/jobs/${id}/purchase-orders/${firstPoId}`,
      `/orders/purchaseorders/${firstPoId}`,
    ];
    firstPoDetailProbes = await Promise.all(detailCandidates.map(tryPath));
  }

  // 4. Also call our typed wrapper so we see the exact error our cron sees.
  let typedWrapper: ProbeResult;
  try {
    const list = await listPurchaseOrders(id);
    typedWrapper = {
      path: "listPurchaseOrders (typed wrapper)",
      ok: true,
      body: { count: list.length, first: list[0] ?? null },
    };
  } catch (err) {
    if (err instanceof SyncoreError) {
      typedWrapper = {
        path: "listPurchaseOrders (typed wrapper)",
        ok: false,
        status: err.status,
        body: err.body,
        error: err.message,
      };
    } else {
      typedWrapper = {
        path: "listPurchaseOrders (typed wrapper)",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return NextResponse.json({
    jobId: id,
    job,
    jobError,
    embeddedPos,
    listProbes: probes,
    firstPoId,
    firstPoDetailProbes,
    typedWrapper,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
