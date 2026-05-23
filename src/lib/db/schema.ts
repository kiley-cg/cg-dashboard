import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  integer,
  jsonb,
  uuid,
  index,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// Auth.js standard tables

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  // App role. Drives access to role-specific surfaces (e.g. /production is
  // for "production"; managers are a superset and always pass). Text rather
  // than pg-enum so new roles can be added without a migration.
  // Set via /admin/users; null until an admin assigns one.
  role: text("role"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    pk: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  }),
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

// App-specific: audit trail of every rep verification

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  syncoreOrderId: text("syncore_order_id").notNull(),
  syncoreLineId: text("syncore_line_id").notNull(),
  vendor: text("vendor").notNull(),
  productId: text("product_id").notNull(),
  qtyOrdered: integer("qty_ordered"),
  qtyAvailable: integer("qty_available"),
  qtyConfirmed: integer("qty_confirmed").notNull(),
  vendorSnapshot: jsonb("vendor_snapshot").notNull(),
  verifiedByUserId: text("verified_by_user_id")
    .notNull()
    .references(() => users.id),
  verifiedAt: timestamp("verified_at", { mode: "date" }).notNull().defaultNow(),
  note: text("note"),
});

// One-shot record of "rep clicked Clear all verifications on this job".
// Presence of a row disables auto-verification for the job — once a rep
// has explicitly wiped the verifications, they want hands-on control,
// not the page silently re-verifying every clean row on next render.
// Re-clicking Clear upserts the timestamp/userId for an audit trail.
export const jobVerificationClears = pgTable("job_verification_clears", {
  jobId: text("job_id").primaryKey(),
  clearedAt: timestamp("cleared_at", { mode: "date" }).notNull().defaultNow(),
  clearedByUserId: text("cleared_by_user_id")
    .notNull()
    .references(() => users.id),
});

// CSR Follow-Up snapshots, twice-daily on weekdays. One row per (snapshot
// run, CSR, status) — see src/lib/syncore/followups.ts.

export const followupSnapshots = pgTable(
  "followup_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotAt: timestamp("snapshot_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    csrId: integer("csr_id").notNull(),
    csrName: text("csr_name").notNull(),
    // "open" | "completed". Stored as text rather than a pg enum so we can
    // add new statuses without a migration if Syncore introduces one.
    followUpStatus: text("follow_up_status").notNull(),
    // YYYY-MM-DD in America/Los_Angeles — the date filter we queried.
    followUpDate: text("follow_up_date").notNull(),
    totalRecords: integer("total_records").notNull(),
    totalIssues: integer("total_issues").notNull(),
    issueCounts: jsonb("issue_counts").notNull(),
    rawStatistics: jsonb("raw_statistics").notNull(),
  },
  (t) => ({
    idxCsrTime: index("followup_snapshots_csr_time_idx").on(
      t.csrId,
      t.snapshotAt,
    ),
    idxTime: index("followup_snapshots_time_idx").on(t.snapshotAt),
  }),
);

export const followupRows = pgTable(
  "followup_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => followupSnapshots.id, { onDelete: "cascade" }),
    snapshotAt: timestamp("snapshot_at", { mode: "date" }).notNull(),
    csrId: integer("csr_id").notNull(),
    csrName: text("csr_name").notNull(),
    followUpStatus: text("follow_up_status").notNull(),
    jobId: integer("job_id").notNull(),
    fuDate: text("fu_date"),
    contact: text("contact"),
    jobStatus: text("job_status"),
    supplier: text("supplier"),
    jobDescription: text("job_description"),
    primaryRep: text("primary_rep"),
    priority: text("priority"),
    estDelivery: text("est_delivery"),
    issue: text("issue"),
    raw: jsonb("raw").notNull(),
  },
  (t) => ({
    idxTimeCsr: index("followup_rows_time_csr_idx").on(t.snapshotAt, t.csrId),
    idxJobTime: index("followup_rows_job_time_idx").on(t.jobId, t.snapshotAt),
    idxIssue: index("followup_rows_issue_idx").on(t.snapshotAt, t.issue),
  }),
);

// Production schedule — Kristen's "what runs today" surface, v2 model.
//
// Syncore owns Jobs and Purchase Orders; the tables below are the dashboard's
// own layer on top of that. Two distinct concerns:
//
// 1. production_po_mirror — read-through cache of Syncore v2 purchase orders.
//    Mirrored by /api/cron/sync-production-pos so the page query is a fast
//    single-DB read instead of N round-trips to api.syncore.app. Both decoration
//    POs (supplier.class === "In House Production") and apparel POs (every
//    other class) live here — the page filters by class to split "what we
//    decorate" from "what we're waiting on".
//
// 2. po_schedule_state — dashboard-owned scheduling/floor state, keyed on the
//    Syncore PO id, NOT the job. A job with embroidery + transfers has two
//    decoration POs that run independently; a job with split-backorder
//    embroidery has two embroidery POs that may land on different days.
//    Either case needs per-PO state.

// Snapshot of a Syncore PO. Both decoration POs and apparel/external POs land
// here — distinguished by `supplier_class`. Refreshed by the mirror cron; we
// keep the full `raw` payload jsonb so new fields are available without a
// schema change.
export const productionPoMirror = pgTable(
  "production_po_mirror",
  {
    // Syncore PO id, used as the natural key. Text because Syncore returns
    // numbers but we standardize on strings across all syncore_* keys in
    // this schema for join consistency.
    poId: text("po_id").primaryKey(),
    syncoreJobId: text("syncore_job_id").notNull(),
    // PO number within the job (display only — 1, 2, 3…).
    poNumber: integer("po_number"),
    // Top-level PO status from Syncore: Open / Approved / Posted Manually /
    // Posted @ease A/P / Paid. Stored as text so new statuses don't need a
    // migration.
    status: text("status").notNull(),
    supplierId: integer("supplier_id"),
    supplierName: text("supplier_name"),
    // "In House Production" = decoration PO (CG Embroidery/Transfers/
    // Fulfillment); other values = apparel/external vendor.
    supplierClass: text("supplier_class"),
    inHandDate: text("in_hand_date"), // YYYY-MM-DD, vendor-side commitment
    // Denormalized snippets we surface on cards without re-parsing `raw`.
    // Stitch count is extracted from `decoration_instructions` if present.
    decorationInstructions: text("decoration_instructions"),
    stitchCount: integer("stitch_count"),
    totalQuantity: integer("total_quantity"),
    // Full PO body as returned by Syncore. Anything not promoted to a column
    // above is still recoverable from here.
    raw: jsonb("raw").notNull(),
    mirroredAt: timestamp("mirrored_at", { mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxJob: index("production_po_mirror_job_idx").on(t.syncoreJobId),
    idxSupplierClass: index("production_po_mirror_class_idx").on(
      t.supplierClass,
      t.status,
    ),
  }),
);

// Per-PO dashboard state. One row per Syncore PO id (`po_schedule_state.po_id`
// is the Syncore PO id, same as `production_po_mirror.po_id`). Unique on
// po_id so toggles are idempotent upserts.
//
// scheduled_date is nullable — a PO sits in "Unscheduled" until Kristen places
// it on a day. floor_status moves stopped → in_progress → done; we close the
// Syncore PO ("Posted Manually" status for in-house decoration) when it flips
// to done (Phase 3 writeback).
export const poScheduleState = pgTable(
  "po_schedule_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poId: text("po_id").notNull().unique(),
    // YYYY-MM-DD in America/Los_Angeles. Null = unscheduled.
    scheduledDate: text("scheduled_date"),
    // "stopped" | "in_progress" | "done". Text rather than pg-enum so new
    // states can be added without a migration.
    floorStatus: text("floor_status").notNull().default("stopped"),
    urgent: boolean("urgent").notNull().default(false),
    // If the PO was carried forward from an earlier day because it didn't
    // finish, the date it was first placed on. Preserves the look-back.
    carriedFromDate: text("carried_from_date"),
    doneAt: timestamp("done_at", { mode: "date" }),
    doneByUserId: text("done_by_user_id").references(() => users.id),
    // True once we've successfully PATCHed the Syncore PO to "Posted
    // Manually". Lets us retry the writeback if it failed without
    // double-posting.
    syncoreClosedAt: timestamp("syncore_closed_at", { mode: "date" }),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxDate: index("po_schedule_state_date_idx").on(t.scheduledDate),
    idxStatus: index("po_schedule_state_status_idx").on(t.floorStatus),
  }),
);

// Ad-hoc tasks captured at the daily huddle. Carry-forward updates
// scheduled_date but never deletes — the original record stays so the
// look-back is intact.
export const huddleTasks = pgTable(
  "huddle_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    text: text("text").notNull(),
    scheduledDate: text("scheduled_date").notNull(), // YYYY-MM-DD, Pacific
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { mode: "date" }),
    doneByUserId: text("done_by_user_id").references(() => users.id),
    urgent: boolean("urgent").notNull().default(false),
    carriedFromDate: text("carried_from_date"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxDate: index("huddle_tasks_date_idx").on(t.scheduledDate),
  }),
);

// Job-keyed verification look-back (req §5.1). When Kristen revisits a
// job after a vendor discrepancy, she needs the imprint location, qty,
// and who approved it — searchable by customer or job number. Mirrors
// the existing `verifications` table pattern but keyed on the production
// approval, not the inventory check.
export const jobVerificationRecord = pgTable(
  "job_verification_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syncoreJobId: text("syncore_job_id").notNull(),
    imprintLocation: text("imprint_location"),
    qtyGarments: integer("qty_garments"),
    approvedBy: text("approved_by"),
    capturedAt: timestamp("captured_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    // "proof" (auto-populated from Christina's proof attachments) | "manual"
    source: text("source").notNull(),
    raw: jsonb("raw"),
  },
  (t) => ({
    idxJob: index("job_verification_record_job_idx").on(t.syncoreJobId),
    idxCaptured: index("job_verification_record_captured_idx").on(
      t.capturedAt,
    ),
  }),
);

// Inbound apparel-PO receiving state. One row per Syncore PO id (apparel
// vendors only — SanMar, S&S, etc., not the in-house decoration POs).
// "Received" here is dashboard-local: when set, the floor sees the PO
// as in-hand and decoration POs that depend on it flip to ready. The
// corresponding flip in Syncore's v1 receiving memo lands in Phase 4.2.
export const poInboundState = pgTable("po_inbound_state", {
  poId: text("po_id").primaryKey(),
  receivedAt: timestamp("received_at", { mode: "date" }),
  receivedByUserId: text("received_by_user_id").references(() => users.id),
  // Stamped once the v1 receiving-memo webui writeback succeeds. Phase
  // 4.1 leaves it null; Phase 4.2 will populate.
  syncoreMemoUpdatedAt: timestamp("syncore_memo_updated_at", {
    mode: "date",
  }),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow(),
});

// Inbound tracking numbers for apparel POs. One row per tracking number;
// a PO can carry several when the vendor splits the shipment.
//
// `source` is "manual" (rep entered it from a vendor email) or "api"
// (Phase 5 auto-poll from SanMar/S&S/Cutter & Buck). `status` + `eta` +
// `last_polled_at` are populated by the carrier poll once it's wired.
export const poTracking = pgTable(
  "po_tracking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poId: text("po_id").notNull(),
    carrier: text("carrier").notNull(),
    trackingNumber: text("tracking_number").notNull(),
    source: text("source").notNull().default("manual"),
    status: text("status"),
    eta: text("eta"), // YYYY-MM-DD
    lastPolledAt: timestamp("last_polled_at", { mode: "date" }),
    enteredByUserId: text("entered_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxPoId: index("po_tracking_po_id_idx").on(t.poId),
  }),
);
