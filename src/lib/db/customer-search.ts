// Job search by customer name OR job number — powers the /verifications
// search box. Customer text comes from followup_rows (which has
// `contact` + `job_description` per job, written by the snapshot cron).
// Job numbers are matched directly against the production mirror so we
// catch jobs that haven't been on a follow-up snapshot yet.

import { desc, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "./client";

export interface JobSearchResult {
  jobId: string;
  customer: string | null;
  // Most recent follow-up snapshot's contact + job_description, when known.
  // Used to render the result label.
  jobDescription: string | null;
}

// Numeric-only queries hit the production mirror directly for the
// fastest path (Kristen typing "32642"). Text queries go through
// followup_rows for customer match.
export async function searchJobs(opts: {
  query: string;
  limit?: number;
}): Promise<JobSearchResult[]> {
  const q = opts.query.trim();
  const limit = Math.min(opts.limit ?? 25, 100);
  if (!q) return [];

  const isAllDigits = /^\d+$/.test(q);
  if (isAllDigits) {
    // Job# match — direct hit on the mirror.
    const rows = await db
      .selectDistinct({
        jobId: schema.productionPoMirror.syncoreJobId,
      })
      .from(schema.productionPoMirror)
      .where(sql`${schema.productionPoMirror.syncoreJobId} LIKE ${`${q}%`}`)
      .limit(limit);
    if (rows.length === 0) return [];
    return await enrichWithCustomerInfo(rows.map((r) => r.jobId));
  }

  // Text — search followup_rows.contact + .job_description.
  const rows = await db.execute<{
    job_id: number | string;
    contact: string | null;
    job_description: string | null;
    snapshot_at: Date;
  }>(sql`
    SELECT DISTINCT ON (job_id)
      job_id, contact, job_description, snapshot_at
    FROM followup_rows
    WHERE contact ILIKE ${`%${q}%`}
       OR job_description ILIKE ${`%${q}%`}
    ORDER BY job_id, snapshot_at DESC
    LIMIT ${limit}
  `);

  const out: JobSearchResult[] = [];
  for (const r of Array.from(
    rows as Iterable<{
      job_id: number | string;
      contact: string | null;
      job_description: string | null;
      snapshot_at: Date;
    }>,
  )) {
    out.push({
      jobId: String(r.job_id),
      customer: r.contact?.trim() || null,
      jobDescription: r.job_description?.trim() || null,
    });
  }
  return out;
}

// Look up customer + description per job from the latest follow-up
// snapshot. Returns one result row per input jobId (null fields when
// the job has never been on a snapshot).
async function enrichWithCustomerInfo(
  jobIds: string[],
): Promise<JobSearchResult[]> {
  if (jobIds.length === 0) return [];
  const numericIds = jobIds.map(Number).filter((n) => Number.isFinite(n));
  if (numericIds.length === 0) {
    return jobIds.map((j) => ({ jobId: j, customer: null, jobDescription: null }));
  }
  const rows = await db.execute<{
    job_id: number | string;
    contact: string | null;
    job_description: string | null;
  }>(sql`
    SELECT DISTINCT ON (job_id)
      job_id, contact, job_description
    FROM followup_rows
    WHERE job_id IN (${sql.join(numericIds.map((n) => sql`${n}`), sql`, `)})
    ORDER BY job_id, snapshot_at DESC
  `);
  const byId = new Map<string, { customer: string | null; jobDescription: string | null }>();
  for (const r of Array.from(rows as Iterable<{ job_id: number | string; contact: string | null; job_description: string | null }>)) {
    byId.set(String(r.job_id), {
      customer: r.contact?.trim() || null,
      jobDescription: r.job_description?.trim() || null,
    });
  }
  return jobIds.map((j) => ({
    jobId: j,
    customer: byId.get(j)?.customer ?? null,
    jobDescription: byId.get(j)?.jobDescription ?? null,
  }));
}
