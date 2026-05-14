// US ZIP3 (first three digits) → state abbreviation.
//
// UPS Rating rejects requests without StateProvinceCode on the ship-from
// address (error 9110016). Our request data only carries ZIPs, so derive
// the state. Coverage: the contiguous 50 + DC + AK + HI. Ranges follow
// USPS sectional center assignments; the few cross-state ZIP3s that exist
// are handled explicitly (e.g. 200/202–205 = DC, 201/206–219 = MD).
//
// Returns null for any ZIP that doesn't resolve — caller decides whether
// to fail or fall back. Territories (PR, VI, GU) are intentionally not
// included; UPS ground doesn't serve them and rating requests for those
// ZIPs need a different code path.

const RANGES: ReadonlyArray<{ from: number; to: number; state: string }> = [
  { from: 5, to: 5, state: "NY" },
  { from: 10, to: 27, state: "MA" },
  { from: 28, to: 29, state: "RI" },
  { from: 30, to: 38, state: "NH" },
  { from: 39, to: 49, state: "ME" },
  { from: 50, to: 54, state: "VT" },
  { from: 55, to: 55, state: "MA" },
  { from: 56, to: 59, state: "VT" },
  { from: 60, to: 69, state: "CT" },
  { from: 70, to: 89, state: "NJ" },
  { from: 100, to: 149, state: "NY" },
  { from: 150, to: 196, state: "PA" },
  { from: 197, to: 199, state: "DE" },
  { from: 220, to: 246, state: "VA" },
  { from: 247, to: 268, state: "WV" },
  { from: 270, to: 289, state: "NC" },
  { from: 290, to: 299, state: "SC" },
  { from: 300, to: 319, state: "GA" },
  { from: 320, to: 349, state: "FL" },
  { from: 350, to: 369, state: "AL" },
  { from: 370, to: 385, state: "TN" },
  { from: 386, to: 397, state: "MS" },
  { from: 398, to: 399, state: "GA" },
  { from: 400, to: 427, state: "KY" },
  { from: 430, to: 459, state: "OH" },
  { from: 460, to: 479, state: "IN" },
  { from: 480, to: 499, state: "MI" },
  { from: 500, to: 528, state: "IA" },
  { from: 530, to: 549, state: "WI" },
  { from: 550, to: 567, state: "MN" },
  { from: 570, to: 577, state: "SD" },
  { from: 580, to: 588, state: "ND" },
  { from: 590, to: 599, state: "MT" },
  { from: 600, to: 629, state: "IL" },
  { from: 630, to: 658, state: "MO" },
  { from: 660, to: 679, state: "KS" },
  { from: 680, to: 693, state: "NE" },
  { from: 700, to: 714, state: "LA" },
  { from: 716, to: 729, state: "AR" },
  { from: 730, to: 749, state: "OK" },
  { from: 750, to: 799, state: "TX" },
  { from: 800, to: 816, state: "CO" },
  { from: 820, to: 831, state: "WY" },
  { from: 832, to: 838, state: "ID" },
  { from: 840, to: 847, state: "UT" },
  { from: 850, to: 865, state: "AZ" },
  { from: 870, to: 884, state: "NM" },
  { from: 889, to: 898, state: "NV" },
  { from: 900, to: 961, state: "CA" },
  { from: 967, to: 968, state: "HI" },
  { from: 970, to: 979, state: "OR" },
  { from: 980, to: 994, state: "WA" },
  { from: 995, to: 999, state: "AK" },
];

// DC and MD share the 200s; not a contiguous range.
const DC_ZIP3 = new Set([200, 202, 203, 204, 205]);
const MD_ZIP3_EXTRA = new Set([201, 206, 207, 208, 209, 210, 211, 212, 214, 215, 216, 217, 218, 219]);

export function zipToState(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const trimmed = zip.trim();
  if (trimmed.length < 3) return null;
  const z3 = Number(trimmed.slice(0, 3));
  if (!Number.isFinite(z3)) return null;
  if (DC_ZIP3.has(z3)) return "DC";
  if (MD_ZIP3_EXTRA.has(z3)) return "MD";
  for (const r of RANGES) {
    if (z3 >= r.from && z3 <= r.to) return r.state;
  }
  return null;
}
