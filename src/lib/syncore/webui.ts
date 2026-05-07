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

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");
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
  method?: "GET" | "POST";
  searchParams?: WebUiSearchParams;
  // Anything passed here is appended as data[key]=value (PHP/.NET-style).
  bracketed?: WebUiSearchParams;
  body?: unknown;
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
    };
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
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
