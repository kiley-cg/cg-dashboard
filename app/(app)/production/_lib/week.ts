// Date helpers for the Mon–Fri notebook tabs and week navigation.
// All dates are YYYY-MM-DD strings in America/Los_Angeles (the shop's
// local time). The "production day" never wraps midnight because the
// shop is local; using Pacific keeps cron and UI agreed.

const TZ = "America/Los_Angeles";

// Pacific YYYY-MM-DD for a given Date. We format then re-parse the
// en-CA locale ("YYYY-MM-DD") so DST is handled correctly.
export function pacificIsoDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// 0 = Sun, 1 = Mon, ..., 6 = Sat — in Pacific time.
export function pacificDayOfWeek(d: Date = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

// Add `days` (calendar days) to a YYYY-MM-DD. Stays within YYYY-MM-DD
// because we anchor at noon UTC — far enough from the date boundary
// that DST shifts can't roll us into an adjacent day.
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Monday-of-week for a given YYYY-MM-DD (Pacific). For Saturday or
// Sunday, returns the upcoming Monday — matches the chosen weekend
// default ("if Sat/Sun, default to next Monday").
export function mondayOfWeek(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  // getUTCDay matches the calendar day at noon UTC, which is the same
  // local day everywhere west of UTC+11. Safe for Pacific.
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  if (dow === 0) return addDaysIso(iso, 1); // Sun -> next Mon
  if (dow === 6) return addDaysIso(iso, 2); // Sat -> next Mon
  return addDaysIso(iso, 1 - dow); // Mon..Fri -> Mon of that week
}

// The five weekday ISO dates (Mon..Fri) for the week containing `weekStart`.
export function weekDays(weekStart: string): string[] {
  return [0, 1, 2, 3, 4].map((i) => addDaysIso(weekStart, i));
}

// Default tab when the page loads. Today if today is Mon-Fri; otherwise
// next Monday (chosen behavior). Returns YYYY-MM-DD.
export function defaultActiveDay(now: Date = new Date()): string {
  const today = pacificIsoDate(now);
  const dow = pacificDayOfWeek(now);
  if (dow >= 1 && dow <= 5) return today;
  // Sat (6) -> +2, Sun (0) -> +1
  const offset = dow === 6 ? 2 : 1;
  return addDaysIso(today, offset);
}

// Carry-forward advance: next visible work day. Mon-Thu -> +1, Fri -> +3
// (skip the weekend, land on Monday). Used by both job and huddle-task
// carry-forward so they stay synchronized.
export function nextWorkDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 5) return addDaysIso(iso, 3); // Fri -> Mon
  if (dow === 6) return addDaysIso(iso, 2); // Sat -> Mon
  if (dow === 0) return addDaysIso(iso, 1); // Sun -> Mon
  return addDaysIso(iso, 1);
}

// Friendly label for a tab. "Mon May 25" — short, dense, notebook-like.
// When the tab matches today, prefix "Today · ".
export function tabLabel(iso: string, today: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(d);
  const md = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(d);
  if (iso === today) return `Today · ${wd} ${md}`;
  return `${wd} ${md}`;
}
