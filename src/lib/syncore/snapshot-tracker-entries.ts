// Pull tracker entries for one job from Syncore, attribute recipients
// to each entryType=3 note based on the immediately-following auto-row,
// and upsert into tracker_entries_cache.
//
// Recipient attribution model:
//   The HAR shows Syncore writes an entryType=3 row first (the human
//   note), then immediately follows it with entryType=2 system row:
//     "A Job Tracking Update email was sent to the following recipients:
//      Kiley Gustafson"
//   Entries come back newest-first, so in walking order the auto-row
//   appears BEFORE the note it's about. We carry forward the pending
//   recipient list and attach it to the next note we hit.

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { ROUTABLE_PEOPLE, type Person } from "@/lib/people/registry";
import {
  extractRecipientNames,
  fetchJobTrackerEntries,
  parseSyncoreDate,
  type SyncoreTrackerEntry,
} from "./tracker-entries";

function matchPersonByName(name: string): Person | null {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  // Exact display-name match first; then first-name fallback.
  const exact = ROUTABLE_PEOPLE.find(
    (p) => p.displayName.toLowerCase() === target,
  );
  if (exact) return exact;
  const firstName = target.split(/\s+/)[0];
  return ROUTABLE_PEOPLE.find((p) => p.key === firstName) ?? null;
}

export interface SnapshotResult {
  jobId: string;
  fetched: number;
  inserted: number;
  updated: number;
  errors?: string;
}

export async function snapshotJobTrackerEntries(opts: {
  jobId: string;
  length?: number;
}): Promise<SnapshotResult> {
  const { jobId } = opts;
  let entries: SyncoreTrackerEntry[] = [];
  try {
    entries = await fetchJobTrackerEntries({ jobId, length: opts.length ?? 50 });
  } catch (err) {
    return {
      jobId,
      fetched: 0,
      inserted: 0,
      updated: 0,
      errors: err instanceof Error ? err.message : String(err),
    };
  }

  if (entries.length === 0) {
    return { jobId, fetched: 0, inserted: 0, updated: 0 };
  }

  // Newest-first → walk and carry forward pending recipient list. When
  // we hit a note (entryType=3), assign whatever recipient list we've
  // accumulated since the last note.
  let pendingRecipientIds: number[] = [];
  const enriched: Array<{
    entry: SyncoreTrackerEntry;
    recipientIds: number[];
    createdAt: Date | null;
  }> = [];

  for (const e of entries) {
    if (e.entryType === 2) {
      // Pull any names mentioned; map to user IDs we know.
      const names = extractRecipientNames(e.description);
      for (const n of names) {
        const p = matchPersonByName(n);
        if (p?.syncoreUserId && !pendingRecipientIds.includes(p.syncoreUserId)) {
          pendingRecipientIds.push(p.syncoreUserId);
        }
      }
      enriched.push({
        entry: e,
        recipientIds: [],
        createdAt: parseSyncoreDate(e.createdDate),
      });
      continue;
    }
    // Note row — attach the recipient list we've gathered since the
    // last note, then reset the buffer.
    enriched.push({
      entry: e,
      recipientIds: pendingRecipientIds,
      createdAt: parseSyncoreDate(e.createdDate),
    });
    pendingRecipientIds = [];
  }

  // Upsert in bulk. We don't ON CONFLICT DO UPDATE the recipient list
  // since recipients are immutable post-send (Syncore wouldn't change
  // them after the fact). DO NOTHING is safe and idempotent.
  const rows = enriched.map((x) => ({
    syncoreEntryId: String(x.entry.id),
    jobId,
    createdAt: x.createdAt ?? new Date(),
    createdByUserId: x.entry.createdById,
    createdByName: x.entry.createdBy,
    description: x.entry.description,
    entryType: x.entry.entryType,
    colorId: x.entry.colorId,
    recipientUserIds: x.recipientIds as unknown as object, // jsonb
  }));

  if (rows.length === 0) {
    return { jobId, fetched: entries.length, inserted: 0, updated: 0 };
  }

  // Find which IDs already exist so we can report inserted vs skipped.
  const ids = rows.map((r) => r.syncoreEntryId);
  const existing = await db
    .select({ id: schema.trackerEntriesCache.syncoreEntryId })
    .from(schema.trackerEntriesCache)
    .where(inArray(schema.trackerEntriesCache.syncoreEntryId, ids));
  const existingSet = new Set(existing.map((r) => r.id));

  const toInsert = rows.filter((r) => !existingSet.has(r.syncoreEntryId));
  if (toInsert.length > 0) {
    await db
      .insert(schema.trackerEntriesCache)
      .values(toInsert)
      .onConflictDoNothing();
  }

  return {
    jobId,
    fetched: entries.length,
    inserted: toInsert.length,
    updated: rows.length - toInsert.length,
  };
}

/**
 * Snapshot tracker entries across many jobs. Used by the cron + the
 * Refresh button. Concurrency-limited fan-out (same pattern as the
 * vendor-tracking cron).
 */
export async function snapshotJobsConcurrently(opts: {
  jobIds: string[];
  concurrency?: number;
}): Promise<SnapshotResult[]> {
  const concurrency = opts.concurrency ?? 8;
  const results: SnapshotResult[] = new Array(opts.jobIds.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= opts.jobIds.length) return;
      results[i] = await snapshotJobTrackerEntries({ jobId: opts.jobIds[i] });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// Get jobs eligible for snapshotting — every distinct syncoreJobId in
// the production PO mirror (which is the universe of open work). Limit
// is a safety cap; production should rarely exceed it.
export async function listSnapshotJobIds(opts?: {
  limit?: number;
}): Promise<string[]> {
  const limit = opts?.limit ?? 1000;
  const rows = await db
    .select({ jobId: schema.productionPoMirror.syncoreJobId })
    .from(schema.productionPoMirror)
    .groupBy(schema.productionPoMirror.syncoreJobId)
    .limit(limit);
  return rows.map((r) => r.jobId).filter(Boolean);
}
