// Walk Drive proofs, upsert each into job_verification_record with
// source='proof'. Stub today — D2.A only writes file metadata into
// `raw` and leaves imprintLocation/qtyGarments/approvedBy null. D2.B
// will plug in a PDF parser to populate those fields.
//
// Dedupe key: (syncoreJobId, source='proof', raw->>'fileId'). We don't
// add a UNIQUE constraint yet (proof files can get re-uploaded with
// the same name), so the snapshot does its own existence check by
// fileId.

import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { listProofs, type DriveProof } from "./proofs";

export interface SnapshotResult {
  fileId: string;
  filename: string;
  jobId: string | null;
  outcome: "inserted" | "updated" | "skipped";
  reason?: string;
}

export async function snapshotProofs(opts?: {
  modifiedAfter?: Date;
}): Promise<SnapshotResult[]> {
  const proofs = await listProofs({ modifiedAfter: opts?.modifiedAfter });

  const results: SnapshotResult[] = [];
  for (const p of proofs) {
    if (!p.jobId) {
      results.push({
        fileId: p.fileId,
        filename: p.filename,
        jobId: null,
        outcome: "skipped",
        reason: "no job# in filename",
      });
      continue;
    }
    const outcome = await upsertOne(p);
    results.push({
      fileId: p.fileId,
      filename: p.filename,
      jobId: p.jobId,
      outcome,
    });
  }
  return results;
}

async function upsertOne(p: DriveProof): Promise<"inserted" | "updated"> {
  // Look for an existing proof row for this job + fileId. We store
  // fileId inside `raw->>'fileId'` so each unique Drive file maps to
  // exactly one row.
  const existing = await db
    .select({ id: schema.jobVerificationRecord.id })
    .from(schema.jobVerificationRecord)
    .where(
      and(
        eq(schema.jobVerificationRecord.syncoreJobId, p.jobId!),
        eq(schema.jobVerificationRecord.source, "proof"),
        sql`${schema.jobVerificationRecord.raw}->>'fileId' = ${p.fileId}`,
      ),
    )
    .limit(1);

  const raw = {
    fileId: p.fileId,
    filename: p.filename,
    revision: p.revision,
    parentFolderId: p.parentFolderId,
    parentFolderName: p.parentFolderName,
    webViewLink: p.webViewLink,
    modifiedAt: p.modifiedAt,
  };

  if (existing.length > 0) {
    await db
      .update(schema.jobVerificationRecord)
      .set({
        // D2.B will populate these from PDF text. For now they stay
        // whatever they were on insert.
        capturedAt: new Date(),
        raw: raw as unknown as object,
      })
      .where(eq(schema.jobVerificationRecord.id, existing[0].id));
    return "updated";
  }
  await db.insert(schema.jobVerificationRecord).values({
    syncoreJobId: p.jobId!,
    source: "proof",
    raw: raw as unknown as object,
  });
  return "inserted";
}
