import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasRoleAccess } from "@/lib/roles";
import {
  getCustomerDisplayMap,
  getMostRecentMirrorAt,
  listOpenDecorationPos,
  type DecorationPoView,
} from "@/lib/db/production-po";
import {
  departmentForSupplier,
  type Department,
} from "@/lib/syncore/production";
import {
  addDaysIso,
  defaultActiveDay,
  mondayOfWeek,
  pacificIsoDate,
  weekDays,
} from "./_lib/week";
import { PoCard, type DayOption } from "./_components/PoCard";
import { HuddleSection } from "./_components/HuddleSection";
import { NotificationToggle } from "./_components/NotificationToggle";
import { WeekTabs } from "./_components/WeekTabs";
import { InboundTab } from "./_components/InboundTab";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "What runs today · Color Graphics",
};

type TabKey = "schedule" | "inbound";

interface PageProps {
  searchParams: Promise<{
    day?: string;
    week?: string;
    tab?: string;
  }>;
}

const DEPT_ORDER: Department[] = [
  "embroidery",
  "transfers",
  "fulfillment",
  "other",
];
const DEPT_TITLE: Record<Department, string> = {
  embroidery: "Embroidery",
  transfers: "Transfers",
  fulfillment: "Fulfillment",
  other: "Other in-house",
};

export default async function ProductionPage({ searchParams }: PageProps) {
  const session = await auth();
  const allowed = await hasRoleAccess({
    email: session?.user?.email,
    userId: session?.user?.id,
    required: "production",
  });
  if (!allowed) {
    notFound();
  }

  const today = pacificIsoDate();
  const params = await searchParams;
  const activeTab: TabKey = params.tab === "inbound" ? "inbound" : "schedule";

  // Week anchor (Monday). `?week=YYYY-MM-DD` overrides; default = this week.
  const weekStart = params.week
    ? mondayOfWeek(params.week)
    : mondayOfWeek(today);
  const days = weekDays(weekStart);

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

  const decorationPos = await listOpenDecorationPos();
  const mostRecent = await getMostRecentMirrorAt();
  const customerMap = await getCustomerDisplayMap({
    jobIds: Array.from(new Set(decorationPos.map((v) => v.po.syncoreJobId))),
  });

  // Bucket by scheduled date. Null scheduled_date = unscheduled. POs
  // scheduled to a week other than the displayed one don't render here —
  // navigate via the week arrows to find them.
  const scheduledByDay = new Map<string, DecorationPoView[]>();
  const unscheduled: DecorationPoView[] = [];
  for (const v of decorationPos) {
    const d = v.state?.scheduledDate;
    if (d) {
      const arr = scheduledByDay.get(d) ?? [];
      arr.push(v);
      scheduledByDay.set(d, arr);
    } else {
      unscheduled.push(v);
    }
  }

  const countByDay: Record<string, number> = {};
  for (const d of days) countByDay[d] = scheduledByDay.get(d)?.length ?? 0;

  const dayItems = scheduledByDay.get(activeDay) ?? [];
  const unscheduledByDept = groupByDepartment(unscheduled);

  const prevWeek = addDaysIso(weekStart, -7);
  const nextWeek = addDaysIso(weekStart, 7);

  // Day options for the per-card Schedule dropdown. Always the displayed
  // week's Mon-Fri — scheduling cross-week happens via the week arrows.
  const weekDayOptions: DayOption[] = days.map((iso) => ({
    iso,
    label: new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`)),
  }));

  return (
    <div className="min-h-screen bg-[#F7F5EF] text-[#1C2B27]">
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

      {/* Top-level tab strip: Schedule (Kristen's day-by-day decoration
          plan) and Inbound (apparel shipping to CG that she's waiting on).
          State carried as ?tab=inbound; default empty = schedule. */}
      <div className="px-8 pt-5 border-b border-[#E3DFD3] flex gap-1">
        <TopTab
          href="/production"
          label="Schedule"
          active={activeTab === "schedule"}
        />
        <TopTab
          href="/production?tab=inbound"
          label="Inbound"
          active={activeTab === "inbound"}
        />
      </div>

      {activeTab === "inbound" ? (
        <InboundTab />
      ) : (
        <>
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
              countByDay={countByDay}
              today={today}
            />
            <div className="ml-auto text-right">
              <span className="block text-[10px] tracking-[.1em] uppercase text-[#9A917F]">
                Open decoration POs
              </span>
              <strong className="text-xl font-serif">
                {decorationPos.length}
              </strong>
            </div>
          </div>

          {/* Scheduled section — current day's cards */}
          <main className="mx-8 bg-white border border-[#E3DFD3] rounded-tr-card rounded-b-card p-4 flex flex-col gap-3">
            {dayItems.length === 0 ? (
              <div className="py-10 text-center text-[#9A917F] italic">
                Nothing scheduled for this day yet. Use the Schedule
                dropdown on any card in the Unscheduled queue below to
                place it on this day.
              </div>
            ) : (
              DEPT_ORDER.flatMap((dept) => {
                const items = dayItems.filter(
                  (v) => departmentForSupplier(v.po.supplierName) === dept,
                );
                if (items.length === 0) return [];
                return [
                  <DeptHeader
                    key={`h-${dept}`}
                    dept={dept}
                    count={items.length}
                  />,
                  ...items.map((v) => (
                    <PoCard
                      key={v.po.poId}
                      po={v.po}
                      state={v.state}
                      apparelSiblings={v.apparelSiblings}
                      inboundTrackingCount={v.inboundTrackingCount}
                      department={dept}
                      customer={
                        customerMap.get(v.po.syncoreJobId) ?? null
                      }
                      weekDays={weekDayOptions}
                    />
                  )),
                ];
              })
            )}

            <HuddleSection activeDay={activeDay} />
          </main>

          {/* Unscheduled queue */}
          <section className="mx-8 mt-6 mb-8">
            <h2 className="text-[12px] tracking-[.14em] uppercase font-bold text-cg-teal mb-2">
              Unscheduled · {unscheduled.length} PO
              {unscheduled.length === 1 ? "" : "s"}
            </h2>
            {unscheduled.length === 0 ? (
              <div className="bg-white border border-[#E3DFD3] rounded-card p-6 text-center text-[#9A917F] italic">
                No open decoration POs. Either the mirror cron
                hasn&apos;t run yet, or everything in production is done.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {DEPT_ORDER.map((dept) => {
                  const items = unscheduledByDept.get(dept) ?? [];
                  if (items.length === 0) return null;
                  return (
                    <div
                      key={dept}
                      className="bg-white border border-[#E3DFD3] rounded-card p-3 flex flex-col gap-3"
                    >
                      <DeptHeader dept={dept} count={items.length} />
                      {items.map((v) => (
                        <PoCard
                          key={v.po.poId}
                          po={v.po}
                          state={v.state}
                          apparelSiblings={v.apparelSiblings}
                          inboundTrackingCount={v.inboundTrackingCount}
                          department={dept}
                          customer={
                            customerMap.get(v.po.syncoreJobId) ?? null
                          }
                          weekDays={weekDayOptions}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <footer className="mx-8 mb-6 text-[11.5px] text-[#9A917F] leading-relaxed">
        v2 PO mirror + scheduling + floor status + inbound (CG-bound).{" "}
        {mostRecent
          ? `Last mirrored ${mostRecent.toISOString().slice(0, 16).replace("T", " ")} UTC.`
          : "Mirror hasn't run yet."}{" "}
        Syncore receiving-memo writeback (Phase 4.2) + carrier auto-poll
        (Phase 5) coming next.
        <span className="ml-2">
          <Link href="/admin/users" className="text-cg-teal hover:underline">
            Admin · user roles →
          </Link>
        </span>
      </footer>
    </div>
  );
}

function TopTab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition",
        active
          ? "border-cg-teal text-[#1C2B27]"
          : "border-transparent text-[#6B6356] hover:text-[#1C2B27]",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function groupByDepartment(
  items: DecorationPoView[],
): Map<Department, DecorationPoView[]> {
  const out = new Map<Department, DecorationPoView[]>();
  for (const v of items) {
    const d = departmentForSupplier(v.po.supplierName);
    const arr = out.get(d) ?? [];
    arr.push(v);
    out.set(d, arr);
  }
  // Sort each bucket by earliest in_hand_date so urgent stuff floats up.
  for (const arr of out.values()) {
    arr.sort((a, b) => {
      const ai = a.po.inHandDate ?? "9999-12-31";
      const bi = b.po.inHandDate ?? "9999-12-31";
      return ai.localeCompare(bi);
    });
  }
  return out;
}

function DeptHeader({ dept, count }: { dept: Department; count: number }) {
  return (
    <h3 className="text-[11px] tracking-[.12em] uppercase font-bold text-[#5A5346] border-b border-[#E3DFD3] pb-1 mt-2 first:mt-0">
      {DEPT_TITLE[dept]} · {count}
    </h3>
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
