"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { upsertManualJobVerificationRecord } from "@/lib/db/verifications";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Phase D1: write the spec/approval row for a job — imprint location,
 * quantity of garments, who approved. One manual row per job (subsequent
 * saves overwrite). Read-side renders all records via
 * findJobVerificationRecords(jobId).
 */
export async function saveJobSpec(
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "verifications.record_spec",
  });
  if (!allowed) return { ok: false, error: "Not authorized" };

  const jobId = String(formData.get("jobId") ?? "").trim();
  if (!jobId) return { ok: false, error: "Missing jobId" };
  const imprintLocation = String(formData.get("imprintLocation") ?? "").trim() || null;
  const qtyRaw = formData.get("qtyGarments");
  const qty = typeof qtyRaw === "string" && qtyRaw.trim() ? Number(qtyRaw) : null;
  if (qty != null && !Number.isFinite(qty)) {
    return { ok: false, error: "Qty must be a number" };
  }
  const approvedBy = String(formData.get("approvedBy") ?? "").trim() || null;

  await upsertManualJobVerificationRecord({
    jobId,
    imprintLocation,
    qtyGarments: qty,
    approvedBy,
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/verifications");
  return { ok: true };
}
