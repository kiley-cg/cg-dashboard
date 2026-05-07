import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  integer,
  jsonb,
  uuid,
  index,
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
