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
 * Extract the actual memo URL from a LoginFromV2 resourceUrl's
 * `RequestURL` query param. Syncore encodes that target with '!' as the
 * parameter separator (e.g. `ActionCMD=Edit!Corp=0!BranchID=97!...`)
 * instead of '&'; we translate back so it's a real query string.
 *
 * Following the chain to the memo URL drops the `pg=` target around
 * hop 4 and lands on the index.asp frameset (round 8/10 wall). The way
 * forward is: use the chain only to mint UserID + Token cookies, then
 * GET this URL directly.
 */
export function memoUrlFromResource(resourceUrl: string): string | null {
  const u = new URL(resourceUrl);
  const requestUrl = u.searchParams.get("RequestURL");
  if (!requestUrl) return null;
  const normalized = requestUrl.replace(/!/g, "&");
  return normalized.startsWith("http") ? normalized : `${US}${normalized}`;
}

/**
 * GET the receiving memo form HTML for a PO. Caller must have already
 * established a us. session (jar holds UserID + Token cookies) via
 * `withFreshSyncoreSession` or `chaseLoginFromV2`. Pass the URL from
 * `memoUrlFromResource` — fetching the bare LoginFromV2 resourceUrl
 * here would redirect through the chain again and land on the frameset.
 */
export async function fetchMemoFormHtml(
  usJar: Map<string, string>,
  memoUrl: string,
): Promise<{ status: number; html: string; finalUrl: string }> {
  const res = await fetch(memoUrl, {
    headers: {
      ...BROWSER_NAV_HEADERS,
      Cookie: cookieHeaderFor(usJar),
    },
    redirect: "follow",
  });
  const html = await res.text();
  return { status: res.status, html, finalUrl: res.url };
}

// ---------------------------------------------------------------------------
// Form snapshot + POST (Step 2)
// ---------------------------------------------------------------------------

export interface FormSnapshot {
  /** Absolute URL of the form's action attribute. */
  action: string;
  /** Always "POST" — the only method Syncore's classic-ASP forms use. */
  method: string;
  /**
   * URL-encodable body of the form as it would submit unchanged. Repeats
   * for fields with the same name (e.g. POItemID appears once per row).
   * Pass through `overrides` in `postFormSnapshot` to mutate values.
   */
  fields: URLSearchParams;
}

function parseSelectedOption(selectInnerHtml: string): string {
  // First try: option with selected attr
  const sel = selectInnerHtml.match(
    /<option\b[^>]*\bselected\b[^>]*?\bvalue\s*=\s*["']([^"']*)["']/i,
  );
  if (sel) return sel[1];
  // Fallback: first option's value
  const first = selectInnerHtml.match(
    /<option\b[^>]*\bvalue\s*=\s*["']([^"']*)["']/i,
  );
  return first?.[1] ?? "";
}

/**
 * Capture the current form state as a URLSearchParams body. Defaults to
 * targeting the named form `rmAdd` (the receiving memo's real form);
 * pass `formName` for other us. pages.
 *
 * What we capture:
 *  - All `<input>` tags: name + value, EXCEPT submit/button/image inputs
 *    (browsers only include the clicked submit's name/value, not all of them)
 *  - Checkboxes: only included if `checked` attr is present (none are by default)
 *  - Selects: the `<option selected>` value, or the first option as fallback
 *  - Textareas: the text content between tags
 */
export function parseFormSnapshot(
  html: string,
  opts: { formName?: string; formIndex?: number } = {},
): FormSnapshot {
  // Find the target form's full HTML by scanning for `<form ...>...</form>`.
  const formRx = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let target: { attrs: string; inner: string } | null = null;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = formRx.exec(html)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const hasAction = /\baction\s*=/i.test(attrs);
    if (opts.formName) {
      if (new RegExp(`\\bname\\s*=\\s*["']${opts.formName}["']`, "i").test(attrs)) {
        target = { attrs, inner };
        break;
      }
    } else if (opts.formIndex != null) {
      if (idx === opts.formIndex) {
        target = { attrs, inner };
        break;
      }
    } else if (hasAction && target == null) {
      // Default: first form with a non-empty action — that's the real one.
      target = { attrs, inner };
      break;
    }
    idx++;
  }
  if (!target) {
    throw new Error("parseFormSnapshot: no matching form found");
  }

  const actionAttr =
    target.attrs.match(/\baction\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
  const methodAttr =
    target.attrs.match(/\bmethod\s*=\s*["']([^"']+)["']/i)?.[1] ?? "post";
  // Resolve relative actions against the memo's us. host.
  const action = actionAttr.startsWith("http")
    ? actionAttr
    : `${US}/porder/${actionAttr.replace(/^\/+/, "")}`;

  const fields = new URLSearchParams();

  // 1. Inputs — every <input ...> in form scope.
  for (const inp of target.inner.matchAll(/<input\b([^>]*)>/gi)) {
    const tagAttrs = inp[1];
    const name = tagAttrs.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    const type =
      tagAttrs.match(/\btype\s*=\s*["']([^"']*)["']/i)?.[1]?.toLowerCase() ??
      "text";
    if (!name) continue;
    if (type === "submit" || type === "button" || type === "image" || type === "reset") {
      continue;
    }
    if (type === "checkbox" || type === "radio") {
      // Only included when checked. Default state has no `checked` attr.
      if (!/\bchecked\b/i.test(tagAttrs)) continue;
    }
    const value = tagAttrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    fields.append(name, value);
  }

  // 2. Selects — find selected option, fallback to first option.
  for (const sel of target.inner.matchAll(
    /<select\b([^>]*)>([\s\S]*?)<\/select>/gi,
  )) {
    const selAttrs = sel[1];
    const inner = sel[2];
    const name = selAttrs.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    fields.append(name, parseSelectedOption(inner));
  }

  // 3. Textareas — body content (HTML-decoded basics only — Syncore's
  //    classic ASP doesn't HTML-encode <textarea> content as far as
  //    we've seen, so a pass-through is fine for round-trip).
  for (const ta of target.inner.matchAll(
    /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi,
  )) {
    const taAttrs = ta[1];
    const inner = ta[2];
    const name = taAttrs.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    fields.append(name, inner);
  }

  return { action, method: methodAttr.toUpperCase(), fields };
}

export interface PostResult {
  /** HTTP status of the POST response. */
  status: number;
  /** Final URL after any redirects (Syncore typically renders the memo again). */
  finalUrl: string;
  /** First 1000 chars of the response body for inspection. */
  bodyPreview: string;
  /** The URL-encoded body we sent (or would have sent in dryRun). */
  sentBody: string;
  /** When dryRun=true, no network call was made. */
  dryRun: boolean;
}

/**
 * POST a form snapshot back to its action URL. Default is **dry run** —
 * no network call, returns the body that *would* be sent. Pass
 * `{ live: true }` to actually fire it. Always dry-run when in doubt;
 * Syncore's memo POST is destructive (it writes to received-qty fields).
 *
 * `overrides` mutates fields by name:
 *   - string  → replace all existing values for that name
 *   - string[] → replace + use multiple values (for `updPOList`-style fields)
 *   - null → delete the field entirely
 *
 * To mark a PO line item for update on the receiving memo, the browser
 * checks the `updPOList` checkbox for that item — equivalent here is
 * `overrides: { updPOList: ["176629842", "176629845"] }` (one entry
 * per item to update).
 */
export async function postFormSnapshot(
  usJar: Map<string, string>,
  snapshot: FormSnapshot,
  overrides: Record<string, string | string[] | null> = {},
  opts: { live?: boolean; referer?: string } = {},
): Promise<PostResult> {
  const body = new URLSearchParams();
  for (const [k, v] of snapshot.fields) body.append(k, v);
  for (const [k, v] of Object.entries(overrides)) {
    // Clear existing entries for this key
    body.delete(k);
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const x of v) body.append(k, x);
    } else {
      body.append(k, v);
    }
  }
  const sentBody = body.toString();

  if (!opts.live) {
    return {
      status: 0,
      finalUrl: snapshot.action,
      bodyPreview: "(dry run — no request sent)",
      sentBody,
      dryRun: true,
    };
  }

  const res = await fetch(snapshot.action, {
    method: "POST",
    headers: {
      ...BROWSER_NAV_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeaderFor(usJar),
      ...(opts.referer ? { Referer: opts.referer } : {}),
    },
    body: sentBody,
    redirect: "follow",
  });
  const respHtml = await res.text();
  return {
    status: res.status,
    finalUrl: res.url,
    bodyPreview: respHtml.slice(0, 1000),
    sentBody,
    dryRun: false,
  };
}

interface AttemptLog {
  attempt: number;
  tokenSuffix: string | null;
  jarKeys: string[];
  outcome: "ok" | "dead-token" | "error";
  errorMessage?: string;
}

export interface SessionResult {
  resource: MemoResourceInfo;
  hops: SessionTrace["hops"];
  attempts: AttemptLog[];
}

/**
 * Glue: fresh www login + memostatuses → resourceUrl → LoginFromV2 chase
 * → callback with the authed us. jar. Use this for any us.-host call.
 *
 * Token-dead retry (option B from May 24 session decision):
 *
 *   Syncore mints a fresh Token only on its own (probably time-based)
 *   cadence — rapid back-to-back logins return the same Token, and once
 *   consumed by a successful chain it's dead. On a dead-token attempt
 *   we wait + fresh-login again, hoping Syncore has rotated by then.
 *
 *   Default 3 attempts with 0/3/8 second backoffs. Each attempt does
 *   a full fresh-login → memostatuses → chase so we're not reusing
 *   anything across retries.
 *
 * `bootstrapPoId` doubles as the PO whose memo resourceUrl we use to
 * mint the session AND is typically the PO the caller wants to act on,
 * so the LoginFromV2 chain lands directly on the right memo URL. Pick a
 * different PO if you need a session for a non-memo task on us.
 */
export async function withFreshSyncoreSession<T>(
  bootstrapPoId: string,
  fn: (us: UsSession, trace: SessionResult) => Promise<T>,
  opts: { maxAttempts?: number; backoffsMs?: number[] } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffsMs = opts.backoffsMs ?? [0, 3000, 8000];
  const attempts: AttemptLog[] = [];
  let lastResource: MemoResourceInfo | null = null;
  let lastHops: SessionTrace["hops"] = [];

  for (let i = 0; i < maxAttempts; i++) {
    const wait = backoffsMs[i] ?? backoffsMs[backoffsMs.length - 1] ?? 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    let resource: MemoResourceInfo;
    let chase: { jar: Map<string, string>; hops: SessionTrace["hops"] };
    try {
      const wwwJar = await freshWwwLogin();
      resource = await getMemoResourceUrl(wwwJar, bootstrapPoId);
      chase = await chaseLoginFromV2(resource.resourceUrl);
    } catch (err) {
      attempts.push({
        attempt: i + 1,
        tokenSuffix: null,
        jarKeys: [],
        outcome: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      if (i === maxAttempts - 1) throw err;
      continue;
    }

    lastResource = resource;
    lastHops = chase.hops;
    const jarKeys = Array.from(chase.jar.keys());
    const hasUserId = chase.jar.has("UserID") || chase.jar.has("userid");

    if (hasUserId) {
      attempts.push({
        attempt: i + 1,
        tokenSuffix: resource.tokenSuffix,
        jarKeys,
        outcome: "ok",
      });
      const us: UsSession = {
        jar: chase.jar,
        expiresAt: Date.now() + 20 * 60 * 1000,
        bootstrapPoId,
      };
      return await fn(us, { resource, hops: chase.hops, attempts });
    }

    attempts.push({
      attempt: i + 1,
      tokenSuffix: resource.tokenSuffix,
      jarKeys,
      outcome: "dead-token",
    });
  }

  throw new WebUiError(
    `LoginFromV2 chain did not set UserID cookie after ${maxAttempts} attempts — Syncore Token rotation hasn't happened in window`,
    0,
    JSON.stringify({ attempts, lastHops, lastTokenSuffix: lastResource?.tokenSuffix ?? null }),
  );
}
