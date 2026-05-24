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

interface FormSummary {
  formCount: number;
  firstFormAction: string | null;
  firstFormMethod: string | null;
  hiddenInputNames: string[];
  bodyTitle: string | null;
  // Heuristic markers — substrings that mean "we landed on the memo"
  // vs "we landed somewhere else". Keep this list calibrated against
  // the real memo HTML from round 10.
  looksLikeMemo: boolean;
  looksLikeFrameset: boolean;
  looksLikeLogin: boolean;
}

function parseFormSummary(html: string): FormSummary {
  const formMatches = [...html.matchAll(/<form\b[^>]*>/gi)];
  const firstForm = formMatches[0]?.[0] ?? "";
  const action = firstForm.match(/\baction=["']([^"']+)["']/i)?.[1] ?? null;
  const method = firstForm.match(/\bmethod=["']([^"']+)["']/i)?.[1] ?? null;

  const hiddenInputNames: string[] = [];
  for (const m of html.matchAll(
    /<input\b[^>]*\btype=["']?hidden["']?[^>]*\bname=["']([^"']+)["']/gi,
  )) {
    hiddenInputNames.push(m[1]);
  }
  // also catch name-before-type ordering
  for (const m of html.matchAll(
    /<input\b[^>]*\bname=["']([^"']+)["'][^>]*\btype=["']?hidden["']?/gi,
  )) {
    if (!hiddenInputNames.includes(m[1])) hiddenInputNames.push(m[1]);
  }

  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;

  return {
    formCount: formMatches.length,
    firstFormAction: action,
    firstFormMethod: method,
    hiddenInputNames,
    bodyTitle: title,
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
