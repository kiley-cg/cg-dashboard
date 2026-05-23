// Round 9 — does browser UA / header parity unlock LoginFromV2?
//
// Round 8 showed our backend gets bounced ("Redirected=1" flag → index.asp
// → Login.asp → www.) even though incognito-paste of the same URL lands
// directly on the memo. Token is portable; the server is fingerprinting
// our request as non-browser and refusing to mint UserID/Token cookies.
//
// Most likely culprit: User-Agent (Node fetch sends a runtime-specific
// UA; the server probably wants a browser one). Possible secondary:
// Accept / Accept-Language / Sec-Fetch-* headers.
//
// Three variants in one probe, all starting from a clean us. cookie jar:
//   A. control: minimal headers (what round 8 did)
//   B. browser UA only
//   C. browser UA + browser Accept-* + Sec-Fetch-* headers
//
// For each, run the LoginFromV2 chain, then check whether we landed on
// the memo page (success) or got bounced (failure).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WWW_BASE = "https://www.ateasesystems.net";

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

interface Hop {
  i: number;
  url: string;
  status: number;
  location?: string;
  setCookies: string[];
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

  const postBody = new URLSearchParams({
    Email: username,
    Password: password,
    __RequestVerificationToken: tokenMatch[1],
  }).toString();

  const postRes = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jarHeader(jar, "www.ateasesystems.net"),
    },
    body: postBody,
    redirect: "manual",
  });
  ingestSetCookies(jar, "www.ateasesystems.net", postRes);
}

async function getResourceUrl(
  jar: DomainJar,
  poId: string,
): Promise<string | null> {
  const url = `${WWW_BASE}/api/purchaseorders/memostatuses?ids=${encodeURIComponent(poId)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Cookie: jarHeader(jar, "www.ateasesystems.net"),
    },
    cache: "no-store",
    redirect: "manual",
  });
  if (res.status !== 200) return null;
  const body = await res.text();
  try {
    const parsed: {
      receivingMemoStatuses?: Array<{
        purchaseOrderId: number;
        resourceUrl?: string | null;
      }>;
    } = JSON.parse(body);
    const m = parsed.receivingMemoStatuses?.find(
      (s) => String(s.purchaseOrderId) === poId,
    );
    return m?.resourceUrl ?? null;
  } catch {
    return null;
  }
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const BROWSER_HEADERS_FULL: Record<string, string> = {
  "User-Agent": BROWSER_UA,
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

async function followChain(
  jar: DomainJar,
  startUrl: string,
  extraHeaders: Record<string, string>,
  max = 10,
): Promise<{ hops: Hop[]; finalUrl: string | null; finalBody: string }> {
  const hops: Hop[] = [];
  let currentUrl: URL | null = new URL(startUrl);
  let i = 0;
  let finalUrl: string | null = null;
  let finalBody = "";

  while (currentUrl && i < max) {
    const host = currentUrl.hostname;
    const headers: Record<string, string> = {
      Accept: "text/html,*/*",
      ...extraHeaders,
    };
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
    hops.push({
      i,
      url: currentUrl.toString(),
      status: res.status,
      location,
      setCookies,
    });

    if (res.status >= 300 && res.status < 400 && location) {
      await res.text().catch(() => "");
      currentUrl = new URL(location, currentUrl);
      i++;
      continue;
    }
    finalUrl = currentUrl.toString();
    finalBody = await res.text().catch(() => "");
    break;
  }

  return { hops, finalUrl, finalBody };
}

function summarize(html: string, finalUrl: string | null) {
  const lower = html.toLowerCase();
  return {
    finalUrlIsMemo: !!(finalUrl && /receivingmemo\.asp/i.test(finalUrl)),
    hasMemoFormMarkers:
      lower.includes("poitemid") ||
      lower.includes("memoid") ||
      lower.includes("receiving memo"),
    bodySize: html.length,
    title: (html.match(/<title>([^<]*)<\/title>/i) ?? [, null])[1],
  };
}

async function runVariant(
  label: string,
  resourceUrl: string,
  wwwJar: DomainJar,
  extraHeaders: Record<string, string>,
) {
  // Build a fresh per-variant jar so cookies don't bleed across variants,
  // but copy in the www. login cookies (resourceUrl was minted for that
  // session and we don't want to lose www. auth state).
  const variantJar: DomainJar = new Map();
  const wwwCookies = wwwJar.get("www.ateasesystems.net");
  if (wwwCookies) {
    variantJar.set("www.ateasesystems.net", new Map(wwwCookies));
  }
  const chain = await followChain(variantJar, resourceUrl, extraHeaders);
  return {
    label,
    finalUrl: chain.finalUrl,
    hops: chain.hops,
    summary: summarize(chain.finalBody, chain.finalUrl),
    jarSnapshot: {
      us: Array.from(variantJar.get("us.ateasesystems.net")?.keys() ?? []),
    },
    finalBodyPreview: chain.finalBody.slice(0, 600),
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

  const resourceUrl = await getResourceUrl(jar, poId);
  if (!resourceUrl) {
    return NextResponse.json({ step: "memostatuses", error: "no resourceUrl" });
  }

  const A = await runVariant("A-control", resourceUrl, jar, {});
  const B = await runVariant("B-browser-ua-only", resourceUrl, jar, {
    "User-Agent": BROWSER_UA,
  });
  // C uses a fresh resourceUrl since the original may have been consumed
  // by A or B if the server marks tokens one-shot.
  const resourceUrlC = (await getResourceUrl(jar, poId)) ?? resourceUrl;
  const C = await runVariant("C-full-browser-headers", resourceUrlC, jar, {
    ...BROWSER_HEADERS_FULL,
  });

  return NextResponse.json({ poId, resourceUrl, variants: [A, B, C] });
}

export async function GET(req: Request) {
  return handle(req);
}
