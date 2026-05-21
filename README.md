# Color Graphics Internal Tools

This repository hosts Color Graphics' internal Next.js app — a single deploy
that bundles every in-house tool we build for our team. New tools live here
unless there's a strong reason to spin up a separate repo (different access
policies, different stakeholders, etc.).

> **Heads up on the repo name.** The repo is currently named `inventory-check`
> (the first tool that lived here). It may be renamed to something more
> general like `cg-tools` or `cg-internal`. GitHub auto-redirects, so existing
> clones keep working — just remember to reconnect the Vercel project to the
> new repo name in Settings → Git.

## Tools in this app

| Tool | Path | Audience | Purpose |
|---|---|---|---|
| **Inventory Check** | `/` | Customer service reps | Enter a Syncore sales order #, see line items with live vendor stock (SanMar, S&S, Cutter & Buck), mark each line as verified — writes back to Syncore. Optional UPS freight + decorator-cost overlays. |
| **CSR Performance Dashboard** | `/dashboard` | Managers (`MANAGER_EMAILS` allowlist) | Daily glanceable read on each CSR's open follow-ups, overdue items, throughput, and 30-day trends. Fed by a twice-daily cron that snapshots Syncore's Job Follow-Ups page. Includes a 7 AM Pacific email digest. |

The app gates everything behind Auth.js + Google sign-in restricted to
`@${ALLOWED_EMAIL_DOMAIN}` (currently `colorgraphicswa.com`). Manager-only
routes layer an additional `MANAGER_EMAILS` allowlist on top.

## Stack

- Next.js 15 (App Router) + TypeScript + React 19
- Tailwind CSS (theme driven by `src/styles/brand-tokens.ts`)
- Auth.js v5 with Google provider (domain-restricted)
- Drizzle ORM + Neon Postgres
- `soap` (vpulim/node-soap) for SanMar PromoStandards
- Resend for transactional email (digest only)
- Vercel Cron for scheduled jobs
- Deployed on Vercel (production branch: `main`)

## First-time setup

```bash
pnpm install
cp .env.example .env.local
# fill in every value — see comments in .env.example
pnpm db:generate    # generates drizzle/ migrations from schema
pnpm db:migrate     # applies them to DATABASE_URL
pnpm dev
```

Open http://localhost:3000 → redirected to `/signin` → sign in with a Google
account whose email ends in `@${ALLOWED_EMAIL_DOMAIN}`.

## Key paths

| Area | File |
|---|---|
| Brand tokens | `src/styles/brand-tokens.ts` |
| Full brand guide | `docs/brand/brand-guidelines.html` |
| Auth config | `src/lib/auth.ts`, `src/lib/auth.config.ts`, `middleware.ts` |
| Manager allowlist | `src/lib/managers.ts` |
| DB schema | `src/lib/db/schema.ts` |
| Syncore v2 REST client | `src/lib/syncore/client.ts`, `orders.ts` |
| Syncore web-UI scraper | `src/lib/syncore/webui.ts`, `followups.ts` |
| SanMar SOAP | `src/lib/vendors/sanmar/client.ts`, `map.ts` |
| Vendor registry | `src/lib/vendors/registry.ts` |
| Inventory Check rep UI | `app/(app)/page.tsx`, `app/(app)/orders/[id]/page.tsx` |
| CSR Dashboard | `app/(app)/dashboard/page.tsx` + `_components/` |
| API | `app/api/orders/[id]/route.ts`, `.../verify/route.ts`, `app/api/cron/...` |

## Scheduled jobs (Vercel Cron)

Configured in `vercel.json`. All cron routes require the `CRON_SECRET` shared
header (sent automatically by Vercel as `Authorization: Bearer …`; for manual
runs use `x-cron-secret`).

| Path | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/snapshot-followups` | 13:00 + 21:00 weekdays | Pulls open + completed follow-ups for each CSR from Syncore's web UI and writes a snapshot to `followup_snapshots` + `followup_rows`. |
| `/api/cron/digest-followups` | 14:15 weekdays | Sends the 7:15 AM Pacific morning digest email to `DIGEST_RECIPIENTS` from `DIGEST_FROM_EMAIL` via Resend. |

To run a snapshot manually:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  http://localhost:3000/api/cron/snapshot-followups | jq
```

## Environment variables

See `.env.example` for the complete annotated list. Every variable must be
set both locally and on Vercel.

Quick reference:

- **Auth:** `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAIL_DOMAIN`
- **Database:** `DATABASE_URL`
- **Syncore v2 REST:** `SYNCORE_BASE_URL`, `SYNCORE_API_KEY`
- **Syncore web UI** (for follow-ups): `SYNCORE_USERNAME`, `SYNCORE_PASSWORD`
- **CSR registry:** `CSR_VALERIE_ID`, `CSR_JEREMIAH_ID`
- **CSR Dashboard:** `MANAGER_EMAILS`, `CRON_SECRET`, `DIGEST_RECIPIENTS`, `DIGEST_FROM_EMAIL`, `RESEND_API_KEY`
- **Vendors:** `SANMAR_*`, `SS_*`, `CB_*`
- **UPS freight:** `UPS_*`

## Adding a new tool

1. Pick a route segment under `app/(app)/<tool-name>/`. Server component by
   default; add `_components/` and `_lib/` subdirs as needed.
2. If the tool needs role gating, add the route prefix check to
   `src/lib/auth.config.ts`'s `authorized` callback alongside `/dashboard`.
3. If it pulls from Syncore, prefer the v2 REST client
   (`src/lib/syncore/client.ts`); fall back to `webui.ts` only if the data
   isn't in v2.
4. New DB tables go in `src/lib/db/schema.ts`. Run `pnpm db:generate` then
   `pnpm db:migrate`.
5. Update this README's "Tools in this app" table.

## Known provisional decisions

These were chosen on best available info and should be confirmed on first
real-world call; each is isolated to one file for easy adjustment:

- `X-API-Key` header name for Syncore (`src/lib/syncore/client.ts`) — swap to
  `Authorization: Bearer …` if 401.
- Write-back endpoint path `/orders/{id}/lines/{lineId}` with a `status`
  field (`src/lib/syncore/orders.ts`) — adjust to whatever Syncore actually
  exposes for marking a line/order verified.
- The Syncore Follow-Ups response shape (`src/lib/syncore/followups.ts`)
  uses tolerant parsers — JSON keys may differ from displayed labels; the
  full raw payload is kept in `raw_statistics` / `raw` jsonb columns so
  parsing can be refined without re-running the cron.

## Verification checklist (end-to-end)

### Inventory Check
1. `pnpm typecheck && pnpm lint` pass.
2. Sign in with a `@${ALLOWED_EMAIL_DOMAIN}` account → land on `/`.
3. Sign in with a non-allowed domain → rejected on the Google callback.
4. Enter a known open order number → page shows line items with live stock.
5. Click **Verify** → a row lands in the `verifications` table and the order
   reflects the status in Syncore.

### CSR Dashboard
1. Sign in with a `MANAGER_EMAILS` address → "Dashboard" link visible in
   the header → `/dashboard` renders.
2. Sign in with a non-manager `@${ALLOWED_EMAIL_DOMAIN}` email → no link;
   `/dashboard` redirects.
3. Run the snapshot cron manually (see above). Confirm `followup_snapshots`
   has 4 rows (2 CSRs × Open + Completed) and `followup_rows` has all rows.
4. Refresh `/dashboard` → CSR scorecards, team rollup, and jobs table
   populate. Click a job # → opens Syncore's job page in a new tab.
5. Trigger the digest cron manually and confirm the email arrives.
