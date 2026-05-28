"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasPermission } from "@/lib/rbac";
import { SyncoreError } from "@/lib/syncore/client";
import { WebUiError, addJobTrackerEntry } from "@/lib/syncore/webui";
import { pushPoTrackingToJobLog } from "@/lib/syncore/job-tracker-push";
import { postPurchaseOrderManually } from "@/lib/syncore/orders";
import {
  addTracking,
  deleteTracking,
  listTrackingForPo,
  markReceived,
  unmarkReceived,
} from "@/lib/db/receiving";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

const FLOOR_STATUSES = ["stopped", "in_progress", "done"] as const;
type FloorStatus = (typeof FLOOR_STATUSES)[number];

function isFloorStatus(value: string): value is FloorStatus {
  return (FLOOR_STATUSES as readonly string[]).includes(value);
}

// YYYY-MM-DD format guard. Production days are Pacific dates carried as
// strings; no Date math runs server-side for these.
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

async function authorize(): Promise<{
  userId: string | null;
  userName: string | null;
}> {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "production.view",
  });
  if (!allowed) throw new Error("Not authorized");
  return {
    userId: session?.user?.id ?? null,
    userName: session?.user?.name ?? null,
  };
}


/**
 * Drop a decoration PO onto a specific day. Upserts po_schedule_state
 * with scheduled_date = the given Pacific YYYY-MM-DD. Idempotent — calling
 * again with a different date moves the PO without leaving stale rows.
 *
 * Posts a Syncore Job Tracker entry on first-schedule and on re-schedule
 * so CSRs see "this is on Wed" without having to come back into the
 * dashboard. Skips the post if the date is unchanged (no-op re-save).
 */
export async function schedulePo(formData: FormData): Promise<void> {
  const { userName } = await authorize();

  const poId = formData.get("poId");
  const scheduledDate = formData.get("scheduledDate");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");
  if (typeof scheduledDate !== "string" || !ISO_DATE_RX.test(scheduledDate)) {
    throw new Error("scheduledDate must be YYYY-MM-DD");
  }

  // Read prior date so we know whether to post (and whether it's a
  // re-schedule vs first-schedule). Doing this BEFORE the upsert.
  const prior = await db
    .select({ scheduledDate: schema.poScheduleState.scheduledDate })
    .from(schema.poScheduleState)
    .where(eq(schema.poScheduleState.poId, poId))
    .limit(1);
  const priorDate = prior[0]?.scheduledDate ?? null;

  await db
    .insert(schema.poScheduleState)
    .values({ poId, scheduledDate })
    .onConflictDoUpdate({
      target: schema.poScheduleState.poId,
      set: {
        scheduledDate: sql`excluded.scheduled_date`,
        updatedAt: new Date(),
      },
    });

  if (priorDate !== scheduledDate) {
    await postScheduleChangeToJobLog({
      poId,
      newDate: scheduledDate,
      priorDate,
      userName,
    });
  }

  revalidatePath("/production");
}

/**
 * Bulk variant of schedulePo — assigns the same date to many POs in
 * one transaction. Used by the BulkScheduleBar when the floor wants
 * to drop a batch of POs onto the same day at once.
 *
 * Posts a Job Tracker entry per PO whose date actually changed
 * (idempotent — re-running with the same date is a no-op writeback).
 */
export async function bulkSchedulePos(formData: FormData): Promise<void> {
  const { userName } = await authorize();

  const poIds = formData.getAll("poIds").filter((v): v is string => typeof v === "string");
  const scheduledDate = formData.get("scheduledDate");
  if (poIds.length === 0) throw new Error("No poIds provided");
  if (typeof scheduledDate !== "string" || !ISO_DATE_RX.test(scheduledDate)) {
    throw new Error("scheduledDate must be YYYY-MM-DD");
  }

  // Snapshot prior dates so we can post Job Tracker entries only for
  // POs that actually changed.
  const priorRows = await db
    .select({
      poId: schema.poScheduleState.poId,
      scheduledDate: schema.poScheduleState.scheduledDate,
    })
    .from(schema.poScheduleState)
    .where(inArray(schema.poScheduleState.poId, poIds));
  const priorMap = new Map(priorRows.map((r) => [r.poId, r.scheduledDate]));

  const now = new Date();
  await db
    .insert(schema.poScheduleState)
    .values(poIds.map((poId) => ({ poId, scheduledDate })))
    .onConflictDoUpdate({
      target: schema.poScheduleState.poId,
      set: {
        scheduledDate: sql`excluded.scheduled_date`,
        updatedAt: now,
      },
    });

  for (const poId of poIds) {
    const priorDate = priorMap.get(poId) ?? null;
    if (priorDate !== scheduledDate) {
      await postScheduleChangeToJobLog({
        poId,
        newDate: scheduledDate,
        priorDate,
        userName,
      });
    }
  }

  revalidatePath("/production");
}

/**
 * Bulk variant of unschedulePo — moves many POs back to the
 * Unscheduled queue in one transaction.
 */
export async function bulkUnschedulePos(formData: FormData): Promise<void> {
  await authorize();

  const poIds = formData.getAll("poIds").filter((v): v is string => typeof v === "string");
  if (poIds.length === 0) throw new Error("No poIds provided");

  const now = new Date();
  await db
    .insert(schema.poScheduleState)
    .values(poIds.map((poId) => ({ poId, scheduledDate: null })))
    .onConflictDoUpdate({
      target: schema.poScheduleState.poId,
      set: {
        scheduledDate: sql`NULL`,
        updatedAt: now,
      },
    });

  revalidatePath("/production");
}

/**
 * Remove the scheduled-day assignment so the PO returns to the
 * Unscheduled queue.
 */
export async function unschedulePo(formData: FormData): Promise<void> {
  await authorize();

  const poId = formData.get("poId");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");

  await db
    .insert(schema.poScheduleState)
    .values({ poId, scheduledDate: null })
    .onConflictDoUpdate({
      target: schema.poScheduleState.poId,
      set: {
        scheduledDate: sql`NULL`,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/production");
}

/**
 * Set the production-floor status for a PO. Local DB only — no Syncore
 * writeback. Use closeSyncorePo() to flip the corresponding Syncore PO
 * to "Posted Manually" once production is actually finished.
 *
 * On done: stamps doneAt + doneByUserId for the look-back trail.
 * On any other status: clears those.
 */
export async function setFloorStatus(formData: FormData): Promise<void> {
  const { userId } = await authorize();

  const poId = formData.get("poId");
  const status = formData.get("status");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");
  if (typeof status !== "string" || !isFloorStatus(status)) {
    throw new Error(`Invalid status: ${String(status)}`);
  }

  const now = new Date();
  await db
    .insert(schema.poScheduleState)
    .values({
      poId,
      floorStatus: status,
      doneAt: status === "done" ? now : null,
      doneByUserId: status === "done" ? userId : null,
    })
    .onConflictDoUpdate({
      target: schema.poScheduleState.poId,
      set: {
        floorStatus: sql`excluded.floor_status`,
        doneAt: sql`excluded.done_at`,
        doneByUserId: sql`excluded.done_by_user_id`,
        updatedAt: now,
      },
    });

  revalidatePath("/production");
}

/**
 * Flip the Syncore PO to "Posted Manually" status — the canonical
 * "done in-house" state per the v2 docs. Only valid when the dashboard
 * has the PO at floor_status='done' and it hasn't already been closed.
 *
 * Returns a structured ActionResult instead of throwing so the client can
 * surface the real Syncore error to the user. In Next.js production
 * builds, thrown errors from server actions are scrubbed to generic
 * "Server Components render" messages — useless for diagnosing why
 * Syncore rejected the PATCH.
 */
export async function closeSyncorePo(
  formData: FormData,
): Promise<ActionResult> {
  let userName: string | null = null;
  try {
    const session = await authorize();
    userName = session.userName;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Not authorized",
    };
  }

  const poId = formData.get("poId");
  if (typeof poId !== "string" || !poId) {
    return { ok: false, error: "Missing poId" };
  }

  // Look up the PO's parent job id — the v1 web UI close endpoint needs
  // both ids in the path.
  const mirror = await db
    .select({ jobId: schema.productionPoMirror.syncoreJobId })
    .from(schema.productionPoMirror)
    .where(eq(schema.productionPoMirror.poId, poId))
    .limit(1);
  if (mirror.length === 0) {
    return { ok: false, error: `PO ${poId} is not in the local mirror` };
  }
  const jobId = mirror[0].jobId;

  // Guardrails: only close from done, and only once.
  const state = await db
    .select()
    .from(schema.poScheduleState)
    .where(eq(schema.poScheduleState.poId, poId))
    .limit(1);
  if (state.length === 0 || state[0].floorStatus !== "done") {
    return {
      ok: false,
      error: "Mark the PO Done before closing it in Syncore.",
    };
  }
  // Allow re-close if formData carries ?force=1 — used when Syncore
  // silently no-op'd a previous attempt and the dashboard's
  // syncoreClosedAt stamp is now out of sync with Syncore's actual
  // status. Without this the action short-circuits and there's no UI
  // way to retry without manual SQL.
  const force = formData.get("force") === "1";
  if (state[0].syncoreClosedAt && !force) {
    revalidatePath("/production");
    return { ok: true };
  }

  try {
    // Tag the close with WHO closed it. The signed-in user's name is
    // the natural "invoice number" for an in-house PO; Syncore stamps
    // the dates server-side on the auto-transition.
    const responseBody = await postPurchaseOrderManually(jobId, poId, {
      invoiceNumber: userName ?? "In-house production",
    });
    // eslint-disable-next-line no-console
    console.log(
      `[closeSyncorePo] PO ${poId} (job ${jobId}) — Syncore response:`,
      JSON.stringify(responseBody),
    );
  } catch (err) {
    if (err instanceof SyncoreError || err instanceof WebUiError) {
      const detail =
        typeof err.body === "object" && err.body !== null
          ? JSON.stringify(err.body)
          : String(err.body ?? "");
      return {
        ok: false,
        status: err.status,
        error: `Syncore ${err.status ?? "error"} closing PO` +
          (detail ? `: ${detail}` : ""),
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  await db
    .update(schema.poScheduleState)
    .set({ syncoreClosedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.poScheduleState.poId, poId));

  // Post a Job Tracker entry confirming the close — gives CSRs the
  // "this is done in-house" signal without having to scroll the Syncore
  // PO list for the status flip. Best-effort; swallow errors so a
  // tracker-post failure doesn't undo a successful close.
  try {
    const mirrorRow = await db
      .select({
        poNumber: schema.productionPoMirror.poNumber,
        supplierName: schema.productionPoMirror.supplierName,
      })
      .from(schema.productionPoMirror)
      .where(eq(schema.productionPoMirror.poId, poId))
      .limit(1);
    const poLabel =
      mirrorRow[0]?.poNumber != null
        ? `${jobId}-${mirrorRow[0].poNumber}`
        : poId;
    const supplierTail = mirrorRow[0]?.supplierName
      ? ` (${mirrorRow[0].supplierName})`
      : "";
    const who = userName ?? "Production";
    await addJobTrackerEntry({
      jobId,
      description: `Production complete — PO ${poLabel}${supplierTail} closed in Syncore by ${who}.`,
    });
  } catch {
    // Tracker post failure shouldn't roll back the close.
  }

  revalidatePath("/production");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Job Tracker writeback for schedule changes.
// ---------------------------------------------------------------------------

// "Mon May 26" from a YYYY-MM-DD. Pacific local — these dates are
// already Pacific calendar days, no timezone math needed.
function formatScheduleDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC", // iso is already a Pacific calendar day
  }).format(new Date(`${iso}T12:00:00Z`));
}

async function postScheduleChangeToJobLog(args: {
  poId: string;
  newDate: string;
  priorDate: string | null;
  userName: string | null;
}): Promise<void> {
  try {
    const mirrorRow = await db
      .select({
        syncoreJobId: schema.productionPoMirror.syncoreJobId,
        poNumber: schema.productionPoMirror.poNumber,
        supplierName: schema.productionPoMirror.supplierName,
      })
      .from(schema.productionPoMirror)
      .where(eq(schema.productionPoMirror.poId, args.poId))
      .limit(1);
    const row = mirrorRow[0];
    if (!row) return;
    const poLabel =
      row.poNumber != null ? `${row.syncoreJobId}-${row.poNumber}` : args.poId;
    const supplierTail = row.supplierName ? ` (${row.supplierName})` : "";
    const who = args.userName ? ` by ${args.userName}` : "";
    const verb = args.priorDate ? "Production rescheduled" : "Production scheduled";
    const fromTail = args.priorDate
      ? ` (was ${formatScheduleDate(args.priorDate)})`
      : "";
    const description = `${verb} for ${formatScheduleDate(args.newDate)} — PO ${poLabel}${supplierTail}${fromTail}${who}.`;
    await addJobTrackerEntry({
      jobId: row.syncoreJobId,
      description,
    });
  } catch {
    // Tracker post failure shouldn't roll back the local schedule
    // change — the floor still gets the PO on their queue.
  }
}

// ---------------------------------------------------------------------------
// Inbound receiving — tracking + receipt-state.
// ---------------------------------------------------------------------------
//
// Mounted on the /production Inbound tab. Eventually we'll surface the
// same actions on a future CSR dashboard receiving section so CSRs can
// chase down tracking even when Kristen isn't watching. Until then,
// production role is fine.

const CARRIERS = ["UPS", "FedEx", "USPS", "DHL", "Other"] as const;
function isCarrier(value: string): boolean {
  return (CARRIERS as readonly string[]).includes(value);
}

export interface AddTrackingResult {
  ok: true;
  // Whether the auto-push to Syncore Job Log succeeded. The local row
  // was always written if ok === true.
  syncedToJobLog: boolean;
  // Present when syncedToJobLog is false — surfaces inline so the user
  // can retry via the manual "→ Job Log" button.
  syncError?: string;
}

export async function addTrackingAction(
  formData: FormData,
): Promise<AddTrackingResult> {
  const { userId } = await authorize();
  const poId = formData.get("poId");
  const carrier = formData.get("carrier");
  const trackingNumber = formData.get("trackingNumber");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");
  if (typeof carrier !== "string" || !isCarrier(carrier)) {
    throw new Error(`Invalid carrier: ${String(carrier)}`);
  }
  if (typeof trackingNumber !== "string" || !trackingNumber.trim()) {
    throw new Error("Tracking number is required");
  }
  const cleanedTracking = trackingNumber.trim();
  // Reject obvious test / placeholder values so they don't slip into
  // the Syncore Job Log (and confuse anyone reading it later).
  if (cleanedTracking.length < 8) {
    throw new Error(
      "Tracking number is too short — real UPS/FedEx/USPS numbers are at least 8 characters.",
    );
  }
  if (/test/i.test(cleanedTracking) || /^1z[a-z]+$/i.test(cleanedTracking)) {
    throw new Error(
      "That looks like test data, not a real tracking number. Paste the actual number from the vendor.",
    );
  }
  await addTracking({
    poId,
    carrier,
    trackingNumber: cleanedTracking,
    userId,
  });

  // Auto-push to Syncore Job Log so everyone at CG sees it. If Syncore
  // is down or rejects the call, the local add still succeeded; we
  // surface the sync error inline so the user can retry via the manual
  // "→ Job Log" button.
  const syncResult = await pushPoTrackingToJobLog(poId);

  revalidatePath("/production");
  if (syncResult.ok) {
    return { ok: true, syncedToJobLog: true };
  }
  return { ok: true, syncedToJobLog: false, syncError: syncResult.error };
}

export async function deleteTrackingAction(
  formData: FormData,
): Promise<void> {
  await authorize();
  const trackingId = formData.get("trackingId");
  if (typeof trackingId !== "string" || !trackingId) {
    throw new Error("Missing trackingId");
  }
  await deleteTracking(trackingId);
  revalidatePath("/production");
}

export async function markReceivedAction(formData: FormData): Promise<void> {
  const { userId } = await authorize();
  const poId = formData.get("poId");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");
  await markReceived({ poId, userId });
  revalidatePath("/production");
}

export async function unmarkReceivedAction(
  formData: FormData,
): Promise<void> {
  await authorize();
  const poId = formData.get("poId");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");
  await unmarkReceived(poId);
  revalidatePath("/production");
}

/**
 * Save Kristen's production notes for a PO. Notes persist past PO close
 * so the /production/notes archive can surface "how did I do this
 * customer last time". Upserts po_schedule_state by poId so unscheduled
 * POs can still accumulate notes.
 *
 * Empty/whitespace string clears the field (sets NULL) and also clears
 * the audit timestamp + author — so the archive page can filter on
 * "notes IS NOT NULL" to skip cleared rows.
 */
export async function saveProductionNotes(formData: FormData): Promise<void> {
  const { userId } = await authorize();

  const poId = formData.get("poId");
  const notesRaw = formData.get("notes");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");
  if (typeof notesRaw !== "string") throw new Error("Missing notes");

  const trimmed = notesRaw.trim();
  const isClear = trimmed.length === 0;
  const now = new Date();

  await db
    .insert(schema.poScheduleState)
    .values({
      poId,
      productionNotes: isClear ? null : trimmed,
      notesUpdatedAt: isClear ? null : now,
      notesUpdatedByUserId: isClear ? null : userId,
    })
    .onConflictDoUpdate({
      target: schema.poScheduleState.poId,
      set: {
        productionNotes: isClear ? null : trimmed,
        notesUpdatedAt: isClear ? null : now,
        notesUpdatedByUserId: isClear ? null : userId,
        updatedAt: now,
      },
    });

  revalidatePath("/production");
  revalidatePath("/production/notes");
}

// postTrackingToJobLog now lives in src/lib/syncore/job-tracker-push.ts
// (pushPoTrackingToJobLog) so the Phase-5 cron can reuse the same
// formatting + auth path without server-action bundling weirdness.

/**
 * Manual "→ Job Log" trigger — useful as a retry escape hatch when
 * the auto-push from addTrackingAction fails. The "+ Add" form auto-
 * fires postTrackingToJobLog for the happy path.
 */
export async function pushTrackingToJobLogAction(
  formData: FormData,
): Promise<ActionResult> {
  await authorize();
  const poId = formData.get("poId");
  if (typeof poId !== "string" || !poId) {
    return { ok: false, error: "Missing poId" };
  }
  return await pushPoTrackingToJobLog(poId);
}

/**
 * Phase B "Ask about this Job" — Kristen fires a message into a Job's
 * Syncore Job Log, addressed to a CSR or salesperson. Reuses the same
 * Job Log primitive (addJobTrackerEntry) as pushPoTrackingToJobLog.
 *
 * Idempotency: the client disables the Send button during the
 * transition; we additionally validate inputs here so a malformed
 * submit can't post a half-formed entry.
 */
export async function askAboutJobAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userName } = await authorize();

  const jobId = formData.get("jobId");
  const recipientKey = formData.get("recipient");
  const body = formData.get("body");
  if (typeof jobId !== "string" || !jobId) {
    return { ok: false, error: "Missing jobId" };
  }
  if (typeof recipientKey !== "string" || !recipientKey) {
    return { ok: false, error: "Pick a recipient" };
  }
  const { PEOPLE_BY_KEY } = await import("@/lib/people/registry");
  const recipient = PEOPLE_BY_KEY[recipientKey];
  if (!recipient) {
    return { ok: false, error: `Unknown recipient: ${recipientKey}` };
  }
  if (typeof body !== "string" || !body.trim()) {
    return { ok: false, error: "Type a question first" };
  }

  const { pushFloorMessageToJobLog } = await import(
    "@/lib/syncore/floor-message-push"
  );
  const result = await pushFloorMessageToJobLog({
    jobId,
    recipientDisplayName: recipient.displayName,
    recipientSyncoreUserId: recipient.syncoreUserId ?? null,
    fromDisplayName: userName ?? "Floor",
    body: body.trim(),
  });

  revalidatePath("/production");
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error, status: result.status };
}
