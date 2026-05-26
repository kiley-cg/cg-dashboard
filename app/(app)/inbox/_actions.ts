"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasPermission } from "@/lib/rbac";

interface AuthResult {
  userId: string;
  userName: string | null;
  canViewAll: boolean;
}

async function authorize(): Promise<AuthResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authorized");
  const canView = await hasPermission({
    email: session.user.email,
    userId: session.user.id,
    permission: "inbox.view",
  });
  if (!canView) throw new Error("Not authorized");
  const canViewAll = await hasPermission({
    email: session.user.email,
    userId: session.user.id,
    permission: "inbox.view_all",
  });
  return {
    userId: session.user.id,
    userName: session.user.name ?? null,
    canViewAll,
  };
}

export async function markHandled(formData: FormData): Promise<void> {
  const { userId } = await authorize();
  const syncoreEntryId = String(formData.get("entryId") ?? "");
  const recipientUserId = Number(formData.get("recipientUserId") ?? 0);
  if (!syncoreEntryId) throw new Error("Missing entryId");
  if (!recipientUserId) throw new Error("Missing recipientUserId");

  await db
    .insert(schema.trackerInboxState)
    .values({
      syncoreEntryId,
      recipientUserId,
      handledAt: new Date(),
      handledByUserId: userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.trackerInboxState.syncoreEntryId,
        schema.trackerInboxState.recipientUserId,
      ],
      set: {
        handledAt: new Date(),
        handledByUserId: userId,
      },
    });
  revalidatePath("/inbox");
}

export async function unmarkHandled(formData: FormData): Promise<void> {
  await authorize();
  const syncoreEntryId = String(formData.get("entryId") ?? "");
  const recipientUserId = Number(formData.get("recipientUserId") ?? 0);
  if (!syncoreEntryId || !recipientUserId) throw new Error("Missing args");
  await db
    .delete(schema.trackerInboxState)
    .where(
      and(
        eq(schema.trackerInboxState.syncoreEntryId, syncoreEntryId),
        eq(schema.trackerInboxState.recipientUserId, recipientUserId),
      ),
    );
  revalidatePath("/inbox");
}

/**
 * Manual Refresh button — re-fires the same path the cron uses, on the
 * job set in the local production mirror. Limited to one user-triggered
 * run at a time per-route by Next's revalidation; if it gets noisy we
 * can scope to "jobs with messages newer than 24h".
 */
export async function refreshInbox(): Promise<void> {
  await authorize();
  const { snapshotJobsConcurrently, listSnapshotJobIds } = await import(
    "@/lib/syncore/snapshot-tracker-entries"
  );
  const jobIds = await listSnapshotJobIds({ limit: 500 });
  await snapshotJobsConcurrently({ jobIds, concurrency: 8 });
  revalidatePath("/inbox");
}

/**
 * Reply to a tracker entry. Reuses the same SendTrackerAsync path as
 * the floor-side Send Job Tracker — just pre-targets the original sender.
 */
export async function replyToEntry(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userName } = await authorize();
  const jobId = String(formData.get("jobId") ?? "");
  const recipientUserId = Number(formData.get("recipientUserId") ?? 0);
  const recipientName = String(formData.get("recipientName") ?? "Recipient");
  const body = String(formData.get("body") ?? "").trim();
  if (!jobId) return { ok: false, error: "Missing jobId" };
  if (!recipientUserId) {
    return {
      ok: false,
      error:
        "Sender doesn't have a Syncore user ID on file — can't email back. Reply directly in Syncore for now.",
    };
  }
  if (!body) return { ok: false, error: "Type a reply first" };

  const { pushFloorMessageToJobLog } = await import(
    "@/lib/syncore/floor-message-push"
  );
  const result = await pushFloorMessageToJobLog({
    jobId,
    recipientDisplayName: recipientName,
    recipientSyncoreUserId: recipientUserId,
    fromDisplayName: userName ?? "Inbox",
    body,
  });
  revalidatePath("/inbox");
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error };
}
