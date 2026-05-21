import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { isManager } from "@/lib/managers";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const showDashboard = isManager(session?.user?.email);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-cg-black text-white">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={32} />
            <span className="font-extrabold tracking-wide uppercase text-sm">
              Color Graphics
            </span>
            <span className="ml-2 text-cg-n-300 text-sm">· Inventory Check</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            {showDashboard && (
              <Link
                href="/dashboard"
                className="text-cg-n-300 hover:text-white transition"
              >
                Dashboard
              </Link>
            )}
            <Link
              href="/help"
              className="text-cg-n-300 hover:text-white transition"
            >
              Help
            </Link>
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
