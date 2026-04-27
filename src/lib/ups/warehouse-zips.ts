// Warehouse zip lookup. SanMar's PromoStandards Inventory response includes
// `postalCode` per InventoryLocation, so for SanMar warehouses we use that
// directly. S&S's API returns only state abbreviations, so we hardcode their
// distribution-center zips.
//
// If the warehouse's name/id doesn't match anything below, we return null
// and the caller should skip the rating call (we can't quote without a
// from-zip).

const SS_WAREHOUSE_ZIPS: ReadonlyArray<{
  keywords: readonly string[];
  zip: string;
}> = [
  { keywords: ["reno", "nv"], zip: "89506" },
  { keywords: ["lockport", "il"], zip: "60441" },
  { keywords: ["olathe", "kansas", "ks"], zip: "66061" },
  { keywords: ["robbinsville", "cranbury", "nj"], zip: "08512" },
  { keywords: ["middleboro", "lakeville", "ma"], zip: "02347" },
  { keywords: ["reading", "pa"], zip: "19605" },
  { keywords: ["atlanta", "ga"], zip: "30122" },
  { keywords: ["fort worth", "ft worth", "dallas", "tx"], zip: "76140" },
];

// SanMar's published warehouse zips (also returned in their Inventory
// response, kept here as a fallback when the response omits them).
const SANMAR_WAREHOUSE_ZIPS: ReadonlyArray<{
  keywords: readonly string[];
  zip: string;
}> = [
  { keywords: ["seattle", "wa"], zip: "98027" },
  { keywords: ["cincinnati", "ohio", "oh"], zip: "45069" },
  { keywords: ["dallas", "tx"], zip: "75038" },
  { keywords: ["reno"], zip: "89441" },
  { keywords: ["robbinsville", "nj"], zip: "08691" },
  { keywords: ["jacksonville", "fl"], zip: "32219" },
  { keywords: ["minneapolis", "mn"], zip: "55379" },
  { keywords: ["phoenix", "az"], zip: "85323" },
  { keywords: ["richmond", "va"], zip: "23226" },
];

const ALL = [...SANMAR_WAREHOUSE_ZIPS, ...SS_WAREHOUSE_ZIPS];

export function warehouseZip(warehouse: {
  id: string;
  name?: string;
}): string | null {
  const haystack = `${warehouse.name ?? ""} ${warehouse.id ?? ""}`.toLowerCase();
  for (const entry of ALL) {
    if (entry.keywords.some((k) => haystack.includes(k))) return entry.zip;
  }
  return null;
}
