// Extract structured spec data from a proof PDF's text content.
//
// Tuned against real CG proofs:
//   - 296_AWC_Embroidery_Proof.pdf (single-location embroidery)
//   - 31549_Reliable_Electric_Proof.pdf (multi-location screen print)
//
// Key learnings:
//   - Job# lives in the PDF body as "PROOF 32353", NOT the filename
//     (filename uses Art# which can be 3-5 digits).
//   - "KG" at the top of the proof is the SALESPERSON initials (per
//     Kiley confirm 2026-05-26), not the approver. Approver lives
//     elsewhere — we don't auto-extract it; user enters via the form.
//   - Imprint location often plural: "Left Chest 4\"w x 1.97\"h" PLUS
//     "Full Back 12\"w x XX\"h". Need to capture all of them.
//   - Garment qty is NOT in the proof; it's on the Syncore PO.
//   - Embroidery proofs ALSO carry stitch count + decoration type.

export interface ProofSpec {
  // Pulled from the PDF body itself when filename didn't yield one.
  jobIdFromText: string | null;
  // Primary location for the schema's text column. Comma-joined when
  // the proof has multiple locations.
  imprintLocation: string | null;
  imprintLocations: string[]; // every location detected, in order
  qtyGarments: number | null;
  // We don't auto-extract this — user enters via the form. Always null
  // from the PDF; field kept for shape consistency.
  approvedBy: null;
  decoration: string | null; // "EMBROIDERY", "SCREEN PRINT", ...
  stitches: number | null;   // embroidery only
  salespersonInitials: string | null; // "KG" etc. — maps to people registry
  matchedSnippets: {
    jobIdFromText?: string;
    locations?: string[];
    decoration?: string;
    stitches?: string;
    salesperson?: string;
  };
}

const JOB_FROM_PDF_RX = /\bPROOF\b\s*[:#-]?\s*(\d{4,6})\b/i;

// Match dimensioned lines like "Left Chest    4\"w x 1.97\"h" or
// "Full Back    12\"w x XX\"h". Capture the location name only.
const LOCATION_DIMENSIONED_RX =
  /^\s*((?:left|right|center|full)\s+(?:chest|back|sleeve|hat|thigh|yoke|nape|side))\s+[\d"”'X]/gim;

// Bare uppercase header. Used as a fallback when no dimensioned lines
// were found (e.g. proofs that don't include sizing).
const LOCATION_HEADER_RX =
  /\b(LEFT\s+CHEST|RIGHT\s+CHEST|FULL\s+BACK|LEFT\s+SLEEVE|RIGHT\s+SLEEVE|HAT\s+FRONT|HAT\s+SIDE|BACK\s+YOKE|NAPE|LEFT\s+THIGH|RIGHT\s+THIGH)\b/gi;

const QTY_PATTERNS: RegExp[] = [
  /(?:total\s+)?(?:quantity|qty)\s*[:\-]\s*(\d+)/i,
  /\b(\d+)\s*(?:pcs?\.?|pieces?|garments?|units?)\b/i,
];

const DECORATION_RX = /\bDecoration\s*[:\-]\s*([A-Z][A-Z\s]+?)(?:\n|$)/i;
const STITCHES_RX = /\bSTITCHES\s+([0-9,]+)\b/i;
// Salesperson initials sit on the proof header line:
//   "PROOF 31549     KG"
// 2-3 uppercase letters after the job#.
const SALESPERSON_RX = /\bPROOF\s+\d{4,6}\s+([A-Z]{2,3})\b/;

function tryPatterns(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractLocations(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  // First pass: dimensioned lines (most reliable).
  for (const m of text.matchAll(LOCATION_DIMENSIONED_RX)) {
    const norm = titleCase(m[1]).replace(/\s+/g, " ").trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  if (out.length > 0) return out;

  // Fallback: bare uppercase header keywords.
  for (const m of text.matchAll(LOCATION_HEADER_RX)) {
    const norm = titleCase(m[1]).replace(/\s+/g, " ").trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

function cleanDecoration(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/[.,;]+$/, "").trim().toUpperCase();
}

export function extractProofSpec(text: string): ProofSpec {
  const jobMatch = text.match(JOB_FROM_PDF_RX);
  const jobIdFromText = jobMatch ? jobMatch[1] : null;

  const locations = extractLocations(text);
  const imprintLocation = locations.length > 0 ? locations.join(", ") : null;

  const qtyRaw = tryPatterns(text, QTY_PATTERNS);
  let qtyGarments: number | null = null;
  if (qtyRaw) {
    const n = Number(qtyRaw);
    if (Number.isFinite(n) && n > 0 && n < 100_000) qtyGarments = n;
  }

  const decorationMatch = text.match(DECORATION_RX);
  const decorationRaw = decorationMatch ? decorationMatch[1] : null;

  const stitchesMatch = text.match(STITCHES_RX);
  const stitchesRaw = stitchesMatch ? stitchesMatch[1] : null;
  let stitches: number | null = null;
  if (stitchesRaw) {
    const n = Number(stitchesRaw.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0 && n < 10_000_000) stitches = n;
  }

  const salesMatch = text.match(SALESPERSON_RX);
  const salespersonInitials = salesMatch ? salesMatch[1] : null;

  return {
    jobIdFromText,
    imprintLocation,
    imprintLocations: locations,
    qtyGarments,
    approvedBy: null,
    decoration: cleanDecoration(decorationRaw),
    stitches,
    salespersonInitials,
    matchedSnippets: {
      jobIdFromText: jobIdFromText ?? undefined,
      locations: locations.length > 0 ? locations : undefined,
      decoration: decorationRaw ?? undefined,
      stitches: stitchesRaw ?? undefined,
      salesperson: salespersonInitials ?? undefined,
    },
  };
}
