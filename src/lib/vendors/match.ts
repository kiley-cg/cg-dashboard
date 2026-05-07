import type { InventoryLine, InventoryLookup } from "@/lib/vendors/types";

// Variant matching between Syncore line items and vendor inventory rows.
// Two strategies, tried in order:
//   1. Exact lowercase match on color AND size
//   2. Token-bag color match: every token of the shorter name appears
//      in the longer one (handles "True Royal" vs "Royal", "Athletic
//      Heather" vs "Heather", etc.) combined with exact size + size-
//      synonym ("S" ↔ "Small") matching
//
// We never fall back to summing across variations — if no match, the
// caller should treat it as "we couldn't find this color/size", not
// fabricate a total that misleads the rep.

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

// Split a color name into comparable tokens. Splits on whitespace,
// underscores, and hyphens, then again on camelCase boundaries — SanMar
// abbreviates multi-word colors as concatenated camelCase in their
// PromoStandards Inventory response ("Heritage Blue" → "HeriBlue",
// "Off White" → "OffWhite"). Without the camelCase split those never
// align with Syncore's space-separated names.
function camelTokens(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .trim()
    .split(/[\s_-]+/)
    .flatMap((p) => p.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/))
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

// Two tokens "match" when they're equal, when one is a 4+ char prefix
// of the other, or when their consonant skeletons match. SanMar uses
// two abbreviation patterns interchangeably:
//   - prefix truncation: "Heritage" → "Heri", "Shadow" → "Shad"
//   - interior vowel deletion: "Twist" → "Twst", "Heather" → "Hthr"
// The 4-char floor on prefix and the 4-consonant floor on skeleton
// equality both guard against short-token collisions like red↔road.
function consonantSkeleton(s: string): string {
  return s.replace(/[aeiou]/g, "");
}
function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 4 && longer.startsWith(shorter)) return true;
  const sa = consonantSkeleton(a);
  const sb = consonantSkeleton(b);
  return sa.length >= 4 && sb.length >= 4 && sa === sb;
}

const SIZE_SYNONYMS: ReadonlyArray<readonly string[]> = [
  ["xs", "extra small"],
  ["s", "small"],
  ["m", "medium"],
  ["l", "large"],
  ["xl", "extra large", "x-large"],
  ["2xl", "xxl", "2x large"],
  ["3xl", "xxxl", "3x large"],
  ["4xl", "xxxxl", "4x large"],
  ["5xl", "xxxxxl"],
];

function sizesMatch(a: string | null, b: string | null): boolean {
  const x = norm(a);
  const y = norm(b);
  // Only permissive when BOTH sides are missing. If one side has a real
  // value and the other is blank, they do NOT match — otherwise an
  // aggregate/parent row in the vendor response (size=null, qty=0) will
  // shadow the real per-variant row and the rep sees a fake 0.
  if (!x && !y) return true;
  if (!x || !y) return false;
  if (x === y) return true;
  for (const group of SIZE_SYNONYMS) {
    if (group.includes(x) && group.includes(y)) return true;
  }
  return false;
}

function colorsMatch(a: string | null, b: string | null): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x && !y) return true;
  if (!x || !y) return false;
  if (x === y) return true;
  // Token-bag with prefix tolerance: every token of the shorter side
  // has an equal-or-prefix match in the longer side. Handles both
  // "Royal" ↔ "True Royal" and "Heritage Blue" ↔ "HeriBlue".
  const xt = camelTokens(a);
  const yt = camelTokens(b);
  const [shortT, longT] = xt.length <= yt.length ? [xt, yt] : [yt, xt];
  return shortT.every((t) => longT.some((u) => tokenMatch(t, u)));
}

export function matchVariant(
  lookup: InventoryLookup,
  color: string | null,
  size: string | null,
): InventoryLine | null {
  if (lookup.status !== "ok") return null;
  const exact = lookup.lines.find(
    (l) => norm(l.color) === norm(color) && norm(l.size) === norm(size),
  );
  if (exact) {
    // If we matched a 0-qty row but other variants of this productId
    // have stock, that's suspicious — likely a vendor-side data shape
    // we're not handling. Log it so we can compare what we matched
    // against the rest of the response.
    if (
      exact.quantityAvailable === 0 &&
      lookup.lines.some((l) => l.quantityAvailable > 0)
    ) {
      console.log("[match] exact match has 0 qty while other variants stock", {
        productId: lookup.productId,
        askColor: color,
        askSize: size,
        matched: {
          color: exact.color,
          size: exact.size,
          warehouses: exact.warehouses?.map((w) => ({
            name: w.name,
            qty: w.quantity,
          })),
        },
        otherStocked: lookup.lines
          .filter((l) => l.quantityAvailable > 0)
          .slice(0, 5)
          .map((l) => ({
            color: l.color,
            size: l.size,
            qty: l.quantityAvailable,
          })),
      });
    }
    return exact;
  }
  const lenient = lookup.lines.find(
    (l) => colorsMatch(l.color, color) && sizesMatch(l.size, size),
  );
  if (lenient) return lenient;
  // No match — log enough to diagnose. Reps reporting "stock should be
  // there" can paste this and we can see whether the vendor returned the
  // variant at all (matcher gap) or didn't (vendor data gap).
  console.log("[match] no variant matched", {
    productId: lookup.productId,
    askColor: color,
    askSize: size,
    vendorVariants: lookup.lines.map((l) => ({
      color: l.color,
      size: l.size,
      qty: l.quantityAvailable,
    })),
  });
  return null;
}
