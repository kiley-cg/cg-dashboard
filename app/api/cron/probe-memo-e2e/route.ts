// Round 8 — end-to-end memo discovery: www. login → memostatuses →
// LoginFromV2 → us. memo page → form parse.
//
// We've validated:
//   - Fresh inline www. login succeeds (round 7)
//   - memostatuses returns LoginFromV2 URLs (round 7)
// We have NOT validated:
//   - LoginFromV2 redirect chain unlocks us. session from our backend
//   - us./porder/receivingMemo.asp returns the actual memo form (not a login page)
//   - We can identify the form POST target + field names for future writeback
//
// us. is classic ASP (VBScript era), so a few things to keep in mind:
//   - Cookie names are case-sensitive (browser sent `UserID`, `Token` — keep
//     the casing). Different domain from www., so separate cookie jar.
//   - The LoginFromV2 resourceUrl's RequestURL uses `!` as a query separator
//     instead of `&` to dodge classic ASP's naive Request.QueryString parsing
//     of nested ampersands. The Login handler presumably swaps `!` back to
//     `&` before issuing the final redirect — but we don't have to; the
//     server redirects us to the final memo URL itself.
//   - Form POSTs in classic ASP typically go to the same .asp page that
//     rendered the form. Hidden inputs preserve state. Expect lots of
//     <input type="hidden"> we'll need to round-trip back unchanged.

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

// Per-domain cookie jar — we'll accumulate www.* cookies and us.* cookies
// separately, and only send the matching ones to each host.
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
  method: string;
  url: string;
  status: number;
  location?: string;
  setCookies: string[];
}

async function wwwLogin(jar: DomainJar): Promise<Hop[]> {
  const username = envOrThrow("SYNCORE_USERNAME");
  const password = envOrThrow("SYNCORE_PASSWORD");
  const hops: Hop[] = [];
  const loginUrl = `${WWW_BASE}/Account/Login`;

  const getRes = await fetch(loginUrl, { redirect: "manual" });
  const getSet = ingestSetCookies(jar, "www.ateasesystems.net", getRes);
  hops.push({
    i: 0,
    method: "GET",
    url: loginUrl,
    status: getRes.status,
    setCookies: getSet,
  });
  const html = await getRes.text();
  const tokenMatch =
    html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ??
    html.match(
      /<input[^>]+name="__RequestVerificationToken"[^>]+value="([^"]+)"/,
    );
  if (!tokenMatch) throw new Error("CSRF token not found");

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
  const postSet = ingestSetCookies(jar, "www.ateasesystems.net", postRes);
  hops.push({
    i: 1,
    method: "POST",
    url: loginUrl,
    status: postRes.status,
    location: postRes.headers.get("location") ?? undefined,
    setCookies: postSet,
  });

  return hops;
}

interface MemoStatus {
  purchaseOrderId: number;
  statusId: number;
  statusName: string;
  displayName: string;
  resourceUrl: string | null;
}

async function fetchMemoStatuses(
  jar: DomainJar,
  poIds: string[],
): Promise<{ status: number; statuses: MemoStatus[]; bodyPreview: string }> {
  const url = `${WWW_BASE}/api/purchaseorders/memostatuses?${poIds
    .map((id) => `ids=${encodeURIComponent(id)}`)
    .join("&")}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Cookie: jarHeader(jar, "www.ateasesystems.net"),
    },
    cache: "no-store",
    redirect: "manual",
  });
  const body = await res.text();
  let statuses: MemoStatus[] = [];
  try {
    const parsed: { receivingMemoStatuses?: MemoStatus[] } = JSON.parse(body);
    statuses = parsed.receivingMemoStatuses ?? [];
  } catch {
    /* leave empty */
  }
  return { status: res.status, statuses, bodyPreview: body.slice(0, 300) };
}

// Follow LoginFromV2 redirect chain. Tracks cookies per domain and resolves
// relative redirects against the current URL. Returns the chain + final URL.
async function followChain(
  jar: DomainJar,
  startUrl: string,
  max = 10,
): Promise<{ hops: Hop[]; finalUrl: string | null; finalStatus: number | null; finalBody: string }> {
  const hops: Hop[] = [];
  let currentUrl: URL | null = new URL(startUrl);
  let i = 0;
  let finalStatus: number | null = null;
  let finalBody = "";
  let finalUrl: string | null = null;

  while (currentUrl && i < max) {
    const host = currentUrl.hostname;
    const res: Response = await fetch(currentUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: jarHeader(jar, host),
      },
      cache: "no-store",
      redirect: "manual",
    });
    const setCookies = ingestSetCookies(jar, host, res);
    const location: string | undefined = res.headers.get("location") ?? undefined;
    hops.push({
      i,
      method: "GET",
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

    finalStatus = res.status;
    finalUrl = currentUrl.toString();
    finalBody = await res.text().catch(() => "");
    break;
  }

  return { hops, finalUrl, finalStatus, finalBody };
}

// Parse the receiving memo form HTML. We're looking for:
//   - The <form> action attribute (where the writeback POSTs)
//   - All <input> name attributes (with type/value hints) — these are the
//     hidden state fields we need to round-trip
//   - Any MemoID-shaped values
//   - Any indicator that we got a login page instead of the memo
function parseMemoForm(html: string): {
  looksLikeMemo: boolean;
  looksLikeLogin: boolean;
  formAction: string | null;
  formMethod: string | null;
  hiddenFieldCount: number;
  hiddenFieldsSample: Array<{ name: string; value: string }>;
  inputNamesSample: string[];
  title: string | null;
  bodySize: number;
} {
  const lower = html.toLowerCase();
  const looksLikeLogin =
    /\baction=["']?[^"'>]*login\.asp/i.test(html) ||
    lower.includes("name=\"username\"") ||
    lower.includes("name=\"password\"");
  const looksLikeMemo =
    /receivingmemo|receiving memo|memoid|poitemid/i.test(html) && !looksLikeLogin;

  const formMatch =
    html.match(
      /<form[^>]*\baction=["']([^"']+)["'][^>]*\bmethod=["']?(\w+)["']?/i,
    ) ??
    html.match(/<form[^>]*\bmethod=["']?(\w+)["']?[^>]*\baction=["']([^"']+)["']/i);
  let formAction: string | null = null;
  let formMethod: string | null = null;
  if (formMatch) {
    if (formMatch[1] && /^(get|post)$/i.test(formMatch[2] ?? "")) {
      formAction = formMatch[1];
      formMethod = formMatch[2];
    } else {
      formMethod = formMatch[1];
      formAction = formMatch[2] ?? null;
    }
  }

  const hiddenRegex =
    /<input[^>]+type=["']hidden["'][^>]+name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi;
  const hiddenFields: Array<{ name: string; value: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = hiddenRegex.exec(html))) {
    hiddenFields.push({ name: m[1], value: m[2].slice(0, 80) });
  }

  const inputNames = Array.from(
    html.matchAll(/<input[^>]+name=["']([^"']+)["']/gi),
    (mm) => mm[1],
  );
  const uniqueInputNames = Array.from(new Set(inputNames)).slice(0, 30);

  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);

  return {
    looksLikeMemo,
    looksLikeLogin,
    formAction,
    formMethod,
    hiddenFieldCount: hiddenFields.length,
    hiddenFieldsSample: hiddenFields.slice(0, 20),
    inputNamesSample: uniqueInputNames,
    title: titleMatch ? titleMatch[1].trim() : null,
    bodySize: html.length,
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

  // Step 1: www. login.
  let wwwLoginHops: Hop[];
  try {
    wwwLoginHops = await wwwLogin(jar);
  } catch (err) {
    return NextResponse.json({
      step: "www-login",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 2: get LoginFromV2 resourceUrl for the requested PO.
  const ms = await fetchMemoStatuses(jar, [poId]);
  const matched = ms.statuses.find((s) => String(s.purchaseOrderId) === poId);
  if (!matched || !matched.resourceUrl) {
    return NextResponse.json({
      step: "memostatuses",
      wwwLoginHops,
      memoStatusResult: ms,
      note: "no resourceUrl for requested PO",
    });
  }

  // Step 3 + 4: follow LoginFromV2 → us. memo page, gathering cookies.
  const chain = await followChain(jar, matched.resourceUrl);

  // Step 5: parse the final HTML.
  const formInfo = chain.finalBody
    ? parseMemoForm(chain.finalBody)
    : null;

  return NextResponse.json({
    poId,
    matchedStatus: {
      statusName: matched.statusName,
      statusId: matched.statusId,
      displayName: matched.displayName,
    },
    wwwLoginHops,
    memoStatusFetchStatus: ms.status,
    loginFromV2Chain: chain.hops,
    finalUrl: chain.finalUrl,
    finalStatus: chain.finalStatus,
    jarSnapshot: {
      www: Array.from(jar.get("www.ateasesystems.net")?.keys() ?? []),
      us: Array.from(jar.get("us.ateasesystems.net")?.keys() ?? []),
    },
    formInfo,
    finalBodyPreview: chain.finalBody.slice(0, 1500),
  });
}

export async function GET(req: Request) {
  return handle(req);
}
