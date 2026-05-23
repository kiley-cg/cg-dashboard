# Syncore Classic ASP auth — discovery notes

What we know about getting authenticated against Syncore's classic-ASP web
UI (`us.ateasesystems.net`) from a backend, based on a series of probe
PRs (#61–#72+). Captured here so future work on writeback against any
classic-ASP Syncore screen (receiving memo, classic invoicing, anything
under `us.`) doesn't have to re-derive it.

## The three Syncore surfaces

| Surface | URL | Auth |
|---|---|---|
| v2 REST API | `https://api.syncore.app/v2` | `x-api-key` header. No session. Easy. |
| www. ASP.NET MVC | `https://www.ateasesystems.net` | Form login at `/Account/Login` (no MFA for service account) → `.ASPXAUTH` + 3 sibling cookies. |
| us. classic ASP | `https://us.ateasesystems.net` | **Not directly logged in.** Auth happens via a one-shot Token minted by the www. API and exchanged at `us./LoginFromV2.asp`. |

The us. surface is where features that don't exist in v2 live —
receiving memo, classic invoicing flows, some Job Follow-Ups detail
screens. It's a separate IIS virtual application from www. (different
cookie scope: `ASPSESSIONID*` per app pool on us., vs `.ASPXAUTH` on
www.).

## www. login

Same flow as our existing `webuiFetch` helper in
`src/lib/syncore/webui.ts`:

```
GET  /Account/Login    → 200, parse __RequestVerificationToken from HTML
POST /Account/Login    → 302 (Location: /). Set-Cookie:
                         .ASPXAUTH, AtEase, .AspNet.ExternalCookie,
                         .AspNet.ApplicationCookie
```

That cookie set is sufficient for the www. REST API (everything under
`/api/*`).

**Note**: MFA is enforced on real user accounts via
`/Account/Challenge` → `POST /Account/Challenged` with 6-digit
`MfaDigit1..6` fields. We bypass it by using a service account
specifically configured without MFA (`SYNCORE_USERNAME` /
`SYNCORE_PASSWORD`). If MFA were ever required, we'd need to plug in
TOTP automation (the seed lives in the MFA setup QR code).

## The bridge: `memostatuses`

`www.` exposes a hidden bulk PO → memo-status endpoint:

```
GET /api/purchaseorders/memostatuses?ids=68609&ids=68610&...
```

Returns:

```json
{
  "receivingMemoStatuses": [
    {
      "purchaseOrderId": 68609,
      "statusId": 1,
      "statusName": "Open",
      "displayName": "View",
      "resourceUrl": "https://us.ateasesystems.net/LoginFromV2.asp?UserId=18553&CountryId=2&BranchId=97&Token=<128 hex chars>&Menu=jobs&RequestURL=%2fporder%2freceivingMemo.asp%3fActionCMD%3dEdit!Corp%3d0!BranchID%3d97!PurchaseOrderID%3d68609!MemoId%3d991153"
    }
  ]
}
```

`statusId` values: `0` = no memo (Create New), `1` = Open, `2` = Received.
`resourceUrl` is the magic — it's a pre-baked LoginFromV2 URL with a
freshly-minted server-issued Token.

### The `!` separator quirk

Note the inner `RequestURL` uses `!` as the query separator instead of
`&`:

```
RequestURL=/porder/receivingMemo.asp?ActionCMD=Edit!Corp=0!BranchID=97!...
```

This is a classic ASP hack: `Request.QueryString` is naive about nested
`&` characters in URL-encoded values, so Syncore swaps them for `!`
and the LoginFromV2 handler swaps them back server-side before issuing
the final redirect.

## us. auth: the LoginFromV2 handshake

Pasting that `resourceUrl` into a browser (incognito, no prior cookies)
lands directly on the receiving memo. From our backend, replicating the
same request requires **two non-obvious things**:

### 1. Full browser-parity request headers (round 9)

A plain backend GET of the `resourceUrl` gets bounced — LoginFromV2
appends `Redirected=1` to its own URL and self-redirects, then sends
you to `index.asp` → `/Login.asp` → www. (i.e., back where you started,
unauthenticated). The server is fingerprinting requests and refusing to
mint `UserID`/`Token` cookies for non-browser callers.

Sending **only** a browser `User-Agent` is not enough. The full set
that unlocks it:

```ts
{
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
}
```

We haven't bisected which specific header is the gate; the leading
suspect is `Sec-Fetch-Site: none` (signals "user typed/pasted URL into
address bar," which is exactly what we're emulating). The cleanest
production move is to send the whole bundle on every us. request.

### 2. The redirect chain (5 hops)

With the right headers, LoginFromV2 does this dance:

```
0. GET us./LoginFromV2.asp?UserId&Token&...
   → 302 (Set-Cookie: ASPSESSIONIDxxxxxxx)
   → us./LoginFromV2.asp?...&Redirected=1

1. GET us./LoginFromV2.asp?...&Redirected=1
   → 302
   → us./index.asp?ref=1&item=jobs&pg=<URL-encoded RequestURL>

2. GET us./index.asp?ref=1&item=jobs&pg=...
   → 302
   → us./index.asp?...&Redirected=1

3. GET us./index.asp?...&Redirected=1
   → 302 (Set-Cookie: UserID, Token)  ← AUTH GRANTED
   → us./index.asp

4. GET us./index.asp
   → 200 (Order Entry Application frameset)
```

The `Redirected=1` query-string flag is classic ASP's "verify the
cookie stuck" pattern — the server sets a cookie on a 302, then checks
that the redirected-back request carries the cookie. If yes, it
proceeds with auth; if no, it bounces to a safe fallback. (Loop-breaker
to avoid infinite redirects when cookies are disabled.)

After the dance, the us. cookie jar has:

- `ASPSESSIONIDxxxxxxxx` — IIS session ID (per app pool; suffix is
  random per virtual app)
- `UserID` — the Syncore user ID (e.g., `18553` for the service
  account, `4915` for the human accounts; case-sensitive, classic ASP)
- `Token` — the auth Token (128 hex chars; case-sensitive)

### 3. Land on the actual page

Note the chain lands on the **frameset index page**, not the
receivingMemo page. The auth dance dropped the `pg=` target. With the
cookies now in hand, hit the real URL directly:

```
GET us./porder/receivingMemo.asp?ActionCMD=Edit&Corp=0&BranchID=97
                                 &PurchaseOrderID={poId}&MemoId={memoId}
   (with UserID + Token cookies from above + the browser headers)
```

Should return 200 with the actual memo form HTML.

### Cookie-jar separation

`us.` and `www.` cookies are scoped to their respective hostnames —
keep them in separate jars and only send each host its own cookies.
Mixing them won't break anything (browsers do the same), but cleaner
to maintain.

## The unsolved problem: Token is one-shot

**Each Token can only be used in ONE successful LoginFromV2 call.**
After a successful exchange, the Token is dead. Subsequent calls to
`memostatuses` (within some window) return the **same** dead Token,
not a fresh one. This means we can't reliably mint a fresh Token on
demand.

Observed:
- Round 9 variant C: token `B392918C...0E9` → success
- Round 10 (~4 min later): `memostatuses` returned the same
  `B392918C...0E9` → LoginFromV2 bounced

Round 11 (probe-token-rotation) tests several cache-bust strategies to
see if we can force `memostatuses` to mint a fresh Token. Outcomes
still TBD.

If cache-bust doesn't work, fallback options:

1. **Deliberately burn the stale Token** — fire one LoginFromV2 call
   that we expect to consume, then re-call `memostatuses` for a fresh
   one. Hacky.
2. **Long-lived per-request session** — keep the us. cookies alive in
   a single Vercel function invocation and reuse across multiple PO
   writebacks. Doesn't help across invocations though.
3. **Find a different mint endpoint** — maybe `memostatuses` isn't the
   only source. Could be a `/api/.../authtoken` endpoint we haven't
   found.

## Classic ASP context

The us. app is **classic ASP** (VBScript backend, IIS 5/6 era, ~2002).
Recognizable by:

- `.asp` extension
- `ActionCMD=Edit/Display/Add` URL dispatch pattern (case-sensitive)
- `ASPSESSIONIDxxxxxxxx` cookies (per virtual application)
- Forms POST to the same `.asp` file that rendered them (with hidden
  inputs for state preservation, no client-side state)
- Cookie names case-sensitive (`UserID`, `Token` — exact case)
- Framesets / iframes
- `Request.QueryString` parser is naive about nested URL-encoded `&`
  (hence the `!` separator hack)

The www. app, by contrast, is modern ASP.NET MVC with `.AspNet.*`
cookie prefixes and a JSON REST API layer.

## Reference probe PRs

- #61, #62, #63, #64 — us. login flow exploration (`probe-us-webui-{1..4}`)
- #65 — discovered `/api/purchaseorders/{poId}/receiving-memo` returns
  405 (later determined to be middleware noise, not signal)
- #66 — calibration of 405 noise vs signal via OPTIONS + bogus paths
- #67 — first memo roundtrip attempt
- #68 — debug headers/payload variants on memostatuses 500
- #69 — login redirect-follow test (turned out not needed)
- #70 — end-to-end probe (discovered the LoginFromV2 bounce)
- #71 — UA bundle test (discovered browser-parity headers unlock LoginFromV2)
- #72 — direct memo fetch with acquired UserID/Token (discovered one-shot Token)
- (next) — token rotation strategies

## How to extend

To build writeback for any other classic-ASP Syncore screen:

1. Identify the screen's URL pattern (likely `us./<area>/<page>.asp?ActionCMD=Edit&...`)
2. Find the API endpoint on www. that returns a `resourceUrl` for it
   (start by searching the v1 frontend in browser DevTools for an
   `/api/<area>/...` call that returns a LoginFromV2 URL)
3. Reuse the auth flow described above:
   - www. login (existing `webuiFetch`)
   - Call the `resourceUrl`-returning endpoint
   - Follow LoginFromV2 with browser-parity headers
   - Directly hit the target `us.` URL with the resulting UserID/Token
4. Parse the form HTML to discover POST target and field names
5. POST the writeback to the form action with all hidden fields
   round-tripped unchanged + your modifications
