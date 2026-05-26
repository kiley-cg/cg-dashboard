// Google Drive client — service-account auth. Used by the proofs-sync
// cron to list / fetch files in Christina's proofs folder.
//
// REQUIRED ENV VARS (set in Vercel project → Settings → Environment Variables):
//   GOOGLE_SA_EMAIL          — service account email, e.g.
//                              dashboard-bot@cg-dashboard.iam.gserviceaccount.com
//   GOOGLE_SA_PRIVATE_KEY    — the entire `private_key` field from the
//                              service account JSON key file. Preserve
//                              the \n escapes — code below converts them.
//   DRIVE_PROOFS_FOLDER_ID   — Drive folder ID of the proofs root (the
//                              long string at the end of the folder's URL)
//
// SETUP (one-time, see docs/drive-proofs-setup.md):
//   1. console.cloud.google.com → new (or existing) project
//   2. Enable Google Drive API
//   3. IAM & Admin → Service Accounts → Create
//   4. Keys → Add Key → Create new (JSON). Download.
//   5. Share Christina's proofs folder with the service account email
//      (Viewer access is enough; we only READ).
//   6. Paste the env vars into Vercel.

import { google, type drive_v3 } from "googleapis";

let cachedDrive: drive_v3.Drive | null = null;

export function getDriveClient(): drive_v3.Drive {
  if (cachedDrive) return cachedDrive;
  const email = process.env.GOOGLE_SA_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      "Drive client: set GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY env vars.",
    );
  }
  // Vercel env vars are stored as raw text — newlines in the private
  // key get serialized as literal \n. Unescape them so the JWT signer
  // gets a real PEM.
  const privateKey = rawKey.includes("\\n")
    ? rawKey.replace(/\\n/g, "\n")
    : rawKey;
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  cachedDrive = google.drive({ version: "v3", auth });
  return cachedDrive;
}

export function getProofsFolderId(): string {
  const id = process.env.DRIVE_PROOFS_FOLDER_ID?.trim();
  if (!id) {
    throw new Error(
      "Drive client: set DRIVE_PROOFS_FOLDER_ID env (the long ID at the end of the Drive folder URL).",
    );
  }
  return id;
}
