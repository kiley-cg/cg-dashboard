import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasPermission } from "@/lib/rbac";
import { deleteHelpDoc, upsertHelpDoc } from "../_actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function EditHelpDocPage({ params }: PageProps) {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.help",
  });
  if (!allowed) notFound();

  const { slug } = await params;
  const rows = await db
    .select()
    .from(schema.helpDocs)
    .where(eq(schema.helpDocs.slug, slug))
    .limit(1);
  const doc = rows[0];

  return (
    <section className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <header>
        <Link
          href="/admin/help"
          className="text-xs text-cg-teal hover:underline"
        >
          ← All help docs
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight mt-2">
          {doc?.title ?? "New help doc"}
        </h1>
        <p className="text-cg-n-600 mt-1 text-sm">
          Slug: <code className="bg-cg-n-100 px-1 rounded text-xs">{slug}</code>
          {doc?.updatedAt && (
            <>
              {" "}· Updated{" "}
              {new Intl.DateTimeFormat("en-US", {
                timeZone: "America/Los_Angeles",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(doc.updatedAt))}
            </>
          )}
        </p>
      </header>

      <form action={upsertHelpDoc} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-cg-n-600">
            Title
          </span>
          <input
            type="text"
            name="title"
            required
            defaultValue={doc?.title ?? ""}
            className="mt-1 w-full border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-cg-n-600">
            Body (markdown)
          </span>
          <textarea
            name="bodyMd"
            rows={20}
            defaultValue={doc?.bodyMd ?? ""}
            className="mt-1 w-full border border-cg-n-300 rounded-input px-2 py-2 bg-white text-sm font-mono leading-relaxed"
            placeholder={`# How to use this dashboard\n\nStep 1...\nStep 2...\n\n## Tips\n- Bullet a\n- Bullet b`}
          />
          <span className="text-[11px] text-cg-n-500 mt-1 block">
            Supports headings (#), lists, links, tables (GFM). Saved
            content renders live in the help drawer on every page with
            the matching slug.
          </span>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-btn bg-cg-black text-white px-4 py-1.5 text-sm font-semibold hover:bg-cg-n-800"
          >
            Save
          </button>
          {doc && (
            <form action={deleteHelpDoc}>
              <input type="hidden" name="slug" value={slug} />
              <button
                type="submit"
                className="text-xs text-cg-n-500 hover:text-cg-red ml-2"
              >
                Delete this doc
              </button>
            </form>
          )}
        </div>
      </form>
    </section>
  );
}
