// Step 1 of the receiving-memo writeback work (issue #76) — a read-only
// proof that withFreshSyncoreSession() actually lands us on the memo
// form, not on the index frameset or a login page.
//
// Runs the full flow end-to-end:
//   1. Fresh www login (new .ASPXAUTH, therefore new Token)
//   2. GET memostatuses → extract resourceUrl + Token
//   3. Follow LoginFromV2 chain with browser headers, capture us. jar
//   4. GET the memo URL (the chain's terminal page) → return HTML preview
//
// Diagnostics returned: hop trail, jar keys per host, the page's
// detected form structure (action/method/hidden input names), and a
// memo-form-marker heuristic. We do NOT post anything — this is the
// last guard rail before Step 2 wires up the real writeback.

import { NextResponse } from "next/server";
import {
  withFreshSyncoreSession,
  fetchMemoFormHtml,
  memoUrlFromResource,
} from "@/lib/syncore/us-session";
import { WebUiError } from "@/lib/syncore/webui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

interface InputBlueprint {
  tag: "input" | "select" | "textarea" | "button";
  name: string;
  type: string | null;
  value: string | null;
  // Truncated outer HTML for context (helps if the regex misses anything)
  snippet: string;
}

interface FormBlueprint {
  // The whole `<form ...>` opening tag so we can read its action/method/
  // onsubmit/id attributes directly without re-parsing.
  openingTag: string;
  action: string | null;
  method: string | null;
  id: string | null;
  onsubmit: string | null;
  inputs: InputBlueprint[];
}

interface FormSummary {
  formCount: number;
  bodyTitle: string | null;
  // Per-form blueprint (just the first 2 — the memo page has 2 forms;
  // anything else is likely a search/filter or scaffolding form).
  forms: FormBlueprint[];
  // The set of JS function references that look like form submitters —
  // classic ASP often POSTs via JS rather than a plain form action.
  jsSubmitCalls: string[];
  // Heuristic markers as before.
  looksLikeMemo: boolean;
  looksLikeFrameset: boolean;
  looksLikeLogin: boolean;
}

function extractAttr(tag: string, attr: string): string | null {
  const m =
    tag.match(new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "i")) ||
    tag.match(new RegExp(`\\b${attr}\\s*=\\s*'([^']*)'`, "i")) ||
    tag.match(new RegExp(`\\b${attr}\\s*=\\s*([^\\s>]+)`, "i"));
  return m?.[1] ?? null;
}

function parseInputsInRange(html: string, start: number, end: number): InputBlueprint[] {
  const slice = html.slice(start, end);
  const out: InputBlueprint[] = [];
  // Self-closing or implicit-close tags: <input>, plus paired <select>/<textarea>/<button>
  for (const m of slice.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = extractAttr(tag, "name");
    if (!name) continue;
    out.push({
      tag: "input",
      name,
      type: extractAttr(tag, "type"),
      value: extractAttr(tag, "value"),
      snippet: tag.length > 200 ? tag.slice(0, 200) + "…" : tag,
    });
  }
  for (const m of slice.matchAll(/<select\b[^>]*>/gi)) {
    const tag = m[0];
    const name = extractAttr(tag, "name");
    if (!name) continue;
    out.push({
      tag: "select",
      name,
      type: null,
      value: null,
      snippet: tag.length > 200 ? tag.slice(0, 200) + "…" : tag,
    });
  }
  for (const m of slice.matchAll(/<textarea\b[^>]*>/gi)) {
    const tag = m[0];
    const name = extractAttr(tag, "name");
    if (!name) continue;
    out.push({
      tag: "textarea",
      name,
      type: null,
      value: null,
      snippet: tag.length > 200 ? tag.slice(0, 200) + "…" : tag,
    });
  }
  for (const m of slice.matchAll(/<button\b[^>]*>/gi)) {
    const tag = m[0];
    const name = extractAttr(tag, "name");
    if (!name) continue;
    out.push({
      tag: "button",
      name,
      type: extractAttr(tag, "type"),
      value: extractAttr(tag, "value"),
      snippet: tag.length > 200 ? tag.slice(0, 200) + "…" : tag,
    });
  }
  return out;
}

function parseFormSummary(html: string): FormSummary {
  // Find each <form> opening tag and its matching </form> (or EOF).
  const formOpenRx = /<form\b[^>]*>/gi;
  const forms: FormBlueprint[] = [];
  let formCount = 0;
  let m: RegExpExecArray | null;
  while ((m = formOpenRx.exec(html)) !== null) {
    formCount++;
    if (forms.length >= 2) continue; // limit to first 2 forms
    const openingTag = m[0];
    const start = m.index + openingTag.length;
    const closeIdx = html.indexOf("</form>", start);
    const end = closeIdx === -1 ? html.length : closeIdx;
    forms.push({
      openingTag: openingTag.length > 400 ? openingTag.slice(0, 400) + "…" : openingTag,
      action: extractAttr(openingTag, "action"),
      method: extractAttr(openingTag, "method"),
      id: extractAttr(openingTag, "id"),
      onsubmit: extractAttr(openingTag, "onsubmit"),
      inputs: parseInputsInRange(html, start, end),
    });
  }

  // Look for explicit JS submit calls — classic-ASP forms often have a
  // helper like SaveMemo() or document.forms[0].submit() in a button's
  // onclick. Surface anything that looks like a function call so we can
  // figure out where Save actually goes.
  const jsSubmitCalls = new Set<string>();
  for (const x of html.matchAll(
    /\b(?:onclick|onsubmit)\s*=\s*["'][^"']*?\b([A-Za-z_]\w{2,40})\s*\(/gi,
  )) {
    jsSubmitCalls.add(x[1]);
  }
  for (const x of html.matchAll(
    /\bdocument\.forms?\[[^\]]*\]\.(?:action\s*=|submit\(\))/gi,
  )) {
    jsSubmitCalls.add(x[0]);
  }

  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;

  return {
    formCount,
    bodyTitle: title,
    forms,
    jsSubmitCalls: Array.from(jsSubmitCalls).slice(0, 20),
    // The frameset page contains "receivingMemo.asp" as a JS string,
    // so that marker alone is a false positive. Require something only
    // the real form HTML has: POItemID inputs or the memo's submit row.
    looksLikeMemo:
      /name=["']?POItemID/i.test(html) ||
      /name=["']?ActionCMD["']?\s+value=["']?Save/i.test(html),
    // Index.asp is the legacy frameset wrapper — landing here means
    // LoginFromV2 dropped the pg= target.
    looksLikeFrameset: /<frameset|src=["'][^"']*index\.asp/i.test(html),
    looksLikeLogin: /Login\.asp/i.test(html) || /expired=1/i.test(html),
  };
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const poId = url.searchParams.get("poId");
  if (!poId) {
    return NextResponse.json(
      { ok: false, error: "missing ?poId=" },
      { status: 400 },
    );
  }

  const startedAt = Date.now();

  try {
    const result = await withFreshSyncoreSession(poId, async (us, trace) => {
      const memoUrl = memoUrlFromResource(trace.resource.resourceUrl);
      if (!memoUrl) {
        throw new Error(
          "Could not extract RequestURL from resourceUrl — memostatuses response shape may have changed",
        );
      }
      const memo = await fetchMemoFormHtml(us.jar, memoUrl);
      return {
        resourceUrl: trace.resource.resourceUrl,
        tokenSuffix: trace.resource.tokenSuffix,
        attempts: trace.attempts,
        chainHops: trace.hops,
        usJarKeys: Array.from(us.jar.keys()),
        memoUrl,
        memo: {
          finalStatus: memo.status,
          finalUrl: memo.finalUrl,
          bodyLength: memo.html.length,
          bodyPreview: memo.html.slice(0, 600),
          form: parseFormSummary(memo.html),
        },
      };
    });

    return NextResponse.json({
      ok: true,
      poId,
      durationMs: Date.now() - startedAt,
      ...result,
    });
  } catch (err) {
    const isWebUi = err instanceof WebUiError;
    return NextResponse.json(
      {
        ok: false,
        poId,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
        status: isWebUi ? err.status : undefined,
        body: isWebUi ? err.body : undefined,
      },
      { status: 500 },
    );
  }
}
