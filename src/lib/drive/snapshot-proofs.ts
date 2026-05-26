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
import { downloadProofBytes, listProofs, type DriveProof } from "./proofs";
import { extractProofSpec, type ProofSpec } from "./proof-extract";

export interface SnapshotResult {
  fileId: string;
  filename: string;
  jobId: string | null;
  outcome: "inserted" | "updated" | "skipped";
  reason?: string;
  // D2.B: what we managed to extract from the PDF body. Null entries
  // mean the regex didn't match — surface via the admin probe so we
  // can tune patterns.
  extracted?: ProofSpec;
}

export async function snapshotProofs(opts?: {
  modifiedAfter?: Date;
  // D2.B: extract PDF text + parse spec fields. Defaults to true;
  // pass false for a metadata-only sweep (faster, no Drive download).
  parseSpec?: boolean;
}): Promise<SnapshotResult[]> {
  const proofs = await listProofs({ modifiedAfter: opts?.modifiedAfter });
  const parseSpec = opts?.parseSpec ?? true;

  const results: SnapshotResult[] = [];
  for (const p of proofs) {
    let extracted: ProofSpec | undefined;
    if (parseSpec) {
      try {
        const bytes = await downloadProofBytes(p.fileId);
        const text = await parsePdfText(bytes);
        extracted = extractProofSpec(text);
      } catch {
        extracted = undefined;
      }
    }

    // Resolve effective job ID: prefer filename (cheap), fall back to
    // PDF text. CG embroidery proofs use Art# in the filename, so the
    // PDF body's "PROOF 32353" is usually the canonical source.
    const effectiveJobId = p.jobId ?? extracted?.jobIdFromText ?? null;

    if (!effectiveJobId) {
      results.push({
        fileId: p.fileId,
        filename: p.filename,
        jobId: null,
        outcome: "skipped",
        reason: "no job# in filename OR PDF body",
        extracted,
      });
      continue;
    }

    const outcome = await upsertOne(
      { ...p, jobId: effectiveJobId },
      extracted,
    );
    results.push({
      fileId: p.fileId,
      filename: p.filename,
      jobId: effectiveJobId,
      outcome,
      extracted,
    });
  }
  return results;
}

// Lazy import so the cron route can tree-shake the parser out of the
// bundle when parseSpec=false. pdf-parse pulls in a chunk of Node
// internals that we don't need for the metadata-only path.
// pdf-parse's ESM build exposes a named module; CJS exposes a function
// at .default. Coerce through unknown to either shape and call.
type PdfParseFn = (b: Buffer) => Promise<{ text?: string }>;
async function parsePdfText(bytes: Buffer): Promise<string> {
  const mod = (await import("pdf-parse")) as unknown as
    | PdfParseFn
    | { default: PdfParseFn };
  const fn: PdfParseFn = typeof mod === "function" ? mod : mod.default;
  const result = await fn(bytes);
  return result.text ?? "";
}

async function upsertOne(
  p: DriveProof,
  extracted: ProofSpec | undefined,
): Promise<"inserted" | "updated"> {
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
    extracted: extracted
      ? {
          decoration: extracted.decoration,
          stitches: extracted.stitches,
          jobIdFromText: extracted.jobIdFromText,
          salespersonInitials: extracted.salespersonInitials,
          imprintLocations: extracted.imprintLocations,
          matchedSnippets: extracted.matchedSnippets,
        }
      : undefined,
  };

  const fields = {
    imprintLocation: extracted?.imprintLocation ?? null,
    qtyGarments: extracted?.qtyGarments ?? null,
    // approvedBy is never auto-populated from the PDF — user enters
    // via the Verification Record form on /jobs/[id].
    approvedBy: null,
  };

  if (existing.length > 0) {
    await db
      .update(schema.jobVerificationRecord)
      .set({
        ...fields,
        capturedAt: new Date(),
        raw: raw as unknown as object,
      })
      .where(eq(schema.jobVerificationRecord.id, existing[0].id));
    return "updated";
  }
  await db.insert(schema.jobVerificationRecord).values({
    syncoreJobId: p.jobId!,
    source: "proof",
    ...fields,
    raw: raw as unknown as object,
  });
  return "inserted";
}
