// Syncore Job Tracker reader. Pulls a job's tracker entries via the
// DataTables-style /Job/GetTrackerEntriesAsync endpoint Kiley HAR'd —
// returns the recent N entries newest-first.
//
// Used by the snapshot-tracker-entries cron (per active job) and the
// inbox's manual Refresh button (same path, on-demand).

import { webuiFetch } from "./webui";

export interface SyncoreTrackerEntry {
  id: number;
  createdDate: string; // "May/25/2026 3:12 PM"
  createdById: number;
  createdBy: string;
  description: string;
  entryType: number; // 2 = system, 3 = human note
  colorId: number;
}

interface RawResponse {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: SyncoreTrackerEntry[];
}

/**
 * Fetch the newest `length` tracker entries for the given Syncore Job ID.
 * Order is newest-first (server-side, matching the HAR).
 */
export async function fetchJobTrackerEntries(opts: {
  jobId: string | number;
  length?: number;
}): Promise<SyncoreTrackerEntry[]> {
  const jobId = String(opts.jobId);
  const length = opts.length ?? 50;

  // DataTables param shape — match the HAR exactly, otherwise the
  // controller's binder rejects the request.
  const params = new URLSearchParams();
  params.set("draw", "1");
  params.set("start", "0");
  params.set("length", String(length));
  params.set("order[0][column]", "0");
  params.set("order[0][dir]", "desc");
  params.set("search[value]", "");
  params.set("search[regex]", "false");
  params.set("JobId", jobId);
  // Column descriptors — the controller validates these exist even
  // though we don't filter on them.
  const cols: { data: string; name: string }[] = [
    { data: "createdDate", name: "date" },
    { data: "1", name: "createdby" },
    { data: "description", name: "description" },
    { data: "3", name: "actions" },
  ];
  cols.forEach((c, i) => {
    params.set(`columns[${i}][data]`, c.data);
    params.set(`columns[${i}][name]`, c.name);
    params.set(`columns[${i}][searchable]`, "true");
    params.set(`columns[${i}][orderable]`, "false");
    params.set(`columns[${i}][search][value]`, "");
    params.set(`columns[${i}][search][regex]`, "false");
  });

  const result = await webuiFetch<RawResponse>(
    `/Job/GetTrackerEntriesAsync?${params.toString()}`,
    {
      method: "GET",
      referer: `https://www.ateasesystems.net/Job/Details/${jobId}`,
    },
  );
  return result.data ?? [];
}

/**
 * Parse "Month/DD/YYYY H:MM AM/PM" (Pacific) into a Date. Syncore returns
 * createdDate in that exact shape — month names are 3-letter abbreviations.
 */
export function parseSyncoreDate(s: string): Date | null {
  // Best-effort. Examples: "May/25/2026 3:12 PM" → 2026-05-25T15:12 PT.
  const m =
    /^([A-Za-z]+)\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/.exec(
      s.trim(),
    );
  if (!m) return null;
  const [, mon, d, y, h, mi, ampm] = m;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const monIdx = months[mon.slice(0, 3).toLowerCase()];
  if (monIdx == null) return null;
  let hour = Number(h);
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  // Assume Pacific local — convert by treating as UTC with -8 offset
  // (we'll be off by an hour during DST, but it's just a display
  // timestamp). Good enough; can refine later with date-fns-tz.
  return new Date(
    Date.UTC(Number(y), monIdx, Number(d), hour + 8, Number(mi)),
  );
}

/**
 * The system entry that follows a SendTrackerAsync looks like:
 *   "A Job Tracking Update email was sent to the following recipients: Kiley Gustafson, Valerie Ross"
 * Extract the comma-separated names from the tail. Returns [] when the
 * description doesn't match the pattern.
 */
export function extractRecipientNames(description: string): string[] {
  const m = /sent to the following recipients?:\s*(.+)$/i.exec(description);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
