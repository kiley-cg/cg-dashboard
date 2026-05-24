"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasRoleAccess } from "@/lib/roles";
import { SyncoreError } from "@/lib/syncore/client";
import { WebUiError, addJobTrackerEntry } from "@/lib/syncore/webui";
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
  const allowed = await hasRoleAccess({
    email: session?.user?.email,
    userId: session?.user?.id,
    required: "production",
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
 */
export async function schedulePo(formData: FormData): Promise<void> {
  await authorize();

  const poId = formData.get("poId");
  const scheduledDate = formData.get("scheduledDate");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");
  if (typeof scheduledDate !== "string" || !ISO_DATE_RX.test(scheduledDate)) {
    throw new Error("scheduledDate must be YYYY-MM-DD");
  }

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
  if (state[0].syncoreClosedAt) {
    revalidatePath("/production");
    return { ok: true };
  }

  try {
    // Tag the close with WHO closed it. The signed-in user's name is
    // the natural "invoice number" for an in-house PO; Syncore stamps
    // the dates server-side on the auto-transition.
    await postPurchaseOrderManually(jobId, poId, {
      invoiceNumber: userName ?? "In-house production",
    });
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

  revalidatePath("/production");
  return { ok: true };
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
  await addTracking({
    poId,
    carrier,
    trackingNumber: trackingNumber.trim(),
    userId,
  });

  // Auto-push to Syncore Job Log so everyone at CG sees it. If Syncore
  // is down or rejects the call, the local add still succeeded; we
  // surface the sync error inline so the user can retry via the manual
  // "→ Job Log" button.
  const syncResult = await postTrackingToJobLog(poId);

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

/**
 * Internal: format and push a PO's tracking #s to its Syncore Job Log.
 * Returns ActionResult. Used by both the explicit "→ Job Log" button
 * (pushTrackingToJobLogAction) AND auto-fired from addTrackingAction so
 * the floor doesn't need a second click.
 */
async function postTrackingToJobLog(poId: string): Promise<ActionResult> {
  const [poRow, trackingEntries] = await Promise.all([
    db
      .select({
        syncoreJobId: schema.productionPoMirror.syncoreJobId,
        poNumber: schema.productionPoMirror.poNumber,
        supplierName: schema.productionPoMirror.supplierName,
      })
      .from(schema.productionPoMirror)
      .where(eq(schema.productionPoMirror.poId, poId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    listTrackingForPo(poId),
  ]);

  if (!poRow) {
    return { ok: false, error: `PO ${poId} not found in mirror` };
  }
  if (trackingEntries.length === 0) {
    return { ok: false, error: "No tracking numbers entered yet for this PO" };
  }

  const poLabel =
    poRow.poNumber != null ? `${poRow.syncoreJobId}-${poRow.poNumber}` : poId;
  const carriersSeen = new Set(
    trackingEntries.map((t) => t.carrier).filter(Boolean),
  );
  const carrierText =
    carriersSeen.size === 1
      ? Array.from(carriersSeen)[0]
      : carriersSeen.size > 1
        ? "mixed"
        : "carrier unknown";
  const supplierTail = poRow.supplierName ? ` (${poRow.supplierName})` : "";

  const header = `Tracking — ${carrierText} — PO ${poLabel}${supplierTail}`;
  const body = trackingEntries
    .map((t) => `  ${t.carrier}: ${t.trackingNumber}`)
    .join("\n");
  const description = `${header}\n${body}`;

  try {
    const ok = await addJobTrackerEntry({
      jobId: poRow.syncoreJobId,
      description,
    });
    if (!ok) {
      return { ok: false, error: "Syncore returned Result=false" };
    }
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
  return await postTrackingToJobLog(poId);
}
