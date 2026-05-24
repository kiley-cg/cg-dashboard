# Syncore `us.` writeback path

How to post data back to Syncore's classic-ASP UI at
`us.ateasesystems.net`. Discovered across PRs #65–#81 and used in
production by Phase 4.2 (receiving memo) — the same technique unlocks
any us. form, not just memos.

## TL;DR

1. **Fresh `/Account/Login` on `www.`** → new `.ASPXAUTH` cookie.
   Don't reuse the module-cached webui session; we need a guaranteed-
   fresh ticket because Syncore's Token is bound to the active session.
2. **GET `www./api/purchaseorders/memostatuses?ids={poId}`** → JSON
   response with a `resourceUrl` field pointing at a one-time
   `us./LoginFromV2.asp?...&Token=XYZ&RequestURL=...` URL.
3. **Follow the LoginFromV2 chain with browser-parity headers**
   (especially `Sec-Fetch-Site: none` — not "cross-site") into a
   **separate `us.` cookie jar**. A successful chain drops `UserID` and
   `Token` cookies on us.
4. **Extract the target URL from the `RequestURL` param**, translating
   Syncore's `!` query-separator back to `&`. Don't follow the chain
   through to its terminus — it lands on the index.asp frameset
   (round 8/10 wall). Just use the chain to mint cookies.
5. **GET the memo URL directly** with the us. jar → 200 with the form
   HTML.
6. **POST the form's `action` URL** (e.g. `receivingMemo.asp`) with
   the same `Cookie` jar, body = all hidden fields preserved + your
   edits, `Content-Type: application/x-www-form-urlencoded`.

## Why the dance is necessary

`us.ateasesystems.net` is the classic-ASP side. It only accepts
sessions established via `LoginFromV2.asp`, which only `www.` can mint.
Two cookie jars, two domains, two completely different auth schemes.

## The Token is one-shot and session-bound

Behavior confirmed end-to-end:

- Same `.ASPXAUTH` cookie ⇒ same `Token` returned by memostatuses
  forever, until Syncore rotates on its own cadence (~minutes, exact
  trigger unknown — probably time-based + consumption).
- Once consumed by a successful LoginFromV2 chain, the Token is dead.
  Subsequent memostatuses calls keep returning the dead Token until
  Syncore rotates.
- Fresh `/Account/Login` gives a fresh `.ASPXAUTH`, but **does not
  immediately force Token rotation** on Syncore's side — there's a
  window where the same dead Token keeps coming back.

Strategy: `withFreshSyncoreSession` retries up to 3 attempts with
0/3/8s backoffs. Each attempt is a full fresh-login + memostatuses +
chase. Empirically attempt 2 catches the rotation when attempt 1 sees
a dead Token.

If all 3 fail, the production action surfaces a clear "try again in a
minute" error and lets the user retry.

## Browser-parity headers

The LoginFromV2 chain bounces to the index.asp frameset unless the
request fingerprints as a real Chrome navigation. The minimal working
set (PR #71 round 9 variant C):

```ts
export const BROWSER_NAV_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...",
  Accept: "text/html,application/xhtml+xml,...",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",      // critical — NOT "cross-site"
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Not_A Brand";v="8", ...',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};
```

Stripping any of these may reintroduce the bounce.

## Form structure (receiving memo as example)

- Form opening: `<form action="receivingMemo.asp" method="post" name="rmAdd">`
- Submit: plain `<input type="submit" value=" Submit ">` — no name, no
  onclick. The form just POSTs.
- ActionCMD lives in a hidden input (`<input type="hidden"
  name="ActionCMD" value="Edit">`). The same value `Edit` is used for
  both GET (load form) and POST (save form). To trigger a different
  operation (e.g. Add), JS overrides the action URL with `?ActionCMD=Add`.
- Per-line-item fields are suffixed with the item id:
  `POItemID`, `rowNo_{POItemID}`, `IsNew_{POItemID}`,
  `qtyReceived_{POItemID}` (the editable one),
  `updPOList` (checkbox, value=POItemID — marks which items to update).
- Memo-level fields: `BranchID`, `purchaseOrderID`, `memoID`, `corp`,
  `OriginalStatusID`, `OperationRunLevel`, plus selects (`StatusID`,
  `receivedByID`, `receivedViaID`, `shippingMethodID`), text inputs
  (`NoBoxes`, `weight`, `OtherReceivedVia`, `trackingNo`), and a
  `comments` textarea.

To save: POST the form body back exactly as received, swapping in the
new qty values. Syncore replays the same page (or redirects) with the
updates persisted.

## Code

- `src/lib/syncore/us-session.ts` — `withFreshSyncoreSession`,
  `chaseLoginFromV2`, `memoUrlFromResource`, `fetchMemoFormHtml`,
  `BROWSER_NAV_HEADERS`. The composable building blocks.
- `src/lib/syncore/webui.ts` — `freshWwwLogin()` (bypasses module
  cache for guaranteed-fresh ticket).
- `app/api/cron/probe-memo-write/route.ts` — read-only verification
  probe. Use this when adding a new us. writeback path; it'll confirm
  cookies + memo URL + form blueprint before you start writing the
  POST body.

## What this unlocks

`withFreshSyncoreSession` works for any us.ateasesystems.net form, not
just receiving memos. Likely uses:

- Updating PO line items (add/remove rows, change quantities)
- Posting POs manually (Status → "Posted Manually")
- Editing job-level data not exposed by v2 REST
- Any classic-ASP form you can find by URL spelunking

Bootstrap-PO trick: `withFreshSyncoreSession(bootstrapPoId, ...)` uses
memostatuses for that PO to get a session. If your target isn't memo-
related, pass any open PO you have access to — the session is bound
to the user, not the PO. The chase callback gets the authed us. jar
and can fetch any us. URL from there.

## Gotchas

- **Don't share cookie jars** across `www.` and `us.` — they have
  different `UserID`/`Token` cookie schemes (us. is case-sensitive).
  Always use a fresh Map per host.
- **Don't reuse the module-cached `webui` session** for `us.` work —
  it caches a 20-min window, but fresh us. sessions need fresh
  Tokens. Use `freshWwwLogin()` instead of `getSession()`.
- **Don't follow the LoginFromV2 chain to terminus**. Use it only to
  acquire cookies (round 10 lesson). Direct GET the memo URL.
- **HAR uploads beat DevTools** for endpoint discovery (documented in
  CLAUDE.md). Anytime you're feeling around for a new endpoint, ask
  the user for a HAR from the browser flow first.
