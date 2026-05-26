# CG Dashboard · Phase C · Build Brief

## CSR/Sales-side inbox — "Questions about your jobs"
The receive-side half of the two-way channel. Floor-side composer (`Send Job Tracker`) is live; this is where the recipients see what came in.

Version 0.1 · Draft for review before build · Created 2026-05-26

---

## 0. TL;DR

Add a **`/inbox`** route. For the signed-in user, show every Syncore Job Tracker entry where they were a recipient that hasn't been marked handled yet. Each row: customer · job# · message · when sent · who sent. Two actions per row — **Reply** (opens a composer that posts via `SendTrackerAsync` addressed back to the sender) and **Mark handled** (one-row write to a local state table; doesn't touch Syncore).

This is the CSR's analogue to the floor's `Send Job Tracker` button. Where the floor *fires* questions, the CSR *batch-answers* them.

---

## 1. What's already in place (most of this is cheap)

- **`sendJobTrackerEntry()`** already works (Phase B, HAR-verified). Reply flow reuses it 1:1.
- **People registry** already maps Syncore userIds → roles, with `syncoreUserId` populated for Valerie, Heidi, Kiley, Jennie. Need IDs for Jeremiah, Tricia, Voshte to fully cover inbox-population.
- **RBAC** in place — add one new permission `inbox.view` (or scope to specific people).
- **HelpButton** + `/admin/help` system — `inbox` slug + SOP at launch.
- **Syncore readback endpoint** for tracker entries is known per Kiley's HAR:
  ```
  GET /Job/GetTrackerEntriesAsync?JobId=<jobId>&start=0&length=20…
  ```
  Returns: `id, createdDate, createdById, createdBy, description, entryType (2=system, 3=note), colorId, …`

**What's NOT in place**:
- An endpoint that returns "tracker entries addressed to me across all jobs". Syncore likely has a per-job view only. We'll need to either (a) cron-snapshot per active job and bucket locally, or (b) find a recipient-filtered endpoint via another HAR.

---

## 2. The routing rule (who sees what)

An entry shows up in **User X's inbox** when:

1. The entry is an `entryType=3` note (human-written) on a Job that's still open.
2. The entry's recipient list includes User X's `syncoreUserId`. *(The recipient info isn't on `GetTrackerEntriesAsync` — it's only on the immediately-following system "email was sent to…" auto-row, entryType=2. Easiest: parse the recipient names out of that auto-row and join back.)*
3. There's no `tracker_inbox_state` row for that entry marking it `handled`.

Optional broader scope:
- A **manager** can see everyone's inbox (filter by user dropdown).
- A **CSR** can see their own + their team's queues if we want supervisory visibility (configurable; default off).

---

## 3. The Syncore read path

Three options, ordered cheapest → most-correct:

### (a) Per-job poll for active jobs
Same path as the Follow-Ups snapshot cron. For every open job in the mirror, `GET /Job/GetTrackerEntriesAsync?JobId=…&length=50`, dedup-insert into a local `tracker_entries_cache` table. Run hourly. Fast to ship; can stale up to 1h.

### (b) Find a recipient-filtered endpoint
Syncore probably has a "Job Trackers assigned to me" view in their UI. Kiley grabs a HAR of clicking around that view → we get the endpoint → real-time per-render fetch (no cron, no cache). **Open question** — needs HAR investigation.

### (c) Webhook
Almost certainly not available from Syncore. Skip unless they surprise us.

**Recommendation**: ship (a) for v1. Investigate (b) opportunistically once Kiley pings someone on a real ateasesystems.net trail.

---

## 4. Data model

```sql
-- Local cache of Syncore tracker entries (write path: hourly cron).
-- We DO NOT mutate this from the UI; it's the dashboard's read replica.
tracker_entries_cache (
  syncore_entry_id  bigint PRIMARY KEY,
  job_id            text NOT NULL,         -- "32655"
  created_at        timestamp NOT NULL,
  created_by_user_id integer NOT NULL,    -- Syncore user id
  created_by_name   text NOT NULL,
  description       text NOT NULL,
  entry_type        integer NOT NULL,      -- 2 = system, 3 = note
  color_id          integer NOT NULL,
  -- Derived from joining the following entryType=2 "email sent to X" row.
  recipient_user_ids integer[] DEFAULT '{}',
  fetched_at        timestamp NOT NULL
);
CREATE INDEX … ON tracker_entries_cache (recipient_user_ids);  -- GIN

-- Per-recipient handled state. Composite PK = (entry × user) so the same
-- entry can be handled by multiple people independently if it had
-- multiple recipients.
tracker_inbox_state (
  syncore_entry_id  bigint NOT NULL,
  recipient_user_id integer NOT NULL,
  handled_at        timestamp,
  handled_by_user_id text REFERENCES "user"(id),
  notes             text,
  PRIMARY KEY (syncore_entry_id, recipient_user_id)
);
```

---

## 5. UI spec

### `/inbox`
- **Header**: "Inbox · [User name]" with a count chip ("3 open"). Filter row: **Open** / **Handled** / **All**, plus a manager-only "Show all users" toggle.
- **Each row**:
  - Left: customer · `Job #32655` · created MM-DD HH:MM · "from Kristen"
  - Middle: the message body
  - Right: **[Reply]** button (opens composer) + **[Mark handled]** checkbox
  - On Reply: same composer as `Send Job Tracker`, recipient pre-selected = the sender, body empty.
  - On Mark handled: write `tracker_inbox_state` row, row visually fades + drops out of "Open" filter (stays visible in "All").
- **Empty state**: "🎉 No open messages. (Showing handled or all to see history.)"

### Nav
Add `/inbox` to the side nav, gated by `inbox.view`. Add a count badge on the nav link itself when there are open items (small request — count(*) where recipient = user AND handled_at IS NULL).

---

## 6. New permission

| Key | Description |
|---|---|
| `inbox.view` | See and act on the inbox view |
| `inbox.view_all` | (Optional) See others' inboxes; granted to manager role |

---

## 7. Out of scope for this slice

- **Threaded conversation UI in-dashboard** — replies post back into Syncore's Job Log; reading the thread happens in Syncore (or as separate per-job timeline if we later want it)
- **Real-time push / WebSocket** — hourly cron is fine for v1
- **Cross-org / external notification** — Syncore already emails the recipient when a tracker is sent; the dashboard inbox is an in-app convenience on top of email
- **Editing or deleting incoming entries** — read-only mirror
- **Replying to other entry types** (sales orders, PO-sent system rows, etc.) — only `entryType=3` notes show up

---

## 8. Open questions to resolve during the build

- **Recipient-filtered Syncore endpoint?** If (3.b) exists, the implementation simplifies dramatically (no cache table, no cron). HAR capture: Kiley clicks the relevant "my trackers" view in Syncore.
- **Recipient extraction** from the `entryType=2` "email sent to X" auto-row: is the recipient name always in a predictable position? Need a few sample bodies to lock the regex.
- **Active-job scope** — should the cron pull tracker entries for every open job, or only jobs with at least one entry in the last 30 days? Tradeoff: completeness vs API call count.
- **Audit row on Mark handled** — should the timestamp + user-id we capture be exposed in the UI ("Handled by Jeremiah at 3:42pm")? Useful for visibility.
- **Reply formatting** — should replies prefix `[Reply to Kristen]` or just send the body? Probably just body, consistent with the floor side after the Phase B rename.

---

## 9. Definition of done

1. `/inbox` route exists, gated by `inbox.view`, shows open entries addressed to the signed-in user.
2. Cron `/api/cron/snapshot-tracker-entries` runs hourly, populates `tracker_entries_cache` from Syncore for every job in the production mirror.
3. **Reply** button sends via `SendTrackerAsync`, recipient pre-selected, success collapses inline.
4. **Mark handled** writes `tracker_inbox_state`, row fades, count chip + nav badge update.
5. SOP doc seeded at `/admin/help/inbox`.
6. Missing Syncore user IDs (Jeremiah / Tricia / Voshte) collected via HARs and added to the registry — otherwise their inbox is empty.
7. Open questions documented in README's "Known provisional decisions".

---

## 10. Estimate
~4–6 hours of focused build. Biggest variable: recipient extraction. If the auto-row format is consistent → trivial. If not → may need an even-newer Syncore endpoint or LLM-style extraction.

---

## 11. Change log
| Version | Date | Notes |
|---|---|---|
| 0.1 | 2026-05-26 | First draft. Modeled on Phase B brief structure. Sent to Kiley for sign-off before build. |
