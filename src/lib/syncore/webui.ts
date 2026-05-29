// Syncore web-UI scraper.
//
// Job Follow-Ups (and Job Tracker, etc.) are not exposed by Syncore's v2
// REST API at api.syncore.app. They live only behind the authenticated web
// UI at ateasesystems.net. This module logs in with username + password,
// caches the session cookie, and exposes a generic `webuiFetch` for the
// internal AJAX endpoints those pages use.
//
// Pattern ported from kiley-cg/client-pickup-scan/src/lib/syncore/webui.ts.

const WEB_BASE = "https://www.ateasesystems.net";
const SESSION_TTL_MS = 20 * 60 * 1000;

export class WebUiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "WebUiError";
  }
}

interface Session {
  cookie: string;
  expiresAt: number;
}

let cachedSession: Session | null = null;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new WebUiError(`Missing env: ${name}`);
  return v;
}

function mergeSetCookies(headers: Headers, jar: Map<string, string>): void {
  for (const raw of headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) jar.set(name, value);
  }
}

// Exported building block for us-session.ts and other callers that need
// to maintain their own per-host cookie jar (vs the module-level cached
// www. session).
export function mergeSetCookiesInto(
  headers: Headers,
  jar: Map<string, string>,
): void {
  mergeSetCookies(headers, jar);
}

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");
}

export function cookieHeaderFor(jar: Map<string, string>): string {
  return cookieHeader(jar);
}

async function login(): Promise<Session> {
  const username = env("SYNCORE_USERNAME");
  const password = env("SYNCORE_PASSWORD");

  const loginUrl = `${WEB_BASE}/Account/Login`;
  const jar = new Map<string, string>();

  const getRes = await fetch(loginUrl, { redirect: "manual" });
  mergeSetCookies(getRes.headers, jar);
  const html = await getRes.text();

  const tokenMatch =
    html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ||
    html.match(
      /<input[^>]+name="__RequestVerificationToken"[^>]+value="([^"]+)"/,
    );
  if (!tokenMatch) {
    throw new WebUiError("Could not find CSRF token on Syncore login page");
  }
  const csrfToken = tokenMatch[1];

  const body = new URLSearchParams({
    Email: username,
    Password: password,
    __RequestVerificationToken: csrfToken,
  });

  const postRes = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: body.toString(),
    redirect: "manual",
  });
  mergeSetCookies(postRes.headers, jar);

  const location = postRes.headers.get("location") ?? "";
  if (
    postRes.status === 200 &&
    (await postRes.text()).includes("Account/Login")
  ) {
    throw new WebUiError(
      "Syncore login rejected — check SYNCORE_USERNAME / SYNCORE_PASSWORD",
    );
  }
  if (
    location.includes("/Account/Login") ||
    location.includes("/Account/Two") ||
    location.includes("/Account/Verify")
  ) {
    throw new WebUiError("Syncore login blocked (bad creds or MFA)");
  }

  return {
    cookie: cookieHeader(jar),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

/**
 * Like `login()` but exposes the cookie jar (Map) instead of a joined
 * string, and does NOT populate the module-level cache. Use this when
 * you need a guaranteed-fresh .ASPXAUTH (e.g. to force Token rotation
 * for a us. session — see us-session.ts).
 *
 * Each call is one full login round-trip (GET + POST). Don't loop this
 * tightly; reuse the returned jar within a single transaction.
 */
export async function freshWwwLogin(): Promise<Map<string, string>> {
  const username = env("SYNCORE_USERNAME");
  const password = env("SYNCORE_PASSWORD");

  const loginUrl = `${WEB_BASE}/Account/Login`;
  const jar = new Map<string, string>();

  const getRes = await fetch(loginUrl, { redirect: "manual" });
  mergeSetCookies(getRes.headers, jar);
  const html = await getRes.text();

  const tokenMatch =
    html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ||
    html.match(
      /<input[^>]+name="__RequestVerificationToken"[^>]+value="([^"]+)"/,
    );
  if (!tokenMatch) {
    throw new WebUiError("Could not find CSRF token on Syncore login page");
  }

  const body = new URLSearchParams({
    Email: username,
    Password: password,
    __RequestVerificationToken: tokenMatch[1],
  });

  const postRes = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: body.toString(),
    redirect: "manual",
  });
  mergeSetCookies(postRes.headers, jar);

  const location = postRes.headers.get("location") ?? "";
  if (
    postRes.status === 200 &&
    (await postRes.text()).includes("Account/Login")
  ) {
    throw new WebUiError(
      "Syncore login rejected — check SYNCORE_USERNAME / SYNCORE_PASSWORD",
    );
  }
  if (
    location.includes("/Account/Login") ||
    location.includes("/Account/Two") ||
    location.includes("/Account/Verify")
  ) {
    throw new WebUiError("Syncore login blocked (bad creds or MFA)");
  }

  return jar;
}

async function getSession(forceFresh = false): Promise<Session> {
  if (
    !forceFresh &&
    cachedSession &&
    cachedSession.expiresAt > Date.now() + 60_000
  ) {
    return cachedSession;
  }
  cachedSession = await login();
  return cachedSession;
}

// --- Search-params builder -------------------------------------------------
//
// Two flavours of param style live behind ateasesystems.net AJAX routes:
//
//   /api/followups/jobs/statistics?customerServiceRepId=13379&...
//   /api/followups/jobs?data[customerServiceRepId]=13379&...
//
// `searchParams` is the flat shape; `bracketed` is the nested-object shape
// that gets serialized as data[key]=value. Both can be used together.

export type WebUiSearchParams = Record<
  string,
  string | number | boolean | undefined | null
>;

function appendParams(
  url: URL,
  params: WebUiSearchParams | undefined,
  prefix?: (key: string) => string,
): void {
  if (!params) return;
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? prefix(k) : k;
    url.searchParams.set(key, String(v));
  }
}

export interface WebUiFetchInit {
  method?: "GET" | "POST" | "PATCH";
  searchParams?: WebUiSearchParams;
  // Anything passed here is appended as data[key]=value (PHP/.NET-style).
  bracketed?: WebUiSearchParams;
  body?: unknown;
  // application/x-www-form-urlencoded body. Mutually exclusive with `body`
  // (which JSON-encodes). Some Syncore endpoints (Job/AddTrackerEntryAsync,
  // legacy ASP.NET MVC AJAX actions) only accept form-encoded.
  formBody?: Record<string, string | number | boolean>;
  // Pre-built request body for endpoints that need things formBody can't
  // express — like ASP.NET's repeated-key array params (Name[]=a&Name[]=b).
  // When set, Content-Type defaults to form-urlencoded; override with
  // contentType.
  rawBody?: string;
  contentType?: string;
  // Override the default Referer. Some Syncore endpoints check Origin/Referer.
  referer?: string;
}

export async function webuiFetch<T = unknown>(
  path: string,
  init: WebUiFetchInit = {},
): Promise<T> {
  const url = new URL(`${WEB_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  appendParams(url, init.searchParams);
  appendParams(url, init.bracketed, (k) => `data[${k}]`);

  const exec = async (session: Session): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: session.cookie,
      Origin: WEB_BASE,
    };
    if (init.referer) headers["Referer"] = init.referer;

    let bodyStr: string | undefined;
    if (init.rawBody !== undefined) {
      bodyStr = init.rawBody;
      headers["Content-Type"] =
        init.contentType ?? "application/x-www-form-urlencoded; charset=UTF-8";
    } else if (init.formBody !== undefined) {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(init.formBody)) {
        usp.append(k, String(v));
      }
      bodyStr = usp.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    } else if (init.body !== undefined) {
      bodyStr = JSON.stringify(init.body);
      headers["Content-Type"] = "application/json";
    }

    return fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: bodyStr,
      cache: "no-store",
      redirect: "manual",
    });
  };

  let session = await getSession();
  let res = await exec(session);

  // An HTML response (or any non-2xx redirect to /Account/Login) means our
  // session expired between calls. Drop the cache, re-auth, retry once.
  let ct = res.headers.get("content-type") ?? "";
  if (!res.ok || ct.includes("text/html")) {
    cachedSession = null;
    session = await getSession(true);
    res = await exec(session);
    ct = res.headers.get("content-type") ?? "";
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => undefined);
    }
    throw new WebUiError(
      `Syncore web ${init.method ?? "GET"} ${path} failed: ${res.status}`,
      res.status,
      body,
    );
  }

  if (ct.includes("text/html")) {
    const sample = (await res.text().catch(() => "")).slice(0, 200);
    throw new WebUiError(
      `Syncore web ${path} returned HTML (session likely invalid): ${sample}`,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface WebUiRawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// Probe-only escape hatch: runs an authenticated request through the cached
// session and returns the raw status/headers/body without parsing or retry
// logic. Use this for endpoint discovery (OPTIONS, unusual methods,
// inspecting Allow headers); production code should use `webuiFetch`.
export async function webuiFetchRaw(
  path: string,
  init: {
    method?: string;
    searchParams?: WebUiSearchParams;
    // Probes need to experiment with the exact header set Syncore expects.
    // `headers` overrides the defaults; pass an empty value to delete a
    // default header.
    headers?: Record<string, string | undefined>;
  } = {},
): Promise<WebUiRawResponse> {
  const url = new URL(`${WEB_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  appendParams(url, init.searchParams);

  const session = await getSession();
  const defaultHeaders: Record<string, string> = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Cookie: session.cookie,
  };
  if (init.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      if (v === undefined || v === "") {
        delete defaultHeaders[k];
      } else {
        defaultHeaders[k] = v;
      }
    }
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: defaultHeaders,
    cache: "no-store",
    redirect: "manual",
  });

  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const body = await res.text().catch(() => "");
  return { status: res.status, headers, body };
}

// ---------------------------------------------------------------------------
// Job Tracker entries (Syncore's per-job audit log)
// ---------------------------------------------------------------------------

/**
 * Job Log entry color codes observed in Syncore's UI:
 *   0 = gray   — system messages (status changes, file attachments)
 *   1 = orange — production/tracking notes (this is what users pick for
 *                tracking-related entries; the auto UPS Tracking Import
 *                rows are also color 1)
 *   2 = green  — accounting / invoice rows
 *   4 = purple — CSR comments / instructions
 * Default to 1 for tracking entries.
 */
export const JOB_LOG_COLOR = {
  gray: 0,
  orange: 1,
  green: 2,
  purple: 4,
} as const;

export interface AddJobTrackerEntryResult {
  Result: boolean;
  Message: string;
}

/**
 * Append an entry to a Syncore job's Job Log (the per-job audit feed
 * everyone at CG looks at). Endpoint discovered from HAR capture; see
 * docs/syncore-us-writeback.md for the broader Syncore integration notes.
 *
 * Returns true on success. Throws on auth / network failure.
 */
export async function addJobTrackerEntry(args: {
  jobId: string | number;
  description: string;
  color?: number;
}): Promise<boolean> {
  const jobId = String(args.jobId);
  const result = await webuiFetch<AddJobTrackerEntryResult>(
    "/Job/AddTrackerEntryAsync",
    {
      method: "POST",
      formBody: {
        JobId: jobId,
        TextColor: args.color ?? JOB_LOG_COLOR.orange,
        Description: args.description,
      },
      referer: `${WEB_BASE}/Job/Details/${jobId}`,
    },
  );
  return result?.Result === true;
}

/**
 * Post a Job Tracker entry that ALSO emails the listed recipients.
 * Different endpoint from addJobTrackerEntry (silent log only) — this
 * one fires Syncore's native notification flow.
 *
 * Request shape captured from a real HAR (Kiley 2026-05-25):
 *   POST /Job/SendTrackerAsync
 *   Body: Id=<jobId>&RecipientIds[]=<userId>&Priority=0&NoteColor=5&Notes=<body>
 * Response: { Result: true, Message: "" }
 *
 * Returns true on success. Throws on auth / network failure.
 */
export async function sendJobTrackerEntry(args: {
  jobId: string | number;
  recipientUserIds: number[];
  notes: string;
  priority?: number; // 0 = normal, defaults to 0
  noteColor?: number; // 5 = blue per the HAR; matches the in-UI color picker
}): Promise<boolean> {
  if (args.recipientUserIds.length === 0) {
    throw new WebUiError("sendJobTrackerEntry requires at least one recipient");
  }
  const jobId = String(args.jobId);

  // ASP.NET model binder expects RepeatedParam[] = value for each id —
  // build the form body manually so the [] suffix survives the
  // serializer. webuiFetch's formBody assumes string→string, which
  // won't repeat keys.
  const params = new URLSearchParams();
  params.set("Id", jobId);
  for (const uid of args.recipientUserIds) {
    params.append("RecipientIds[]", String(uid));
  }
  params.set("Priority", String(args.priority ?? 0));
  params.set("NoteColor", String(args.noteColor ?? 5));
  params.set("Notes", args.notes);

  const result = await webuiFetch<AddJobTrackerEntryResult>(
    "/Job/SendTrackerAsync",
    {
      method: "POST",
      rawBody: params.toString(),
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
      referer: `${WEB_BASE}/Job/Details/${jobId}`,
    },
  );
  return result?.Result === true;
}
