// Phase 4.2 probe round 3: follow the redirect chain after POSTing to
// us.ateasesystems.net/Login.asp. Round 2 showed login redirects to
// www. — we suspected us. delegates auth to www. and bounces back
// with the right cookies. This round walks the chain manually so we
// can see (a) every hop, (b) the final cookie jar, (c) whether the
// resulting session unlocks /porder/receivingMemo.asp.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const US_BASE = "https://us.ateasesystems.net";
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

interface CookieJar {
  // domain → name → value. Crude single-tenant model; we only deal with
  // two hostnames so anything more elaborate is overkill.
  byDomain: Map<string, Map<string, string>>;
}

function newJar(): CookieJar {
  return { byDomain: new Map() };
}

function ingest(jar: CookieJar, url: URL, res: Response): void {
  const host = url.hostname;
  const inner = jar.byDomain.get(host) ?? new Map<string, string>();
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) inner.set(name, value);
  }
  jar.byDomain.set(host, inner);
}

function cookieHeaderFor(jar: CookieJar, url: URL): string {
  const inner = jar.byDomain.get(url.hostname);
  if (!inner || inner.size === 0) return "";
  return Array.from(inner.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");
}

interface Hop {
  i: number;
  method: string;
  url: string;
  status: number;
  contentType?: string;
  location?: string | null;
  cookieKeysAfter: Record<string, string[]>;
}

async function followChain(
  start: URL,
  init: { method: "GET" | "POST"; body?: string; contentType?: string },
  jar: CookieJar,
  max = 8,
): Promise<{ hops: Hop[]; final: Response | null; finalUrl: URL | null }> {
  const hops: Hop[] = [];
  let nextUrl: URL | null = start;
  let nextMethod: "GET" | "POST" = init.method;
  let nextBody: string | undefined = init.body;
  let nextContentType: string | undefined = init.contentType;
  let final: Response | null = null;
  let finalUrl: URL | null = null;

  for (let i = 0; i < max && nextUrl; i++) {
    const headers: Record<string, string> = {
      Accept: "text/html,*/*",
    };
    const cookieHeader = cookieHeaderFor(jar, nextUrl);
    if (cookieHeader) headers["Cookie"] = cookieHeader;
    if (nextContentType) headers["Content-Type"] = nextContentType;

    const res: Response = await fetch(nextUrl, {
      method: nextMethod,
      headers,
      body: nextBody,
      redirect: "manual",
      cache: "no-store",
    });
    ingest(jar, nextUrl, res);

    const cookieSnapshot: Record<string, string[]> = {};
    for (const [d, m] of jar.byDomain) cookieSnapshot[d] = Array.from(m.keys());

    const loc: string | null = res.headers.get("location");
    hops.push({
      i,
      method: nextMethod,
      url: nextUrl.toString(),
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      location: loc,
      cookieKeysAfter: cookieSnapshot,
    });

    if (res.status >= 300 && res.status < 400 && loc) {
      // Drain body to free socket
      await res.text().catch(() => "");
      // Resolve relative redirects against current URL
      nextUrl = new URL(loc, nextUrl);
      // Per RFC: 302/303 convert to GET; 307/308 preserve. For our
      // ASP world everything we'll see is 302, so always GET.
      nextMethod = "GET";
      nextBody = undefined;
      nextContentType = undefined;
      continue;
    }

    final = res;
    finalUrl = nextUrl;
    break;
  }

  return { hops, final, finalUrl };
}

async function handle(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const poId = url.searchParams.get("poId") ?? "68776";

  let username: string;
  let password: string;
  try {
    username = envOrThrow("SYNCORE_USERNAME");
    password = envOrThrow("SYNCORE_PASSWORD");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const jar = newJar();

  // Phase A: POST credentials to us./Login.asp and follow wherever it
  // sends us. Hopefully it eventually drops us back on us. with
  // UserID/Token cookies.
  const loginBody = new URLSearchParams({
    UserName: username,
    Password: password,
    Login: "Login",
  }).toString();

  const loginChain = await followChain(
    new URL(`${US_BASE}/Login.asp`),
    {
      method: "POST",
      body: loginBody,
      contentType: "application/x-www-form-urlencoded",
    },
    jar,
  );

  // Phase B: with whatever session we ended up with, try the receiving
  // memo page.
  const memoUrl = new URL(
    `${US_BASE}/porder/receivingMemo.asp?ActionCMD=Edit&Corp=0&BranchID=97&PurchaseOrderID=${encodeURIComponent(poId)}`,
  );
  const memoChain = await followChain(
    memoUrl,
    { method: "GET" },
    jar,
  );

  let memoBodyPreview = "";
  let memoIdHits: string[] = [];
  let poItemHits: string[] = [];
  if (memoChain.final && memoChain.final.status === 200) {
    const text = await memoChain.final.text();
    memoBodyPreview = text.slice(0, 500);
    const memoMatches = text.match(/[Mm]emo[Ii][Dd]\s*[=:"]?\s*['"]?\d+/g);
    const itemMatches = text.match(
      /POItemID\s*=?\s*['"]?\d+|rowNo_\d+/g,
    );
    memoIdHits = memoMatches ? Array.from(new Set(memoMatches)).slice(0, 10) : [];
    poItemHits = itemMatches ? Array.from(new Set(itemMatches)).slice(0, 10) : [];
  }

  // Final cookie state per domain
  const finalCookies: Record<string, string[]> = {};
  for (const [d, m] of jar.byDomain) finalCookies[d] = Array.from(m.keys());

  return NextResponse.json({
    poId,
    finalCookies,
    loginChain: loginChain.hops,
    memoChain: memoChain.hops,
    memoFinalStatus: memoChain.final?.status,
    memoBodyPreview,
    memoIdHits,
    poItemHits,
  });
}

export async function GET(req: Request) {
  return handle(req);
}
