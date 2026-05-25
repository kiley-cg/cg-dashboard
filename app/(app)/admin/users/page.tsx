import { notFound } from "next/navigation";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users, roles as rbacRoles, userRoles as rbacUserRoles } from "@/lib/db/schema";
import { isManager } from "@/lib/managers";
import { APP_ROLES, APP_ROLE_LABELS } from "@/lib/roles";
import {
  assignRoleToUser,
  inviteUser,
  removeRoleFromUser,
  setUserRole,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "User Roles · Color Graphics",
};

export default async function AdminUsersPage() {
  const session = await auth();
  if (!isManager(session?.user?.email)) {
    notFound();
  }

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .orderBy(asc(users.email));

  // RBAC: all available roles + every user's assignments. Bucketed
  // into a map for O(1) lookup in the table render.
  const allRbacRoles = await db
    .select({
      id: rbacRoles.id,
      name: rbacRoles.name,
      label: rbacRoles.label,
    })
    .from(rbacRoles)
    .orderBy(asc(rbacRoles.label));
  const assignments = await db
    .select({
      userId: rbacUserRoles.userId,
      roleId: rbacUserRoles.roleId,
    })
    .from(rbacUserRoles);
  const userRoleIds = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = userRoleIds.get(a.userId) ?? new Set();
    set.add(a.roleId);
    userRoleIds.set(a.userId, set);
  }
  const roleById = new Map(allRbacRoles.map((r) => [r.id, r]));

  return (
    <section className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <header>
        <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
          Admin
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight mt-1">
          User roles
        </h1>
        <p className="text-cg-n-600 mt-2 text-sm">
          Set the surface a user lands on. Managers (per{" "}
          <code className="text-xs bg-cg-n-100 px-1 py-0.5 rounded">
            MANAGER_EMAILS
          </code>
          ) always pass every role gate regardless of the value here.
        </p>
      </header>

      <div className="border border-cg-n-200 rounded-card p-4">
        <h2 className="text-sm font-semibold text-cg-n-800">Invite user</h2>
        <p className="text-xs text-cg-n-600 mt-1">
          Pre-create a row so a role is in place before their first sign-in.
          They land on the right surface immediately when they sign in with
          Google.
        </p>
        <form
          action={inviteUser}
          className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_10rem_auto] gap-2"
        >
          <input
            type="text"
            name="name"
            placeholder="Name (optional)"
            className="border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
          />
          <input
            type="email"
            name="email"
            required
            placeholder="email@colorgraphicswa.com"
            className="border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
          />
          <select
            name="role"
            defaultValue=""
            className="border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
          >
            <option value="">— no role —</option>
            {APP_ROLES.map((r) => (
              <option key={r} value={r}>
                {APP_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-btn bg-cg-black text-white px-3 py-1 text-xs font-semibold hover:bg-cg-n-800 transition"
          >
            Invite
          </button>
        </form>
      </div>

      <div className="border border-cg-n-200 rounded-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cg-n-50 text-cg-n-600">
            <tr className="text-left">
              <th className="px-4 py-2 font-semibold">User</th>
              <th className="px-4 py-2 font-semibold">Email</th>
              <th className="px-4 py-2 font-semibold w-48">Legacy role</th>
              <th className="px-4 py-2 font-semibold">
                <div className="flex items-center gap-2">
                  RBAC roles
                  <Link
                    href="/admin/roles"
                    className="text-[10px] text-cg-teal hover:underline normal-case font-normal"
                  >
                    manage →
                  </Link>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-cg-n-500 italic"
                >
                  No users yet. They appear here after first sign-in.
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const isMgr = isManager(u.email);
              return (
                <tr
                  key={u.id}
                  className="border-t border-cg-n-200 align-middle"
                >
                  <td className="px-4 py-3">{u.name ?? "—"}</td>
                  <td className="px-4 py-3 text-cg-n-700">
                    {u.email ?? "—"}
                    {isMgr && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-cg-info">
                        Manager
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <form action={setUserRole} className="flex gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role ?? ""}
                        className="border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm flex-1"
                      >
                        <option value="">— none —</option>
                        {APP_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-btn bg-cg-black text-white px-3 py-1 text-xs font-semibold hover:bg-cg-n-800 transition"
                      >
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {Array.from(userRoleIds.get(u.id) ?? []).map((rid) => {
                        const r = roleById.get(rid);
                        if (!r) return null;
                        return (
                          <form
                            key={rid}
                            action={removeRoleFromUser}
                            className="inline-flex"
                          >
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="roleId" value={rid} />
                            <button
                              type="submit"
                              title={`Remove ${r.label}`}
                              className="inline-flex items-center gap-1 text-[11px] bg-cg-n-100 text-cg-n-700 rounded px-1.5 py-0.5 hover:bg-cg-red hover:text-white"
                            >
                              {r.label}
                              <span className="text-[10px] opacity-70">×</span>
                            </button>
                          </form>
                        );
                      })}
                      <form
                        action={assignRoleToUser}
                        className="inline-flex gap-1"
                      >
                        <input type="hidden" name="userId" value={u.id} />
                        <select
                          name="roleId"
                          defaultValue=""
                          required
                          className="border border-cg-n-300 rounded-input px-1.5 py-0.5 bg-white text-[11px]"
                        >
                          <option value="" disabled>
                            + add role…
                          </option>
                          {allRbacRoles
                            .filter(
                              (r) =>
                                !(userRoleIds.get(u.id) ?? new Set()).has(r.id),
                            )
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                        </select>
                        <button
                          type="submit"
                          className="text-[11px] border border-cg-teal text-cg-teal rounded px-1.5 py-0.5 hover:bg-cg-teal hover:text-white"
                        >
                          Add
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
