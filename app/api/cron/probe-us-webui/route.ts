// Probe for Phase 4.2: can we authenticate to us.ateasesystems.net with
// the same credentials we use for www., and if so what does the receiving
// memo page give us for a known PO?
//
// Three things this checks:
//   1. GET us.ateasesystems.net/Account/Login — does the same CSRF form
//      live there?
//   2. POST creds against that login — does it accept SYNCORE_USERNAME /
//      SYNCORE_PASSWORD or does it require the v2->v1 LoginFromV2.asp
//      bridge?
//   3. With cookies in hand, GET /porder/receivingMemo.asp?PurchaseOrderID
//      — does it auto-resolve MemoId, redirect to a list, or 404?
//
// Gated on CRON_SECRET. Temporary — will be deleted once we land the
// real receiving-memo writeback.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const US_BASE = "https://us.ateasesystems.net";

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

interface ProbeStep {
  label: string;
  url: string;
  method: string;
  status?: number;
  contentType?: string;
  location?: string | null;
  bodyPreview?: string;
  cookieKeys?: string[];
  csrfTokenFound?: boolean;
  memoIdHits?: string[];
  poItemHits?: string[];
  error?: string;
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

  const steps: ProbeStep[] = [];
  const jar = new Map<string, string>();

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

  // Step 1: GET /Login.asp — classic ASP login form. Inspect for the
  // input names + any token field.
  try {
    const res = await fetch(`${US_BASE}/Login.asp`, { redirect: "manual" });
    mergeSetCookies(res.headers, jar);
    const html = await res.text();
    // Capture every <input name="..."> for the form. Useful to see what
    // we need to POST.
    const inputNames = Array.from(
      html.matchAll(/<input[^>]+name=["']([^"']+)["']/g),
    ).map((m) => m[1]);
    // Capture <form action="...">
    const formAction = html.match(/<form[^>]+action=["']([^"']+)["']/i)?.[1];
    steps.push({
      label: "GET /Login.asp",
      url: `${US_BASE}/Login.asp`,
      method: "GET",
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      cookieKeys: Array.from(jar.keys()),
      bodyPreview: `formAction=${formAction ?? "?"}; inputs=[${Array.from(new Set(inputNames)).join(", ")}]`,
    });
  } catch (err) {
    steps.push({
      label: "GET /Login.asp",
      url: `${US_BASE}/Login.asp`,
      method: "GET",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 2: POST credentials with classic-ASP-style form. The exact
  // input names will surface from step 1 — try the most common
  // (UserName / Password / Login) as a first pass.
  try {
    const body = new URLSearchParams({
      UserName: username,
      Password: password,
      Login: "Login",
    });
    const res = await fetch(`${US_BASE}/Login.asp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(jar),
      },
      body: body.toString(),
      redirect: "manual",
    });
    mergeSetCookies(res.headers, jar);
    const location = res.headers.get("location");
    const text = await res.text().catch(() => "");
    steps.push({
      label: "POST /Login.asp (UserName/Password/Login)",
      url: `${US_BASE}/Login.asp`,
      method: "POST",
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      location,
      cookieKeys: Array.from(jar.keys()),
      bodyPreview: text.slice(0, 300),
    });
  } catch (err) {
    steps.push({
      label: "POST /Login.asp",
      url: `${US_BASE}/Login.asp`,
      method: "POST",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 3: GET receivingMemo with PO id, see what comes back. Look in
  // the HTML for any value that smells like a Memo id and capture the
  // POItemID / rowNo_<id> patterns so we know the form fields exist.
  try {
    const res = await fetch(
      `${US_BASE}/porder/receivingMemo.asp?ActionCMD=Edit&Corp=0&BranchID=97&PurchaseOrderID=${encodeURIComponent(poId)}`,
      {
        headers: { Cookie: cookieHeader(jar) },
        redirect: "manual",
      },
    );
    mergeSetCookies(res.headers, jar);
    const text = await res.text();
    const memoMatches = text.match(/[Mm]emo[Ii][Dd]\s*[=:"]\s*['"]?\d+/g);
    const itemMatches = text.match(
      /POItemID\s*=?\s*['"]?\d+|rowNo_\d+/g,
    );
    steps.push({
      label: "GET /porder/receivingMemo.asp (with session)",
      url: `${US_BASE}/porder/receivingMemo.asp?...&PurchaseOrderID=${poId}`,
      method: "GET",
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      location: res.headers.get("location"),
      cookieKeys: Array.from(jar.keys()),
      memoIdHits: memoMatches ? Array.from(new Set(memoMatches)).slice(0, 10) : [],
      poItemHits: itemMatches ? Array.from(new Set(itemMatches)).slice(0, 10) : [],
      bodyPreview: text.slice(0, 500),
    });
  } catch (err) {
    steps.push({
      label: "GET /porder/receivingMemo.asp",
      url: `${US_BASE}/porder/receivingMemo.asp`,
      method: "GET",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ poId, steps });
}

export async function GET(req: Request) {
  return handle(req);
}
