// Help / SOP doc fetcher. Pages call getHelpDoc("production") on the
// server to render the initial drawer state; admin UI mutates via the
// server actions in app/(app)/admin/help/_actions.ts.

import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";

export interface HelpDoc {
  slug: string;
  title: string;
  bodyMd: string;
  updatedAt: Date | null;
}

export async function getHelpDoc(slug: string): Promise<HelpDoc | null> {
  const rows = await db
    .select()
    .from(schema.helpDocs)
    .where(eq(schema.helpDocs.slug, slug))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    slug: r.slug,
    title: r.title,
    bodyMd: r.bodyMd,
    updatedAt: r.updatedAt,
  };
}
