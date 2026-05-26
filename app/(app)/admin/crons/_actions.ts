"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

// Trigger a cron handler "now" by calling its own HTTP endpoint with
// the CRON_SECRET. Kept as a self-fetch (vs invoking the handler in
// the same process) so the run flows through the exact same code path
// the scheduled invocation takes — logging, auth check, everything.
export async function runCronNow(
  _prevState: string | null,
  formData: FormData,
): Promise<string> {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.crons",
  });
  if (!allowed) return "Not authorized";

  const path = String(formData.get("path") ?? "");
  if (!path.startsWith("/api/cron/")) return "Invalid cron path";

  const secret = process.env.CRON_SECRET;
  if (!secret) return "CRON_SECRET not configured";

  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    "localhost:3000";
  const scheme = host.includes("localhost") ? "http" : "https";
  const url = `${scheme}://${host}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "x-triggered-by": session?.user?.id ?? "admin",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return `Cron returned ${res.status}: ${body.slice(0, 120)}`;
  }

  revalidatePath("/admin/crons");
  return "Triggered — last-run row should appear momentarily.";
}
