// Round 5 — end-to-end roundtrip probe for the LoginFromV2 → receiving memo
// pipeline.
//
// HAR capture revealed that the www. REST endpoint
//   /api/purchaseorders/memostatuses?ids=POID
// returns a per-PO entry with a `resourceUrl` field that is a freshly-minted
// LoginFromV2 URL of the form
//   https://us.ateasesystems.net/LoginFromV2.asp?UserId=...&Token=...&Menu=...
//     &RequestURL=%2fporder%2freceivingMemo.asp%3fActionCMD%3dEdit!Corp%3d0!...
//
// That URL Set-Cookies UserID/Token on us. and 302s onward to the target
// memo page. So our end-to-end flow becomes:
//
//   1. webuiFetch /api/purchaseorders/memostatuses?ids=POID  (existing www. auth)
//   2. read resourceUrl from response
//   3. fetch that URL manually, follow redirects, collect us. cookies
//   4. with that us. cookie jar, GET /porder/receivingMemo.asp?ActionCMD=Edit
//      and parse the form HTML for the writeback POST target + field names
//
// This probe walks the full chain for a single PO and reports each hop plus
// the final memo HTML preview. All calls are read-only.

import { NextResponse } from "next/server";
import { webuiFetch } from "@/lib/syncore/webui";

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

interface MemoStatus {
  purchaseOrderId: number;
  statusId: number;
  statusName: string;
  displayName: string;
  resourceUrl: string | null;
}

interface Hop {
  i: number;
  url: string;
  status: number;
  contentType?: string;
  location?: string | null;
  setCookieNames?: string[];
}

function buildCookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");
}

function ingestCookies(jar: Map<string, string>, res: Response): string[] {
  const names: string[] = [];
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) {
      jar.set(name, value);
      names.push(name);
    }
  }
  return names;
}

async function followChain(
  start: string,
  max = 8,
): Promise<{ hops: Hop[]; jar: Map<string, string>; finalBody: string; finalUrl: string }> {
  const jar = new Map<string, string>();
  const hops: Hop[] = [];
  let nextUrl: URL | null = new URL(start);
  let finalBody = "";
  let finalUrl = "";

  for (let i = 0; i < max && nextUrl; i++) {
    const headers: Record<string, string> = { Accept: "text/html,*/*" };
    const c = buildCookieHeader(jar);
    if (c) headers["Cookie"] = c;

    const res: Response = await fetch(nextUrl, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
    });
    const setCookieNames = ingestCookies(jar, res);
    const loc: string | null = res.headers.get("location");

    hops.push({
      i,
      url: nextUrl.toString(),
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      location: loc,
      setCookieNames: setCookieNames.length ? setCookieNames : undefined,
    });

    if (res.status >= 300 && res.status < 400 && loc) {
      await res.text().catch(() => "");
      nextUrl = new URL(loc, nextUrl);
      continue;
    }

    finalUrl = nextUrl.toString();
    finalBody = await res.text().catch(() => "");
    break;
  }

  return { hops, jar, finalBody, finalUrl };
}

interface MemoParsed {
  formAction?: string;
  formMethod?: string;
  memoIdField?: string;
  poIdField?: string;
  hiddenInputs: string[];
  qtyReceivedFields: string[];
  poItemIdFields: string[];
}

function parseMemoForm(html: string): MemoParsed {
  const formMatch = html.match(/<form\b([^>]*)>/i);
  const formAttrs = formMatch?.[1] ?? "";
  const actionMatch = formAttrs.match(/\baction\s*=\s*["']([^"']+)["']/i);
  const methodMatch = formAttrs.match(/\bmethod\s*=\s*["']([^"']+)["']/i);
  const memoIdMatch = html.match(
    /name\s*=\s*["'](?:MemoID|MemoId|memoID|memoId)["'][^>]*value\s*=\s*["']([^"']+)["']/i,
  );
  const poIdMatch = html.match(
    /name\s*=\s*["'](?:PurchaseOrderID|PurchaseOrderId)["'][^>]*value\s*=\s*["']([^"']+)["']/i,
  );

  const hiddenInputs = Array.from(
    html.matchAll(
      /<input[^>]+type\s*=\s*["']hidden["'][^>]*name\s*=\s*["']([^"']+)["']/gi,
    ),
  )
    .map((m) => m[1])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 30);

  const qtyReceivedFields = Array.from(
    html.matchAll(/name\s*=\s*["']([^"']*[Qq]ty[Rr]eceived[^"']*)["']/g),
  )
    .map((m) => m[1])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 30);

  const poItemIdFields = Array.from(
    html.matchAll(/name\s*=\s*["'](POItemID[^"']*)["']/gi),
  )
    .map((m) => m[1])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 30);

  return {
    formAction: actionMatch?.[1],
    formMethod: methodMatch?.[1],
    memoIdField: memoIdMatch?.[1],
    poIdField: poIdMatch?.[1],
    hiddenInputs,
    qtyReceivedFields,
    poItemIdFields,
  };
}

async function handle(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const poId = url.searchParams.get("poId") ?? "68609";

  // Step 1: ask www. for the memo status (and freshly-minted LoginFromV2 URL).
  let memoStatuses: MemoStatus[] = [];
  let statusFetchError: string | undefined;
  try {
    const data = await webuiFetch<{ receivingMemoStatuses?: MemoStatus[] }>(
      `/api/purchaseorders/memostatuses?ids=${encodeURIComponent(poId)}`,
    );
    memoStatuses = data.receivingMemoStatuses ?? [];
  } catch (err) {
    statusFetchError = err instanceof Error ? err.message : String(err);
  }

  const target = memoStatuses.find((s) => String(s.purchaseOrderId) === poId);

  // Redact the Token value before reporting back — the API rotates it, but
  // there's no reason to splash it into Vercel logs.
  const redactedResourceUrl = target?.resourceUrl
    ? target.resourceUrl.replace(/(Token=)[^&]+/i, "$1[redacted]")
    : null;

  if (!target?.resourceUrl) {
    return NextResponse.json({
      poId,
      statusFetchError,
      memoStatusCount: memoStatuses.length,
      target: target
        ? { ...target, resourceUrl: redactedResourceUrl }
        : undefined,
      note: "no resourceUrl on memostatuses response — nothing to follow",
    });
  }

  // Step 2 + 3: follow the LoginFromV2 chain, collecting us. cookies.
  let chain: Awaited<ReturnType<typeof followChain>> | undefined;
  let chainError: string | undefined;
  try {
    chain = await followChain(target.resourceUrl);
  } catch (err) {
    chainError = err instanceof Error ? err.message : String(err);
  }

  // Step 4: parse the final HTML for the memo form (writeback target).
  let memoParsed: MemoParsed | undefined;
  let finalBodyPreview: string | undefined;
  if (chain && chain.finalBody) {
    memoParsed = parseMemoForm(chain.finalBody);
    finalBodyPreview = chain.finalBody.slice(0, 1500);
  }

  return NextResponse.json({
    poId,
    statusFetchError,
    memoStatusCount: memoStatuses.length,
    target: target
      ? { ...target, resourceUrl: redactedResourceUrl }
      : undefined,
    chainError,
    hops: chain?.hops,
    finalUrl: chain?.finalUrl,
    usCookieKeys: chain ? Array.from(chain.jar.keys()) : undefined,
    memoParsed,
    finalBodyPreview,
  });
}

export async function GET(req: Request) {
  return handle(req);
}
