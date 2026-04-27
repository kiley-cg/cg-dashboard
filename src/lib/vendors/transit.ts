// UPS Ground transit-day estimates from each known SanMar / S&S warehouse to
// Color Graphics' Olympia, WA shop (98512). Hand-curated from UPS's standard
// ground-time map; we use these as a stand-in because:
//   - SanMar's web-service guide doesn't expose a Days-In-Transit endpoint.
//   - S&S has a Days-In-Transit API (next to wire up once we have its docs).
//
// The keys are the same substring keywords used by warehouse-priority.ts so a
// vendor-returned warehouse name OR id (e.g. "Seattle" or "WA") matches the
// same entry. Days assume standard UPS Ground from a US warehouse to the
// home zip. For non-home destinations we currently just degrade to "varies"
// in the UI; richer per-region lookups are a follow-up.

const HOME_ZIP_PREFIX = "98";

const WAREHOUSE_TRANSIT_DAYS_TO_HOME: ReadonlyArray<{
  keywords: readonly string[];
  days: number;
}> = [
  { keywords: ["seattle", "renton", "wa"], days: 1 },
  { keywords: ["reno", "nv"], days: 2 },
  { keywords: ["phoenix", "az"], days: 3 },
  { keywords: ["dallas", "fort worth", "ft worth", "tx"], days: 4 },
  { keywords: ["olathe", "kansas", "ks"], days: 4 },
  { keywords: ["lockport", "illinois", "il"], days: 4 },
  { keywords: ["minneapolis", "mn"], days: 4 },
  { keywords: ["cincinnati", "hebron", "ohio", "oh", "ky"], days: 5 },
  { keywords: ["atlanta", "ga"], days: 5 },
  { keywords: ["richmond", "va"], days: 5 },
  { keywords: ["robbinsville", "cranbury", "nj"], days: 5 },
  { keywords: ["reading", "pa"], days: 5 },
  { keywords: ["jacksonville", "fl"], days: 5 },
  { keywords: ["middleboro", "lakeville", "ma"], days: 5 },
];

/**
 * Estimate UPS Ground transit days from a warehouse to a destination zip.
 * Returns null when we can't make a confident estimate (unknown warehouse
 * or non-home destination — caller can fall back to "varies").
 */
export function transitDays(
  warehouse: { id: string; name?: string },
  destZip: string | null | undefined,
): number | null {
  // Only the home-zip table is curated; bail otherwise.
  const zip = (destZip ?? "").trim();
  if (!zip.startsWith(HOME_ZIP_PREFIX)) return null;

  const haystack = `${warehouse.name ?? ""} ${warehouse.id ?? ""}`.toLowerCase();
  for (const entry of WAREHOUSE_TRANSIT_DAYS_TO_HOME) {
    if (entry.keywords.some((k) => haystack.includes(k))) return entry.days;
  }
  return null;
}
