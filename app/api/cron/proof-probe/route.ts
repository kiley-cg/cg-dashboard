// Phase D2.B probe — given a Drive fileId, downloads the PDF, runs
// the parser, and returns BOTH the extracted spec AND the raw text
// (truncated) so we can iterate the regexes against real proofs.
//
// Usage:
//   curl -s -H "x-cron-secret: $CRON_SECRET" \
//     "https://inventory-check-neon.vercel.app/api/cron/proof-probe?fileId=<DRIVE_FILE_ID>" | jq
//
// Under /api/cron/* so x-cron-secret bypasses the auth middleware.

import { NextResponse } from "next/server";
import { downloadProofBytes } from "@/lib/drive/proofs";
import { extractProofSpec } from "@/lib/drive/proof-extract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const x = req.headers.get("x-cron-secret") ?? "";
  return x === expected;
}

type PdfParseFn = (b: Buffer) => Promise<{ text?: string }>;

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const fileId = url.searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json(
      { ok: false, error: "missing ?fileId=<DRIVE_FILE_ID>" },
      { status: 400 },
    );
  }
  try {
    const bytes = await downloadProofBytes(fileId);
    // Deep import: pdf-parse@1.1.1's index.js runs a self-test on
    // load that crashes under Next.js's webpack bundler.
    const mod = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as
      | PdfParseFn
      | { default: PdfParseFn };
    const pdfParse: PdfParseFn = typeof mod === "function" ? mod : mod.default;
    const result = await pdfParse(bytes);
    const text = result.text ?? "";
    const extracted = extractProofSpec(text);
    return NextResponse.json({
      ok: true,
      fileId,
      extracted,
      textPreview: text.slice(0, 4000),
      textLength: text.length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        fileId,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
