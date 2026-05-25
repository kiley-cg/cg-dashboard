import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { hasPermission } from "@/lib/rbac";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  // Permission-driven nav visibility. Each link asks "can this user
  // see the dashboard?". Manager emails still pass automatically
  // (superset built into hasPermission).
  const showProduction = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "production.view",
  });
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
    })) ||
    (await hasPermission({
      email: session?.user?.email,
      userId: session?.user?.id,
      permission: "admin.crons",
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
