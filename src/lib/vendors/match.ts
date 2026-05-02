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

function tokens(s: string | null | undefined): string[] {
  return norm(s).split(/\s+/).filter(Boolean);
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
  // Token-bag: every token of the shorter side appears in the longer.
  const xt = tokens(x);
  const yt = tokens(y);
  const [shortT, longT] = xt.length <= yt.length ? [xt, yt] : [yt, xt];
  return shortT.every((t) => longT.includes(t));
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
  if (exact) return exact;
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
