// Extract structured spec data from a proof PDF's text content.
//
// Best-effort regex matching with sensible defaults. This is the part
// most likely to need tuning against real PDFs — the patterns below
// are educated guesses. To update: see what didn't match in the
// snapshot's results, add a new regex variant here.
//
// All patterns case-insensitive and tolerant of whitespace / colons /
// dashes between the label and the value.

export interface ProofSpec {
  imprintLocation: string | null;
  qtyGarments: number | null;
  approvedBy: string | null;
  // The raw extracted text snippets matched, so the admin probe can
  // show what it found and we can iterate the regexes.
  matchedSnippets: {
    location?: string;
    quantity?: string;
    approver?: string;
  };
}

// Try multiple label variants for each field. Order matters — first
// successful match wins. Add new variants to the front of the array
// when you see them in a real PDF.

const LOCATION_PATTERNS: RegExp[] = [
  /imprint\s*(?:location|position)?\s*[:\-]\s*([^\n\r]+)/i,
  /(?:logo|design|art|placement)\s*location\s*[:\-]\s*([^\n\r]+)/i,
  /location\s*[:\-]\s*([^\n\r]+)/i,
  // Common bare-keyword fallback — pick the first one we see in the
  // text. Add more locations here as you see them in proofs.
  /\b(left\s+chest|right\s+chest|full\s+back|left\s+sleeve|right\s+sleeve|hat\s+front|hat\s+side|back\s+yoke|nape|left\s+thigh|right\s+thigh)\b/i,
];

const QTY_PATTERNS: RegExp[] = [
  // "Quantity: 50", "Qty: 50", "Total Quantity: 50"
  /(?:total\s+)?(?:quantity|qty)\s*[:\-]\s*(\d+)/i,
  // "50 pcs", "50 pieces", "50 garments"
  /\b(\d+)\s*(?:pcs?\.?|pieces?|garments?|units?)\b/i,
];

const APPROVER_PATTERNS: RegExp[] = [
  /approved\s*by\s*[:\-]\s*([^\n\r]+)/i,
  /approver\s*[:\-]\s*([^\n\r]+)/i,
  /sign[ -]?off\s*(?:by)?\s*[:\-]\s*([^\n\r]+)/i,
];

function tryPatterns(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function cleanLocation(raw: string | null): string | null {
  if (!raw) return null;
  // Trim trailing punctuation / extra labels that often follow.
  let s = raw.replace(/[.,;]+$/, "").trim();
  // If the value spilled past a sensible imprint location length, cap
  // it — usually means the regex grabbed too greedily.
  if (s.length > 60) s = s.slice(0, 60).trim() + "…";
  return s || null;
}

function cleanApprover(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.replace(/[.,;]+$/, "").trim();
  // Strip a trailing date the regex might have caught.
  s = s.replace(/\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}.*$/, "").trim();
  if (s.length > 60) s = s.slice(0, 60).trim() + "…";
  return s || null;
}

export function extractProofSpec(text: string): ProofSpec {
  const locationRaw = tryPatterns(text, LOCATION_PATTERNS);
  const qtyRaw = tryPatterns(text, QTY_PATTERNS);
  const approverRaw = tryPatterns(text, APPROVER_PATTERNS);

  let qtyGarments: number | null = null;
  if (qtyRaw) {
    const n = Number(qtyRaw);
    if (Number.isFinite(n) && n > 0 && n < 100_000) qtyGarments = n;
  }

  return {
    imprintLocation: cleanLocation(locationRaw),
    qtyGarments,
    approvedBy: cleanApprover(approverRaw),
    matchedSnippets: {
      location: locationRaw ?? undefined,
      quantity: qtyRaw ?? undefined,
      approver: approverRaw ?? undefined,
    },
  };
}
