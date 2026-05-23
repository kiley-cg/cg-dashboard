# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

A single Next.js app deployed to Vercel that bundles every in-house tool Color Graphics ships for its team. The repo is currently named `inventory-check` (the first tool that lived here) but hosts multiple tools — when adding a new one, give it its own route segment under `app/(app)/<tool>/` rather than spinning up a new repo. The README's "Tools in this app" table is the source of truth for what currently lives here.

Stack: Next.js 15 App Router · React 19 · TypeScript (strict) · Tailwind · Auth.js v5 · Drizzle + Neon Postgres · `soap` (PromoStandards) · Resend · Vercel Cron.

Package manager: **pnpm**.

## Commands

```bash
pnpm dev                  # next dev
pnpm build                # next build
pnpm lint                 # next lint (eslint)
pnpm typecheck            # tsc --noEmit
pnpm db:generate          # drizzle-kit generate — emit a migration from schema.ts changes
pnpm db:migrate           # drizzle-kit migrate  — apply pending migrations to DATABASE_URL
pnpm db:studio            # drizzle-kit studio
```

There is no test runner configured. The README's "Verification checklist" is the manual smoke test for both tools.

Run a cron route locally:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  http://localhost:3000/api/cron/snapshot-followups | jq
```

## Architecture

### Auth split: edge vs Node
Auth is intentionally split across two files because middleware runs on the edge runtime and cannot import the Drizzle adapter:

- `src/lib/auth.config.ts` — edge-safe `NextAuthConfig` (Google provider + `signIn`/`authorized` callbacks). Imported by `middleware.ts`.
- `src/lib/auth.ts` — full `NextAuth()` with `DrizzleAdapter`. Node-only. Imported by server components and API routes.

`middleware.ts`'s matcher excludes `/api/auth`, `/signin`, and `/api/cron/*`; the `authorized` callback in `auth.config.ts` then layers the `MANAGER_EMAILS` allowlist on `/dashboard` and `/api/dashboard`. Cron routes must verify `CRON_SECRET` themselves because middleware lets them through. New manager-only route segments must be added to that callback.

### Two Syncore data sources
Syncore exposes some data only via the v2 REST API and other data only via the authenticated web UI. The codebase has both clients; prefer REST when possible:

- `src/lib/syncore/client.ts` + `orders.ts` — v2 REST at `api.syncore.app` (`x-api-key` header). Jobs, sales orders, line items, write-backs.
- `src/lib/syncore/webui.ts` + `followups.ts` — username/password login against `ateasesystems.net`, cached cookie session (20-minute TTL), used only for Job Follow-Ups which isn't in v2.

The follow-ups parser is intentionally permissive (passthrough Zod schemas + multi-name fallbacks) and the full payload is preserved in `raw` / `raw_statistics` jsonb columns so parsing can be refined later without re-running the cron.

### Vendor registry pattern
`src/lib/vendors/registry.ts` exposes a single `lookupInventory(line, opts)` and dispatches to vendor adapters based on the Syncore supplier name (`sanmar` / `ss` / `cb`). To add a vendor: drop a `fetchXxxInventory` adapter under `src/lib/vendors/<code>/`, add a match clause in `resolveVendor`, and surface a `VendorCode` in `types.ts`. SanMar and Cutter & Buck use SOAP/PromoStandards (shared helpers in `src/lib/vendors/promostandards/`); S&S uses their REST API.

### Verification audit trail + Clear opt-out
Every rep "Verify" click writes a row to the `verifications` table (`src/lib/db/schema.ts`) including a `vendor_snapshot` jsonb of what was visible at that moment. The `job_verification_clears` table is a separate one-row-per-job opt-out: when a rep clicks "Clear all verifications", a row is upserted there to **disable auto-verification** for that job — without it, the page would silently re-verify clean rows on next render. Any new auto-verify logic must check this table.

### Scheduled jobs
Configured in `vercel.json`:

| Path | Cron (UTC) | Purpose |
|---|---|---|
| `/api/cron/snapshot-followups` | `0 * * * 1-5` | Hourly weekday snapshot of Syncore Job Follow-Ups → `followup_snapshots` + `followup_rows`. |
| `/api/cron/digest-followups`   | `15 14 * * 1-5` | 7:15 AM Pacific digest email via Resend. |

Both routes verify `CRON_SECRET` (Vercel sends it as `Authorization: Bearer …`; manual runs use `x-cron-secret`).

### Brand tokens
Tailwind theme is driven by `src/styles/brand-tokens.ts` (see also `tailwind.config.ts`). Use the `cg-*` color classes; the full guide is `docs/brand/CG Brand Guidelines.html`.

## Conventions

- Path alias: `@/*` → `src/*`.
- Server components by default; co-locate per-route helpers in `_lib/` and per-route components in `_components/` subdirs (see `app/(app)/dashboard/`).
- Provisional Syncore decisions (header name, write-back endpoint shape, follow-ups JSON keys) are documented in the README's "Known provisional decisions" — each is isolated to one file so it can be flipped without ripple.
- Don't introduce a test framework or fixture data without checking with the user; the project ships with manual verification only.

## Working with the user

- **When investigating Syncore (or any external system) endpoints, ask the user for a HAR file first**, not for step-by-step DevTools instructions. A HAR captures the entire network session — every request, response body, set-cookies, redirect chain — in one file, and `jq` can slice it however you need. Asking for one curl at a time, or directing the user to filter Network panel rows manually, is much slower and easier to misdirect. To capture: Chrome DevTools → Network tab → check "Preserve log" → perform the flow → right-click any row → Save all as HAR with content. Then the user uploads the file and you parse it locally.

## Environment

See `.env.example` for the annotated complete list. Required for any local run: `AUTH_SECRET`, `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `ALLOWED_EMAIL_DOMAIN`, `DATABASE_URL`. Vendor and Syncore vars are required only for the features that touch them.
