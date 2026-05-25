// Permission catalog — single source of truth for every permission key
// the app recognizes. Adding a new gateable feature: add a row here,
// reference the key from your hasPermission() call, and (optionally)
// add it to the appropriate seeded role(s) in src/lib/db/seed-rbac.ts.
//
// Keep keys lowercase dot-separated, scoped by feature: "scope.action".

export const PERMISSIONS = {
  // Production dashboard
  "production.view": {
    label: "View production dashboard",
    description: "Access /production at all.",
  },
  "production.schedule": {
    label: "Schedule POs",
    description: "Drop POs onto days; move between days.",
  },
  "production.bulk_schedule": {
    label: "Bulk-schedule POs",
    description: "Use the multi-select bar to schedule many at once.",
  },
  "production.set_floor_status": {
    label: "Set floor status",
    description: "Change Pending/Scheduled/In Progress/Completed.",
  },
  "production.close_syncore_po": {
    label: "Close PO in Syncore",
    description: "Flip a PO to Posted Manually in Syncore.",
  },
  "production.add_tracking": {
    label: "Add tracking #s",
    description: "Manually enter tracking numbers for incoming apparel.",
  },
  "production.delete_tracking": {
    label: "Delete tracking #s",
    description: "Remove tracking entries (manual or API-sourced).",
  },
  "production.edit_notes": {
    label: "Edit production notes",
    description: "Add/edit Kristen's production notes per PO.",
  },

  // Inventory check
  "inventory.view": {
    label: "View inventory check",
    description: "Access the inventory verification tool.",
  },
  "inventory.verify": {
    label: "Verify line items",
    description: "Mark line items verified against vendor inventory.",
  },
  "inventory.clear_verifications": {
    label: "Clear job verifications",
    description: "Reset all verifications for a job (escape hatch).",
  },

  // Manager dashboard (follow-ups digest etc.)
  "dashboard.view": {
    label: "View manager dashboard",
    description: "Access /dashboard (follow-ups digest, snapshots).",
  },

  // Admin surfaces
  "admin.users": {
    label: "Manage users",
    description: "Invite users, edit their role assignments.",
  },
  "admin.roles": {
    label: "Manage roles",
    description: "Create roles, set their permissions.",
  },
  "admin.crons": {
    label: "Manage crons",
    description: "View cron schedule + run history, trigger manual runs.",
  },
  "admin.help": {
    label: "Edit help docs",
    description: "Create + edit the SOP / help content shown in each dashboard's help drawer.",
  },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && value in PERMISSIONS;
}

// Group permissions by their scope prefix for the admin UI ("production",
// "inventory", "admin", etc) so the role-edit page can render them in
// labeled sections.
export function permissionsByScope(): Record<string, PermissionKey[]> {
  const out: Record<string, PermissionKey[]> = {};
  for (const key of PERMISSION_KEYS) {
    const scope = key.split(".")[0] ?? "other";
    (out[scope] ||= []).push(key);
  }
  return out;
}
