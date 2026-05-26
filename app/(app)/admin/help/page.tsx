import { notFound } from "next/navigation";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasPermission } from "@/lib/rbac";
import { PageHelp } from "../../_components/PageHelp";
import { ActionForm } from "../../_components/ActionForm";
import { seedDefaultHelpDocs } from "./_actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help docs · Admin · Color Graphics" };

// Slugs the app references today. We surface these as "missing" placeholders
// in the list so admins know what to write SOPs for. Add to this when you
// add a HelpButton in a new spot.
const KNOWN_SLUGS = [
  { slug: "production", title: "Production planner" },
  { slug: "production.tracking", title: "Tracking auto-poll + carrier ETAs" },
  { slug: "inventory", title: "Inventory check" },
  { slug: "dashboard", title: "Manager dashboard" },
  { slug: "admin.users", title: "Admin · Users" },
  { slug: "admin.roles", title: "Admin · Roles" },
  { slug: "admin.crons", title: "Admin · Crons" },
  { slug: "admin.help", title: "Admin · Help docs" },
];

export default async function AdminHelpPage() {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.help",
  });
  if (!allowed) notFound();

  const rows = await db
    .select({
      slug: schema.helpDocs.slug,
      title: schema.helpDocs.title,
      updatedAt: schema.helpDocs.updatedAt,
    })
    .from(schema.helpDocs)
    .orderBy(asc(schema.helpDocs.slug));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  // Merge known slugs (which may be missing docs) with any custom slugs
  // already in the DB.
  const mergedSlugs = new Set<string>([
    ...KNOWN_SLUGS.map((k) => k.slug),
    ...rows.map((r) => r.slug),
  ]);
  const entries = Array.from(mergedSlugs).sort().map((slug) => {
    const known = KNOWN_SLUGS.find((k) => k.slug === slug);
    const row = bySlug.get(slug);
    return {
      slug,
      title: row?.title ?? known?.title ?? slug,
      updatedAt: row?.updatedAt ?? null,
      exists: !!row,
    };
  });

  return (
    <section className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
            Admin
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight mt-1">
            Help docs / SOPs
          </h1>
          <p className="text-cg-n-600 mt-2 text-sm">
            Each dashboard has a <code className="bg-cg-n-100 px-1 rounded text-xs">?</code> button that opens a help drawer. The drawer renders this content as markdown. Edit any slug below; changes apply immediately (no deploy needed).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ActionForm
            action={seedDefaultHelpDocs}
            label="Seed defaults"
            loadingLabel="Seeding…"
            title="Insert default SOP content for known slugs. Won't overwrite anything you've edited."
          />
          <PageHelp slug="admin.help" title="Admin · Help docs" />
        </div>
      </header>

      <div className="border border-cg-n-200 rounded-card divide-y divide-cg-n-200">
        {entries.map((e) => (
          <div key={e.slug} className="p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <Link
                  href={`/admin/help/${encodeURIComponent(e.slug)}`}
                  className="font-semibold text-cg-teal hover:underline"
                >
                  {e.title}
                </Link>
                <code className="text-[11px] bg-cg-n-100 px-1.5 py-0.5 rounded">
                  {e.slug}
                </code>
                {!e.exists && (
                  <span className="text-[10px] uppercase tracking-wider bg-cg-warning-tint text-cg-warning px-1.5 py-0.5 rounded">
                    empty
                  </span>
                )}
              </div>
              {e.updatedAt && (
                <p className="text-[11px] text-cg-n-500 mt-1">
                  Updated{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: "America/Los_Angeles",
                    dateStyle: "medium",
                  }).format(new Date(e.updatedAt))}
                </p>
              )}
            </div>
            <Link
              href={`/admin/help/${encodeURIComponent(e.slug)}`}
              className="text-xs border border-cg-teal text-cg-teal rounded-input px-2.5 py-1 hover:bg-cg-teal hover:text-white"
            >
              {e.exists ? "Edit" : "Write"}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
