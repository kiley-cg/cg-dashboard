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
  // Override the configured root folder. Used for range-folder backfills
  // (e.g. "30000-30999") so one Vercel call covers a bounded chunk.
  rootFolderId?: string;
  // Cap on PDFs processed per call. Lets a backfill chunk a large range
  // into multiple Vercel invocations (each capped at 300s).
  limit?: number;
  // Skip the first N files (after newest-first sort). Pair with `limit`
  // to step through a large range across multiple calls.
  offset?: number;
  // How many PDFs to download+parse in parallel. PDF parsing on Vercel
  // is mostly I/O-bound (Drive download), so 4 is a reasonable default.
  concurrency?: number;
}): Promise<SnapshotResult[]> {
  const allProofs = await listProofs({
    modifiedAfter: opts?.modifiedAfter,
    rootFolderId: opts?.rootFolderId,
  });
  const offset = opts?.offset ?? 0;
  const proofs = opts?.limit
    ? allProofs.slice(offset, offset + opts.limit)
    : allProofs.slice(offset);
  const parseSpec = opts?.parseSpec ?? true;
  const concurrency = Math.max(1, opts?.concurrency ?? 4);

  async function processOne(p: typeof proofs[number]): Promise<SnapshotResult> {
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
      return {
        fileId: p.fileId,
        filename: p.filename,
        jobId: null,
        outcome: "skipped",
        reason: "no job# in filename OR PDF body",
        extracted,
      };
    }

    const outcome = await upsertOne(
      { ...p, jobId: effectiveJobId },
      extracted,
    );
    return {
      fileId: p.fileId,
      filename: p.filename,
      jobId: effectiveJobId,
      outcome,
      extracted,
    };
  }

  // Bounded-concurrency map: process up to `concurrency` PDFs in
  // parallel. With parseSpec=false there's no PDF download so the
  // concurrency only affects DB upserts — harmless either way.
  const results: SnapshotResult[] = [];
  for (let i = 0; i < proofs.length; i += concurrency) {
    const batch = proofs.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processOne));
    results.push(...batchResults);
  }
  return results;
}

// Deep import bypasses pdf-parse's index.js, which runs a self-test
// reading ./test/data/05-versions-space.pdf on first load when
// `module.parent` is falsy — true under Next.js's webpack bundler,
// crashing every Vercel function with ENOENT.
type PdfParseFn = (b: Buffer) => Promise<{ text?: string }>;
async function parsePdfText(bytes: Buffer): Promise<string> {
  const mod = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as
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
          inkColors: extracted.inkColors,
          imprintDimensions: extracted.imprintDimensions,
          productName: extracted.productName,
          productColor: extracted.productColor,
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
