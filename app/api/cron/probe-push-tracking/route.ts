// Step 2 verification probe — push a tracking # into Syncore's receiving
// memo for a PO. Default is DRY RUN (no network write); pass &live=1 to
// actually fire the POST.
//
// First-time use:
//   1. Run dry-run, inspect `wouldSendBody` — confirm the URL-encoded
//      body looks right (only trackingNo changed, everything else
//      preserved exactly).
//   2. Run live on a low-stakes PO. Manually check Syncore's receiving
//      memo UI to confirm the tracking # appears.
//   3. After both pass, wire pushTrackingToSyncore() to the production
//      "Push to Syncore" button.

import { NextResponse } from "next/server";
import {
  withFreshSyncoreSession,
  fetchMemoFormHtml,
  memoUrlFromResource,
  parseFormSnapshot,
  postFormSnapshot,
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

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const poId = url.searchParams.get("poId");
  const trackingNo = url.searchParams.get("trackingNo");
  const live = url.searchParams.get("live") === "1";

  if (!poId) {
    return NextResponse.json(
      { ok: false, error: "missing ?poId=" },
      { status: 400 },
    );
  }
  if (!trackingNo) {
    return NextResponse.json(
      { ok: false, error: "missing ?trackingNo=" },
      { status: 400 },
    );
  }

  const startedAt = Date.now();

  try {
    const result = await withFreshSyncoreSession(poId, async (us, trace) => {
      const memoUrl = memoUrlFromResource(trace.resource.resourceUrl);
      if (!memoUrl) throw new Error("Could not extract memo URL");

      const memo = await fetchMemoFormHtml(us.jar, memoUrl);
      if (memo.status !== 200) {
        throw new Error(`Memo GET returned ${memo.status}`);
      }

      const snapshot = parseFormSnapshot(memo.html, { formName: "rmAdd" });

      // The actual override we care about: set trackingNo. Everything
      // else is round-tripped as-is from the form snapshot.
      const post = await postFormSnapshot(
        us.jar,
        snapshot,
        { trackingNo },
        { live, referer: memoUrl },
      );

      return {
        attempts: trace.attempts,
        memoUrl,
        snapshotAction: snapshot.action,
        snapshotMethod: snapshot.method,
        snapshotFieldCount: Array.from(snapshot.fields.keys()).length,
        // The headline: the exact body we sent (or would send).
        wouldSendBody: post.sentBody,
        liveRequested: live,
        postResult: {
          dryRun: post.dryRun,
          status: post.status,
          finalUrl: post.finalUrl,
          bodyPreview: post.bodyPreview,
        },
      };
    });

    return NextResponse.json({
      ok: true,
      poId,
      trackingNo,
      durationMs: Date.now() - startedAt,
      ...result,
    });
  } catch (err) {
    const isWebUi = err instanceof WebUiError;
    return NextResponse.json(
      {
        ok: false,
        poId,
        trackingNo,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
        status: isWebUi ? err.status : undefined,
        body: isWebUi ? err.body : undefined,
      },
      { status: 500 },
    );
  }
}
