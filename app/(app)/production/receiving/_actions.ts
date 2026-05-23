"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasRoleAccess } from "@/lib/roles";
import {
  addTracking,
  deleteTracking,
  markReceived,
  unmarkReceived,
} from "@/lib/db/receiving";

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

const CARRIERS = ["UPS", "FedEx", "USPS", "DHL", "Other"] as const;
function isCarrier(value: string): boolean {
  return (CARRIERS as readonly string[]).includes(value);
}

export async function addTrackingAction(formData: FormData): Promise<void> {
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
  revalidatePath("/production/receiving");
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
  revalidatePath("/production/receiving");
}

export async function markReceivedAction(formData: FormData): Promise<void> {
  const { userId } = await authorize();
  const poId = formData.get("poId");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");
  await markReceived({ poId, userId });
  revalidatePath("/production/receiving");
  revalidatePath("/production");
}

export async function unmarkReceivedAction(
  formData: FormData,
): Promise<void> {
  await authorize();
  const poId = formData.get("poId");
  if (typeof poId !== "string" || !poId) throw new Error("Missing poId");
  await unmarkReceived(poId);
  revalidatePath("/production/receiving");
  revalidatePath("/production");
}
