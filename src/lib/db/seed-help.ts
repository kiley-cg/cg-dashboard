// Default SOP / help content for the in-app help drawer. Idempotent —
// re-running won't overwrite existing rows (admins can freely edit and
// the seed won't clobber their changes). Triggered from /admin/help
// via the "Seed defaults" button.

import { eq } from "drizzle-orm";
import { db, schema } from "./client";

interface SeedDoc {
  slug: string;
  title: string;
  bodyMd: string;
}

const SEED_DOCS: SeedDoc[] = [
  {
    slug: "production",
    title: "Production planner",
    bodyMd: `# Production planner

The day-by-day view of what's on the floor. Built for Kristen; everyone with the **Production Floor** role lands here on sign-in.

## At a glance

- **Day tabs** show one weekday at a time. Use the **← / →** arrows to jump weeks.
- **Week view** (toggle top-right) shows Mon–Fri as columns side by side, with drag-and-drop between days.
- The **count chip** + **capacity bar** on each day tab show how much is scheduled (soft target = 1,500 pieces).

## PO tiles

Each card is one decoration PO. Color codes:

- **Red border** — the latest apparel arrival is *after* the customer's due date. Won't ship on time without action.
- **Green border** — all apparel for this job is delivered (or Syncore-closed). Ready to start.
- **Dim** — completed.
- **Department stripe** on the left identifies which floor the job belongs to (Embroidery / Transfers / Fulfillment / Other).

## Scheduling

- **Schedule dropdown** on each card drops it on a day.
- **Multi-select** — tick checkboxes on multiple cards, then a sticky bar appears at the top with **Schedule to: [day]** and **Unschedule**.
- In **Week view**, drag any card between day columns (or to the Unscheduled strip at top).

## Status

- **Pending** — scheduled day not yet set
- **Scheduled** — day set, not started
- **In Progress** — actively being decorated
- **Completed** — done. Click **Close in Syncore** to flip the PO to "Posted Manually" on the Syncore side.

## Inbound apparel

Each PO's rollup shows: *Waiting on N of M apparel POs · last MM-DD · K tracking*. Click to expand a per-PO breakdown. Tracking #s come from vendor APIs (SanMar / C&B / S&S — auto-polled 2x daily) and UPS Track API for ETAs (every 4h).

## Ask about this Job

Use the **Ask about this Job** button on any card to fire a question to the CSR or salesperson. Defaults to the CSR-on-job; override via the dropdown. Sends to that Job's Syncore Job Log AND emails the recipient (when their Syncore user ID is in the registry).
`,
  },
  {
    slug: "production.tracking",
    title: "Tracking auto-poll + carrier ETAs",
    bodyMd: `# How tracking works

Two crons run automatically — no one needs to enter UPS numbers manually for SanMar / C&B / S&S apparel.

## Vendor poll (2× daily, weekdays)
At **8 AM and 2 PM Pacific**, for every open apparel PO in the dashboard, we ask the vendor "did this ship?" via their API:

- **SanMar** → PromoStandards OSN SOAP
- **Cutter & Buck** → PromoStandards OSN SOAP
- **S&S Activewear** → REST \`/v2/orders?Boxes=true\`

New tracking numbers land in the PO's expanded tracking list AND auto-post to Syncore's Job Log so everyone sees it.

## Carrier poll (every 4h)
For every UPS tracking number on record (which is ~all of them — SanMar/C&B/S&S ship UPS), we hit the **UPS Track API** to get:

- Scheduled or actual delivery date → shows as "ETA MM-DD" or "delivered MM-DD"
- Status → green chip for **delivered**, neutral chip for **in transit / OFD / label / exception**

## What you'll see

In the rollup on each PO: *Waiting on N of M apparel POs · last MM-DD · K tracking*. The "last" date is the latest known delivery across all open siblings — what gates scheduling.

Click the badge to expand the tracking #s. Each row has: carrier, tracking #, **api** chip (auto vs manual), ETA / delivered date, status chip, × delete.

## When to manually add tracking

- Vendor isn't SanMar / C&B / S&S (Contract Garments, in-house transfers, etc.)
- Vendor API doesn't have the shipment yet but you have the # from an email
- Tracking is from a non-UPS carrier (FedEx, USPS) — those aren't auto-polled

Type the tracking# in the inline form, pick the carrier, hit **+ Add & sync**. It also auto-posts to the Syncore Job Log.

## Troubleshooting

- **"0 tracking" on a PO that should have it**: either the vendor hasn't shipped yet, or the cron hasn't run since shipment. Admins can trigger a manual run at \`/admin/crons\`.
- **PO shows "still arriving" but everything's delivered**: usually means Syncore PO status hasn't been posted yet. The dashboard cross-references delivery status — once all tracking shows delivered, the PO drops out of the waiting count automatically.
`,
  },
  {
    slug: "inventory",
    title: "Inventory check",
    bodyMd: `# Inventory check

Type a Syncore Job ID, hit **Search**, and the tool pulls the job's sales orders and checks each line item's availability against the actual vendor's live inventory (SanMar, S&S, Cutter & Buck).

## What you'll see

For each line:
- **Available** — green: vendor has stock to fill the order
- **Short** — red: not enough. Number shown is how many short.
- **No match** — vendor doesn't carry that style/color/size (or we can't resolve the SKU)
- **Verify** — once you've checked with the vendor and confirmed (or sourced an alt), click Verify to mark the line good. Verifications log to an audit table.

## Clearing verifications

If you need to start over on a job (e.g. someone re-ordered substitutes), use **Clear all verifications**. That writes a one-row opt-out so the page won't silently re-verify on next render.

## Manager / FAQ

See \`/help/inventory\` for the full FAQ.
`,
  },
  {
    slug: "dashboard",
    title: "Manager dashboard",
    bodyMd: `# Manager dashboard

CSR performance snapshot from Syncore Job Follow-Ups. Snapshots are taken every weekday hour by a cron job; the daily digest emails out at **7:15 AM Pacific** (\`/api/cron/digest-followups\`).

## What's on this page

- **Per-CSR rollups** — open follow-ups, days-past-due, top customers
- **Team summary** at top — aggregate metrics across all CSRs
- **Imbalance banner** — flagged when one CSR's load is materially higher than peers
- **Drill-in**: click any CSR row to see their queue.

## Snapshots

Data comes from the \`followup_snapshots\` + \`followup_rows\` tables (each hourly cron run inserts a new snapshot). View any specific run's source data in Neon / Drizzle Studio if needed.

## Manager-only

This page requires the \`dashboard.view\` permission. Granted by default to the Manager and Administrator roles.
`,
  },
  {
    slug: "admin.users",
    title: "Admin · Users",
    bodyMd: `# User admin

One-stop user management. Lists every user that has signed in (or been invited).

## Invite a user

Pre-create a row by entering their email — they land on the right surface immediately on first sign-in. Their email must match the \`ALLOWED_EMAIL_DOMAIN\` env (typically @colorgraphicswa.com).

## Assigning roles

Each user has a list of **RBAC roles** (chip per role). Click ×  on any chip to remove. Use the **+ add role...** dropdown to add more. Roles bundle permissions — see \`/admin/roles\` to edit which.

## Manager superset

Users whose email is in the \`MANAGER_EMAILS\` env always pass every permission gate regardless of their RBAC role assignments. Use this as a safety net while migrating users to explicit roles; remove the env once everyone has the right RBAC roles.
`,
  },
  {
    slug: "admin.roles",
    title: "Admin · Roles",
    bodyMd: `# Roles admin

Roles bundle permissions. Users are assigned one or more roles; the union of all their roles' permissions determines what they can see and do.

## Default roles

Re-seed by clicking **Re-seed defaults** at the top. Idempotent — won't overwrite custom edits.

- **Administrator** — every permission, including admin pages
- **Manager** — every dashboard + write actions; no admin pages
- **CSR** — inventory + production view + manual tracking entry
- **Production Floor** — schedule POs, set floor status, log tracking
- **Viewer** — read-only across the main dashboards

## Editing a role

Click any role label to open its edit page. Tick the permission checkboxes you want, hit **Save permissions**. System roles (Administrator, Manager, Viewer) can have their permissions edited but can't be deleted.

## Past migration note

The original single \`users.role\` text column was migrated to RBAC and the column dropped 2026-05-26. RBAC is the only source of truth now.

## Adding new permissions

Permission keys live in code (\`src/lib/permissions.ts\`). Adding a new gateable feature = one new row in that catalog + a \`hasPermission()\` call in the code. Then admins can assign the new permission to roles here.
`,
  },
  {
    slug: "admin.crons",
    title: "Admin · Crons",
    bodyMd: `# Cron admin

Visibility + control over the scheduled background jobs.

## What you see

For each cron defined in \`vercel.json\`:
- **Schedule** (raw + human-readable)
- **Last run**: timestamp (Pacific), duration, status, summary or error message
- Expandable **earlier runs** (last 5)
- **Run now** button — POSTs to the cron's own URL with \`CRON_SECRET\`. Same code path as a scheduled invocation.

## What's instrumented

All 5 current crons log to \`cron_runs\`:
- \`/api/cron/poll-vendor-tracking\` — vendor OSN sweep (2× daily weekdays)
- \`/api/cron/poll-carriers\` — UPS Track API sweep (every 4h)
- \`/api/cron/snapshot-followups\` — Syncore Follow-Ups snapshot (hourly weekdays)
- \`/api/cron/digest-followups\` — daily email digest (7:15 AM Pacific)
- \`/api/cron/sync-production-pos\` — Syncore PO mirror sync (hourly during business hours)

## Adding a new cron

1. Define the route at \`app/api/cron/<name>/route.ts\`
2. Wrap handlers with \`logCronRun("/api/cron/<name>", handler)\` so it appears here
3. Add the schedule to \`vercel.json\`
`,
  },
  {
    slug: "verifications",
    title: "Verification look-back",
    bodyMd: `# Verification look-back

Pull up a job's verification trail without flipping pages. When a vendor sends the wrong garment or a customer questions an order, this is where you confirm imprint location, quantity, and who approved.

## How to find a job

- Type a **customer name** (partial OK) — search hits the latest Job Follow-Up snapshot's customer + description fields.
- Or type a **job number** directly — jumps to that job.

## What's on each job page

When you open a result, the job page shows:
- **Verification record** (top) — imprint location, qty garments, approved-by. Editable by anyone with the \`verifications.record_spec\` permission (CSRs, managers, admins). Saved values persist forever — you don't lose context when the job closes.
- **Per-line inventory verifications** — every "Verify" click ever recorded for this job, with timestamps and who.

## Phase D2 (coming)

Christina's proofs (from Google Drive) will auto-populate the spec when she signs off — same fields, source flips to "proof" instead of "manual". The form here keeps working unchanged.
`,
  },
  {
    slug: "inbox",
    title: "Inbox",
    bodyMd: `# Inbox

Consolidated view of every Syncore Job Tracker entry addressed to you across all active jobs. Pair to the floor's **Send Job Tracker** button on \`/production\` — when Kristen pings you with a question, it lands here.

## Where the data comes from

A snapshot cron runs **every 30 minutes** and pulls tracker entries from every active job in the production mirror into a local cache. The inbox view reads from that cache (fast, doesn't hit Syncore live).

If you need fresher data right now, hit **Refresh** at the top of the page — it fires the same path on-demand.

## Per-row actions

- **Reply** opens a composer pre-targeted to the sender. Sends via Syncore's \`SendTrackerAsync\` (same as the floor side), which posts to the job's Job Log AND emails the recipient.
- **Mark handled** writes a per-recipient state row. Doesn't touch Syncore — it's a local "I dealt with this" flag. The row fades, count chip + nav badge drop by one. Click again to unhandle.

## Filters

- **Open** (default) — entries you haven't marked handled yet
- **Handled** — your archive
- **All** — everything addressed to you

## Manager view (\`inbox.view_all\`)

Managers see a dropdown to switch the inbox view to anyone else's queue — useful when someone's out and you need to triage.

## When messages don't show up

- **Sender's Syncore user ID not in the registry** — for entries to attribute to you, the sender's tracker recipient list (parsed from Syncore's "email sent to X" auto-row) must match a person in \`src/lib/people/registry.ts\` with your \`syncoreUserId\`. Missing IDs today: Jeremiah, Tricia, Voshte.
- **Snapshot cron hasn't run yet** — hit **Refresh**.
- **Entry type wasn't a human note** — only \`entryType=3\` (the actual message) shows up; the auto-rows that follow (\`entryType=2\`) are used internally for recipient extraction.
`,
  },
  {
    slug: "admin.help",
    title: "Admin · Help docs",
    bodyMd: `# Help docs admin

Each major page in the dashboard has a **?** button that opens this drawer. Content comes from the \`help_docs\` table; you edit it here, changes apply immediately (no deploy).

## Adding content for a new slug

Mount \`<PageHelp slug="your-slug" title="Foo" />\` somewhere in the page header. The slug shows up here as "empty" until you write something. Click it, write markdown, save.

## Markdown supported

Standard GFM: headings, lists, links, **bold**, *italic*, code, blockquotes, tables.

## Re-seed defaults

The **Seed defaults** button populates default SOPs for the known dashboards (production, inventory, dashboard, admin.\\*). Idempotent — won't overwrite anything you've edited.
`,
  },
];

export async function seedHelpDocs(): Promise<{
  inserted: number;
  skipped: number;
}> {
  let inserted = 0;
  let skipped = 0;
  for (const d of SEED_DOCS) {
    const existing = await db
      .select({ id: schema.helpDocs.id })
      .from(schema.helpDocs)
      .where(eq(schema.helpDocs.slug, d.slug))
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(schema.helpDocs).values({
      slug: d.slug,
      title: d.title,
      bodyMd: d.bodyMd,
    });
    inserted++;
  }
  return { inserted, skipped };
}
