# Drive proofs sync — one-time setup

Phase D2 reads Christina's proof PDFs from Google Drive and writes them into the dashboard's `job_verification_record` table. This is the GCP-side setup Kiley needs to do once before the cron does anything useful.

## 1. Create a Google Cloud project (or reuse one)

1. https://console.cloud.google.com → top dropdown → New Project
2. Name it something like `cg-dashboard`. Note the project ID.

## 2. Enable the Drive API

1. APIs & Services → Library
2. Search "Google Drive API" → Enable

## 3. Create a service account

1. IAM & Admin → Service Accounts → Create Service Account
2. Name: `dashboard-proofs-bot` (or similar). Skip the optional grant steps.
3. After creation, click into the account → **Keys** tab → Add Key → Create new key → JSON. Download the file.
4. The downloaded JSON has a `client_email` (looks like `dashboard-proofs-bot@<project>.iam.gserviceaccount.com`) and a `private_key` (`-----BEGIN PRIVATE KEY-----\n…`). You'll paste those into Vercel env vars in step 5.

## 4. Share the proofs folder with the service account

1. In Drive, open Christina's proofs folder (the root).
2. Share → paste the service account email from step 3 → set permission to **Viewer** → Share.
3. Copy the folder ID from the URL: `https://drive.google.com/drive/folders/<FOLDER_ID>` → that long string is the ID.

## 5. Add three env vars in Vercel

Project → Settings → Environment Variables:

| Key | Value |
|---|---|
| `GOOGLE_SA_EMAIL` | The `client_email` from the JSON |
| `GOOGLE_SA_PRIVATE_KEY` | The entire `private_key` value, including `BEGIN`/`END` lines and the `\n` escapes |
| `DRIVE_PROOFS_FOLDER_ID` | The folder ID from step 4 |

> ⚠ Vercel preserves `\n` as literal backslash-n in the env var. The Drive client converts those to real newlines at runtime — leave the escapes as-is when you paste.

## 6. Test the cron manually

After the env vars are saved + Vercel has redeployed:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://inventory-check-neon.vercel.app/api/cron/sync-proofs?modifiedAfter=1970-01-01" | jq
```

`modifiedAfter=1970-01-01` triggers a full backfill (instead of the default "last 30 days"). Expected response:

```json
{
  "ok": true,
  "summary": {
    "proofCount": 142,
    "inserted": 142,
    "updated": 0,
    "skipped": 7,
    "modifiedAfter": "1970-01-01T00:00:00.000Z",
    "durationMs": 18234
  }
}
```

`skipped` rows are PDFs whose filename didn't contain a job# matchable by `/\b\d{4,6}\b/`. Pull the raw list with `?modifiedAfter=...&full=1` once D2.A's verify endpoint lands — or check the `cron_runs` row's summary.

## 7. Verify writes

In Neon SQL editor:

```sql
SELECT syncore_job_id, raw->>'filename' AS filename, raw->>'webViewLink' AS link, captured_at
FROM job_verification_record
WHERE source = 'proof'
ORDER BY captured_at DESC
LIMIT 20;
```

If you see rows, the sync is working. Open the `/jobs/<id>` page for one of them — the manual Verification Record form will still be empty (proof rows show as separate history; D2.B layers in auto-fill).

## 8. Schedule

Once you've verified, the cron is already in `vercel.json`:

```
{ "path": "/api/cron/sync-proofs", "schedule": "15 14-23 * * 1-5" }
```

= hourly during business hours (7am–4pm Pacific, Mon–Fri). Tune in `vercel.json` if you want more frequent or off-hours sweeps.

## What's NOT in D2.A

- **PDF text extraction** — D2.B will parse imprint location / qty / approved-by out of the PDF body. Until then, proof rows only carry filename + Drive link.
- **Production Worksheet matrix view** — D2.C. Aggregates the proof rows into the matrix layout Kristen wants.
- **Image-only proofs (PNG / JPEG)** — out of scope. If Christina occasionally uploads images instead of PDFs, they'll be silently skipped. Tell us if that's a real case.
