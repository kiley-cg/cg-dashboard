# Vendor tracking pipeline — patterns + state

Living document. Update when a new vendor is wired, an endpoint changes,
or a known gap closes.

## What this pipeline does

Two crons keep production-floor tracking automatic:

1. **`/api/cron/poll-vendor-tracking`** — for each open apparel PO in
   the mirror, asks the vendor "do you have shipments for PO `{jobId}-{poNumber}`?"
   New tracking #s get dedup-inserted into `po_tracking` with
   `source="api"` and auto-pushed to the Syncore Job Log.
2. **`/api/cron/poll-carriers`** — for each `po_tracking` row with
   `carrier='UPS'`, hits UPS Track API to populate `status` / `eta` /
   `lastPolledAt`. Powers the "ready by MM-DD" date and delivery chips
   on `/production`.

Schedules in `vercel.json`:

| Path | Cron (UTC) | Purpose |
|---|---|---|
| `/api/cron/poll-vendor-tracking` | `0 15,21 * * 1-5` | 8am + 2pm Pacific weekdays |
| `/api/cron/poll-carriers` | `30 15,19,23 * * *` | every 4h daily |

## Vendor coverage

| Vendor | Wired | Endpoint | Notes |
|---|---|---|---|
| **SanMar** | ✅ live | `https://ws.sanmar.com:8080/promostandards/OrderShipmentNotificationServiceBinding?WSDL` | PromoStandards OSN 1.0.0 SOAP. Binding has **no version suffix**. Confirmed via SanMar PO Integration Guide v24.1. ~100% UPS in production data. |
| **Cutter & Buck** | ✅ live | `https://api.cbcorporate.com/promostandards/OrderShipmentNotification.asmx?wsdl` | PromoStandards OSN 1.0.0 SOAP. Endpoint name **drops "Service"** — unlike their other endpoints (`InventoryService121`, `ProductData200`). Confirmed via C&B PromoStandards Integration Guide. Returns carrier "CI" for some shipments — actually UPS (tracking# starts with `1Z`), normalize if UPS-poll needs them. |
| **S&S Activewear** | ✅ live | `/v2/orders/?Boxes=true&BoxLines=true&mediaType=json` | REST API. **No per-PO filter** — fetch the full open-orders list (cached 90s per cron sweep, single-flight) and match `order.poNumber` client-side. Tracking lives in `boxes[].trackingNumber`. Confirmed via S&S API Developer Guide. |

## Adapter pattern

Every vendor adapter exports a function with the same signature:

```ts
// src/lib/vendors/<code>/tracking.ts
export async function fetchXxxTracking(
  customerPoNumber: string,  // "{jobId}-{poNumber}" e.g. "32642-2"
  opts?: { wsdlUrl?: string; queryType?: OsnQueryType },
): Promise<OsnShipmentPackage[]>;
```

PromoStandards adapters reuse the shared SOAP client at
`src/lib/vendors/promostandards/orderShipmentNotification.ts` —
SanMar and C&B both run through it. REST adapters (S&S) implement
the same return shape but talk HTTP directly.

The dispatcher in `src/lib/vendors/tracking.ts` routes by supplier
name (same `resolveVendor` pattern as the inventory registry).

## How to wire a new vendor

1. **Get the spec from the vendor.** Email their integrations team
   for their PromoStandards docs (most carry `Standards.pdf` or an
   "Integration Guide PDF") or REST API docs. Don't guess endpoint
   names — they vary subtly (see SanMar/C&B notes below).
2. **Build an adapter** in `src/lib/vendors/<code>/tracking.ts`
   modeled on `cb/tracking.ts` (SOAP) or `ss/tracking.ts` (REST).
3. **Add to dispatcher** — one case in `src/lib/vendors/tracking.ts`.
4. **Add scan candidates** to `app/api/cron/probe-vendor-tracking/route.ts`
   so the probe's `?scan=1` mode can iterate alternate URLs.
5. **Verify with a real PO** — see "Iteration workflow" below.
6. **Document** here: row in coverage table + any vendor quirks.

## Iteration workflow (debugging a new vendor)

The probe route at `app/api/cron/probe-vendor-tracking/route.ts` was
built specifically to short-cut endpoint discovery. The dance:

```bash
SECRET="<your CRON_SECRET>"
BASE="https://inventory-check-neon.vercel.app/api/cron/probe-vendor-tracking"
PO="32642-2"  # a real shipped PO

# 1. Scan candidate endpoints in parallel:
curl -s -H "x-cron-secret: $SECRET" \
  "$BASE?vendor=<code>&poNumber=$PO&scan=1" | jq '.candidates'

# 2. Once one loads, see the raw response shape:
curl -s -H "x-cron-secret: $SECRET" \
  "$BASE?vendor=<code>&poNumber=$PO&raw=1" | jq '.raw'

# 3. Override WSDL/path without redeploying:
curl -s -H "x-cron-secret: $SECRET" \
  "$BASE?vendor=<code>&poNumber=$PO&wsdl=https://...&raw=1" | jq

# 4. After the adapter lands, full sweep:
curl -s -H "x-cron-secret: $SECRET" \
  "https://inventory-check-neon.vercel.app/api/cron/poll-vendor-tracking" \
  | jq '.summary'
```

`?scan=1` semantics:
- `outcome: "ok"` — endpoint loaded AND adapter returned shipments
- `outcome: "wsdl-loaded-call-failed"` — endpoint exists but SOAP/REST
  call faulted (auth issue, wrong request shape, etc.)
- `outcome: "wsdl-404"` — endpoint doesn't exist at this path

## Hard-won lessons (don't relearn these)

- **Each vendor's PromoStandards URL convention is different.** SanMar's
  is `{Service}Binding?WSDL` (no version). C&B's is `{Service}.asmx?wsdl`
  but drops the "Service" suffix on OSN specifically. Read their PDF
  before scanning. ChatGPT/Claude guesses get you within 2 PRs but cost
  iteration time.
- **Always ask the user for the integration PDF first.** Same energy as
  asking for a HAR when debugging an external system — one upload beats
  10 curl iterations.
- **Response shapes nest deep.** SanMar's OSN response is 9 levels
  deep (`OrderShipmentNotificationArray > OrderShipmentNotification[] >
  SalesOrderArray > SalesOrder[] > ShipmentLocationArray >
  ShipmentLocation[] > PackageArray > Package[]`). The parser in
  `orderShipmentNotification.ts` uses a depth-20 deep-walk that
  recognizes Package/Shipment-like keys; don't shallow-key by hand.
- **SOAP libs deserialize `xs:dateTime` as JS Date objects, not strings.**
  `findStr` in the parser handles `Date` instances explicitly. If you
  see `shipDate: null` in parsed output but a valid ISO string in the
  serialized `raw`, that's the cause.
- **Vendor PO filters lie.** S&S's `/orders?poNumber=X` returned a
  completely unrelated PO. Always paste a real PO number and confirm
  the response actually echoes it back.
- **A PO can be Open in Syncore for weeks after the apparel arrives.**
  The dashboard's "waiting on N of M" count cross-references tracking
  delivery status — a Syncore-open PO with all tracking "delivered"
  drops out of the waiting set.

## UPS Track API (Phase 5b)

- Client at `src/lib/ups/tracking.ts`. Reuses `UPS_CLIENT_ID` /
  `UPS_CLIENT_SECRET` (same creds as Rating) + token cache in
  `src/lib/ups/auth.ts`.
- **UPS app must subscribe to the Tracking product** separately from
  Rating. Error code `250002 Invalid Authentication Information`
  almost always means "Tracking product not enabled" — fix at
  developer.ups.com → My Apps → Add product.
- Endpoint: `GET /api/track/v1/details/{trackingNumber}`. Required
  headers: `Authorization: Bearer <token>`, `transId` (any unique
  short string), `transactionSrc`.
- We only re-poll rows where `lastPolledAt > 4h` (or null). Errors
  also stamp `lastPolledAt` so a broken tracking# doesn't get
  hammered every cron run.

## Known gaps / next candidates

- **FedEx + USPS Track** — not currently in pipeline. CG ships almost
  exclusively UPS via apparel vendors; CG decision was to use a
  headless browser for FedEx/USPS when needed.
- **Auto-mark PO received when all tracking delivered** — held back
  pending partial-shipment edge cases.
- **`last_polled_at` watermark on `po_tracking` for the vendor-poll
  cron** — today we brute-force top-500 by `mirroredAt`. A watermark
  column would skip recently-polled POs and let us scale past 500.
- **Carrier code normalization** — C&B returns "CI" for some UPS
  shipments. The UPS Track cron filters on `lower(carrier) = 'ups'`
  so those rows get skipped. Normalize by inspecting the tracking#
  prefix (`1Z…` = UPS) at insert time.
