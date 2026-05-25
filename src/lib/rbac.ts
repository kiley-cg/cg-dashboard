// Permission check helpers — the API every feature gate calls. Replaces
// hasRoleAccess() over time. The legacy helper stays during the
// transition (Drop 3 swaps call sites).

import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db/client";
import { isManager } from "./managers";
import type { PermissionKey } from "./permissions";

// True if this user has the permission. Managers (per MANAGER_EMAILS env)
// remain a superset during transition — they pass every gate regardless
// of role assignments. Remove the manager shortcircuit once explicit
// roles are assigned to all admins.
export async function hasPermission(opts: {
  email: string | null | undefined;
  userId: string | null | undefined;
  permission: PermissionKey;
}): Promise<boolean> {
  if (isManager(opts.email)) return true;
  if (!opts.userId) return false;
  const rows = await db
    .select({ p: schema.rolePermissions.permissionKey })
    .from(schema.rolePermissions)
    .innerJoin(
      schema.userRoles,
      eq(schema.userRoles.roleId, schema.rolePermissions.roleId),
    )
    .where(
      and(
        eq(schema.userRoles.userId, opts.userId),
        eq(schema.rolePermissions.permissionKey, opts.permission),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// Batch variant — pass a set of permissions and get back which ones
// this user has. One round-trip instead of N. Useful in server
// components rendering many gated controls at once.
export async function getUserPermissions(opts: {
  email: string | null | undefined;
  userId: string | null | undefined;
  permissions: PermissionKey[];
}): Promise<Set<PermissionKey>> {
  if (isManager(opts.email)) return new Set(opts.permissions);
  if (!opts.userId || opts.permissions.length === 0) return new Set();
  const rows = await db
    .select({ p: schema.rolePermissions.permissionKey })
    .from(schema.rolePermissions)
    .innerJoin(
      schema.userRoles,
      eq(schema.userRoles.roleId, schema.rolePermissions.roleId),
    )
    .where(
      and(
        eq(schema.userRoles.userId, opts.userId),
        inArray(
          schema.rolePermissions.permissionKey,
          opts.permissions as string[],
        ),
      ),
    );
  return new Set(rows.map((r) => r.p as PermissionKey));
}

// Get all roles assigned to a user (id + display label). Used by the
// admin UI and any UI that wants to show "logged in as X".
export async function getUserRoles(
  userId: string | null | undefined,
): Promise<{ id: string; name: string; label: string }[]> {
  if (!userId) return [];
  return await db
    .select({
      id: schema.roles.id,
      name: schema.roles.name,
      label: schema.roles.label,
    })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, userId));
}
