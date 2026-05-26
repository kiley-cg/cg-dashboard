// Seed default roles + permission grants. Idempotent — safe to re-run.
// Runs automatically on first DB migration; also exposed as a script
// (pnpm db:seed-rbac) for re-applying after the catalog changes.

import { eq } from "drizzle-orm";
import { db, schema } from "./client";
import { PERMISSION_KEYS, type PermissionKey } from "../permissions";

interface SeedRole {
  name: string;
  label: string;
  description: string;
  isSystem: boolean;
  permissions: PermissionKey[] | "all";
}

// Tune these as the team's actual mental model crystallizes. Admin UI
// lets Kiley edit them post-seed; re-running this seed will NOT
// overwrite custom changes to non-system roles' permissions.
const SEED_ROLES: SeedRole[] = [
  {
    name: "admin",
    label: "Administrator",
    description: "Full access including admin pages.",
    isSystem: true,
    permissions: "all",
  },
  {
    name: "manager",
    label: "Manager",
    description: "Every dashboard + write actions + manage help docs; no other admin pages.",
    isSystem: true,
    permissions: [
      ...PERMISSION_KEYS.filter((k) => !k.startsWith("admin.")),
      "admin.help" as const,
    ],
  },
  {
    name: "csr",
    label: "CSR",
    description: "Inventory verification + production view + manual tracking entry + inbox.",
    isSystem: false,
    permissions: [
      "inventory.view",
      "inventory.verify",
      "verifications.record_spec",
      "production.view",
      "production.add_tracking",
      "inbox.view",
    ],
  },
  {
    name: "production_floor",
    label: "Production",
    description: "Schedule POs, set floor status, log tracking.",
    isSystem: false,
    permissions: [
      "production.view",
      "production.schedule",
      "production.bulk_schedule",
      "production.set_floor_status",
      "production.add_tracking",
      "production.edit_notes",
      "inbox.view",
    ],
  },
  {
    name: "viewer",
    label: "Viewer",
    description: "Read-only access across the main dashboards.",
    isSystem: true,
    permissions: [
      "production.view",
      "inventory.view",
      "dashboard.view",
    ],
  },
];

export async function seedRbac(): Promise<{
  rolesUpserted: number;
  permissionsGranted: number;
}> {
  let rolesUpserted = 0;
  let permissionsGranted = 0;

  for (const r of SEED_ROLES) {
    const existing = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, r.name))
      .limit(1);

    let roleId: string;
    if (existing.length === 0) {
      const [inserted] = await db
        .insert(schema.roles)
        .values({
          name: r.name,
          label: r.label,
          description: r.description,
          isSystem: r.isSystem,
        })
        .returning({ id: schema.roles.id });
      roleId = inserted.id;
      rolesUpserted++;

      // First-time seed: grant all listed permissions. We DO NOT
      // re-grant on subsequent runs — that would clobber admin edits.
      const perms = r.permissions === "all" ? PERMISSION_KEYS : r.permissions;
      if (perms.length > 0) {
        await db
          .insert(schema.rolePermissions)
          .values(
            perms.map((p) => ({ roleId, permissionKey: p as string })),
          )
          .onConflictDoNothing();
        permissionsGranted += perms.length;
      }
    } else {
      // Existing role — update label/description/isSystem only.
      // Permissions are not touched; admin owns them post-seed.
      await db
        .update(schema.roles)
        .set({
          label: r.label,
          description: r.description,
          isSystem: r.isSystem,
          updatedAt: new Date(),
        })
        .where(eq(schema.roles.id, existing[0].id));
    }
  }

  return { rolesUpserted, permissionsGranted };
}
