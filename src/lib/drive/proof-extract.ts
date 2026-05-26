// Extract structured spec data from a proof PDF's text content.
//
// Tuned against real CG embroidery proofs (296_AWC_Embroidery_Proof.pdf,
// shared by Kiley 2026-05-26). Key learnings:
//   - Job# lives in the PDF body as "PROOF 32353", NOT the filename
//     (filename uses Art# which is 3 digits).
//   - Imprint location appears as both a bare uppercase header
//     ("LEFT CHEST") and a dimensioned line ("Left Chest 1.87"w x 2.3"h").
//   - Garment qty is NOT in the proof; it's on the Syncore PO. Returns
//     null for embroidery proofs — that's expected.
//   - "KG" initials at the top might be the artist or the approver
//     — flagged as ambiguous; treat as a tentative approver until
//     Kiley confirms the workflow.
//   - Embroidery proofs ALSO carry stitch count + decoration type —
//     extracted as bonus fields.

export interface ProofSpec {
  // Pulled from the PDF body itself when filename didn't yield one.
  // The snapshot uses this as a fallback after filename parsing fails.
  jobIdFromText: string | null;
  imprintLocation: string | null;
  qtyGarments: number | null;
  approvedBy: string | null;
  // Bonus fields surfaced from embroidery proofs.
  decoration: string | null; // "EMBROIDERY", "SCREEN PRINT", ...
  stitches: number | null;   // embroidery only
  // What the regexes actually grabbed — surfaced via the probe so we
  // can iterate.
  matchedSnippets: {
    jobIdFromText?: string;
    location?: string;
    quantity?: string;
    approver?: string;
    decoration?: string;
    stitches?: string;
  };
}

// "PROOF 32353" — canonical job# marker on CG's embroidery proof.
// Allow optional colon/dash, multiple spaces.
const JOB_FROM_PDF_RX = /\bPROOF\b\s*[:#-]?\s*(\d{4,6})\b/i;

const LOCATION_PATTERNS: RegExp[] = [
  // Labeled line: "Imprint Location: …", "Logo Placement: …"
  /imprint\s*(?:location|position)?\s*[:\-]\s*([^\n\r]+)/i,
  /(?:logo|design|art|placement)\s*location\s*[:\-]\s*([^\n\r]+)/i,
  /location\s*[:\-]\s*([^\n\r]+)/i,
  // CG embroidery proof "Left Chest 1.87"w x 2.3"h" — pick the
  // location name immediately before the dimensions.
  /\b((?:left|right|center|full)\s+(?:chest|back|sleeve|hat|thigh|yoke|nape|side))\s+\d/i,
  // Bare uppercase header. Order: more specific first, then generic.
  /\b(LEFT\s+CHEST|RIGHT\s+CHEST|FULL\s+BACK|LEFT\s+SLEEVE|RIGHT\s+SLEEVE|HAT\s+FRONT|HAT\s+SIDE|BACK\s+YOKE|NAPE|LEFT\s+THIGH|RIGHT\s+THIGH)\b/i,
];

const QTY_PATTERNS: RegExp[] = [
  /(?:total\s+)?(?:quantity|qty)\s*[:\-]\s*(\d+)/i,
  /\b(\d+)\s*(?:pcs?\.?|pieces?|garments?|units?)\b/i,
];

const APPROVER_PATTERNS: RegExp[] = [
  /approved\s*by\s*[:\-]\s*([^\n\r]+)/i,
  /approver\s*[:\-]\s*([^\n\r]+)/i,
  /sign[ -]?off\s*(?:by)?\s*[:\-]\s*([^\n\r]+)/i,
  // CG embroidery proof header: "PROOF 32353       KG"
  // Two-letter all-caps initials after the PROOF id. AMBIGUOUS:
  // could be artist OR approver — surface as tentative until Kiley
  // confirms the workflow.
  /\bPROOF\s+\d{4,6}\s+([A-Z]{2,3})\b/,
];

const DECORATION_RX = /\bDecoration\s*[:\-]\s*([A-Z][A-Z\s]+?)(?:\n|$)/i;
const STITCHES_RX = /\bSTITCHES\s+([0-9,]+)\b/i;

function tryPatterns(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function cleanLocation(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.replace(/[.,;]+$/, "").trim();
  // Normalize "LEFT CHEST" → "Left Chest" for readability in the UI.
  if (s === s.toUpperCase()) {
    s = s
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (s.length > 60) s = s.slice(0, 60).trim() + "…";
  return s || null;
}

function cleanApprover(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.replace(/[.,;]+$/, "").trim();
  s = s.replace(/\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}.*$/, "").trim();
  if (s.length > 60) s = s.slice(0, 60).trim() + "…";
  return s || null;
}

function cleanDecoration(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/[.,;]+$/, "").trim().toUpperCase();
}

export function extractProofSpec(text: string): ProofSpec {
  const jobMatch = text.match(JOB_FROM_PDF_RX);
  const jobIdFromText = jobMatch ? jobMatch[1] : null;

  const locationRaw = tryPatterns(text, LOCATION_PATTERNS);
  const qtyRaw = tryPatterns(text, QTY_PATTERNS);
  const approverRaw = tryPatterns(text, APPROVER_PATTERNS);
  const decorationMatch = text.match(DECORATION_RX);
  const decorationRaw = decorationMatch ? decorationMatch[1] : null;
  const stitchesMatch = text.match(STITCHES_RX);
  const stitchesRaw = stitchesMatch ? stitchesMatch[1] : null;

  let qtyGarments: number | null = null;
  if (qtyRaw) {
    const n = Number(qtyRaw);
    if (Number.isFinite(n) && n > 0 && n < 100_000) qtyGarments = n;
  }
  let stitches: number | null = null;
  if (stitchesRaw) {
    const n = Number(stitchesRaw.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0 && n < 10_000_000) stitches = n;
  }

  return {
    jobIdFromText,
    imprintLocation: cleanLocation(locationRaw),
    qtyGarments,
    approvedBy: cleanApprover(approverRaw),
    decoration: cleanDecoration(decorationRaw),
    stitches,
    matchedSnippets: {
      jobIdFromText: jobIdFromText ?? undefined,
      location: locationRaw ?? undefined,
      quantity: qtyRaw ?? undefined,
      approver: approverRaw ?? undefined,
      decoration: decorationRaw ?? undefined,
      stitches: stitchesRaw ?? undefined,
    },
  };
}
