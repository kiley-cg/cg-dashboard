"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasRoleAccess } from "@/lib/roles";

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
