// "Ask about this Job" floor → CSR/Sales messaging helper. Sibling to
// pushPoTrackingToJobLog: same Syncore Job Log primitive
// (addJobTrackerEntry), different formatter for a person-to-person
// question rather than tracking metadata.
//
// Format mirrors the existing cron entries so anyone reading the Job
// Log in Syncore sees a consistent style:
//
//   [Floor → Valerie] [from Kristen] body…

import { addJobTrackerEntry, WebUiError } from "./webui";

export type PushResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

export interface FloorMessagePushArgs {
  jobId: string;
  recipientDisplayName: string;
  fromDisplayName: string;
  body: string;
}

export async function pushFloorMessageToJobLog(
  args: FloorMessagePushArgs,
): Promise<PushResult> {
  const recipient = args.recipientDisplayName.trim();
  const from = args.fromDisplayName.trim();
  const body = args.body.trim();
  if (!args.jobId) return { ok: false, error: "Missing jobId" };
  if (!recipient) return { ok: false, error: "Missing recipient" };
  if (!body) return { ok: false, error: "Message body is empty" };

  // Header makes routing legible at a glance when scrolling the Job
  // Log in Syncore. "from" identifies the author since Syncore's own
  // entry-author field may not be visible everywhere the log surfaces.
  const header = `[Floor → ${recipient}]${from ? ` [from ${from}]` : ""}`;
  const description = `${header}\n${body}`;

  try {
    const ok = await addJobTrackerEntry({
      jobId: args.jobId,
      description,
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
