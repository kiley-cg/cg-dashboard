// Warehouse selection logic. Picks the "Ships from" warehouse for a line,
// computes a split allocation when no single warehouse can fulfill alone,
// and proposes a per-Sales-Order consolidation warehouse when one can fill
// every line.
//
// Priority is geographic from the destination zip. Default destination is
// Color Graphics' Olympia, WA shop (98512) — that's where decorated orders
// land before going to the end customer. For drop-ship orders, callers
// pass the customer's ship-to zip and the priority list re-orders.

const HOME_ZIP = "98512";

type WarehouseRef = {
  id: string;
  name?: string;
  quantity: number;
};

type Region =
  | "west" // 8xxxx, 9xxxx
  | "central-south" // 7xxxx
  | "midwest" // 4xxxx, 5xxxx, 6xxxx
  | "southeast" // 3xxxx
  | "northeast"; // 0xxxx, 1xxxx, 2xxxx

// Priority lists per ship-to region. Entries are keyword groups matched
// against a warehouse's name OR id (substring, case-insensitive). SanMar
// returns city names; S&S returns state abbreviations — the matcher
// accommodates both.

const WEST: ReadonlyArray<readonly string[]> = [
  ["seattle", "renton", "wa"],
  ["reno", "nv"],
  ["phoenix", "az"],
  ["dallas", "fort worth", "ft worth", "tx"],
  ["olathe", "kansas", "ks"],
  ["lockport", "illinois", "il"],
  ["cincinnati", "hebron", "ohio", "oh", "ky"],
  ["minneapolis", "mn"],
  ["atlanta", "ga"],
  ["richmond", "va"],
  ["robbinsville", "cranbury", "nj"],
  ["reading", "pa"],
  ["jacksonville", "fl"],
  ["middleboro", "lakeville", "ma"],
];

const CENTRAL_SOUTH: ReadonlyArray<readonly string[]> = [
  ["dallas", "fort worth", "ft worth", "tx"],
  ["olathe", "kansas", "ks"],
  ["atlanta", "ga"],
  ["jacksonville", "fl"],
  ["cincinnati", "hebron", "ohio", "oh", "ky"],
  ["minneapolis", "mn"],
  ["lockport", "illinois", "il"],
  ["richmond", "va"],
  ["robbinsville", "cranbury", "nj"],
  ["reading", "pa"],
  ["phoenix", "az"],
  ["reno", "nv"],
  ["middleboro", "lakeville", "ma"],
  ["seattle", "renton", "wa"],
];

const MIDWEST: ReadonlyArray<readonly string[]> = [
  ["minneapolis", "mn"],
  ["lockport", "illinois", "il"],
  ["olathe", "kansas", "ks"],
  ["cincinnati", "hebron", "ohio", "oh", "ky"],
  ["dallas", "fort worth", "ft worth", "tx"],
  ["atlanta", "ga"],
  ["richmond", "va"],
  ["robbinsville", "cranbury", "nj"],
  ["reading", "pa"],
  ["jacksonville", "fl"],
  ["middleboro", "lakeville", "ma"],
  ["phoenix", "az"],
  ["reno", "nv"],
  ["seattle", "renton", "wa"],
];

const SOUTHEAST: ReadonlyArray<readonly string[]> = [
  ["jacksonville", "fl"],
  ["atlanta", "ga"],
  ["richmond", "va"],
  ["cincinnati", "hebron", "ohio", "oh", "ky"],
  ["robbinsville", "cranbury", "nj"],
  ["reading", "pa"],
  ["dallas", "fort worth", "ft worth", "tx"],
  ["middleboro", "lakeville", "ma"],
  ["lockport", "illinois", "il"],
  ["olathe", "kansas", "ks"],
  ["minneapolis", "mn"],
  ["phoenix", "az"],
  ["reno", "nv"],
  ["seattle", "renton", "wa"],
];

const NORTHEAST: ReadonlyArray<readonly string[]> = [
  ["robbinsville", "cranbury", "nj"],
  ["reading", "pa"],
  ["middleboro", "lakeville", "ma"],
  ["richmond", "va"],
  ["cincinnati", "hebron", "ohio", "oh", "ky"],
  ["lockport", "illinois", "il"],
  ["jacksonville", "fl"],
  ["atlanta", "ga"],
  ["olathe", "kansas", "ks"],
  ["minneapolis", "mn"],
  ["dallas", "fort worth", "ft worth", "tx"],
  ["phoenix", "az"],
  ["reno", "nv"],
  ["seattle", "renton", "wa"],
];

const PRIORITIES: Record<Region, ReadonlyArray<readonly string[]>> = {
  west: WEST,
  "central-south": CENTRAL_SOUTH,
  midwest: MIDWEST,
  southeast: SOUTHEAST,
  northeast: NORTHEAST,
};

export function regionForZip(zip: string | null | undefined): Region {
  const trimmed = (zip ?? "").trim();
  if (!trimmed) return regionForZip(HOME_ZIP);
  const first = trimmed[0];
  if (first === "9" || first === "8") return "west";
  if (first === "7") return "central-south";
  if (first === "6" || first === "5" || first === "4") return "midwest";
  if (first === "3") return "southeast";
  return "northeast";
}

function priorityFor(zip: string | null | undefined) {
  return PRIORITIES[regionForZip(zip)];
}

export function warehouseRank(
  warehouse: { id: string; name?: string },
  zip: string | null | undefined,
): number {
  const list = priorityFor(zip);
  const haystack = `${warehouse.name ?? ""} ${warehouse.id ?? ""}`.toLowerCase();
  for (let i = 0; i < list.length; i++) {
    if (list[i].some((k) => haystack.includes(k))) return i;
  }
  return list.length;
}

/**
 * Pick the highest-priority warehouse that has full stock for the line.
 * Returns null when no single warehouse can fulfill alone.
 */
export function pickPrimaryWarehouse(
  warehouses: WarehouseRef[],
  qtyOrdered: number,
  zip: string | null | undefined,
): WarehouseRef | null {
  if (qtyOrdered <= 0) return warehouses[0] ?? null;
  return (
    [...warehouses]
      .filter((w) => w.quantity >= qtyOrdered)
      .sort((a, b) => {
        const pa = warehouseRank(a, zip);
        const pb = warehouseRank(b, zip);
        if (pa !== pb) return pa - pb;
        return b.quantity - a.quantity;
      })[0] ?? null
  );
}

/**
 * When no single warehouse can fulfill alone, allocate the ordered qty
 * across warehouses in priority order: highest-priority first, take what
 * it has, move on. Stops when the line is fully filled or warehouses run
 * out (in which case `remaining > 0` indicates a true partial fill).
 */
export function computeSplit(
  warehouses: WarehouseRef[],
  qtyOrdered: number,
  zip: string | null | undefined,
): {
  allocations: Array<{ warehouse: WarehouseRef; qty: number }>;
  remaining: number;
} {
  const sorted = [...warehouses]
    .filter((w) => w.quantity > 0)
    .sort((a, b) => warehouseRank(a, zip) - warehouseRank(b, zip));
  const allocations: Array<{ warehouse: WarehouseRef; qty: number }> = [];
  let remaining = qtyOrdered;
  for (const w of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, w.quantity);
    if (take <= 0) continue;
    allocations.push({ warehouse: w, qty: take });
    remaining -= take;
  }
  return { allocations, remaining };
}

// Only consolidate when the winning warehouse ranks in the top of the
// destination's priority list. Otherwise we'd "save a PO" by pulling
// the entire order from across the country instead of letting most
// lines ship from the closest warehouse and splitting off the few
// short ones. 0/1/2 = top-three for the region (Seattle/Reno/Phoenix
// for West, etc.).
const CONSOLIDATION_MAX_RANK = 2;

/**
 * Multi-line consolidation: find a single warehouse that can fulfill
 * every (line, available) pair from itself. Returns null when no
 * warehouse can, or when the only fulfilling warehouse is too far
 * (the freight penalty of shipping cross-country outweighs the savings
 * of cutting one PO instead of two).
 */
export function pickConsolidationWarehouse(
  lines: Array<{
    qtyOrdered: number;
    warehouses: WarehouseRef[];
  }>,
  zip: string | null | undefined,
): string | null {
  if (lines.length === 0) return null;
  const firstLine = lines[0];
  const candidates = firstLine.warehouses.filter(
    (w) => w.quantity >= firstLine.qtyOrdered,
  );
  const survivors = candidates.filter((cand) =>
    lines.every((line) =>
      line.warehouses.some(
        (w) => w.id === cand.id && w.quantity >= line.qtyOrdered,
      ),
    ),
  );
  if (survivors.length === 0) return null;
  survivors.sort((a, b) => warehouseRank(a, zip) - warehouseRank(b, zip));
  const winner = survivors[0];
  if (warehouseRank(winner, zip) > CONSOLIDATION_MAX_RANK) return null;
  return winner.id;
}
