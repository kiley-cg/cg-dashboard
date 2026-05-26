"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { hasPermission } from "@/lib/rbac";

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.help",
  });
  if (!allowed) throw new Error("Not authorized");
  return session?.user?.id ?? null;
}

const SLUG_RX = /^[a-z][a-z0-9._-]{0,60}$/;

export async function upsertHelpDoc(formData: FormData): Promise<void> {
  const userId = await requireAdmin();
  const slug = String(formData.get("slug") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const bodyMd = String(formData.get("bodyMd") ?? "");
  if (!SLUG_RX.test(slug)) {
    throw new Error("Slug must be lower-snake/dot-separated, ≤60 chars, start with a letter.");
  }
  if (!title) throw new Error("Title is required");

  const existing = await db
    .select({ id: schema.helpDocs.id })
    .from(schema.helpDocs)
    .where(eq(schema.helpDocs.slug, slug))
    .limit(1);
  const now = new Date();
  if (existing.length === 0) {
    await db.insert(schema.helpDocs).values({
      slug,
      title,
      bodyMd,
      updatedByUserId: userId,
    });
  } else {
    await db
      .update(schema.helpDocs)
      .set({ title, bodyMd, updatedAt: now, updatedByUserId: userId })
      .where(eq(schema.helpDocs.id, existing[0].id));
  }
  revalidatePath("/admin/help");
  revalidatePath(`/admin/help/${slug}`);
}

export async function deleteHelpDoc(formData: FormData): Promise<void> {
  await requireAdmin();
  const slug = String(formData.get("slug") ?? "");
  if (!slug) throw new Error("Missing slug");
  await db.delete(schema.helpDocs).where(eq(schema.helpDocs.slug, slug));
  revalidatePath("/admin/help");
}

// One-click: insert default SOP content for every well-known slug
// (production / inventory / dashboard / admin.*). Idempotent — skips
// slugs that already have a row so admin edits aren't clobbered.
export async function seedDefaultHelpDocs(
  _prevState: string | null,
): Promise<string> {
  await requireAdmin();
  const { seedHelpDocs } = await import("@/lib/db/seed-help");
  const result = await seedHelpDocs();
  revalidatePath("/admin/help");
  if (result.inserted === 0) {
    return `All ${result.skipped} default help docs already present.`;
  }
  return `Inserted ${result.inserted} default help doc${result.inserted === 1 ? "" : "s"} (${result.skipped} already present).`;
}
