// Production Queue read path.
//
// The Production Queue lives in Syncore @ease v1, NOT the v2 REST API,
// so this module sits on top of the web-UI scraper (src/lib/syncore/webui.ts)
// the same way followups.ts does. The exact endpoint URL/shape isn't known
// yet — run scripts/discover-production-queue.ts in a logged-in environment
// to capture it, then wire `fetchProductionQueue` against the real response
// shape.
//
// For now this module exports the canonical shape Kristen's "what runs
// today" view expects, and a mock seed so the route can render end-to-end
// while the endpoint is unknown.

export type ProductionStatus =
  | "stopped"
  | "pending"
  | "production"
  | "finishing";

export type ProductionJobType =
  | "embroidery"
  | "transfer"
  | "screenprint"
  | "fulfillment";

export interface ProductionPo {
  po: string;
  received: boolean;
  eta?: string; // YYYY-MM-DD
}

// One card per Job. POs belonging to the same Job aggregate under one job
// (Day 2 Second Sitting §1 — Kristen sees same-Job POs as one job, run
// together). Drill-down expands `pos`.
export interface ProductionJob {
  jobId: string;
  customer: string;
  artNo: string; // parsed out of `description` per Day 3 §6.4
  description: string;
  qty: number;
  type: ProductionJobType;
  due: string; // YYYY-MM-DD
  scheduled: string; // YYYY-MM-DD — Pacific, the day this card lands on
  status: ProductionStatus;
  calcMinutes: number | null; // null until the Production Worksheet matrix is populated
  pos: ProductionPo[];
  note: string | null;
}

// --- Live fetch (TODO: wire once endpoint is captured) --------------------

export interface FetchProductionQueueOpts {
  // YYYY-MM-DD in America/Los_Angeles. The Production Queue might be
  // global or might support a date filter; we'll know once we capture
  // the endpoint. For now this is just plumbing.
  date: string;
}

export async function fetchProductionQueue(
  _opts: FetchProductionQueueOpts,
): Promise<ProductionJob[]> {
  // Intentionally unimplemented until scripts/discover-production-queue.ts
  // captures the v1 endpoint shape. The /production page falls back to
  // mock data (mockProductionQueue) when this throws.
  throw new Error(
    "fetchProductionQueue: v1 Production Queue endpoint not yet wired. " +
      "Run scripts/discover-production-queue.ts to capture the endpoint, " +
      "then implement against the real payload.",
  );
}

// --- Mock seed (matches kristen_schedule.jsx prototype) -------------------
//
// Same six jobs as the validated prototype, with `scheduled` and `due`
// rebased to the requested anchor date so the multi-day notebook tabs
// always have data to show. Keep this in sync with the prototype until
// real data is wired.

const RAW_SEED: Array<
  Omit<ProductionJob, "scheduled" | "due"> & {
    scheduledOffset: number; // days from anchor
    dueOffset: number;
  }
> = [
  {
    jobId: "32511",
    customer: "Heritage Bank",
    artNo: "502",
    description: "502 Heritage Bank LC polo — navy",
    qty: 24,
    type: "embroidery",
    status: "production",
    calcMinutes: 70,
    pos: [
      { po: "32511-1", received: true },
      { po: "32511-3", received: true },
    ],
    note: "Repeat — memorized setup (~5 min). Thread loaded.",
    scheduledOffset: 0,
    dueOffset: 0,
  },
  {
    jobId: "32498",
    customer: "LOTT Clean Water",
    artNo: "767",
    description: "767 LOTT cap — stone",
    qty: 12,
    type: "embroidery",
    status: "pending",
    calcMinutes: 45,
    pos: [
      { po: "32498-1", received: true },
      { po: "32498-2", received: false, eta: undefined },
    ],
    note: "Picked up 2pm — must finish by then. Waiting last PO (caps), ETA today.",
    scheduledOffset: 0,
    dueOffset: 0,
  },
  {
    jobId: "32540",
    customer: "AWC",
    artNo: "172",
    description: "172 Olympia Public Works tee — bulk run",
    qty: 48,
    type: "embroidery",
    status: "production",
    calcMinutes: 190,
    pos: [
      { po: "32540-1", received: true },
      { po: "32540-2", received: true },
      { po: "32540-4", received: true },
      { po: "32540-5", received: true },
    ],
    note: "All 4 POs same job — run together.",
    scheduledOffset: 0,
    dueOffset: 1,
  },
  {
    jobId: "32522",
    customer: "Peak Credit Union",
    artNo: "—",
    description: "Peak webstore batch — DTF left chest",
    qty: 30,
    type: "transfer",
    status: "pending",
    calcMinutes: 55,
    pos: [
      { po: "32522-1", received: true },
      { po: "32522-2", received: false },
    ],
    note: "Path B — decorated by OSI, receiving in. Bag-and-tag in-house.",
    scheduledOffset: 1,
    dueOffset: 1,
  },
  {
    jobId: "32487",
    customer: "Whidbey Island Bank",
    artNo: "503",
    description: "503 Whidbey Island Bank fleece",
    qty: 18,
    type: "embroidery",
    status: "finishing",
    calcMinutes: 95,
    pos: [{ po: "32487-1", received: true }],
    note: "Carried from yesterday. Finishing trims.",
    scheduledOffset: 0,
    dueOffset: -1,
  },
  {
    jobId: "32555",
    customer: "Harbor Wholesale",
    artNo: "17984",
    description: "17984 Harbor Wholesale jacket — back + LC",
    qty: 6,
    type: "embroidery",
    status: "pending",
    calcMinutes: 60,
    pos: [{ po: "32555-1", received: false }],
    note: "Not yet received — can't schedule firm until PO in.",
    scheduledOffset: 1,
    dueOffset: 2,
  },
];

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Generate mock production jobs anchored to `anchorDate`. Used as a
// fallback while the v1 endpoint isn't wired.
export function mockProductionQueue(anchorDate: string): ProductionJob[] {
  return RAW_SEED.map((j) => {
    const scheduled = shiftIso(anchorDate, j.scheduledOffset);
    const due = shiftIso(anchorDate, j.dueOffset);
    // ETA stamps in the seed track "today"; expand any received: false
    // POs that lacked an ETA in the source to land on `scheduled`.
    const pos = j.pos.map((p) =>
      p.received ? p : { ...p, eta: p.eta ?? scheduled },
    );
    return {
      jobId: j.jobId,
      customer: j.customer,
      artNo: j.artNo,
      description: j.description,
      qty: j.qty,
      type: j.type,
      status: j.status,
      calcMinutes: j.calcMinutes,
      pos,
      note: j.note,
      scheduled,
      due,
    };
  });
}
