// Routable people for the "Ask about this Job" floor → CSR/Sales
// messaging feature. Confirmed with Kiley 2026-05-25.
//
// Static for v1 — Syncore exposes customerServiceRepName on the job
// record (used to default the recipient) but doesn't yet have a clean
// employee list endpoint we can rely on. Update this file when the
// roster changes; future enhancement could derive from Syncore.

export type PersonRole = "csr" | "sales" | "sales_assistant";

export interface Person {
  // Slug used in URLs / form values. Lowercase first name suffices today.
  key: string;
  // Display name in the recipient dropdown + Job Log attribution.
  displayName: string;
  role: PersonRole;
  // Syncore user ID for /Job/SendTrackerAsync. When present, sends route
  // through Syncore's notify-and-email flow. When absent, falls back to
  // a silent Job Log entry. Sourced from a real Job Tracker payload HAR.
  // To add a missing ID: have the person sign in to ateasesystems.net,
  // open any job's tracker, send a message — the Network panel shows
  // their userId as createdById in the readback.
  syncoreUserId?: number;
  // Optional Syncore-side display name as it appears in the
  // customerServiceRepName column on jobs — used to fuzzy-match the
  // default recipient.
  syncoreCustomerServiceRepName?: string;
}

export const ROUTABLE_PEOPLE: Person[] = [
  { key: "valerie", displayName: "Valerie Ross", role: "csr", syncoreUserId: 13379, syncoreCustomerServiceRepName: "Valerie Ross" },
  // Jeremiah's userId not yet known — sends will fall back to silent
  // Job Log entry (no email). Fill in when we have a HAR with him.
  { key: "jeremiah", displayName: "Jeremiah Gana", role: "csr", syncoreCustomerServiceRepName: "Jeremiah Gana" },
  { key: "heidi", displayName: "Heidi Lopez-Mix", role: "sales", syncoreUserId: 4916 },
  // Tricia + Voshte userIds not yet known.
  { key: "tricia", displayName: "Tricia", role: "sales" },
  { key: "voshte", displayName: "Voshte", role: "sales" },
  { key: "kiley", displayName: "Kiley Gustafson", role: "sales", syncoreUserId: 4915 },
  { key: "jennie", displayName: "Jennie Guthrie-Lopez", role: "sales_assistant", syncoreUserId: 5848 },
];

export const PEOPLE_BY_KEY: Record<string, Person> = Object.fromEntries(
  ROUTABLE_PEOPLE.map((p) => [p.key, p]),
);

// Heuristic: given the CSR name Syncore returns on a job
// (`customerServiceRepName`), find the matching registry entry. Case-
// insensitive, trims whitespace, also matches first name as a fallback
// since Syncore sometimes returns "Valerie R." vs "Valerie Ross".
export function matchCsrByName(name: string | null | undefined): Person | null {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  if (!target) return null;
  const exact = ROUTABLE_PEOPLE.find(
    (p) => p.syncoreCustomerServiceRepName?.toLowerCase() === target,
  );
  if (exact) return exact;
  const firstNameOnly = target.split(/\s+/)[0];
  return (
    ROUTABLE_PEOPLE.find(
      (p) => p.role === "csr" && p.key === firstNameOnly,
    ) ?? null
  );
}

export const ROLE_LABEL: Record<PersonRole, string> = {
  csr: "CSR",
  sales: "Sales",
  sales_assistant: "Sales Assistant",
};
