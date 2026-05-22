import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isManager } from "@/lib/managers";
import { APP_ROLES, APP_ROLE_LABELS } from "@/lib/roles";
import { inviteUser, setUserRole } from "./actions";

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
              <th className="px-4 py-2 font-semibold w-48">Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={3}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
