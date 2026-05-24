// Bridge from the `www.` web UI (where login + memostatuses live) to the
// `us.` classic-ASP UI (where the receiving memo form lives).
//
// What this solves:
//
//   1. The receiving memo writeback lives at us.ateasesystems.net, but you
//      can only get there via a one-time `LoginFromV2.asp?...&Token=XYZ`
//      URL minted by `www./api/purchaseorders/memostatuses`.
//   2. The `Token` query param is session-bound (same .ASPXAUTH ⇒ same
//      Token forever). To "rotate" we need a fresh www login.
//   3. The us. host needs a SEPARATE cookie jar (its UserID + Token
//      cookies are case-sensitive and scoped to us.).
//   4. Backend follows of LoginFromV2 get bounced unless we send
//      browser-parity headers (PR #71 round 9 variant C confirmed this).
//
// See issue #76 for the full discovery trail (probe rounds 1–11).

import {
  WebUiError,
  freshWwwLogin,
  cookieHeaderFor,
  mergeSetCookiesInto,
} from "./webui";

const WWW = "https://www.ateasesystems.net";
const US = "https://us.ateasesystems.net";

// Full browser-parity headers — round 9 variant C established that
// LoginFromV2 won't mint the us. UserID/Token cookies unless the request
// looks like a real Chrome navigation. Header values mirror the working
// probe set exactly; `Sec-Fetch-Site: "none"` (not "cross-site") is what
// round 9 actually used and is what unlocks the chain.
export const BROWSER_NAV_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua":
    '"Not_A Brand";v="8", "Chromium";v="148", "Google Chrome";v="148"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

export interface UsSession {
  jar: Map<string, string>;
  // expiresAt mirrors the existing webuiFetch 20-min cache window; us.
  // sessions appear to last at least that long in practice.
  expiresAt: number;
  // Bookkeeping for debug routes and writeback logging — which PO's
  // resourceUrl we used to acquire this session.
  bootstrapPoId: string;
}

export interface SessionTrace {
  hops: Array<{ url: string; status: number; locationHeader: string | null }>;
  wwwJarKeys: string[];
  usJarKeys: string[];
  resourceUrl: string;
  tokenSuffix: string | null;
}

interface MemoResourceInfo {
  resourceUrl: string;
  tokenSuffix: string | null;
  status: number;
  rawBody: string;
}

/**
 * Build the LoginFromV2 URL for a given PO id by hitting memostatuses.
 * Throws if the call doesn't return a usable resourceUrl. Uses the
 * caller's www. jar (don't share between calls — fresh login per session).
 */
export async function getMemoResourceUrl(
  wwwJar: Map<string, string>,
  poId: string,
): Promise<MemoResourceInfo> {
  const url = `${WWW}/api/purchaseorders/memostatuses?ids=${encodeURIComponent(poId)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Cookie: cookieHeaderFor(wwwJar),
    },
    redirect: "manual",
  });
  const body = await res.text();
  if (res.status !== 200) {
    throw new WebUiError(
      `memostatuses returned ${res.status} for poId=${poId}`,
      res.status,
      body.slice(0, 400),
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new WebUiError("memostatuses returned non-JSON body", 200, body.slice(0, 400));
  }
  const arr = (json as { receivingMemoStatuses?: Array<{ resourceUrl?: string }> })
    ?.receivingMemoStatuses;
  const resourceUrl = arr?.[0]?.resourceUrl;
  if (!resourceUrl) {
    throw new WebUiError(
      "memostatuses returned no resourceUrl",
      200,
      body.slice(0, 400),
    );
  }
  const tokenMatch = resourceUrl.match(/[?&]Token=([0-9A-F]+)/i);
  const token = tokenMatch?.[1] ?? null;
  return {
    resourceUrl,
    tokenSuffix: token ? token.slice(-12) : null,
    status: res.status,
    rawBody: body,
  };
}

/**
 * Follow the LoginFromV2 → us. redirect chain with browser-parity
 * headers, accumulating Set-Cookies into a fresh us. jar. Returns the
 * authed us. jar plus a trace of the hops for debugging.
 *
 * The chain typically looks like:
 *   1. GET www./LoginFromV2.asp?... → 302 to us./LoginFromV2.asp?...
 *   2. GET us./LoginFromV2.asp?... → 302 (sets UserID + Token cookies)
 *   3. → 302 to us./porder/receivingMemo.asp?ActionCMD=...
 *   4. GET us./porder/receivingMemo.asp → 200 (the form)
 *
 * We stop at the final 200 (or first non-redirect) and return the jar
 * with whatever us. cookies were collected. Caller can then make further
 * us. requests with the same jar.
 */
export async function chaseLoginFromV2(
  startUrl: string,
): Promise<{ jar: Map<string, string>; hops: SessionTrace["hops"] }> {
  const usJar = new Map<string, string>();
  const hops: SessionTrace["hops"] = [];
  let nextUrl: string | null = startUrl;
  let safety = 8;

  while (nextUrl && safety-- > 0) {
    const isUsHost = new URL(nextUrl).host === "us.ateasesystems.net";
    const headers: Record<string, string> = { ...BROWSER_NAV_HEADERS };
    // Only send us. cookies to us. — host-scoped, the whole point of the
    // separate jar.
    if (isUsHost && usJar.size > 0) {
      headers.Cookie = cookieHeaderFor(usJar);
    }
    const res: Response = await fetch(nextUrl, {
      headers,
      redirect: "manual",
    });
    const location = res.headers.get("location");
    hops.push({ url: nextUrl, status: res.status, locationHeader: location });

    if (isUsHost) {
      mergeSetCookiesInto(res.headers, usJar);
    }

    if (res.status >= 300 && res.status < 400 && location) {
      nextUrl = new URL(location, nextUrl).toString();
      // Drain body to free the connection.
      await res.text();
      continue;
    }
    // Final response — drain body, exit.
    await res.text();
    break;
  }

  return { jar: usJar, hops };
}

/**
 * GET the receiving memo form HTML for a PO. Caller must have already
 * established a us. session (jar holds UserID + Token cookies) via
 * `withFreshSyncoreSession` or `chaseLoginFromV2`.
 *
 * The memo URL takes ActionCMD=Edit + the POItemID list as a query
 * string. We don't yet know the canonical params — Step 2 will parse
 * the actual form to find out. For now the resourceUrl from
 * memostatuses redirects directly to the right memo page.
 */
export async function fetchMemoFormHtml(
  usJar: Map<string, string>,
  memoPath: string,
): Promise<{ status: number; html: string; finalUrl: string }> {
  const url = memoPath.startsWith("http") ? memoPath : `${US}${memoPath}`;
  const res = await fetch(url, {
    headers: {
      ...BROWSER_NAV_HEADERS,
      Cookie: cookieHeaderFor(usJar),
    },
    redirect: "follow",
  });
  const html = await res.text();
  return { status: res.status, html, finalUrl: res.url };
}

/**
 * Glue: fresh www login + memostatuses → resourceUrl → LoginFromV2 chase
 * → callback with the authed us. jar. Use this for any us.-host call.
 *
 * `bootstrapPoId` doubles as the PO whose memo resourceUrl we use to
 * mint the session AND is typically the PO the caller wants to act on,
 * so the LoginFromV2 chain lands directly on the right memo URL. Pick a
 * different PO if you need a session for a non-memo task on us.
 */
export async function withFreshSyncoreSession<T>(
  bootstrapPoId: string,
  fn: (
    us: UsSession,
    trace: { resource: MemoResourceInfo; hops: SessionTrace["hops"] },
  ) => Promise<T>,
): Promise<T> {
  const wwwJar = await freshWwwLogin();
  const resource = await getMemoResourceUrl(wwwJar, bootstrapPoId);
  const { jar, hops } = await chaseLoginFromV2(resource.resourceUrl);

  // Sanity check: a successful chase must drop both UserID and Token
  // cookies on us. Without them, subsequent us. calls will land on
  // /Login.asp?expired=1 (round 4's failure mode).
  if (!jar.has("UserID") && !jar.has("userid")) {
    throw new WebUiError(
      "LoginFromV2 chain did not set UserID cookie on us. — check BROWSER_NAV_HEADERS",
      0,
      JSON.stringify({ hops, jarKeys: Array.from(jar.keys()) }),
    );
  }

  const us: UsSession = {
    jar,
    expiresAt: Date.now() + 20 * 60 * 1000,
    bootstrapPoId,
  };
  return await fn(us, { resource, hops });
}
