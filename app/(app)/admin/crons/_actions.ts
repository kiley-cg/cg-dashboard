"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

// Trigger a cron handler "now" by calling its own HTTP endpoint with
// the CRON_SECRET. Kept as a self-fetch (vs invoking the handler in
// the same process) so the run flows through the exact same code path
// the scheduled invocation takes — logging, auth check, everything.
export async function runCronNow(formData: FormData): Promise<void> {
  const session = await auth();
  const allowed = await hasPermission({
    email: session?.user?.email,
    userId: session?.user?.id,
    permission: "admin.crons",
  });
  if (!allowed) throw new Error("Not authorized");

  const path = String(formData.get("path") ?? "");
  if (!path.startsWith("/api/cron/")) throw new Error("Invalid cron path");

  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET not configured");

  // Derive the absolute URL from VERCEL_URL (set in prod) or default to
  // localhost so this works in dev too.
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    "localhost:3000";
  const scheme = host.includes("localhost") ? "http" : "https";
  const url = `${scheme}://${host}${path}`;

  // Fire-and-forget — the cron itself logs into cron_runs via
  // logCronRun, so we don't need to await the body. We do await the
  // initial response so the user sees errors (network, 401, etc).
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
    throw new Error(`Cron returned ${res.status}: ${body.slice(0, 200)}`);
  }

  revalidatePath("/admin/crons");
}
