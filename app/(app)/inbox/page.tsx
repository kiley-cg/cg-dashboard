// Phase C inbox — consolidated view of Syncore Job Tracker entries
// addressed to the signed-in user across every active job. Read-only
// against tracker_entries_cache (populated by the
// /api/cron/snapshot-tracker-entries cron every 30 min + the manual
// Refresh button on this page).

import { notFound } from "next/navigation";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasPermission } from "@/lib/rbac";
import {
  ROUTABLE_PEOPLE,
  matchCsrByName,
} from "@/lib/people/registry";
import { PageHelp } from "../_components/PageHelp";
import { ActionForm } from "../_components/ActionForm";
import { getCustomerDisplayMap } from "@/lib/db/production-po";
import { InboxRow } from "./_components/InboxRow";
import { RefreshButton } from "./_components/RefreshButton";
import { UserSwitcher } from "./_components/UserSwitcher";
import { markAllHandled } from "./_actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · Color Graphics" };

interface PageProps {
  searchParams: Promise<{ filter?: string; user?: string }>;
}

export default async function InboxPage({ searchParams }: PageProps) {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "inbox.view",
  });
  if (!allowed) notFound();
  const canViewAll = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "inbox.view_all",
  });

  const params = await searchParams;
  const filter: "open" | "handled" | "all" =
    params.filter === "handled"
      ? "handled"
      : params.filter === "all"
        ? "all"
        : "open";

  // Determine which Syncore user ID's inbox we're showing.
  //   - Default: the signed-in user, mapped via their display name.
  //   - Manager (canViewAll) can override via ?user=<key>.
  const myPerson =
    matchCsrByName(session?.user?.name ?? null) ??
    ROUTABLE_PEOPLE.find(
      (p) => p.displayName === session?.user?.name,
    ) ??
    null;

  const overrideKey = canViewAll ? params.user : undefined;
  const overridePerson = overrideKey
    ? ROUTABLE_PEOPLE.find((p) => p.key === overrideKey) ?? null
    : null;
  const viewing = overridePerson ?? myPerson;

  if (!viewing?.syncoreUserId) {
    return (
      <section className="max-w-4xl mx-auto px-6 py-10 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight">Inbox</h1>
          <PageHelp slug="inbox" title="Inbox" />
        </header>
        <div className="border border-cg-n-200 rounded-card p-6 text-sm text-cg-n-600">
          You don&apos;t have a Syncore user ID on file in the people
          registry yet, so we can&apos;t pull your incoming tracker
          entries. Ping Kiley to add you to{" "}
          <code className="text-xs bg-cg-n-100 px-1 rounded">
            src/lib/people/registry.ts
          </code>
          .
        </div>
      </section>
    );
  }

  const myUserId = viewing.syncoreUserId;

  // Fetch entries addressed to this user. recipient_user_ids is jsonb;
  // use the @> containment operator for the Set check.
  const entries = await db
    .select({
      syncoreEntryId: schema.trackerEntriesCache.syncoreEntryId,
      jobId: schema.trackerEntriesCache.jobId,
      createdAt: schema.trackerEntriesCache.createdAt,
      createdByUserId: schema.trackerEntriesCache.createdByUserId,
      createdByName: schema.trackerEntriesCache.createdByName,
      description: schema.trackerEntriesCache.description,
      colorId: schema.trackerEntriesCache.colorId,
    })
    .from(schema.trackerEntriesCache)
    .where(
      and(
        eq(schema.trackerEntriesCache.entryType, 3),
        sql`${schema.trackerEntriesCache.recipientUserIds} @> ${JSON.stringify([myUserId])}::jsonb`,
      ),
    )
    .orderBy(desc(schema.trackerEntriesCache.createdAt))
    .limit(200);

  // Pull handled-state for every entry we just loaded (for the current
  // viewing user). One round-trip, joined client-side.
  const handledRows =
    entries.length === 0
      ? []
      : await db
          .select()
          .from(schema.trackerInboxState)
          .where(
            and(
              eq(schema.trackerInboxState.recipientUserId, myUserId),
              sql`${schema.trackerInboxState.syncoreEntryId} = ANY (${sql.raw(
                `ARRAY[${entries.map((e) => `'${e.syncoreEntryId.replace(/'/g, "''")}'`).join(",")}]::text[]`,
              )})`,
            ),
          );
  const handledMap = new Map(handledRows.map((r) => [r.syncoreEntryId, r]));

  const customerMap = await getCustomerDisplayMap({
    jobIds: Array.from(new Set(entries.map((e) => e.jobId))),
  });

  // Apply Open/Handled/All filter.
  const visible = entries.filter((e) => {
    const handled = handledMap.has(e.syncoreEntryId);
    if (filter === "open") return !handled;
    if (filter === "handled") return handled;
    return true;
  });

  const openCount = entries.filter(
    (e) => !handledMap.has(e.syncoreEntryId),
  ).length;

  return (
    <section className="max-w-4xl mx-auto px-6 py-10 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
            Inbox
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight mt-1">
            {viewing.displayName} · {openCount} open
          </h1>
          <p className="text-[11.5px] text-cg-n-500 mt-1">
            Auto-refreshes every 30 minutes. Click Refresh for an
            on-demand pull.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {openCount > 0 && (
            <ActionForm
              action={markAllHandled}
              label={`Mark all ${openCount} handled`}
              loadingLabel="Marking…"
              variant="ghost"
              hiddenInputs={{ recipientUserId: String(myUserId) }}
            />
          )}
          <RefreshButton />
          {canViewAll && (
            <UserSwitcher current={viewing.key} filter={filter} />
          )}
          <PageHelp slug="inbox" title="Inbox" />
        </div>
      </header>

      <nav className="flex items-center gap-1 text-[12px]">
        {(["open", "handled", "all"] as const).map((f) => (
          <a
            key={f}
            href={`/inbox?filter=${f}${overrideKey ? `&user=${overrideKey}` : ""}`}
            className={[
              "px-3 py-1 rounded font-semibold transition",
              filter === f
                ? "bg-cg-teal text-white"
                : "bg-[#EFEDE4] text-cg-n-600 hover:bg-[#E3DFD3]",
            ].join(" ")}
          >
            {f === "open" ? `Open (${openCount})` : f.charAt(0).toUpperCase() + f.slice(1)}
          </a>
        ))}
      </nav>

      {visible.length === 0 ? (
        <div className="border border-cg-n-200 rounded-card p-10 text-center text-cg-n-500 italic">
          {filter === "open"
            ? "🎉 No open messages."
            : "Nothing here on this filter."}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((e) => (
            <InboxRow
              key={e.syncoreEntryId}
              entry={{
                syncoreEntryId: e.syncoreEntryId,
                jobId: e.jobId,
                createdAt: e.createdAt.toISOString(),
                createdByUserId: e.createdByUserId,
                createdByName: e.createdByName,
                description: e.description,
                customer: customerMap.get(e.jobId) ?? null,
              }}
              recipientUserId={myUserId}
              handled={
                handledMap.has(e.syncoreEntryId)
                  ? {
                      handledAt:
                        handledMap.get(e.syncoreEntryId)!.handledAt?.toISOString() ?? null,
                      handledByUserId: handledMap.get(e.syncoreEntryId)!.handledByUserId,
                    }
                  : null
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
