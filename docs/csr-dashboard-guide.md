# CSR Performance Dashboard — User Guide

> Internal Color Graphics tool. Live at `/dashboard` on the
> Inventory Check production site, gated to managers by email allowlist.

## What it is

A glanceable view of how Color Graphics' two CSRs (Valerie Ross, Jeremiah
Gana) are doing each day. Snapshots Syncore's Job Follow-Ups page hourly
during business hours (Mon–Fri) and rolls the data up into:

- A score per CSR ("attention score") indicating how much help they need
- Auto-generated talking points for your 1:1s
- The 5 oldest neglected jobs per CSR — with one click out to Syncore
- A team-wide issue heatmap (clickable to filter the jobs table below)
- A 7:15 AM PT weekday digest email summarizing it all

You don't need to do anything to keep it running — the cron is automated.
Open the dashboard before a 1:1 or a CSR check-in, scan the talking
points, click the relevant job links, have a smarter conversation in
30 seconds.

## Who can see it

Anyone whose email is in the `MANAGER_EMAILS` Vercel env var. Currently
that's `kiley@colorgraphicswa.com` and `voshte@colorgraphicswa.com`.
CSRs and other Color Graphics employees who sign in to the Inventory
Check app won't see the "Dashboard" link in the header.

To add or remove a manager, edit the env var in Vercel → Project →
Settings → Environment Variables → `MANAGER_EMAILS` (comma-separated,
no spaces). Redeploy after editing.

## Reading the dashboard

### Page header

```
CSR Performance
Snapshot at 2:14 PM PDT · 7 min ago · for 2026-05-07
```

The "Snapshot at" timestamp is when the data was last refreshed from
Syncore. Hourly during weekday business hours; off on weekends. If
the timestamp is older than ~70 minutes during a business weekday,
something's stuck — see "Troubleshooting" below.

### Workload imbalance banner (only when relevant)

Appears at the top of the page in amber **only when**:

- One CSR's open follow-up count is ≥1.5× the other's
- AND the absolute gap is ≥8 follow-ups
- AND the higher CSR has ≥10 open

So you'll see it when there's a real imbalance worth acting on, and
nothing when the team is balanced. Action: redistribute some open
jobs — typically Hold or Needs Tracking, since those don't require
deep context.

### Per-CSR scorecard

| Stat | What it means |
|---|---|
| **Attention score** | `overdue + stale Critical/Rush`. Lower is better. 0 = green; 1–3 = amber; >3 = red. |
| **Follow-ups** | Total open follow-ups assigned to this CSR right now. |
| **Due today** | Open follow-ups whose F/U date is today. |
| **Overdue** | Open follow-ups whose F/U date is in the past. |
| **Critical/Rush** | Open follow-ups marked Critical or Critical Rush priority. |
| **Stale crit/rush** | Open Critical/Rush follow-ups that are also overdue. |
| **Issue mix bar** | Stacked bar showing the breakdown of open follow-ups by issue type (Hold, Needs Tracking, Artwork, etc.). |
| **Aging on open list** | Buckets showing how long jobs have been "stuck" — combines days overdue (from F/U date) and days since we first saw the job. <1d / 1–3d / 3–7d / 7d+. |

### Talking points (per CSR)

Auto-generated 1:1 prep bullets, in priority order. Up to 5 bullets
per CSR. Examples of the rules:

- 🔴 If any Critical/Rush jobs are overdue → name the count and the
  oldest one with its job number and contact
- 🔴 If any open job has been stuck >14 days → name it explicitly
- 🟡 If overdue total >5 → flag as priority
- 🟡 If one issue type owns >40% of issued workload (≥5 jobs) → flag
  for focused chase
- 🟡 If workload >30 → suggest triaging down
- 🟢 If nothing fired → "clean slate, keep it up"

The bullets are facts pulled from data, not opinions. Use them as a
starting point for the conversation, not a script.

### Oldest open jobs (per CSR)

Top 5 jobs from this CSR's open list, sorted by days stuck. Days are
shown red if ≥14, amber if ≥7. Click the **Job #** to open the job
in Syncore in a new tab — same tool you and the CSR already use.

These are the embarrassments — the jobs everyone forgot about. Walk
through these in your 1:1.

### Team rollup heatmap

A grid showing each CSR's open count for each issue type (Artwork,
Hold, Needs Tracking, In Transit, etc.). Cells are red-shaded by
intensity — darker red = more.

**Click any non-zero cell** → scrolls to the Jobs table below and
filters it to that CSR + that issue type. Use this to drill into
"why does Jeremiah have 12 Hold jobs?" with one click.

### 30-day trend sparklines

Once we've been collecting data for a few weeks, the team rollup
section will show two small line charts per CSR:

- **Open** — workload over time
- **Issues** — total issues over time

Right now they'll look flat or empty. Comes alive after ~14 days.

### Jobs table

Bottom of the page. The filterable, sortable list of every job in
the latest snapshot. Filter by status (Open/Completed/All), CSR,
issue type. Sort by clicking column headers. Click any **Job #** to
open in Syncore.

## The morning email digest

Sent at **7:15 AM PT every weekday** to `kiley@colorgraphicswa.com`
and `voshte@colorgraphicswa.com`. Subject lines like:

```
CSR Dashboard · 2026-05-07 · 3 overdue · 1 stale crit/rush
CSR Dashboard · 2026-05-07 · all clear
```

Body shows the same scorecard data per CSR plus a link to the live
dashboard. Sent from `alerts@updates.colorgraphicswa.com`; replies
land in the `alerts@colorgraphicswa.com` Google Group.

To add or remove digest recipients, edit `DIGEST_RECIPIENTS` in
Vercel env vars (comma-separated). Redeploy after editing.

**If the digest goes to spam:** mark "Not spam" once. After Gmail
learns the sender is legit (~3-5 sends), future digests will land
in the inbox.

## What's coming

Pinned for ~2 weeks from now once we have meaningful time-series data:

- **Week-over-week deltas** in the talking points ("Backlog up 23%
  this week — what's blocking?")
- **Issue-resolution latency trends** (avg days a Hold/Needs-Tracking
  job stays open before it leaves the open list)
- **Looker Studio reporting dashboard** — point-and-click charts for
  ad-hoc analysis ("show me Jeremiah's overdue count by week")
  pulling from a Google Sheet that's auto-populated from Neon
- Possibly: 5 PM EOD email asking "did Valerie/Jeremiah clear their
  due-today list before going home?"

## Troubleshooting

### "Snapshot at" timestamp is hours old during a weekday

The hourly cron is failing. Check Vercel → Project `inventory-check`
→ Logs → search `requestPath:/api/cron/snapshot-followups`. Recent
runs should be 200. If they're failing, click into one — likely
causes:

- Syncore login rejected → password changed, MFA was enabled, or
  account was disabled. Check `automations@colorgraphicswa.com` in
  Syncore. Update `SYNCORE_PASSWORD` in Vercel env if needed.
- Postgres connection error → Neon is down or `DATABASE_URL` rotated.
  Check Neon's status page.

### Numbers on the dashboard don't match Syncore's UI

Syncore's "Total Records" panel filtered to one CSR with status=Open
should match the dashboard's "Follow-ups" stat for that CSR. If it
doesn't:

- Snapshot might be stale. Check the timestamp at top of page; if
  it's >2 hours old during business hours, see above.
- Click **Settings → Cron Jobs → Run** on `snapshot-followups` to
  force a fresh pull. Refresh the dashboard with Cmd+Shift+R.

### Dashboard link not showing in the header

Your email isn't in the `MANAGER_EMAILS` allowlist, OR you're signed
in as a different account. Sign out and back in with the right email.

### Digest email not arriving

- Check Gmail spam folder first.
- Check Resend → https://resend.com → Emails — every send attempt is
  logged. If it shows "Failed" or "Bounced," click for the error.
- Vercel → Cron Jobs → Run on `digest-followups` manually to test.
  External APIs in the run log should show 1 outgoing POST to
  `api.resend.com/emails`.

### A new CSR joined the team

Currently the CSR list is hardcoded via env vars (`CSR_VALERIE_ID`,
`CSR_JEREMIAH_ID`) and a small registry in
`src/lib/syncore/followups.ts`. Adding a CSR requires a code change.
Tell Kiley.

## Where the code lives

- Repo: `kiley-cg/inventory-check`
- Dashboard route: `app/(app)/dashboard/page.tsx`
- Talking-points / oldest-jobs / imbalance logic:
  `app/(app)/dashboard/_lib/compute.ts`
- Syncore web-UI scraper: `src/lib/syncore/webui.ts`,
  `src/lib/syncore/followups.ts`
- Database schema: `src/lib/db/schema.ts` (`followup_snapshots` and
  `followup_rows` tables)
- Cron entrypoints: `app/api/cron/snapshot-followups/route.ts`,
  `app/api/cron/digest-followups/route.ts`
- Cron schedule: `vercel.json`
- Email digest: `src/lib/email/digest.ts`
- Manager allowlist: `src/lib/managers.ts`
