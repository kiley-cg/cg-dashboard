"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isManager } from "@/lib/managers";

export async function inviteUser(
  _prevState: string | null,
  formData: FormData,
): Promise<string> {
  const session = await auth();
  if (!isManager(session?.user?.email)) {
    return "Not authorized";
  }

  const rawEmail = formData.get("email");
  const rawName = formData.get("name");
  if (typeof rawEmail !== "string" || !rawEmail.trim()) {
    return "Email is required";
  }

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return `Invalid email: ${email}`;
  }
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.toLowerCase();
  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    return `Email must be @${allowedDomain}`;
  }

  const name =
    typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;

  // Pre-create a row so RBAC roles can be assigned before first sign-in.
  // Idempotent — if the user already exists, we don't touch them; admin
  // assigns roles via the table below.
  const result = await db
    .insert(users)
    .values({ email, name })
    .onConflictDoNothing()
    .returning({ id: users.id });
  revalidatePath("/admin/users");
  if (result.length === 0) {
    return `${email} already exists.`;
  }
  return `Invited ${email}. Assign roles below.`;
}

// RBAC: assign one role to a user. Idempotent — ON CONFLICT DO NOTHING.
export async function assignRoleToUser(formData: FormData): Promise<void> {
  const session = await auth();
  if (!isManager(session?.user?.email)) throw new Error("Not authorized");
  const { userRoles } = await import("@/lib/db/schema");
  const userId = formData.get("userId");
  const roleId = formData.get("roleId");
  if (typeof userId !== "string" || !userId) throw new Error("Missing userId");
  if (typeof roleId !== "string" || !roleId) throw new Error("Missing roleId");
  await db
    .insert(userRoles)
    .values({ userId, roleId, assignedByUserId: session?.user?.id ?? null })
    .onConflictDoNothing();
  revalidatePath("/admin/users");
}

// RBAC: remove a role from a user.
export async function removeRoleFromUser(formData: FormData): Promise<void> {
  const session = await auth();
  if (!isManager(session?.user?.email)) throw new Error("Not authorized");
  const { userRoles } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const userId = formData.get("userId");
  const roleId = formData.get("roleId");
  if (typeof userId !== "string" || !userId) throw new Error("Missing userId");
  if (typeof roleId !== "string" || !roleId) throw new Error("Missing roleId");
  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  revalidatePath("/admin/users");
}
