# Inventory Check

Internal Color Graphics web app. Customer service reps enter a Syncore sales
order number; the tool pulls line items from Syncore, queries live vendor
inventory (SanMar via PromoStandards Inventory 2.0.0 SOAP in v1), and lets the
rep mark the line as verified — which writes back to Syncore.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS (theme driven by `src/styles/brand-tokens.ts`)
- Auth.js v5 with Google provider (domain-restricted)
- Drizzle ORM + Neon Postgres
- `soap` (vpulim/node-soap) for SanMar
- Deployed on Vercel

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
| Full brand guide | `docs/brand/brand-guidelines.html` (upload here) |
| Auth config | `src/lib/auth.ts`, `middleware.ts` |
| DB schema | `src/lib/db/schema.ts` |
| Syncore client | `src/lib/syncore/client.ts`, `orders.ts` |
| SanMar SOAP | `src/lib/vendors/sanmar/client.ts`, `map.ts` |
| Vendor registry | `src/lib/vendors/registry.ts` |
| Rep UI | `app/(app)/page.tsx`, `app/(app)/orders/[id]/page.tsx` |
| API | `app/api/orders/[id]/route.ts`, `.../verify/route.ts` |

## Environment variables

See `.env.example`. Every variable must be set both locally and on Vercel.

## Known provisional decisions

These were chosen on best available info and should be confirmed on first
real-world call; each is isolated to one file for easy adjustment:

- `X-API-Key` header name for Syncore (`src/lib/syncore/client.ts`) — swap to
  `Authorization: Bearer …` if 401.
- Write-back endpoint path `/orders/{id}/lines/{lineId}` with a `status`
  field (`src/lib/syncore/orders.ts`) — adjust to whatever Syncore actually
  exposes for marking a line/order verified (may end up being a custom field
  or order note).
- Placeholder CG logo SVG (`public/brand/logo.svg` and `src/components/Logo.tsx`)
  — replace with the real asset once `docs/brand/brand-guidelines.html` is
  uploaded and the tokens are extracted.

## Verification checklist (end-to-end)

1. `pnpm typecheck && pnpm lint` pass.
2. Sign in with a `@${ALLOWED_EMAIL_DOMAIN}` account → land on `/`.
3. Sign in with a non-allowed domain → rejected on the Google callback.
4. Enter a known open order number → page shows line items with live stock.
5. Click **Verify** → a row lands in the `verifications` table and the order
   reflects the status in Syncore.
6. Point `SANMAR_WSDL_URL` at an unreachable host → page still loads, affected
   lines show "vendor error", Verify disabled on those lines.
