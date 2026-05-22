"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasRoleAccess } from "@/lib/roles";
import { postPurchaseOrderManually } from "@/lib/syncore/orders";

const FLOOR_STATUSES = ["stopped", "in_progress", "done"] as const;
type FloorStatus = (typeof FLOOR_STATUSES)[number];

function isFloorStatus(value: string): value is FloorStatus {
  return (FLOOR_STATUSES as readonly string[]).includes(value);
}

// YYYY-MM-DD format guard. Production days are Pacific dates carried as
// strings; no Date math runs server-side for these.
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

async function authorize(): Promise<{ userId: string | null }> {
  const session = await auth();
  const allowed = await hasRoleAccess({
    email: session?.user?.email,
    userId: session?.user?.id,
    required: "production",
  });
  if (!allowed) throw new Error("Not authorized");
  return { userId: session?.user?.id ?? null };
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
 * has the PO at floor_status='done' and it hasn't already been closed
 * (syncore_closed_at IS NULL).
 *
 * Best-effort writeback: if Syncore returns an error, the action throws
 * and the local syncore_closed_at stays null. The user can retry.
 * Local floor_status='done' is preserved regardless.
 */
export async function closeSyncorePo(formData: FormData): Promise<void> {
  await authorize();

  const poId = formData.get("poId");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");

  // Look up the PO's parent job id (Syncore PATCH path needs both).
  const mirror = await db
    .select({
      jobId: schema.productionPoMirror.syncoreJobId,
    })
    .from(schema.productionPoMirror)
    .where(eq(schema.productionPoMirror.poId, poId))
    .limit(1);
  if (mirror.length === 0) throw new Error(`PO ${poId} not in mirror`);
  const jobId = mirror[0].jobId;

  // Guardrails: only close from done, and only once.
  const state = await db
    .select()
    .from(schema.poScheduleState)
    .where(eq(schema.poScheduleState.poId, poId))
    .limit(1);
  if (state.length === 0 || state[0].floorStatus !== "done") {
    throw new Error("PO must be marked done before closing in Syncore");
  }
  if (state[0].syncoreClosedAt) {
    // Already closed — make the action idempotent rather than throwing.
    revalidatePath("/production");
    return;
  }

  await postPurchaseOrderManually(jobId, poId);

  await db
    .update(schema.poScheduleState)
    .set({ syncoreClosedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.poScheduleState.poId, poId));

  revalidatePath("/production");
}
