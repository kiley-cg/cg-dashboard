import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  integer,
  jsonb,
  uuid,
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
