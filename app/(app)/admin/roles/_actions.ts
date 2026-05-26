"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { isManager } from "@/lib/managers";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions";
import { seedRbac } from "@/lib/db/seed-rbac";

async function requireManager(): Promise<void> {
  const session = await auth();
  if (!isManager(session?.user?.email)) {
    throw new Error("Not authorized");
  }
}

const SLUG_RX = /^[a-z][a-z0-9_]{0,40}$/;

export async function createRole(formData: FormData): Promise<void> {
  await requireManager();
  const name = String(formData.get("name") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!SLUG_RX.test(name)) {
    throw new Error("Name must be lower_snake_case, 1-40 chars, start with a letter.");
  }
  if (!label) throw new Error("Label is required");
  await db.insert(schema.roles).values({ name, label, description });
  revalidatePath("/admin/roles");
}

export async function updateRoleMeta(formData: FormData): Promise<void> {
  await requireManager();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");
  const label = String(formData.get("label") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!label) throw new Error("Label is required");
  await db
    .update(schema.roles)
    .set({ label, description, updatedAt: new Date() })
    .where(eq(schema.roles.id, id));
  revalidatePath("/admin/roles");
  revalidatePath(`/admin/roles/${id}`);
}

export async function deleteRole(formData: FormData): Promise<void> {
  await requireManager();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");
  const existing = await db
    .select({ isSystem: schema.roles.isSystem })
    .from(schema.roles)
    .where(eq(schema.roles.id, id))
    .limit(1);
  if (existing.length === 0) throw new Error("Role not found");
  if (existing[0].isSystem) {
    throw new Error("System roles can't be deleted (their permissions are still editable).");
  }
  await db.delete(schema.roles).where(eq(schema.roles.id, id));
  revalidatePath("/admin/roles");
}

// Replace this role's permission set with the submitted list. Form posts
// every checkbox state; we diff to the DB to avoid clobbering on race.
export async function setRolePermissions(formData: FormData): Promise<void> {
  await requireManager();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");
  const raw = formData.getAll("permission");
  const selected: PermissionKey[] = [];
  for (const v of raw) {
    if (typeof v === "string" && isPermissionKey(v)) selected.push(v);
  }
  // Compute diff vs current
  const current = await db
    .select({ key: schema.rolePermissions.permissionKey })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, id));
  const currentSet = new Set(current.map((r) => r.key));
  const selectedSet = new Set<string>(selected);

  const toAdd = selected.filter((k) => !currentSet.has(k));
  const toRemove = current
    .map((r) => r.key)
    .filter((k) => !selectedSet.has(k));

  if (toAdd.length > 0) {
    await db
      .insert(schema.rolePermissions)
      .values(toAdd.map((k) => ({ roleId: id, permissionKey: k })))
      .onConflictDoNothing();
  }
  if (toRemove.length > 0) {
    await db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, id),
          inArray(schema.rolePermissions.permissionKey, toRemove),
        ),
      );
  }
  revalidatePath("/admin/roles");
  revalidatePath(`/admin/roles/${id}`);
}

// Returns a status string so the UI can render concrete confirmation
// next to the button. useActionState-compatible: takes the previous
// state as the first arg (unused but required) and returns the new
// state string.
export async function reseedRoles(
  _prevState: string | null,
): Promise<string> {
  await requireManager();
  const result = await seedRbac();
  revalidatePath("/admin/roles");
  if (result.rolesUpserted === 0) {
    return "All default roles already present. Nothing to add.";
  }
  return `Added ${result.rolesUpserted} role${result.rolesUpserted === 1 ? "" : "s"} (${result.permissionsGranted} permission grants).`;
}

// One-shot migration: read every user's legacy `users.role` text column
// and assign the matching RBAC role. Idempotent — re-runs do nothing
// once everyone's been mapped. Safe to call from /admin/roles after a
// fresh seed.
//
// Map:
//   production       → production_floor
//   csr              → csr
//   sales            → csr      (no first-class sales role yet)
//   sales_assistant  → viewer
//   manager          → manager
export async function migrateLegacyRoles(
  _prevState: string | null,
): Promise<string> {
  await requireManager();
  const { users } = await import("@/lib/db/schema");
  const all = await db
    .select({ id: users.id, role: users.role })
    .from(users);

  const roleMap: Record<string, string> = {
    production: "production_floor",
    csr: "csr",
    sales: "csr",
    sales_assistant: "viewer",
    manager: "manager",
  };

  let mapped = 0;
  let skippedNoRole = 0;
  for (const u of all) {
    const target = u.role ? roleMap[u.role] : null;
    if (!target) {
      if (!u.role) skippedNoRole++;
      continue;
    }
    const found = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, target))
      .limit(1);
    if (found.length === 0) continue;
    await db
      .insert(schema.userRoles)
      .values({ userId: u.id, roleId: found[0].id })
      .onConflictDoNothing();
    mapped++;
  }
  revalidatePath("/admin/users");
  if (mapped === 0) {
    return `No legacy roles to migrate (${skippedNoRole} user${skippedNoRole === 1 ? "" : "s"} had no legacy role).`;
  }
  return `Mapped ${mapped} user${mapped === 1 ? "" : "s"} to an RBAC role (existing assignments preserved).`;
}
