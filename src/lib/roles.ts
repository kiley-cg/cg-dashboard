// Role definitions for the per-person dashboard surfaces.
//
// Stored as text on `user.role` (see schema.ts) so new roles can be added
// without a migration. Managers are a superset — they pass any role gate
// because they need to QA/support every surface.

import { db } from "./db/client";
import { users } from "./db/schema";
import { eq } from "drizzle-orm";
import { isManager } from "./managers";

export type AppRole =
  | "production"
  | "csr"
  | "sales"
  | "sales_assistant"
  | "manager";

export const APP_ROLES: AppRole[] = [
  "production",
  "csr",
  "sales",
  "sales_assistant",
  "manager",
];

// Display labels for the admin UI. Values stay snake_case for storage so
// they're safe in DB rows and URLs; humans see the title-cased version.
export const APP_ROLE_LABELS: Record<AppRole, string> = {
  production: "Production",
  csr: "CSR",
  sales: "Sales",
  sales_assistant: "Sales Assistant",
  manager: "Manager",
};

export function isAppRole(value: string | null | undefined): value is AppRole {
  return (
    value === "production" ||
    value === "csr" ||
    value === "sales" ||
    value === "sales_assistant" ||
    value === "manager"
  );
}

// Server-only — hits Drizzle. Call from server components / route handlers
// only; middleware is edge-safe and cannot import this.
export async function getUserRole(
  userId: string | null | undefined,
): Promise<AppRole | null> {
  if (!userId) return null;
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const r = rows[0]?.role;
  return isAppRole(r) ? r : null;
}

// True if this user can access a role-gated surface. Managers are a
// superset (per Kiley's decision in the Phase B handoff). Pass the email
// AND the userId because manager-status is email-based (env allowlist)
// while role is row-based.
export async function hasRoleAccess(opts: {
  email: string | null | undefined;
  userId: string | null | undefined;
  required: AppRole;
}): Promise<boolean> {
  if (isManager(opts.email)) return true;
  const role = await getUserRole(opts.userId);
  return role === opts.required;
}
