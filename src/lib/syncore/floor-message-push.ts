// "Ask about this Job" floor → CSR/Sales messaging helper. Sibling to
// pushPoTrackingToJobLog: same Syncore Job Log primitive
// (addJobTrackerEntry), different formatter.
//
// v1 used a "[Floor → X] [from Y]" prefix to express routing, since
// the addJobTrackerEntry endpoint is silent (no native notification).
// Kiley flagged the arrow mangling and pointed at SendTrackerAsync
// (Syncore's real tracker-with-email endpoint) — wiring that needs a
// HAR capture to lock down the request shape. Until then, drop the
// prefix entirely so the Job Log shows just the message body. Author
// attribution falls back to Syncore's own "createdBy" column on the
// log row.

import { addJobTrackerEntry, WebUiError } from "./webui";

export type PushResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

export interface FloorMessagePushArgs {
  jobId: string;
  // Kept on the signature so the next iteration (SendTrackerAsync) can
  // use them without changing call sites; currently unused while we're
  // on the silent endpoint.
  recipientDisplayName: string;
  fromDisplayName: string;
  body: string;
}

export async function pushFloorMessageToJobLog(
  args: FloorMessagePushArgs,
): Promise<PushResult> {
  const body = args.body.trim();
  if (!args.jobId) return { ok: false, error: "Missing jobId" };
  if (!body) return { ok: false, error: "Message body is empty" };

  try {
    const ok = await addJobTrackerEntry({
      jobId: args.jobId,
      description: body,
    });
    if (!ok) return { ok: false, error: "Syncore returned Result=false" };
    return { ok: true };
  } catch (err) {
    if (err instanceof WebUiError) {
      return { ok: false, error: err.message, status: err.status };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
