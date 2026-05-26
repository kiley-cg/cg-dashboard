// Walk the Drive proofs folder recursively, return every PDF file we
// can attribute to a Syncore job by parsing the job# out of the
// filename. Customer/job nesting is supported — we recurse through
// any subfolders.

import { getDriveClient, getProofsFolderId } from "./client";

export interface DriveProof {
  fileId: string;
  filename: string;
  // ID of the immediate parent folder (used to recover customer name
  // for grouping/debug).
  parentFolderId: string;
  parentFolderName: string | null;
  mimeType: string;
  modifiedAt: string; // ISO 8601 from Drive
  webViewLink: string | null;
  // Extracted from filename via regex. Null when we can't find a
  // plausible job# (caller can decide to skip or surface for manual
  // attention).
  jobId: string | null;
  // Best-effort revision tag from filename, e.g. "V2" or "rev3".
  revision: string | null;
}

// Job# extraction. CG job IDs are 4-6 digits today. Pull the FIRST
// run of 4-6 digits; refine later if we see false positives. Examples
// that match:
//   "32642-PeakCU-V1.pdf"   → 32642
//   "Job_32642_back.pdf"    → 32642
//   "327-customername.pdf"  → null (too short; protects against "year" matches)
const JOB_RX = /\b(\d{4,6})\b/;

// Revision detection — accept "V2", "v3", "rev4", "_R2".
const REV_RX = /\b[vVrR](?:ev)?[_-]?(\d+)\b/;

export function parseFilename(name: string): {
  jobId: string | null;
  revision: string | null;
} {
  const jobMatch = name.match(JOB_RX);
  const revMatch = name.match(REV_RX);
  return {
    jobId: jobMatch ? jobMatch[1] : null,
    revision: revMatch ? `V${revMatch[1]}` : null,
  };
}

/**
 * List all PDFs under the root proofs folder (recursive). Returns
 * proofs sorted newest-modified first so the cron can process in a
 * sensible order if it ever needs to bail early.
 */
export async function listProofs(opts?: {
  rootFolderId?: string;
  modifiedAfter?: Date;
}): Promise<DriveProof[]> {
  const drive = getDriveClient();
  const rootId = opts?.rootFolderId ?? getProofsFolderId();
  const modifiedAfter = opts?.modifiedAfter;

  // BFS through folders. Drive's API supports `'X' in parents` for
  // one-level listing; we recurse to handle nested customer/job folders.
  const queue: Array<{ id: string; name: string | null }> = [
    { id: rootId, name: null },
  ];
  const out: DriveProof[] = [];

  while (queue.length > 0) {
    const folder = queue.shift()!;
    let pageToken: string | undefined;
    while (true) {
      const qParts: string[] = [
        `'${folder.id.replace(/'/g, "\\'")}' in parents`,
        "trashed = false",
      ];
      if (modifiedAfter) {
        qParts.push(`modifiedTime > '${modifiedAfter.toISOString()}'`);
      }
      const res = await drive.files.list({
        q: qParts.join(" and "),
        fields:
          "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, parents)",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const files = res.data.files ?? [];
      for (const f of files) {
        if (!f.id) continue;
        if (f.mimeType === "application/vnd.google-apps.folder") {
          queue.push({ id: f.id, name: f.name ?? null });
          continue;
        }
        // PDFs only for v1 — Christina's proofs are PDFs per her flow.
        // Expand to image/png + image/jpeg in a follow-up if needed
        // (would also need OCR).
        if (f.mimeType !== "application/pdf") continue;
        const { jobId, revision } = parseFilename(f.name ?? "");
        out.push({
          fileId: f.id,
          filename: f.name ?? "(unnamed)",
          parentFolderId: folder.id,
          parentFolderName: folder.name,
          mimeType: f.mimeType,
          modifiedAt: f.modifiedTime ?? new Date().toISOString(),
          webViewLink: f.webViewLink ?? null,
          jobId,
          revision,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
  }

  // Newest first.
  out.sort((a, b) =>
    b.modifiedAt.localeCompare(a.modifiedAt),
  );
  return out;
}

/**
 * Download a Drive file's bytes given its fileId. Used by the PDF
 * parser (D2.B) to fetch the proof body for text extraction.
 */
export async function downloadProofBytes(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  // googleapis returns an ArrayBuffer when responseType is set.
  return Buffer.from(res.data as ArrayBuffer);
}
