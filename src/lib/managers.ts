// Edge-safe: imported by middleware. No DB, no Node-only modules.

function parseList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isManager(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = parseList(process.env.MANAGER_EMAILS);
  return allow.has(email.toLowerCase());
}
