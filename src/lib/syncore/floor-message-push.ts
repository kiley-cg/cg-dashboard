// "Ask about this Job" floor → CSR/Sales messaging helper.
//
// Two write paths:
//   - sendJobTrackerEntry (preferred) — posts the entry AND emails the
//     recipient. Used when we have the recipient's Syncore user ID.
//   - addJobTrackerEntry (fallback) — silent log-only. Used when the
//     recipient's user ID isn't in the people registry yet (the email
//     part will need to be added when we capture another HAR).
//
// Body is the plain message — Syncore tags it with the sender (the
// authenticated webui user) in its own createdBy column.

import {
  addJobTrackerEntry,
  sendJobTrackerEntry,
  WebUiError,
} from "./webui";

export type PushResult =
  | { ok: true; emailed: boolean }
  | { ok: false; error: string; status?: number };

export interface FloorMessagePushArgs {
  jobId: string;
  // Display name only — used for client confirmation copy. The actual
  // routing happens via recipientSyncoreUserId.
  recipientDisplayName: string;
  // Syncore user ID for the email-firing endpoint. When null/undefined,
  // we fall back to the silent log entry (no email).
  recipientSyncoreUserId: number | null | undefined;
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
    if (args.recipientSyncoreUserId) {
      const ok = await sendJobTrackerEntry({
        jobId: args.jobId,
        recipientUserIds: [args.recipientSyncoreUserId],
        notes: body,
      });
      if (!ok) return { ok: false, error: "Syncore returned Result=false" };
      return { ok: true, emailed: true };
    }
    // Fallback for recipients whose Syncore user ID we don't have yet.
    const ok = await addJobTrackerEntry({
      jobId: args.jobId,
      description: body,
    });
    if (!ok) return { ok: false, error: "Syncore returned Result=false" };
    return { ok: true, emailed: false };
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
