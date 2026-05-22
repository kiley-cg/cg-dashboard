import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasRoleAccess } from "@/lib/roles";
import {
  mockProductionQueue,
  type ProductionJob,
} from "@/lib/syncore/production";
import {
  addDaysIso,
  defaultActiveDay,
  mondayOfWeek,
  pacificIsoDate,
  weekDays,
} from "./_lib/week";
import { JobCard } from "./_components/JobCard";
import { HuddleSection } from "./_components/HuddleSection";
import { NotificationToggle } from "./_components/NotificationToggle";
import { WeekTabs } from "./_components/WeekTabs";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "What runs today · Color Graphics",
};

interface PageProps {
  searchParams: Promise<{
    day?: string;
    week?: string;
  }>;
}

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

export default async function ProductionPage({ searchParams }: PageProps) {
  const session = await auth();
  const allowed = await hasRoleAccess({
    email: session?.user?.email,
    userId: session?.user?.id,
    required: "production",
  });
  if (!allowed) {
    // Defense-in-depth: middleware lets all signed-in users past, the page
    // enforces role. 404 rather than "forbidden" so the route isn't visibly
    // gated (matches the existing /dashboard pattern).
    notFound();
  }

  const today = pacificIsoDate();
  const params = await searchParams;

  // Week anchor (Monday). `?week=YYYY-MM-DD` overrides; default = this week.
  const weekStart = params.week
    ? mondayOfWeek(params.week)
    : mondayOfWeek(today);
  const days = weekDays(weekStart);

  // Active day. `?day=YYYY-MM-DD` overrides; default = today if in this
  // week, else first day of the displayed week, else weekend default.
  let activeDay: string;
  if (params.day && days.includes(params.day)) {
    activeDay = params.day;
  } else if (days.includes(today)) {
    activeDay = today;
  } else if (params.week) {
    activeDay = days[0];
  } else {
    activeDay = defaultActiveDay();
  }

  // Pull all jobs once, partition into per-day counts for the tabs and
  // filter to the active day for rendering. The mock returns six anchored
  // to today; once `fetchProductionQueue` is wired, swap this for the real
  // pull and pass the week range.
  let jobs: ProductionJob[] = [];
  try {
    jobs = mockProductionQueue(today);
  } catch {
    jobs = [];
  }

  const countByDay = new Map<string, number>();
  for (const j of jobs) {
    countByDay.set(j.scheduled, (countByDay.get(j.scheduled) ?? 0) + 1);
  }

  const dayJobs = jobs
    .filter((j) => j.scheduled === activeDay)
    .sort((a, b) => {
      // Urgent flag would float to top here once persisted state is wired;
      // for now sort by due date alone.
      return a.due.localeCompare(b.due);
    });

  const totalMinutes = dayJobs.reduce((s, j) => s + (j.calcMinutes ?? 0), 0);

  const prevWeek = addDaysIso(weekStart, -7);
  const nextWeek = addDaysIso(weekStart, 7);

  return (
    <div className="min-h-screen bg-[#F7F5EF] text-[#1C2B27]">
      {/* Masthead */}
      <header className="flex flex-wrap items-end justify-between gap-3 px-8 pt-7 pb-4 border-b-2 border-[#1C2B27]">
        <div>
          <p className="text-[11px] tracking-[.14em] uppercase font-bold text-cg-teal">
            Color Graphics · Production
          </p>
          <h1 className="text-[34px] font-medium tracking-tight mt-1 font-serif">
            What runs today
          </h1>
        </div>
        <NotificationToggle />
      </header>

      {/* Week navigation + 5-day tabs */}
      <div className="px-8 pt-4 flex flex-wrap items-end gap-3">
        <WeekArrows
          prevHref={`/production?week=${prevWeek}`}
          nextHref={`/production?week=${nextWeek}`}
          weekStart={weekStart}
        />
        <WeekTabs
          days={days}
          activeDay={activeDay}
          weekStart={weekStart}
          countByDay={Object.fromEntries(countByDay)}
          today={today}
        />
        <div className="ml-auto text-right">
          <span className="block text-[10px] tracking-[.1em] uppercase text-[#9A917F]">
            Scheduled load
          </span>
          <strong className="text-xl font-serif">
            {fmtMinutes(totalMinutes)}
          </strong>
        </div>
      </div>

      {/* Job cards */}
      <main className="mx-8 bg-white border border-[#E3DFD3] rounded-tr-card rounded-b-card p-4 flex flex-col gap-3">
        {dayJobs.length === 0 ? (
          <div className="py-10 text-center text-[#9A917F] italic">
            Nothing scheduled for this day yet.
          </div>
        ) : (
          dayJobs.map((j) => (
            <JobCard
              key={j.jobId}
              job={j}
              isLastDayOfWeek={activeDay === days[days.length - 1]}
            />
          ))
        )}

        <HuddleSection activeDay={activeDay} />
      </main>

      <footer className="mx-8 mt-4 text-[11.5px] text-[#9A917F] leading-relaxed">
        Slice #1 scaffold · mock data stands in for Syncore @ease v1 Production
        Queue. Done/urgent/carry state and huddle tasks land in Postgres once
        the v1 endpoint is wired (see scripts/discover-production-queue.ts).
        <span className="ml-2">
          <Link href="/admin/users" className="text-cg-teal hover:underline">
            Admin · user roles →
          </Link>
        </span>
      </footer>
    </div>
  );
}

function WeekArrows({
  prevHref,
  nextHref,
  weekStart,
}: {
  prevHref: string;
  nextHref: string;
  weekStart: string;
}) {
  const d = new Date(`${weekStart}T12:00:00Z`);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(d);
  return (
    <div className="flex items-center gap-1 pb-2 text-sm">
      <Link
        href={prevHref}
        className="px-2 py-1 rounded text-[#6B6356] hover:bg-[#EFEDE4] hover:text-[#1C2B27] transition"
        aria-label="Previous week"
      >
        ←
      </Link>
      <span className="text-[11px] uppercase tracking-wider text-[#9A917F] font-semibold">
        Week of {label}
      </span>
      <Link
        href={nextHref}
        className="px-2 py-1 rounded text-[#6B6356] hover:bg-[#EFEDE4] hover:text-[#1C2B27] transition"
        aria-label="Next week"
      >
        →
      </Link>
    </div>
  );
}
