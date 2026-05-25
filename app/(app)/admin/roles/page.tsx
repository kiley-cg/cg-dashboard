import { notFound } from "next/navigation";
import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isManager } from "@/lib/managers";
import { db, schema } from "@/lib/db/client";
import { createRole, deleteRole, reseedRoles } from "./_actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Roles · Admin · Color Graphics" };

export default async function AdminRolesPage() {
  const session = await auth();
  if (!isManager(session?.user?.email)) notFound();

  // Roles + counts (members + permission grants) for the list.
  const roleRows = await db
    .select({
      id: schema.roles.id,
      name: schema.roles.name,
      label: schema.roles.label,
      description: schema.roles.description,
      isSystem: schema.roles.isSystem,
    })
    .from(schema.roles)
    .orderBy(asc(schema.roles.label));

  const memberCounts = await db
    .select({
      roleId: schema.userRoles.roleId,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(schema.userRoles)
    .groupBy(schema.userRoles.roleId);
  const memberCount = new Map(memberCounts.map((r) => [r.roleId, r.n]));

  const permCounts = await db
    .select({
      roleId: schema.rolePermissions.roleId,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(schema.rolePermissions)
    .groupBy(schema.rolePermissions.roleId);
  const permCount = new Map(permCounts.map((r) => [r.roleId, r.n]));

  return (
    <section className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
            Admin
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight mt-1">Roles</h1>
          <p className="text-cg-n-600 mt-2 text-sm">
            Roles bundle permissions. Assign roles to users on the{" "}
            <Link href="/admin/users" className="text-cg-teal underline">
              Users
            </Link>{" "}
            page.
          </p>
        </div>
        <form action={reseedRoles}>
          <button
            type="submit"
            className="text-xs border border-cg-n-300 rounded-input px-3 py-1.5 hover:bg-cg-n-100"
            title="Add any missing default roles (admin/manager/csr/floor/viewer). Won't overwrite custom edits."
          >
            Re-seed defaults
          </button>
        </form>
      </header>

      <div className="border border-cg-n-200 rounded-card divide-y divide-cg-n-200">
        {roleRows.length === 0 ? (
          <div className="p-6 text-sm text-cg-n-600 italic">
            No roles yet — click "Re-seed defaults" above to bootstrap.
          </div>
        ) : (
          roleRows.map((r) => (
            <div key={r.id} className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/admin/roles/${r.id}`}
                    className="font-semibold text-cg-teal hover:underline"
                  >
                    {r.label}
                  </Link>
                  <code className="text-[11px] bg-cg-n-100 px-1.5 py-0.5 rounded">
                    {r.name}
                  </code>
                  {r.isSystem && (
                    <span className="text-[10px] uppercase tracking-wider bg-cg-n-100 text-cg-n-600 px-1.5 py-0.5 rounded">
                      system
                    </span>
                  )}
                </div>
                {r.description && (
                  <p className="text-xs text-cg-n-600 mt-1">{r.description}</p>
                )}
                <p className="text-[11px] text-cg-n-600 mt-1">
                  {permCount.get(r.id) ?? 0} permissions ·{" "}
                  {memberCount.get(r.id) ?? 0} member
                  {(memberCount.get(r.id) ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
              <Link
                href={`/admin/roles/${r.id}`}
                className="text-xs border border-cg-teal text-cg-teal rounded-input px-2.5 py-1 hover:bg-cg-teal hover:text-white"
              >
                Edit
              </Link>
              {!r.isSystem && (
                <form action={deleteRole}>
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="text-xs text-cg-n-500 hover:text-cg-red"
                    title="Delete role (members will lose this role's permissions)"
                  >
                    ×
                  </button>
                </form>
              )}
            </div>
          ))
        )}
      </div>

      <div className="border border-cg-n-200 rounded-card p-4">
        <h2 className="text-sm font-semibold text-cg-n-800">Create role</h2>
        <p className="text-xs text-cg-n-600 mt-1">
          Adds a new role with no permissions. Open it to grant permissions.
        </p>
        <form
          action={createRole}
          className="mt-3 grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-2"
        >
          <input
            type="text"
            name="name"
            required
            placeholder="machine_name"
            pattern="[a-z][a-z0-9_]{0,40}"
            className="border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm font-mono"
          />
          <input
            type="text"
            name="label"
            required
            placeholder="Display label"
            className="border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
          />
          <button
            type="submit"
            className="border border-cg-teal text-cg-teal rounded-input px-3 py-1 text-sm hover:bg-cg-teal hover:text-white"
          >
            Create
          </button>
          <input
            type="text"
            name="description"
            placeholder="Description (optional)"
            className="sm:col-span-3 border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
          />
        </form>
      </div>
    </section>
  );
}
