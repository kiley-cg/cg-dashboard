import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { isManager } from "@/lib/managers";
import { hasRoleAccess } from "@/lib/roles";
import { hasPermission } from "@/lib/rbac";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  // Permission-driven nav visibility. Each link asks "can this user
  // see the dashboard?" rather than "what's their role?". Manager
  // emails still pass automatically (superset). Production keeps a
  // legacy hasRoleAccess fallback during the transition so existing
  // users don't lose access mid-rollout.
  const showProduction =
    (await hasPermission({
      email: session?.user?.email,
      userId: session?.user?.id,
      permission: "production.view",
    })) ||
    (await hasRoleAccess({
      email: session?.user?.email,
      userId: session?.user?.id,
      required: "production",
    }));
  const showDashboard = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "dashboard.view",
  });
  // Admin nav appears when the user can manage any admin surface.
  const showAdmin =
    (await hasPermission({
      email: session?.user?.email,
      userId: session?.user?.id,
      permission: "admin.users",
    })) ||
    (await hasPermission({
      email: session?.user?.email,
      userId: session?.user?.id,
      permission: "admin.roles",
    }));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-cg-black text-white">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={32} />
            <span className="font-extrabold tracking-wide uppercase text-sm">
              Color Graphics
            </span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            {showProduction && (
              <Link
                href="/production"
                className="text-cg-n-300 hover:text-white transition"
              >
                Production
              </Link>
            )}
            {showDashboard && (
              <Link
                href="/dashboard"
                className="text-cg-n-300 hover:text-white transition"
              >
                Dashboard
              </Link>
            )}
            {showAdmin && (
              <Link
                href="/admin/users"
                className="text-cg-n-300 hover:text-white transition"
              >
                Admin
              </Link>
            )}
            {session?.user?.email && (
              <span className="text-cg-n-300">{session.user.email}</span>
            )}
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button
                type="submit"
                className="text-cg-n-300 hover:text-white transition"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
