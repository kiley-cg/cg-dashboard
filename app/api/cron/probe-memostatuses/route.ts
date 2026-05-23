// Round 6 — debug the 500 from /api/purchaseorders/memostatuses.
//
// Round 5 found the endpoint via HAR, but calling it via webuiFetch
// returns 500 instead of 200. Comparing what the browser sent (per HAR)
// vs what webuiFetch sends:
//
//   Browser sent:                   webuiFetch sends:
//     Accept: application/json        Accept: application/json
//     Content-type: application/      (no Content-Type on GET)
//        json; charset=UTF-8
//     Referer: /Job/Details/{jobId}   (no Referer)
//     (no X-Requested-With)           X-Requested-With: XMLHttpRequest
//
// And the HAR call used 5 ids; we tried 1. Could be any of those.
//
// This probe tries the endpoint with several header/payload variants
// and surfaces the raw status + body for each, so we can see the
// actual 500 message.

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

interface Attempt {
  label: string;
  status?: number;
  contentType?: string;
  bodyPreview?: string;
  error?: string;
}

async function attempt(
  label: string,
  path: string,
  headers: Record<string, string | undefined>,
): Promise<Attempt> {
  try {
    const res = await webuiFetchRaw(path, { headers });
    return {
      label,
      status: res.status,
      contentType: res.headers["content-type"],
      bodyPreview: res.body.slice(0, 500),
    };
  } catch (err) {
    return { label, error: err instanceof Error ? err.message : String(err) };
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
  const poIdsParam = url.searchParams.get("poIds") ?? "68609";
  const poIds = poIdsParam.split(",").filter(Boolean);
  const jobId = url.searchParams.get("jobId") ?? "32616";

  const singleQuery = `?ids=${encodeURIComponent(poIds[0])}`;
  const multiQuery = poIds.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
  const multiPath = `/api/purchaseorders/memostatuses?${multiQuery}`;
  const singlePath = `/api/purchaseorders/memostatuses${singleQuery}`;

  // Reference: stock webuiFetch-style request (X-Requested-With, no Content-Type).
  const stockHeaders: Record<string, string | undefined> = {};

  // Browser parity: what the HAR showed the browser sending.
  const browserHeaders: Record<string, string | undefined> = {
    "X-Requested-With": "", // delete
    "Content-Type": "application/json; charset=UTF-8",
    Referer: `https://www.ateasesystems.net/Job/Details/${jobId}`,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };

  // One-at-a-time variants to isolate which header matters.
  const drop_xrw: Record<string, string | undefined> = {
    "X-Requested-With": "",
  };
  const just_content_type: Record<string, string | undefined> = {
    "Content-Type": "application/json; charset=UTF-8",
  };
  const just_referer: Record<string, string | undefined> = {
    Referer: `https://www.ateasesystems.net/Job/Details/${jobId}`,
  };

  const attempts = await Promise.all([
    attempt("01-stock-single", singlePath, stockHeaders),
    attempt("02-stock-multi", multiPath, stockHeaders),
    attempt("03-browser-single", singlePath, browserHeaders),
    attempt("04-browser-multi", multiPath, browserHeaders),
    attempt("05-drop-xrw-single", singlePath, drop_xrw),
    attempt("06-just-content-type-single", singlePath, just_content_type),
    attempt("07-just-referer-single", singlePath, just_referer),
  ]);

  return NextResponse.json({ poIds, jobId, attempts });
}

export async function GET(req: Request) {
  return handle(req);
}
