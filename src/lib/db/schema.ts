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
import { sql } from "drizzle-orm";
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
    // Kristen's free-form notes on how this decoration job was run
    // ("used 40wt thread", "needed two hoopings"). Persists past PO close
    // so /production/notes can surface "how did I do this customer last
    // time" — the real long-term value of the field.
    productionNotes: text("production_notes"),
    notesUpdatedAt: timestamp("notes_updated_at", { mode: "date" }),
    notesUpdatedByUserId: text("notes_updated_by_user_id").references(
      () => users.id,
    ),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxDate: index("po_schedule_state_date_idx").on(t.scheduledDate),
    idxStatus: index("po_schedule_state_status_idx").on(t.floorStatus),
    idxNotesUpdated: index("po_schedule_state_notes_updated_idx").on(
      t.notesUpdatedAt,
    ),
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

// Tracks progress of the slow-drip Drive proof backfill. One row per
// Drive range folder (e.g. "28000-28999"). The hourly cron handles
// last-30-days incrementals; this table powers a daily catch-up cron
// that steps through historical ranges one chunk at a time.
export const proofBackfillState = pgTable("proof_backfill_state", {
  rangeName: text("range_name").primaryKey(),
  folderId: text("folder_id").notNull(),
  // Total Drive PDFs in this range. Null until the first sweep counts
  // them; populated by the seeding step of the cron.
  totalCount: integer("total_count"),
  // How many files have been processed with parseSpec=true so far.
  processedOffset: integer("processed_offset").notNull().default(0),
  doneAt: timestamp("done_at", { mode: "date" }),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow(),
});

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

// --- RBAC (Role-Based Access Control) -----------------------------------
//
// New many-to-many model layered alongside the existing users.role text
// column. The legacy column stays during transition; new code calls
// hasPermission() against this graph instead of hasRoleAccess().
//
// Permission keys are well-known strings declared in src/lib/permissions.ts
// (no separate `permissions` row table — keys live in code so feature gates
// can be added in PRs without a DB write).
//
// Roles are admin-editable. Each role has a set of permission keys via
// rolePermissions. Users have any number of roles via userRoles.

export const roles = pgTable(
  "rbac_role",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Lowercase machine name used in code references. Lower-snake_case.
    name: text("name").notNull().unique(),
    label: text("label").notNull(), // human-readable display
    description: text("description"),
    // System roles can't be deleted from the admin UI (admin / viewer);
    // their permissions are still editable.
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
);

export const rolePermissions = pgTable(
  "rbac_role_permission",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    // Permission key — validated at write time against the catalog in
    // src/lib/permissions.ts. Keep as text so a new permission can be
    // added in code + assigned via UI without a schema change.
    permissionKey: text("permission_key").notNull(),
    grantedAt: timestamp("granted_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionKey] }),
    idxRole: index("rbac_role_permission_role_idx").on(t.roleId),
  }),
);

export const userRoles = pgTable(
  "rbac_user_role",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { mode: "date" }).notNull().defaultNow(),
    assignedByUserId: text("assigned_by_user_id").references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
    idxUser: index("rbac_user_role_user_idx").on(t.userId),
  }),
);

// --- Cron run history ----------------------------------------------------
//
// Each cron handler that's instrumented with logCronRun() appends one row
// here per invocation. Powers the /admin/crons page: last-run timestamp,
// success vs error, duration, and the summary the handler returned.

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cronPath: text("cron_path").notNull(), // "/api/cron/poll-vendor-tracking"
    triggeredAt: timestamp("triggered_at", { mode: "date" })
      .notNull()
      .defaultNow(),
    // "schedule" for Vercel-cron-driven runs; otherwise the userId
    // (when run from the admin dashboard) or "external" for raw curl.
    triggeredBy: text("triggered_by").notNull().default("schedule"),
    durationMs: integer("duration_ms"),
    status: text("status").notNull(), // "ok" | "error"
    summary: jsonb("summary"),
    errorMessage: text("error_message"),
  },
  (t) => ({
    idxPath: index("cron_runs_path_idx").on(t.cronPath, t.triggeredAt),
  }),
);

// --- Help / SOP docs -----------------------------------------------------
//
// One row per page-level SOP. Pages reference by slug; admins edit via
// /admin/help. Markdown is stored as source so admins can tweak without
// a deploy. Slug is the natural key: "production", "production.tracking",
// "admin.crons", etc.

export const helpDocs = pgTable(
  "help_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id),
  },
);

// --- Phase C inbox / tracker mirror -------------------------------------
//
// Local cache of Syncore Job Tracker entries. Snapshot cron fetches per
// active job every 30 min; manual /inbox refresh fires the same path
// on-demand. The inbox page reads from these tables, never from
// Syncore live — keeps the page snappy and consolidates per-user
// "what's addressed to me" without a Syncore endpoint that supports it.

export const trackerEntriesCache = pgTable(
  "tracker_entries_cache",
  {
    syncoreEntryId: text("syncore_entry_id").primaryKey(), // stored as text for safety (Syncore IDs are big ints)
    jobId: text("job_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    createdByUserId: integer("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    description: text("description").notNull(),
    entryType: integer("entry_type").notNull(), // 2 = system, 3 = note
    colorId: integer("color_id").notNull(),
    // User IDs derived from the immediately-following entryType=2 "email
    // sent to…" auto-row. Many entries have 0 recipients; the GIN index
    // makes "where 13379 = ANY(recipient_user_ids)" fast.
    recipientUserIds: jsonb("recipient_user_ids").notNull().default(sql`'[]'::jsonb`),
    fetchedAt: timestamp("fetched_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    idxJob: index("tracker_entries_cache_job_idx").on(t.jobId),
    idxCreated: index("tracker_entries_cache_created_idx").on(t.createdAt),
  }),
);

// Per-recipient "I handled this" flag. Composite PK so a multi-recipient
// entry tracks each person's handled state independently.
export const trackerInboxState = pgTable(
  "tracker_inbox_state",
  {
    syncoreEntryId: text("syncore_entry_id").notNull(),
    recipientUserId: integer("recipient_user_id").notNull(),
    handledAt: timestamp("handled_at", { mode: "date" }),
    handledByUserId: text("handled_by_user_id").references(() => users.id),
    notes: text("notes"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.syncoreEntryId, t.recipientUserId] }),
  }),
);
