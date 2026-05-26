import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { hasPermission } from "@/lib/rbac";
import { db, schema } from "@/lib/db/client";
import { matchCsrByName, ROUTABLE_PEOPLE } from "@/lib/people/registry";
import { AdminMenu } from "./_components/AdminMenu";

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
  const showInbox = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "inbox.view",
  });
  const showVerifications = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "inventory.view",
  });
  // Inbox "open" count for the nav badge. Only meaningful for users
  // who are mapped to a Syncore userId in the registry.
  //
  // Wrapped in try/catch because this query touches the Phase C inbox
  // tables — if the migration (drizzle/0011_brief_skin.sql) hasn't run
  // yet on this environment, we don't want the layout to throw and
  // crash every page in the app. Worst case the badge silently reads
  // 0 until migrations land.
  let inboxOpenCount = 0;
  if (showInbox) {
    const me =
      matchCsrByName(session?.user?.name ?? null) ??
      ROUTABLE_PEOPLE.find((p) => p.displayName === session?.user?.name) ??
      null;
    if (me?.syncoreUserId) {
      try {
        const rows = await db
          .select({ n: sql<number>`COUNT(*)::int` })
          .from(schema.trackerEntriesCache)
          .leftJoin(
            schema.trackerInboxState,
            and(
              eq(
                schema.trackerInboxState.syncoreEntryId,
                schema.trackerEntriesCache.syncoreEntryId,
              ),
              eq(
                schema.trackerInboxState.recipientUserId,
                me.syncoreUserId,
              ),
            ),
          )
          .where(
            and(
              eq(schema.trackerEntriesCache.entryType, 3),
              sql`${schema.trackerEntriesCache.recipientUserIds} @> ${JSON.stringify([me.syncoreUserId])}::jsonb`,
              isNull(schema.trackerInboxState.handledAt),
            ),
          );
        inboxOpenCount = rows[0]?.n ?? 0;
      } catch {
        // Tables likely not migrated yet — keep the layout alive.
        inboxOpenCount = 0;
      }
    }
  }
  // Per-admin-page permissions — used to populate the Admin dropdown
  // with only the links this user can actually open.
  const canUsers = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.users",
  });
  const canRoles = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.roles",
  });
  const canCrons = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.crons",
  });
  const canHelp = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.help",
  });
  const showAdmin = canUsers || canRoles || canCrons || canHelp;

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
            {showInbox && (
              <Link
                href="/inbox"
                className="text-cg-n-300 hover:text-white transition inline-flex items-center gap-1.5"
              >
                Inbox
                {inboxOpenCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-cg-red text-white text-[10px] font-bold">
                    {inboxOpenCount}
                  </span>
                )}
              </Link>
            )}
            {showVerifications && (
              <Link
                href="/verifications"
                className="text-cg-n-300 hover:text-white transition"
              >
                Verifications
              </Link>
            )}
            {showAdmin && (
              <AdminMenu
                items={[
                  { href: "/admin/users", label: "Users", show: canUsers },
                  { href: "/admin/roles", label: "Roles", show: canRoles },
                  { href: "/admin/crons", label: "Crons", show: canCrons },
                  { href: "/admin/help", label: "Help docs", show: canHelp },
                ]}
              />
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
