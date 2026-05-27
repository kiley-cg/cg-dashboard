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
  // the proof has multiple locations. For promo products this is
  // typically "Default".
  imprintLocation: string | null;
  imprintLocations: string[]; // every location detected, in order
  qtyGarments: number | null;
  // We don't auto-extract this — user enters via the form. Always null
  // from the PDF; field kept for shape consistency.
  approvedBy: null;
  decoration: string | null; // "EMBROIDERY", "SCREEN PRINT", "PAD PRINT", ...
  stitches: number | null;   // embroidery only
  salespersonInitials: string | null; // "KG" / "HLM" — maps to people registry
  // Promo-product fields. Null for garment decoration where the
  // concepts don't apply.
  inkColors: string[];                  // ["WHITE", "BLACK"]
  imprintDimensions: string | null;     // "1.2321\"w x 0.5957\"h"
  productName: string | null;           // "Baseball Stress Reliever"
  productColor: string | null;          // "Royal blue"
  matchedSnippets: {
    jobIdFromText?: string;
    locations?: string[];
    decoration?: string;
    stitches?: string;
    salesperson?: string;
    inkColors?: string[];
    dimensions?: string;
  };
}

// Job# can appear three ways across the proof corpus:
//   - "PROOF 32353" (embroidery/screen-print header)
//   - "Art# 32665"  (promo header — also appears on garments)
//   - "32665HLM" trailing at end of text (promo footer, no space)
const JOB_RX_PROOF = /\bPROOF\b[\s:#-]+(\d{4,6})\b/i;
const JOB_RX_ART = /\bArt\s*#\s*(\d{4,6})\b/i;
const JOB_RX_TRAILING = /(\d{4,6})[A-Z]{2,3}\s*$/m;

// Garment locations (embroidery / screen print): "Left Chest 4\"w x 1.97\"h".
const LOCATION_DIMENSIONED_RX =
  /^\s*((?:left|right|center|full)\s+(?:chest|back|sleeve|hat|thigh|yoke|nape|side))\s+[\d"”'X]/gim;

// Bare uppercase header. Used as a fallback when no dimensioned lines
// were found (e.g. proofs that don't include sizing).
const LOCATION_HEADER_RX =
  /\b(LEFT\s+CHEST|RIGHT\s+CHEST|FULL\s+BACK|LEFT\s+SLEEVE|RIGHT\s+SLEEVE|HAT\s+FRONT|HAT\s+SIDE|BACK\s+YOKE|NAPE|LEFT\s+THIGH|RIGHT\s+THIGH)\b/gi;

// Promo product imprint area marker. The location word is concatenated
// with the dimensions, no space: "Default1.2321\"w x 0.5957 \"h".
// Capture the dimensions string for downstream display.
const PROMO_IMPRINT_RX =
  /\b(Default|Front|Back|Top|Bottom|Side|Lid|Handle|Strap)(\d+(?:\.\d+)?["”'][wh])/gi;

const QTY_PATTERNS: RegExp[] = [
  /(?:total\s+)?(?:quantity|qty)\s*[:\-]\s*(\d+)/i,
  /\b(\d+)\s*(?:pcs?\.?|pieces?|garments?|units?)\b/i,
];

const DECORATION_RX = /\bDecoration\s*[:\-]\s*([A-Z][A-Z\s]+?)(?:\n|$)/i;
const STITCHES_RX = /\bSTITCHES\s+([0-9,]+)\b/i;

// Salesperson initials. Two layouts observed:
//   - "PROOF 31549     KG" (embroidery/screen-print, space-separated)
//   - "32665HLM" (promo, concatenated at end of text)
const SALESPERSON_HEADER_RX = /\bPROOF\s+\d{4,6}\s+([A-Z]{2,3})\b/;
const SALESPERSON_TRAILING_RX = /(\d{4,6})([A-Z]{2,3})\s*$/m;

// "INK COLORS\nWHITE\n[next line]" — ink colors are listed one per line
// after the header. We capture the first 1-3 lines of uppercase tokens.
const INK_COLORS_RX = /\bINK\s+COLORS\s*\n((?:[A-Z][A-Z\s\/&]*\n){1,6})/i;

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

function extractLocations(text: string): {
  locations: string[];
  dimensions: string | null;
} {
  const seen = new Set<string>();
  const out: string[] = [];

  // First pass: dimensioned garment lines (most reliable).
  for (const m of text.matchAll(LOCATION_DIMENSIONED_RX)) {
    const norm = titleCase(m[1]).replace(/\s+/g, " ").trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }

  // Second pass: promo product layout — "Default1.23\"w x 0.59\"h".
  // Captures the dimensions snippet for separate storage too.
  let dimensions: string | null = null;
  for (const m of text.matchAll(PROMO_IMPRINT_RX)) {
    const norm = titleCase(m[1]).trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
    if (!dimensions) {
      // Re-scan the same line to grab the full "1.2321"w x 0.5957"h"
      // since PROMO_IMPRINT_RX only captures the start of dimensions.
      const lineRx = new RegExp(
        `${m[1]}\\s*(\\d+(?:\\.\\d+)?["”'][wh]\\s*x\\s*\\d+(?:\\.\\d+)?\\s*["”'][wh])`,
        "i",
      );
      const dimMatch = text.match(lineRx);
      dimensions = dimMatch ? dimMatch[1].replace(/\s+/g, " ").trim() : null;
    }
  }
  if (out.length > 0) return { locations: out, dimensions };

  // Fallback: bare uppercase garment header keywords.
  for (const m of text.matchAll(LOCATION_HEADER_RX)) {
    const norm = titleCase(m[1]).replace(/\s+/g, " ").trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return { locations: out, dimensions };
}

function extractInkColors(text: string): string[] {
  const m = text.match(INK_COLORS_RX);
  if (!m) return [];
  return m[1]
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 30 && /^[A-Z][A-Z\s\/&]*$/.test(s));
}

// "Product :\nColor :\nBaseball Stress\nReliever\nRoyal blue"
// Labels and values are on separate lines (PDF spatial layout). Look
// for the labels then take the next 1-2 non-label lines as values.
function extractProductAndColor(
  text: string,
): { product: string | null; color: string | null } {
  const lines = text.split("\n").map((l) => l.trim());
  const productIdx = lines.findIndex((l) => /^Product\s*:/i.test(l));
  const colorIdx = lines.findIndex((l) => /^Color\s*:/i.test(l));
  if (productIdx < 0 || colorIdx < 0) return { product: null, color: null };

  // After "Product :" / "Color :" the next two lines tend to be
  // product (1-2 lines, e.g. "Baseball Stress" / "Reliever") then the
  // color. Heuristic: take up to 2 lines after Color: as product,
  // last one as color. Tuned against the Baseball Stress Reliever proof.
  const after = lines.slice(colorIdx + 1).filter((l) => l.length > 0);
  if (after.length === 0) return { product: null, color: null };
  if (after.length === 1) return { product: null, color: after[0] };
  // Last line is color; everything before is the product name.
  const color = after[after.length - 1];
  const product = after.slice(0, -1).join(" ").trim();
  return { product, color };
}

function cleanDecoration(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/[.,;]+$/, "").trim().toUpperCase();
}

export function extractProofSpec(text: string): ProofSpec {
  // Try each job# pattern in order: PROOF header > Art# > trailing.
  const jobIdFromText =
    text.match(JOB_RX_PROOF)?.[1] ??
    text.match(JOB_RX_ART)?.[1] ??
    text.match(JOB_RX_TRAILING)?.[1] ??
    null;

  const { locations, dimensions } = extractLocations(text);
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

  // Salesperson: try header layout first (space-separated), then
  // trailing layout (concatenated at end of text).
  const salespersonInitials =
    text.match(SALESPERSON_HEADER_RX)?.[1] ??
    text.match(SALESPERSON_TRAILING_RX)?.[2] ??
    null;

  const inkColors = extractInkColors(text);
  const { product: productName, color: productColor } =
    extractProductAndColor(text);

  return {
    jobIdFromText,
    imprintLocation,
    imprintLocations: locations,
    qtyGarments,
    approvedBy: null,
    decoration: cleanDecoration(decorationRaw),
    stitches,
    salespersonInitials,
    inkColors,
    imprintDimensions: dimensions,
    productName,
    productColor,
    matchedSnippets: {
      jobIdFromText: jobIdFromText ?? undefined,
      locations: locations.length > 0 ? locations : undefined,
      decoration: decorationRaw ?? undefined,
      stitches: stitchesRaw ?? undefined,
      salesperson: salespersonInitials ?? undefined,
      inkColors: inkColors.length > 0 ? inkColors : undefined,
      dimensions: dimensions ?? undefined,
    },
  };
}
