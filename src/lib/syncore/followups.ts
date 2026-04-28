// Job Follow-Ups fetchers built on top of the web-UI scraper.
//
// The exact JSON shape returned by /api/followups/jobs and
// /api/followups/jobs/statistics is not formally documented. We write
// passthrough Zod schemas (anything goes), then normalize known fields with
// multiple-name fallbacks. The full raw payload is always preserved in
// `raw` / `rawStatistics` jsonb columns so the dashboard can be refined
// without re-running the cron.

import { z } from "zod";
import { webuiFetch, type WebUiSearchParams } from "./webui";

// Known status IDs from the Follow-up Status filter dropdown.
export const FOLLOWUP_STATUS_OPEN = 6;
export const FOLLOWUP_STATUS_COMPLETED = 5;

export type FollowUpStatusKind = "open" | "completed";

const STATUS_ID_BY_KIND: Record<FollowUpStatusKind, number> = {
  open: FOLLOWUP_STATUS_OPEN,
  completed: FOLLOWUP_STATUS_COMPLETED,
};

// All issue types Syncore exposes on the Results-Statistics panel. Order
// matches the screenshot left-to-right, top-to-bottom.
export const ISSUE_KINDS = [
  "artwork",
  "backOrder",
  "development",
  "hold",
  "inProduction",
  "inTransit",
  "needsTracking",
  "postDelivery",
  "problem",
  "waiting",
  "none",
] as const;

export type IssueKind = (typeof ISSUE_KINDS)[number];

export type IssueCounts = Record<IssueKind, number>;

export const RawJsonZ: z.ZodType<unknown> = z.unknown();

// Permissive: validate that we got an object, but don't enforce a shape.
const StatisticsRawZ = z.record(z.string(), RawJsonZ);
const RowRawZ = z.record(z.string(), RawJsonZ);

// Rows endpoint may return an array directly, or { items: [...], total }.
const RowsResponseZ = z.union([
  z.array(RowRawZ),
  z.object({}).passthrough(),
]);

// --- Helpers ---------------------------------------------------------------

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function pick<T>(obj: Record<string, unknown>, keys: string[], coerce: (v: unknown) => T | null): T | null {
  for (const k of keys) {
    if (k in obj) {
      const c = coerce(obj[k]);
      if (c !== null) return c;
    }
    // Try case-insensitive match too — Syncore mixes camel/Pascal/snake.
    const lower = k.toLowerCase();
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === lower) {
        const c = coerce(obj[key]);
        if (c !== null) return c;
      }
    }
  }
  return null;
}

function pickNested(obj: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = obj;
  for (const p of path) {
    if (cursor && typeof cursor === "object" && !Array.isArray(cursor)) {
      cursor = (cursor as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cursor;
}

// --- Statistics -----------------------------------------------------------

export interface FollowUpStatistics {
  totalRecords: number;
  totalIssues: number;
  issueCounts: IssueCounts;
  raw: Record<string, unknown>;
}

// Map known display labels (and likely JSON keys) to our IssueKind enum.
const ISSUE_LABEL_TO_KIND: Record<string, IssueKind> = {
  artwork: "artwork",
  "back order": "backOrder",
  backorder: "backOrder",
  development: "development",
  hold: "hold",
  "in production": "inProduction",
  inproduction: "inProduction",
  "in transit": "inTransit",
  intransit: "inTransit",
  "needs tracking": "needsTracking",
  needstracking: "needsTracking",
  "post delivery": "postDelivery",
  postdelivery: "postDelivery",
  problem: "problem",
  waiting: "waiting",
  none: "none",
};

function emptyIssueCounts(): IssueCounts {
  return Object.fromEntries(ISSUE_KINDS.map((k) => [k, 0])) as IssueCounts;
}

function extractIssueCounts(raw: Record<string, unknown>): IssueCounts {
  const counts = emptyIssueCounts();

  // Walk every value in the payload looking for { name|label|status, count|total|value }.
  // This is intentionally tolerant — Syncore's statistics endpoint may return
  // a flat object, an array of {name, count}, or nested under "issues".
  const visit = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;

    const obj = node as Record<string, unknown>;
    const label =
      asString(obj.name) ??
      asString(obj.label) ??
      asString(obj.issue) ??
      asString(obj.status) ??
      asString(obj.title);
    const count =
      asNumber(obj.count) ??
      asNumber(obj.total) ??
      asNumber(obj.value) ??
      asNumber(obj.records);

    if (label && count !== null) {
      const kind = ISSUE_LABEL_TO_KIND[label.toLowerCase()];
      if (kind) counts[kind] = count;
    }

    // Also accept flat keys like { artwork: 11, hold: 6, ... }
    for (const [k, v] of Object.entries(obj)) {
      const kind = ISSUE_LABEL_TO_KIND[k.toLowerCase()];
      const n = asNumber(v);
      if (kind && n !== null) counts[kind] = n;
      else if (typeof v === "object" && v !== null) visit(v);
    }
  };

  visit(raw);
  return counts;
}

function normalizeStatistics(raw: Record<string, unknown>): FollowUpStatistics {
  const totalRecords =
    pick(raw, ["totalRecords", "total_records", "total"], asNumber) ?? 0;
  const totalIssues =
    pick(raw, ["totalIssues", "total_issues"], asNumber) ?? 0;

  return {
    totalRecords,
    totalIssues,
    issueCounts: extractIssueCounts(raw),
    raw,
  };
}

export async function fetchFollowUpStatistics(opts: {
  csrId: number;
  status: FollowUpStatusKind;
  followUpDate: string; // YYYY-MM-DD
}): Promise<FollowUpStatistics> {
  const params: WebUiSearchParams = {
    searchString: "",
    followUpDate: opts.followUpDate,
    supplierId: "",
    jobPriorityId: "",
    issueId: "",
    jobStatusId: "",
    jobClassId: "",
    salesRepId: "",
    customerServiceRepId: opts.csrId,
    followUpStatusId: STATUS_ID_BY_KIND[opts.status],
    jobDateFrom: "",
    jobDateTo: "",
  };
  const raw = await webuiFetch<unknown>("/api/followups/jobs/statistics", {
    searchParams: params,
  });
  const obj = StatisticsRawZ.parse(raw);
  return normalizeStatistics(obj);
}

// --- Rows -----------------------------------------------------------------

export interface FollowUpRow {
  jobId: number;
  fuDate: string | null;
  contact: string | null;
  jobStatus: string | null;
  supplier: string | null;
  jobDescription: string | null;
  primaryRep: string | null;
  csrName: string | null;
  priority: string | null;
  estDelivery: string | null;
  issue: string | null;
  raw: Record<string, unknown>;
}

function normalizeRow(raw: Record<string, unknown>): FollowUpRow | null {
  // jobId is the only field we require — everything else is best-effort.
  const jobId = pick(
    raw,
    ["jobId", "JobId", "job_id", "id", "JobID"],
    asNumber,
  );
  if (jobId === null) return null;

  const fuDate = pick(
    raw,
    ["followUpDate", "FollowUpDate", "fuDate", "follow_up_date"],
    asString,
  );
  const jobStatus =
    pick(raw, ["jobStatus", "JobStatus", "status"], asString) ??
    asString(pickNested(raw, ["job", "status"]));
  const supplier =
    pick(raw, ["supplier", "Supplier", "vendor", "supplierName"], asString) ??
    asString(pickNested(raw, ["supplier", "name"]));
  const description =
    pick(
      raw,
      [
        "jobDescription",
        "JobDescription",
        "description",
        "Description",
        "jobName",
      ],
      asString,
    ) ?? asString(pickNested(raw, ["job", "description"]));
  const primaryRep =
    pick(
      raw,
      ["primaryRep", "PrimaryRep", "primaryRepName", "salesRep", "rep"],
      asString,
    ) ??
    asString(pickNested(raw, ["primaryRep", "name"])) ??
    asString(pickNested(raw, ["salesRep", "name"]));
  const csrName =
    pick(
      raw,
      [
        "csr",
        "Csr",
        "customerServiceRep",
        "customerServiceRepName",
        "CustomerServiceRep",
      ],
      asString,
    ) ??
    asString(pickNested(raw, ["customerServiceRep", "name"])) ??
    asString(pickNested(raw, ["csr", "name"]));
  const priority =
    pick(raw, ["priority", "Priority", "jobPriority"], asString) ??
    asString(pickNested(raw, ["priority", "name"])) ??
    asString(pickNested(raw, ["job", "priority", "name"]));
  const estDelivery = pick(
    raw,
    [
      "estDelivery",
      "EstDelivery",
      "estimatedDeliveryDate",
      "estDeliveryDate",
      "expectedDelivery",
    ],
    asString,
  );
  const issue =
    pick(raw, ["issue", "Issue", "issueName"], asString) ??
    asString(pickNested(raw, ["issue", "name"]));
  const contact =
    pick(raw, ["contact", "Contact", "contactName", "customer"], asString) ??
    asString(pickNested(raw, ["contact", "name"])) ??
    asString(pickNested(raw, ["client", "businessName"])) ??
    asString(pickNested(raw, ["client", "name"]));

  return {
    jobId,
    fuDate,
    contact,
    jobStatus,
    supplier,
    jobDescription: description,
    primaryRep,
    csrName,
    priority,
    estDelivery,
    issue,
    raw,
  };
}

function extractRowArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["items", "results", "data", "rows", "jobs"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

export async function fetchFollowUpRows(opts: {
  csrId: number;
  status: FollowUpStatusKind;
  followUpDate: string;
  pageSize?: number;
}): Promise<FollowUpRow[]> {
  const pageSize = opts.pageSize ?? 500;
  const raw = await webuiFetch<unknown>("/api/followups/jobs", {
    searchParams: {
      offset: 0,
      fetch: pageSize,
      sortColumn: "job.priority",
      sortOrder: "DESC",
    },
    bracketed: {
      searchString: "",
      followUpDate: opts.followUpDate,
      supplierId: "",
      jobPriorityId: "",
      issueId: "",
      jobStatusId: "",
      jobClassId: "",
      salesRepId: "",
      customerServiceRepId: opts.csrId,
      followUpStatusId: STATUS_ID_BY_KIND[opts.status],
      jobDateFrom: "",
      jobDateTo: "",
    },
  });

  RowsResponseZ.parse(raw); // shape-check only
  const arr = extractRowArray(raw);
  const rows: FollowUpRow[] = [];
  for (const item of arr) {
    const r = normalizeRow(item);
    if (r) rows.push(r);
  }
  return rows;
}

// --- Combined snapshot ----------------------------------------------------

export interface CsrSnapshot {
  csrId: number;
  status: FollowUpStatusKind;
  followUpDate: string;
  statistics: FollowUpStatistics;
  rows: FollowUpRow[];
}

export async function fetchSnapshotForCsr(opts: {
  csrId: number;
  status: FollowUpStatusKind;
  followUpDate: string;
}): Promise<CsrSnapshot> {
  const [statistics, rows] = await Promise.all([
    fetchFollowUpStatistics(opts),
    fetchFollowUpRows(opts),
  ]);
  return { ...opts, statistics, rows };
}

// --- CSR registry ---------------------------------------------------------
//
// CSR IDs come from env so we can add/remove people without a code change.
// Names are stored alongside so snapshot rows are self-describing in the DB.

export interface CsrConfig {
  id: number;
  name: string;
}

export function loadCsrRegistry(): CsrConfig[] {
  const out: CsrConfig[] = [];
  const v = process.env.CSR_VALERIE_ID;
  const j = process.env.CSR_JEREMIAH_ID;
  if (v && !Number.isNaN(Number(v))) out.push({ id: Number(v), name: "Valerie Ross" });
  if (j && !Number.isNaN(Number(j))) out.push({ id: Number(j), name: "Jeremiah Gana" });
  return out;
}
