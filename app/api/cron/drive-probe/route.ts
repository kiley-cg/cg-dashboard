// Phase D2 diagnostic — verifies Drive auth + folder ID without doing
// any recursion. Lists ONLY the immediate children of the configured
// proofs folder, capped at 25 results. Should return in <5s when the
// setup is correct.
//
// Usage:
//   curl -s -H "x-cron-secret: $CRON_SECRET" \
//     "https://inventory-check-neon.vercel.app/api/cron/drive-probe" | jq
//
// Lives under /api/cron/* so the middleware's CRON_SECRET carve-out
// applies — /api/admin/* would require a signed-in session.

import { NextResponse } from "next/server";
import { getDriveClient, getProofsFolderId } from "@/lib/drive/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const env = {
    GOOGLE_SA_EMAIL: process.env.GOOGLE_SA_EMAIL?.trim() ?? null,
    GOOGLE_SA_PRIVATE_KEY_present: Boolean(process.env.GOOGLE_SA_PRIVATE_KEY),
    GOOGLE_SA_PRIVATE_KEY_length: process.env.GOOGLE_SA_PRIVATE_KEY?.length ?? 0,
    DRIVE_PROOFS_FOLDER_ID: process.env.DRIVE_PROOFS_FOLDER_ID?.trim() ?? null,
  };

  const started = Date.now();
  try {
    const drive = getDriveClient();
    const folderId = getProofsFolderId();

    // 1. Confirm folder is readable by the SA.
    const meta = await drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType, driveId, parents",
      supportsAllDrives: true,
    });

    // 2. Single-page listing, capped at 25 items — no recursion.
    const list = await drive.files.list({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, modifiedTime)",
      pageSize: 25,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = list.data.files ?? [];
    const folderCount = files.filter(
      (f) => f.mimeType === "application/vnd.google-apps.folder",
    ).length;
    const pdfCount = files.filter((f) => f.mimeType === "application/pdf").length;

    return NextResponse.json({
      ok: true,
      env,
      folder: {
        id: meta.data.id,
        name: meta.data.name,
        mimeType: meta.data.mimeType,
        driveId: meta.data.driveId ?? null,
      },
      sample: {
        count: files.length,
        folderCount,
        pdfCount,
        items: files.slice(0, 10).map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
        })),
      },
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        env,
        error: msg,
        durationMs: Date.now() - started,
      },
      { status: 500 },
    );
  }
}
