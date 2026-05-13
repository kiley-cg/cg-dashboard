// Maps Syncore "issue" labels to brand-token color tones. Reuses the same
// dot+pill pattern as src/components/Badge.tsx so issue badges feel native.

import type { IssueKind } from "@/lib/syncore/followups";

export const ISSUE_LABEL: Record<IssueKind, string> = {
  artwork: "Artwork",
  backOrder: "Back Order",
  development: "Development",
  hold: "Hold",
  inProduction: "In Production",
  inTransit: "In Transit",
  needsTracking: "Needs Tracking",
  postDelivery: "Post Delivery",
  problem: "Problem",
  waiting: "Waiting",
  none: "None",
};

// dot color is the most distinctive cue; bg/text desaturated so a row of
// badges stays readable.
const TONE: Record<IssueKind, { dot: string; bg: string; text: string }> = {
  artwork: { dot: "bg-purple-500", bg: "bg-purple-50", text: "text-purple-700" },
  backOrder: { dot: "bg-cg-n-500", bg: "bg-cg-n-100", text: "text-cg-n-700" },
  development: { dot: "bg-cg-black", bg: "bg-cg-n-100", text: "text-cg-n-900" },
  hold: { dot: "bg-amber-400", bg: "bg-amber-50", text: "text-amber-700" },
  inProduction: { dot: "bg-cg-info", bg: "bg-sky-50", text: "text-cg-info" },
  inTransit: { dot: "bg-cg-success", bg: "bg-green-50", text: "text-cg-success" },
  needsTracking: { dot: "bg-cg-teal", bg: "bg-sky-50", text: "text-cg-teal" },
  postDelivery: { dot: "bg-cg-red-300", bg: "bg-cg-red-50", text: "text-cg-red-700" },
  problem: { dot: "bg-cg-danger", bg: "bg-cg-red-50", text: "text-cg-danger" },
  waiting: { dot: "bg-cg-warning", bg: "bg-amber-50", text: "text-cg-warning" },
  none: { dot: "bg-cg-n-300", bg: "bg-cg-n-50", text: "text-cg-n-500" },
};

export function issueKindFromLabel(label: string | null): IssueKind {
  if (!label) return "none";
  const norm = label.toLowerCase().replace(/\s+/g, "");
  for (const [kind, display] of Object.entries(ISSUE_LABEL)) {
    if (display.toLowerCase().replace(/\s+/g, "") === norm) return kind as IssueKind;
  }
  return "none";
}

export function IssueBadge({ kind }: { kind: IssueKind }) {
  const t = TONE[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-chip px-2.5 py-0.5 text-xs font-semibold ${t.bg} ${t.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {ISSUE_LABEL[kind]}
    </span>
  );
}
