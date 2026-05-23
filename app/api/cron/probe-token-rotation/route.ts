// Round 11 — figure out how to mint a fresh LoginFromV2 token.
//
// Round 10 surfaced that tokens appear to be one-shot: round 9 variant C
// successfully consumed token `B392918C...`, and round 10's call to
// memostatuses returned that same dead token back, causing LoginFromV2
// to bounce.
//
// This probe tests three rotation strategies:
//   1. Cache-bust query params (timestamp, random ID)
//   2. Cache-bust request headers (Cache-Control, Pragma)
//   3. Time delay between calls
//
// For each call, we capture:
//   - The Token from the resourceUrl
//   - All response headers (including Cache-Control / ETag / Vary —
//     hints about whether the response is cached upstream or per-user)
//   - The full response body
//
// If any strategy returns a new Token, that's our lever.
// If all return the same Token, we know rotation requires a different
// trigger (maybe consuming the old one in a "burn" LoginFromV2 call).

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

interface CookieJar {
  cookies: Map<string, string>;
}

function ingestSetCookies(jar: CookieJar, res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) jar.cookies.set(name, value);
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.cookies.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");
}

async function wwwLogin(): Promise<CookieJar> {
  const username = envOrThrow("SYNCORE_USERNAME");
  const password = envOrThrow("SYNCORE_PASSWORD");
  const jar: CookieJar = { cookies: new Map() };
  const loginUrl = `${WWW_BASE}/Account/Login`;
  const getRes = await fetch(loginUrl, { redirect: "manual" });
  ingestSetCookies(jar, getRes);
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
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({
      Email: username,
      Password: password,
      __RequestVerificationToken: tokenMatch[1],
    }).toString(),
    redirect: "manual",
  });
  ingestSetCookies(jar, postRes);
  return jar;
}

interface MemoCall {
  label: string;
  url: string;
  requestHeaders: Record<string, string>;
  status: number;
  responseHeaders: Record<string, string>;
  tokenExtracted: string | null;
  tokenSuffix: string | null;
  bodyPreview: string;
  durationMs: number;
}

async function callMemoStatuses(
  jar: CookieJar,
  label: string,
  poId: string,
  init: { extraQuery?: string; headers?: Record<string, string> },
): Promise<MemoCall> {
  const sep = init.extraQuery ? "&" : "";
  const url =
    `${WWW_BASE}/api/purchaseorders/memostatuses?ids=${encodeURIComponent(poId)}` +
    `${sep}${init.extraQuery ?? ""}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Cookie: cookieHeader(jar),
    ...(init.headers ?? {}),
  };
  const started = Date.now();
  const res = await fetch(url, {
    headers,
    cache: "no-store",
    redirect: "manual",
  });
  const body = await res.text();
  const durationMs = Date.now() - started;

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  const tokenMatch = body.match(/Token=([0-9A-F]{128})/);
  const token = tokenMatch ? tokenMatch[1] : null;

  return {
    label,
    url,
    requestHeaders: headers,
    status: res.status,
    responseHeaders,
    tokenExtracted: token,
    tokenSuffix: token ? token.slice(-12) : null,
    bodyPreview: body.slice(0, 350),
    durationMs,
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

  let jar: CookieJar;
  try {
    jar = await wwwLogin();
  } catch (err) {
    return NextResponse.json({
      step: "login",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Run sequentially so we can observe whether the token rotates between
  // calls (parallel calls might race and obscure the pattern).
  const calls: MemoCall[] = [];

  // 1. Baseline.
  calls.push(await callMemoStatuses(jar, "1-baseline", poId, {}));

  // 2. Cache-bust via query param.
  calls.push(
    await callMemoStatuses(jar, "2-querybust", poId, {
      extraQuery: `_t=${Date.now()}`,
    }),
  );

  // 3. Cache-bust via Cache-Control header.
  calls.push(
    await callMemoStatuses(jar, "3-cache-control", poId, {
      headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
    }),
  );

  // 4. Cache-bust via Pragma: no-cache (HTTP/1.0-style).
  calls.push(
    await callMemoStatuses(jar, "4-pragma", poId, {
      headers: { Pragma: "no-cache" },
    }),
  );

  // 5. Different PO ID (still the same UserID — does token rotate per PO?).
  calls.push(await callMemoStatuses(jar, "5-different-po", "68610", {}));

  // 6. After a 2-second delay.
  await new Promise((r) => setTimeout(r, 2000));
  calls.push(await callMemoStatuses(jar, "6-after-delay", poId, {}));

  // 7. With browser-style headers in case server fingerprints us.
  calls.push(
    await callMemoStatuses(jar, "7-browser-headers", poId, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        Referer: `${WWW_BASE}/Job/Details/32616`,
      },
    }),
  );

  // Compute summary: unique token count.
  const uniqueTokens = new Set(
    calls
      .map((c) => c.tokenExtracted)
      .filter((t): t is string => t !== null),
  );

  return NextResponse.json({
    poId,
    callCount: calls.length,
    uniqueTokenCount: uniqueTokens.size,
    uniqueTokenSuffixes: Array.from(uniqueTokens).map((t) => t.slice(-12)),
    interpretation:
      uniqueTokens.size === 1
        ? "Server returned the same Token for all calls — cache-bust does not force rotation. Token rotation requires a different trigger (likely actual consumption via LoginFromV2)."
        : `Server returned ${uniqueTokens.size} distinct tokens across ${calls.length} calls — one of the rotation strategies works. Compare the per-call results to find which.`,
    calls,
  });
}

export async function GET(req: Request) {
  return handle(req);
}
