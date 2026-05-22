// Probe the right way to PATCH a PO into "Posted Manually" status.
//
// Our current path `/orders/jobs/{jobId}/purchaseorders/{poId}/status/postedmanually`
// 404s even though the v2 docs sample shows exactly that string. This
// route tries a battery of plausible alternatives and reports each one's
// status + body so we can pick the one Syncore actually accepts.
//
// SAFETY: the first successful call closes the PO for real. The probe
// short-circuits as soon as it gets a 2xx, so we don't flap state.
//
// Usage:
//   curl -H "x-cron-secret: $CRON_SECRET" \
//     "https://<host>/api/cron/probe-close-po?id=<poId>"

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { syncoreFetch, SyncoreError } from "@/lib/syncore/client";
import { db, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

interface Attempt {
  method: string;
  path: string;
  body?: unknown;
  ok: boolean;
  status?: number;
  responseBody?: unknown;
  error?: string;
}

async function tryOne(
  method: string,
  path: string,
  body?: unknown,
): Promise<Attempt> {
  try {
    const result = await syncoreFetch<unknown>(path, { method, body });
    return { method, path, body, ok: true, responseBody: result };
  } catch (err) {
    if (err instanceof SyncoreError) {
      return {
        method,
        path,
        body,
        ok: false,
        status: err.status,
        responseBody: err.body,
        error: err.message,
      };
    }
    return {
      method,
      path,
      body,
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
  const poId = url.searchParams.get("id");
  if (!poId) {
    return NextResponse.json(
      { ok: false, error: "missing ?id=<poId>" },
      { status: 400 },
    );
  }

  const mirror = await db
    .select({ jobId: schema.productionPoMirror.syncoreJobId })
    .from(schema.productionPoMirror)
    .where(eq(schema.productionPoMirror.poId, poId))
    .limit(1);
  if (mirror.length === 0) {
    return NextResponse.json(
      { ok: false, error: `PO ${poId} not in mirror` },
      { status: 404 },
    );
  }
  const jobId = mirror[0].jobId;

  // First: GET the current state so we know what we're working with.
  const getResult = await tryOne(
    "GET",
    `/orders/jobs/${jobId}/purchaseorders/${poId}`,
  );

  // Variations to try. Stop after the first 2xx.
  const variants: Array<{ method: string; path: string; body?: unknown }> = [
    // 1. Documented path, no body
    {
      method: "PATCH",
      path: `/orders/jobs/${jobId}/purchaseorders/${poId}/status/postedmanually`,
    },
    // 2. Spelling variants
    {
      method: "PATCH",
      path: `/orders/jobs/${jobId}/purchaseorders/${poId}/status/posted_manually`,
    },
    {
      method: "PATCH",
      path: `/orders/jobs/${jobId}/purchaseorders/${poId}/status/posted-manually`,
    },
    {
      method: "PATCH",
      path: `/orders/jobs/${jobId}/purchaseorders/${poId}/status/postedManually`,
    },
    {
      method: "PATCH",
      path: `/orders/jobs/${jobId}/purchaseorders/${poId}/status/PostedManually`,
    },
    // 3. POST instead of PATCH
    {
      method: "POST",
      path: `/orders/jobs/${jobId}/purchaseorders/${poId}/status/postedmanually`,
    },
    // 4. PUT to the PO with body — full-update style per docs
    {
      method: "PUT",
      path: `/orders/jobs/${jobId}/purchaseorders/${poId}`,
      body: { status: "Posted Manually" },
    },
    {
      method: "PATCH",
      path: `/orders/jobs/${jobId}/purchaseorders/${poId}`,
      body: { status: "Posted Manually" },
    },
    // 5. No "status" segment
    {
      method: "PATCH",
      path: `/orders/jobs/${jobId}/purchaseorders/${poId}/postedmanually`,
    },
  ];

  const attempts: Attempt[] = [];
  for (const v of variants) {
    const r = await tryOne(v.method, v.path, v.body);
    attempts.push(r);
    if (r.ok) break; // don't keep PATCHing once one succeeds
  }

  return NextResponse.json({
    poId,
    jobId,
    initialGet: getResult,
    attempts,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
