import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isManager } from "@/lib/managers";
import { db, schema } from "@/lib/db/client";
import {
  PERMISSIONS,
  permissionsByScope,
  type PermissionKey,
} from "@/lib/permissions";
import { setRolePermissions, updateRoleMeta } from "../_actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const SCOPE_LABELS: Record<string, string> = {
  production: "Production",
  inventory: "Inventory check",
  dashboard: "Manager dashboard",
  admin: "Admin",
};

export default async function EditRolePage({ params }: PageProps) {
  const session = await auth();
  if (!isManager(session?.user?.email)) notFound();
  const { id } = await params;

  const rows = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.id, id))
    .limit(1);
  const role = rows[0];
  if (!role) notFound();

  const grants = await db
    .select({ key: schema.rolePermissions.permissionKey })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, id));
  const granted = new Set(grants.map((r) => r.key));

  const grouped = permissionsByScope();
  const scopeOrder = Object.keys(grouped).sort((a, b) => {
    // Keep admin last; the others alphabetically.
    if (a === "admin") return 1;
    if (b === "admin") return -1;
    return a.localeCompare(b);
  });

  return (
    <section className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <header>
        <Link
          href="/admin/roles"
          className="text-xs text-cg-teal hover:underline"
        >
          ← All roles
        </Link>
        <div className="flex items-baseline gap-2 mt-2">
          <h1 className="text-2xl font-extrabold tracking-tight">
            {role.label}
          </h1>
          <code className="text-xs bg-cg-n-100 px-1.5 py-0.5 rounded">
            {role.name}
          </code>
          {role.isSystem && (
            <span className="text-[10px] uppercase tracking-wider bg-cg-n-100 text-cg-n-600 px-1.5 py-0.5 rounded">
              system
            </span>
          )}
        </div>
        {role.description && (
          <p className="text-cg-n-600 text-sm mt-1">{role.description}</p>
        )}
      </header>

      {/* Meta editor */}
      <form
        action={updateRoleMeta}
        className="border border-cg-n-200 rounded-card p-4 space-y-2"
      >
        <input type="hidden" name="id" value={role.id} />
        <h2 className="text-sm font-semibold text-cg-n-800">Details</h2>
        <input
          type="text"
          name="label"
          defaultValue={role.label}
          required
          className="w-full border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
        />
        <input
          type="text"
          name="description"
          defaultValue={role.description ?? ""}
          placeholder="Description"
          className="w-full border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
        />
        <button
          type="submit"
          className="text-xs border border-cg-teal text-cg-teal rounded-input px-3 py-1.5 hover:bg-cg-teal hover:text-white"
        >
          Save details
        </button>
      </form>

      {/* Permission checkboxes — one form covering every scope */}
      <form action={setRolePermissions} className="space-y-4">
        <input type="hidden" name="id" value={role.id} />
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-cg-n-800">Permissions</h2>
          <button
            type="submit"
            className="text-xs border border-cg-teal text-cg-teal rounded-input px-3 py-1.5 hover:bg-cg-teal hover:text-white"
          >
            Save permissions
          </button>
        </div>

        {scopeOrder.map((scope) => {
          const keys = grouped[scope] ?? [];
          if (keys.length === 0) return null;
          return (
            <div
              key={scope}
              className="border border-cg-n-200 rounded-card p-4"
            >
              <h3 className="text-xs uppercase tracking-wider font-bold text-cg-n-600 mb-2">
                {SCOPE_LABELS[scope] ?? scope}
              </h3>
              <ul className="space-y-1.5">
                {keys.map((k: PermissionKey) => (
                  <li key={k}>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        name="permission"
                        value={k}
                        defaultChecked={granted.has(k)}
                        className="mt-0.5 w-4 h-4 accent-cg-teal"
                      />
                      <div>
                        <div className="text-sm font-medium">
                          {PERMISSIONS[k].label}{" "}
                          <code className="ml-1 text-[10px] bg-cg-n-100 px-1 py-px rounded text-cg-n-600">
                            {k}
                          </code>
                        </div>
                        <div className="text-xs text-cg-n-600">
                          {PERMISSIONS[k].description}
                        </div>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </form>
    </section>
  );
}
