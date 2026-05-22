// Probe whether Syncore v2 exposes a global jobs-list endpoint.
//
// The sync-production-pos cron currently seeds its job IDs from
// followup_rows — fine for jobs CSRs are tracking, but misses brand-new
// jobs and any production that's already past the follow-up phase. This
// route pokes the obvious endpoint shapes to find out whether a real
// list endpoint exists; if so, we'll replace the follow-ups seed.
//
// Gated on CRON_SECRET. Temporary — delete once a path is chosen.

import { NextResponse } from "next/server";
import { syncoreFetch, SyncoreError } from "@/lib/syncore/client";

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
  bodyPreview?: unknown;
  bodyKind?: string;
  arrayLength?: number;
  error?: string;
}

function previewOfBody(b: unknown): {
  bodyPreview: unknown;
  bodyKind: string;
  arrayLength?: number;
} {
  if (Array.isArray(b)) {
    return {
      bodyKind: "array",
      arrayLength: b.length,
      bodyPreview: b.slice(0, 2),
    };
  }
  if (b && typeof b === "object") {
    const keys = Object.keys(b);
    // Common Syncore envelope: { jobs/salesorders/etc: [...], total_results }
    for (const k of keys) {
      const v = (b as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        return {
          bodyKind: `object {${k}: array}`,
          arrayLength: v.length,
          bodyPreview: { [k]: v.slice(0, 2), keys },
        };
      }
    }
    return { bodyKind: "object", bodyPreview: b };
  }
  return { bodyKind: typeof b, bodyPreview: b };
}

async function tryPath(path: string): Promise<ProbeResult> {
  try {
    const body = await syncoreFetch<unknown>(path);
    return { path, ok: true, ...previewOfBody(body) };
  } catch (err) {
    if (err instanceof SyncoreError) {
      return {
        path,
        ok: false,
        status: err.status,
        bodyPreview: err.body,
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

  // Plausible variations of a global jobs-list endpoint. Mirror the
  // existing pattern for salesorders / purchaseorders which both use the
  // un-hyphenated noun.
  const candidates = [
    "/orders/jobs",
    "/orders/jobs?status=Open",
    "/orders/jobs?status=WIP",
    "/orders/jobs?status=Submitted",
    "/orders/jobs?page=1&count=25",
    "/orders/jobs?count=10",
    "/orders/joblist",
    "/orders/job-list",
  ];

  const probes = await Promise.all(candidates.map(tryPath));
  return NextResponse.json({ probes });
}

export async function GET(req: Request) {
  return handle(req);
}
