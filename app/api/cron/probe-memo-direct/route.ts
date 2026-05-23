// Round 10 — fetch the actual memo HTML directly with the UserID/Token
// cookies we now know how to obtain.
//
// Round 9 proved that full browser-parity headers (UA + Accept +
// Sec-Fetch-* + sec-ch-ua family) unlock LoginFromV2 and grant us
// UserID + Token cookies on us.ateasesystems.net. But the auth dance
// dropped the pg= target and landed us on the index.asp frameset
// instead of the memo. Now that we hold UserID + Token, we can hit
// the memo URL directly.
//
// This probe:
//   1. www. login
//   2. Get LoginFromV2 resourceUrl
//   3. Follow full browser-headers chain to acquire UserID + Token
//   4. GET us./porder/receivingMemo.asp?ActionCMD=Edit&... DIRECTLY
//      using the cookie jar
//   5. Parse the form HTML for action, method, hidden fields, line
//      items — the writeback blueprint
//
// Also dumps a longer body preview so we can eyeball the actual memo
// markup and confirm we're not on a login/frameset page.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WWW_BASE = "https://www.ateasesystems.net";
const US_BASE = "https://us.ateasesystems.net";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua":
    '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

type DomainJar = Map<string, Map<string, string>>;

function jarSet(jar: DomainJar, host: string, name: string, value: string): void {
  const inner = jar.get(host) ?? new Map<string, string>();
  inner.set(name, value);
  jar.set(host, inner);
}

function jarHeader(jar: DomainJar, host: string): string {
  const inner = jar.get(host);
  if (!inner || inner.size === 0) return "";
  return Array.from(inner.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");
}

function ingestSetCookies(jar: DomainJar, host: string, res: Response): string[] {
  const added: string[] = [];
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) {
      jarSet(jar, host, name, value);
      added.push(name);
    }
  }
  return added;
}

async function wwwLogin(jar: DomainJar): Promise<void> {
  const username = envOrThrow("SYNCORE_USERNAME");
  const password = envOrThrow("SYNCORE_PASSWORD");
  const loginUrl = `${WWW_BASE}/Account/Login`;
  const getRes = await fetch(loginUrl, { redirect: "manual" });
  ingestSetCookies(jar, "www.ateasesystems.net", getRes);
  const html = await getRes.text();
  const tokenMatch =
    html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ??
    html.match(
      /<input[^>]+name="__RequestVerificationToken"[^>]+value="([^"]+)"/,
    );
  if (!tokenMatch) throw new Error("CSRF not found");

  const postRes = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jarHeader(jar, "www.ateasesystems.net"),
    },
    body: new URLSearchParams({
      Email: username,
      Password: password,
      __RequestVerificationToken: tokenMatch[1],
    }).toString(),
    redirect: "manual",
  });
  ingestSetCookies(jar, "www.ateasesystems.net", postRes);
}

async function getResourceUrl(
  jar: DomainJar,
  poId: string,
): Promise<{
  resourceUrl: string | null;
  memoId: string | null;
  statusName: string | null;
}> {
  const url = `${WWW_BASE}/api/purchaseorders/memostatuses?ids=${encodeURIComponent(poId)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Cookie: jarHeader(jar, "www.ateasesystems.net"),
    },
    cache: "no-store",
    redirect: "manual",
  });
  if (res.status !== 200) return { resourceUrl: null, memoId: null, statusName: null };
  const body = await res.text();
  try {
    const parsed: {
      receivingMemoStatuses?: Array<{
        purchaseOrderId: number;
        statusName: string;
        resourceUrl?: string | null;
      }>;
    } = JSON.parse(body);
    const m = parsed.receivingMemoStatuses?.find(
      (s) => String(s.purchaseOrderId) === poId,
    );
    if (!m || !m.resourceUrl) {
      return { resourceUrl: null, memoId: null, statusName: m?.statusName ?? null };
    }
    // The resourceUrl encodes RequestURL=...MemoId=<id> using ! separators.
    const memoIdMatch = decodeURIComponent(m.resourceUrl).match(/MemoId[=:]([0-9]+)/i);
    return {
      resourceUrl: m.resourceUrl,
      memoId: memoIdMatch ? memoIdMatch[1] : null,
      statusName: m.statusName,
    };
  } catch {
    return { resourceUrl: null, memoId: null, statusName: null };
  }
}

interface Hop {
  i: number;
  url: string;
  status: number;
  location?: string;
  setCookies: string[];
}

async function followChain(
  jar: DomainJar,
  startUrl: string,
  max = 10,
): Promise<Hop[]> {
  const hops: Hop[] = [];
  let currentUrl: URL | null = new URL(startUrl);
  let i = 0;
  while (currentUrl && i < max) {
    const host = currentUrl.hostname;
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    const cookie = jarHeader(jar, host);
    if (cookie) headers["Cookie"] = cookie;
    const res: Response = await fetch(currentUrl, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
    });
    const setCookies = ingestSetCookies(jar, host, res);
    const location: string | undefined = res.headers.get("location") ?? undefined;
    hops.push({ i, url: currentUrl.toString(), status: res.status, location, setCookies });
    if (res.status >= 300 && res.status < 400 && location) {
      await res.text().catch(() => "");
      currentUrl = new URL(location, currentUrl);
      i++;
      continue;
    }
    break;
  }
  return hops;
}

function parseMemo(html: string) {
  const lower = html.toLowerCase();
  const looksLikeLogin =
    lower.includes('name="username"') ||
    lower.includes('name="password"') ||
    /action=["']?[^"'>]*login\.asp/i.test(html);
  const looksLikeMemo =
    /receiving memo|qty received|poitemid/i.test(html) && !looksLikeLogin;

  // Classic ASP forms: usually <form name="..." method="post" action="...">
  // The form may have no explicit method (defaults to GET) or use POST.
  const forms = Array.from(
    html.matchAll(/<form\b([^>]*)>/gi),
    (m) => m[1],
  ).map((attrs) => {
    const actionMatch = attrs.match(/\baction=["']([^"']+)["']/i);
    const methodMatch = attrs.match(/\bmethod=["']?(\w+)["']?/i);
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
    return {
      name: nameMatch?.[1] ?? null,
      method: methodMatch?.[1] ?? "GET",
      action: actionMatch?.[1] ?? null,
    };
  });

  const hiddenFields = Array.from(
    html.matchAll(
      /<input[^>]+type=["']hidden["'][^>]+name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi,
    ),
    (m) => ({ name: m[1], value: m[2].slice(0, 60) }),
  );

  const allInputNames = Array.from(
    new Set(
      Array.from(html.matchAll(/<input[^>]+name=["']([^"']+)["']/gi), (m) => m[1]),
    ),
  );

  // Line item indicators — POItemID is the per-line key in the close-PO flow,
  // and the receiving memo likely uses the same convention.
  const poItemIds = Array.from(
    new Set(
      Array.from(
        html.matchAll(/POItemID["']?[^>]*value=["']?(\d+)/gi),
        (m) => m[1],
      ),
    ),
  );

  return {
    looksLikeMemo,
    looksLikeLogin,
    title: (html.match(/<title>([^<]*)<\/title>/i) ?? [, null])[1],
    bodySize: html.length,
    forms,
    hiddenFieldCount: hiddenFields.length,
    hiddenFieldsSample: hiddenFields.slice(0, 30),
    allInputNames: allInputNames.slice(0, 40),
    poItemIds: poItemIds.slice(0, 30),
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

  const jar: DomainJar = new Map();
  try {
    await wwwLogin(jar);
  } catch (err) {
    return NextResponse.json({
      step: "www-login",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const { resourceUrl, memoId, statusName } = await getResourceUrl(jar, poId);
  if (!resourceUrl) {
    return NextResponse.json({
      step: "memostatuses",
      error: "no resourceUrl for PO",
      statusName,
    });
  }

  // Phase 1: walk LoginFromV2 chain to acquire UserID + Token cookies.
  const authChain = await followChain(jar, resourceUrl);
  const usCookies = Array.from(jar.get("us.ateasesystems.net")?.keys() ?? []);
  const haveAuth = usCookies.includes("UserID") && usCookies.includes("Token");

  if (!haveAuth) {
    return NextResponse.json({
      step: "loginfromv2",
      error: "did not acquire UserID + Token cookies",
      authChain,
      usCookies,
    });
  }

  // Phase 2: directly GET the memo page with the now-authed us. cookies.
  const action = url.searchParams.get("action") ?? "Edit";
  const memoUrl =
    `${US_BASE}/porder/receivingMemo.asp?ActionCMD=${action}&Corp=0&BranchID=97` +
    `&PurchaseOrderID=${encodeURIComponent(poId)}` +
    `&MemoId=${encodeURIComponent(memoId ?? "0")}`;

  const memoChain = await followChain(jar, memoUrl);
  // Get the body of the final hop.
  const lastHop = memoChain[memoChain.length - 1];
  let finalBody = "";
  if (lastHop) {
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    const cookie = jarHeader(jar, "us.ateasesystems.net");
    if (cookie) headers["Cookie"] = cookie;
    // Re-fetch the final URL to read the body (followChain only logs hops).
    const res = await fetch(lastHop.url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
    });
    finalBody = await res.text().catch(() => "");
  }

  const memoInfo = parseMemo(finalBody);

  return NextResponse.json({
    poId,
    memoId,
    statusName,
    authChain,
    memoChain,
    haveAuth,
    usCookieKeys: Array.from(jar.get("us.ateasesystems.net")?.keys() ?? []),
    memoUrl,
    memoInfo,
    finalBodyPreview: finalBody.slice(0, 2500),
  });
}

export async function GET(req: Request) {
  return handle(req);
}
