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

export async function inviteUser(formData: FormData): Promise<void> {
  const session = await auth();
  if (!isManager(session?.user?.email)) {
    throw new Error("Not authorized");
  }

  const rawEmail = formData.get("email");
  const rawName = formData.get("name");
  const rawRole = formData.get("role");
  if (typeof rawEmail !== "string" || !rawEmail.trim()) {
    throw new Error("Email is required");
  }

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Invalid email: ${email}`);
  }
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.toLowerCase();
  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    throw new Error(`Email must be @${allowedDomain}`);
  }

  const name =
    typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;

  let role: string | null = null;
  if (typeof rawRole === "string" && rawRole !== "") {
    if (!isAppRole(rawRole)) {
      throw new Error(`Invalid role: ${rawRole}`);
    }
    role = rawRole;
  }

  // If the email is already in the table (e.g. they signed in already),
  // leave the row alone — the manager can use the per-row form to edit.
  await db.insert(users).values({ email, name, role }).onConflictDoNothing();
  revalidatePath("/admin/users");
}
