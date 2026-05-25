// Server-component wrapper around HelpButton (client) that fetches the
// doc + permission check in one spot. Drop it on any page's header
// with just <PageHelp slug="…" title="…" /> — no per-page boilerplate.

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { getHelpDoc } from "@/lib/help";
import { HelpButton } from "./HelpDrawer";

export async function PageHelp({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  const session = await auth();
  const [doc, canEdit] = await Promise.all([
    getHelpDoc(slug),
    hasPermission({
      email: session?.user?.email,
      userId: session?.user?.id,
      permission: "admin.help",
    }),
  ]);
  return <HelpButton slug={slug} title={title} doc={doc} canEdit={canEdit} />;
}
