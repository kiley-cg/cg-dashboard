"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isManager } from "@/lib/managers";
import { isAppRole } from "@/lib/roles";

export async function setUserRole(formData: FormData): Promise<void> {
  const session = await auth();
  if (!isManager(session?.user?.email)) {
    throw new Error("Not authorized");
  }

  const userId = formData.get("userId");
  const role = formData.get("role");
  if (typeof userId !== "string" || !userId) {
    throw new Error("Missing userId");
  }
  if (typeof role !== "string") {
    throw new Error("Missing role");
  }

  // Empty string from the <select> means "clear the role".
  const next = role === "" ? null : role;
  if (next !== null && !isAppRole(next)) {
    throw new Error(`Invalid role: ${next}`);
  }

  await db.update(users).set({ role: next }).where(eq(users.id, userId));
  revalidatePath("/admin/users");
}
