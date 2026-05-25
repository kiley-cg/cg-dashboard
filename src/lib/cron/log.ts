// Cron run logger. Wraps a Next.js Route Handler so each invocation is
// captured in cron_runs (path, duration, status, summary). Powers the
// /admin/crons page's run history without each cron route having to do
// its own bookkeeping.
//
// Usage in a route handler:
//
//   import { logCronRun } from "@/lib/cron/log";
//   async function handler(req: Request) { ...; return NextResponse.json({ summary, ... }); }
//   export const POST = logCronRun("/api/cron/foo", handler);
//   export const GET  = logCronRun("/api/cron/foo", handler);

import { db, schema } from "@/lib/db/client";

type Handler = (req: Request) => Promise<Response>;

export function logCronRun(cronPath: string, handler: Handler): Handler {
  return async (req: Request) => {
    const startedAt = Date.now();
    const triggeredBy = req.headers.get("x-triggered-by")?.trim() || "schedule";
    let res: Response;
    try {
      res = await handler(req);
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      await safeInsert({
        cronPath,
        triggeredBy,
        durationMs,
        status: "error",
        errorMessage: message.slice(0, 1000),
        summary: null,
      });
      throw err;
    }

    // Try to pull `summary` out of the response body so the admin UI
    // can render meaningful info (rows polled, errors, etc.) without
    // having to parse from elsewhere. We clone before reading so the
    // original response can still be returned to the caller.
    let summary: unknown = null;
    let errorMessage: string | null = null;
    try {
      const clone = res.clone();
      const body = await clone.json().catch(() => null);
      if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        if ("summary" in b) summary = b.summary;
        if (b.ok === false && typeof b.error === "string") {
          errorMessage = b.error.slice(0, 1000);
        }
      }
    } catch {
      // Non-JSON response, fine — just no summary recorded.
    }

    const status = res.ok && errorMessage === null ? "ok" : "error";
    await safeInsert({
      cronPath,
      triggeredBy,
      durationMs: Date.now() - startedAt,
      status,
      summary,
      errorMessage,
    });
    return res;
  };
}

async function safeInsert(row: {
  cronPath: string;
  triggeredBy: string;
  durationMs: number;
  status: string;
  summary: unknown;
  errorMessage: string | null;
}): Promise<void> {
  try {
    await db.insert(schema.cronRuns).values({
      cronPath: row.cronPath,
      triggeredBy: row.triggeredBy,
      durationMs: row.durationMs,
      status: row.status,
      summary: row.summary == null ? null : (row.summary as object),
      errorMessage: row.errorMessage,
    });
  } catch {
    // Don't let a logging failure propagate to the cron's response.
    // If the cron_runs table hasn't been migrated yet, this stays a no-op.
  }
}
