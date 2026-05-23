// Round 7 — test whether webuiFetch's login is incomplete.
//
// webuiFetch's login() does POST /Account/Login and stops. It doesn't
// follow the 302 redirect that the browser follows to complete the
// session. The browser's post-login GET / may set additional auth
// cookies (renewed auth ticket, ASPSESSION variants) that endpoints
// like /api/purchaseorders/memostatuses require — explaining why we
// 500 on memostatuses but 200 on /api/followups/jobs/* (which presumably
// only checks for the simpler cookie set webuiFetch already has).
//
// This probe runs the login inline (no mutation to production webui.ts),
// optionally follows the post-login redirect chain accumulating all
// Set-Cookie, then hits memostatuses and followups for comparison.
//
// If the "follow redirects" variant returns 200 on memostatuses where
// the "don't follow" variant 500s, we patch webui.ts in a follow-up.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WEB_BASE = "https://www.ateasesystems.net";

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

function mergeSetCookies(headers: Headers, jar: Map<string, string>): string[] {
  const added: string[] = [];
  for (const raw of headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) {
      jar.set(name, value);
      added.push(name);
    }
  }
  return added;
}

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");
}

interface Hop {
  i: number;
  method: string;
  url: string;
  status: number;
  location?: string;
  setCookies: string[];
  jarKeys: string[];
}

async function login(opts: { followRedirects: boolean }): Promise<{
  jar: Map<string, string>;
  hops: Hop[];
  error?: string;
}> {
  const username = envOrThrow("SYNCORE_USERNAME");
  const password = envOrThrow("SYNCORE_PASSWORD");
  const jar = new Map<string, string>();
  const hops: Hop[] = [];

  const loginUrl = `${WEB_BASE}/Account/Login`;

  // Step 1: GET /Account/Login → CSRF + initial cookies
  const getRes = await fetch(loginUrl, { redirect: "manual" });
  const getSet = mergeSetCookies(getRes.headers, jar);
  hops.push({
    i: 0,
    method: "GET",
    url: loginUrl,
    status: getRes.status,
    setCookies: getSet,
    jarKeys: Array.from(jar.keys()),
  });
  const html = await getRes.text();
  const tokenMatch =
    html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ??
    html.match(
      /<input[^>]+name="__RequestVerificationToken"[^>]+value="([^"]+)"/,
    );
  if (!tokenMatch) {
    return { jar, hops, error: "CSRF token not found on login GET" };
  }
  const csrf = tokenMatch[1];

  // Step 2: POST /Account/Login with credentials.
  const postBody = new URLSearchParams({
    Email: username,
    Password: password,
    __RequestVerificationToken: csrf,
  }).toString();

  let res = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: postBody,
    redirect: "manual",
  });
  let setCookies = mergeSetCookies(res.headers, jar);
  let location = res.headers.get("location") ?? undefined;
  hops.push({
    i: 1,
    method: "POST",
    url: loginUrl,
    status: res.status,
    location,
    setCookies,
    jarKeys: Array.from(jar.keys()),
  });

  // Step 3: optionally follow the redirect chain so we accumulate any
  // post-login cookies the server sets when loading the landing page.
  if (opts.followRedirects) {
    let currentUrl: URL | null =
      res.status >= 300 && res.status < 400 && location
        ? new URL(location, WEB_BASE)
        : null;
    let i = 2;
    while (currentUrl && i < 10) {
      res = await fetch(currentUrl, {
        method: "GET",
        headers: { Cookie: cookieHeader(jar) },
        redirect: "manual",
      });
      setCookies = mergeSetCookies(res.headers, jar);
      location = res.headers.get("location") ?? undefined;
      hops.push({
        i,
        method: "GET",
        url: currentUrl.toString(),
        status: res.status,
        location,
        setCookies,
        jarKeys: Array.from(jar.keys()),
      });
      await res.text().catch(() => "");
      if (res.status >= 300 && res.status < 400 && location) {
        currentUrl = new URL(location, currentUrl);
        i++;
        continue;
      }
      break;
    }
  }

  return { jar, hops };
}

interface Probe {
  label: string;
  status?: number;
  contentType?: string;
  bodyPreview?: string;
  error?: string;
}

async function probe(
  label: string,
  url: string,
  jar: Map<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<Probe> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader(jar),
        ...extraHeaders,
      },
      cache: "no-store",
      redirect: "manual",
    });
    const body = await res.text().catch(() => "");
    return {
      label,
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      bodyPreview: body.slice(0, 400),
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
  const poIdsParam = url.searchParams.get("poIds") ?? "68609,68610";
  const poIds = poIdsParam.split(",").filter(Boolean);
  const memoStatusUrl = `${WEB_BASE}/api/purchaseorders/memostatuses?${poIds
    .map((id) => `ids=${encodeURIComponent(id)}`)
    .join("&")}`;
  const followupsUrl = `${WEB_BASE}/api/followups/jobs/statistics`;

  // Variant A: stock webuiFetch behavior (don't follow redirects).
  const A = await login({ followRedirects: false });
  const aMemo = await probe("A-memostatuses", memoStatusUrl, A.jar);
  const aFollowups = await probe("A-followups", followupsUrl, A.jar);

  // Variant B: follow post-login redirects to accumulate full cookie jar.
  const B = await login({ followRedirects: true });
  const bMemo = await probe("B-memostatuses", memoStatusUrl, B.jar);
  const bFollowups = await probe("B-followups", followupsUrl, B.jar);

  return NextResponse.json({
    poIds,
    variantA_noFollow: {
      hops: A.hops,
      jarKeys: Array.from(A.jar.keys()),
      probes: [aMemo, aFollowups],
    },
    variantB_followRedirects: {
      hops: B.hops,
      jarKeys: Array.from(B.jar.keys()),
      probes: [bMemo, bFollowups],
    },
  });
}

export async function GET(req: Request) {
  return handle(req);
}
