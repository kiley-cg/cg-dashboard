// Job Log entry probe — append a test entry to a Syncore job's Job Log
// via the endpoint discovered from HAR capture (May 24).
//
// Usage:
//   GET ?jobId=32616&desc=Hello+from+probe
// Optional:
//   &color=1   (0=gray, 1=orange [default], 2=green, 4=purple)

import { NextResponse } from "next/server";
import { addJobTrackerEntry, WebUiError } from "@/lib/syncore/webui";

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
  const jobId = url.searchParams.get("jobId");
  const desc = url.searchParams.get("desc");
  const colorStr = url.searchParams.get("color");

  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: "missing ?jobId=" },
      { status: 400 },
    );
  }
  if (!desc) {
    return NextResponse.json(
      { ok: false, error: "missing ?desc=" },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const color = colorStr ? Number(colorStr) : undefined;
    const ok = await addJobTrackerEntry({
      jobId,
      description: desc,
      color,
    });
    return NextResponse.json({
      ok: true,
      result: ok,
      jobId,
      description: desc,
      color: color ?? 1,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    const isWebUi = err instanceof WebUiError;
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        status: isWebUi ? err.status : undefined,
        body: isWebUi ? err.body : undefined,
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
