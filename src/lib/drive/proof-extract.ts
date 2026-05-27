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

// Promo product imprint area marker. Three observed layouts:
//   1. "Default1.2321\"w x 0.5957\"h"     (1 word + concatenated dims)
//   2. "Case1.25\"w x .2\"h"               (1 word + concat)
//   3. "Front  Center4\"w x 2.39\"h"       (multi-word + concat)
//   4. "Front Panel Center\n5\"w x 1.5\"h" (multi-word, dims on next line)
//
// Permissive: 1-4 Title-Case words, then optional whitespace (incl.
// newline), then dimensions. Negative lookahead skips known label
// words so "Color :" / "Decoration : ..." don't false-match.
const PROMO_IMPRINT_RX =
  /^(?!(?:Product|Color|Colors|Decoration|Ink|Proof|Art|Please|Inspect)\b)([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})\s*\n?\s*(\d+(?:\.\d+)?["”'][wh]\s*x\s*\d+(?:\.\d+)?\s*["”'][wh])/gim;

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

// "INK COLORS" header (allow singular "INK COLOR" + multiple spaces).
// Color values are scanned line-by-line after the header (see
// extractInkColors) — some proofs interleave location/dimension lines
// between the header and the actual color values.
const INK_COLORS_HEADER_RX = /\bINK\s+COLORS?\b/i;
// A color value line: 1-2 uppercase or Title-Case words, optionally
// followed by a PMS code (digits). Examples: WHITE, White, BLACK,
// "Royal Blue", "ROYAL 287", "CMYK PROCESS". Used to filter the lines
// after the INK COLORS header.
const INK_COLOR_VALUE_RX = /^([A-Z][A-Za-z]+(?:\s+(?:[A-Z][A-Za-z]+|\d{2,4}))?)\s*$/;

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
  const lines = text.split("\n").map((l) => l.trim());
  const headerIdx = lines.findIndex((l) => INK_COLORS_HEADER_RX.test(l));
  if (headerIdx < 0) return [];

  const colors: string[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (line.length === 0) continue;
    // Stop at the next labelled section (Product:, Color:, etc.).
    if (/^(?:Product|Color|Colors|Decoration)\s*:/i.test(line)) break;
    // Skip lines that don't look like a color value (dimensions,
    // interleaved location names, etc.).
    if (!INK_COLOR_VALUE_RX.test(line)) continue;
    colors.push(line);
    // Heuristic cap — most proofs have <=6 ink colors.
    if (colors.length >= 6) break;
  }
  return colors;
}

// "Product :\nColor :\nBaseball Stress\nReliever\nRoyal blue\n32665\n32665HLM"
//
// Labels appear consecutively (PDF spatial layout puts the label
// column above the value column). After "Color :", the value block is:
//   product lines (1-2) → color line (1) → job#/salesperson stuff.
// Stop reading at the first all-digits or digits-then-initials line —
// that's the start of the job# footer.
function extractProductAndColor(
  text: string,
): { product: string | null; color: string | null } {
  const lines = text.split("\n").map((l) => l.trim());
  const productIdx = lines.findIndex((l) => /^Product\s*:/i.test(l));
  const colorIdx = lines.findIndex((l) => /^Colors?\s*:/i.test(l));
  if (productIdx < 0 || colorIdx < 0) return { product: null, color: null };

  const valueLines: string[] = [];
  for (const line of lines.slice(colorIdx + 1)) {
    if (line.length === 0) continue;
    // First numeric line = start of the job#/salesperson footer.
    if (/^\d{3,6}([A-Z]{2,3})?$/.test(line)) break;
    valueLines.push(line);
  }
  if (valueLines.length === 0) return { product: null, color: null };
  if (valueLines.length === 1) return { product: null, color: valueLines[0] };
  // Last value-line is color; everything before is the product name
  // (which may be wrapped across 1-2 lines).
  const color = valueLines[valueLines.length - 1];
  const product = valueLines.slice(0, -1).join(" ").trim();
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
