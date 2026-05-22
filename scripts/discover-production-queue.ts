// Discovery script — find the Syncore @ease v1 Production Queue endpoint.
//
// Production data lives in v1 (behind ateasesystems.net), NOT the v2 REST
// API. The proven access pattern is src/lib/syncore/webui.ts: log in with
// username/password, cache a session cookie, then hit the page's internal
// AJAX endpoints (the way followups.ts does for /api/followups/jobs).
//
// We don't know what the Production Queue page calls. This script probes
// a series of plausible URLs against your logged-in session. Whichever
// returns JSON is the winner — paste its URL, method, and a snippet of
// the payload back into chat and I'll wire `fetchProductionQueue`
// (src/lib/syncore/production.ts) against the real shape.
//
// Usage (locally, with SYNCORE_USERNAME / SYNCORE_PASSWORD in .env.local):
//   pnpm exec tsx scripts/discover-production-queue.ts
//   # or, if you don't have tsx:
//   npx tsx scripts/discover-production-queue.ts
//
// If none of these candidates hit, the fastest fallback is browser
// dev-tools: open the Production Queue page in a logged-in tab, switch
// to Network → XHR, reload, and copy the request the page makes to
// populate the queue. Paste URL/method/payload into chat.

/* eslint-disable no-console */

import { webuiFetch, WebUiError } from "../src/lib/syncore/webui";

// Candidate paths to probe. Ordered roughly by likelihood — Syncore's
// pattern is /api/<area>/<resource> with optional /<sub>. We try the
// plain resource first, then a /list or /jobs sub, then the older
// non-API page paths in case the queue uses a server-rendered fragment.
const CANDIDATES: Array<{ path: string; label: string }> = [
  // Most likely — mirrors /api/followups/jobs:
  { path: "/api/production/queue", label: "production/queue" },
  { path: "/api/production/queue/jobs", label: "production/queue/jobs" },
  { path: "/api/productionqueue", label: "productionqueue" },
  { path: "/api/productionqueue/jobs", label: "productionqueue/jobs" },
  { path: "/api/production/scheduler", label: "production/scheduler" },
  { path: "/api/productionscheduler", label: "productionscheduler" },
  { path: "/api/production/schedule", label: "production/schedule" },
  { path: "/api/scheduler/jobs", label: "scheduler/jobs" },
  // Worksheet variants — the data Kristen edits today:
  { path: "/api/production/worksheet", label: "production/worksheet" },
  { path: "/api/productionworksheet", label: "productionworksheet" },
  // Generic fallbacks:
  { path: "/api/jobs/production", label: "jobs/production" },
  { path: "/api/jobs/queue", label: "jobs/queue" },
];

// Reasonable default params. The Follow-Ups endpoint accepts a flat
// shape; we'll try the same here. If the real endpoint uses bracketed
// data[…] params, swap to `bracketed:` once we know.
function defaultParams() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    offset: 0,
    fetch: 50,
    scheduledDateFrom: today,
    scheduledDateTo: today,
  };
}

interface Hit {
  label: string;
  path: string;
  shape: string;
  sample: unknown;
}

async function probe(): Promise<Hit[]> {
  const hits: Hit[] = [];
  const params = defaultParams();

  for (const { path, label } of CANDIDATES) {
    process.stdout.write(`  ${label.padEnd(36, " ")} `);
    try {
      const data = await webuiFetch<unknown>(path, { searchParams: params });
      const shape = describeShape(data);
      hits.push({ label, path, shape, sample: data });
      console.log(`✓ ${shape}`);
    } catch (err) {
      if (err instanceof WebUiError) {
        const tag =
          err.status === 404
            ? "404"
            : err.status === 401
              ? "401 (auth)"
              : err.status === 403
                ? "403 (forbidden)"
                : err.message.includes("HTML")
                  ? "HTML"
                  : err.status
                    ? String(err.status)
                    : "err";
        console.log(`· ${tag}`);
      } else {
        console.log(
          `· ${err instanceof Error ? err.message.slice(0, 60) : String(err)}`,
        );
      }
    }
  }

  return hits;
}

function describeShape(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (depth > 1) return "[...]";
    return `[${describeShape(value[0], depth + 1)} ×${value.length}]`;
  }
  const t = typeof value;
  if (t !== "object") return t;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).slice(0, 6);
  if (depth > 1) return "{...}";
  return `{${keys.join(",")}${Object.keys(obj).length > 6 ? ",…" : ""}}`;
}

async function main() {
  console.log("Probing Syncore web-UI for the Production Queue endpoint…\n");

  const hits = await probe();

  console.log("\n── Summary ─────────────────────────────────────────────");
  if (hits.length === 0) {
    console.log("No candidate returned JSON.");
    console.log("");
    console.log("Next: open the Production Queue in a logged-in browser tab,");
    console.log("Network → XHR → reload → copy the populating request,");
    console.log("and paste URL + method + payload into chat.");
    process.exit(2);
  }

  for (const hit of hits) {
    console.log("");
    console.log(`✓ ${hit.path}`);
    console.log(`  shape: ${hit.shape}`);
    const sample = JSON.stringify(hit.sample, null, 2);
    const snippet = sample.length > 1500 ? sample.slice(0, 1500) + "\n…" : sample;
    console.log("  sample:");
    console.log(
      snippet
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
    );
  }
  console.log(
    "\nPaste the winning URL + ~50 lines of the sample into chat and I'll wire it.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
