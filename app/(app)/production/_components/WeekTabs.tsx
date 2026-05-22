import Link from "next/link";
import { tabLabel } from "../_lib/week";

interface Props {
  days: string[]; // 5 Mon-Fri ISO dates
  activeDay: string;
  weekStart: string;
  countByDay: Record<string, number>;
  today: string;
}

// 5-tab Mon-Fri strip. Each tab is a server-rendered link so the active
// day is shareable in the URL and survives reloads.
export function WeekTabs({
  days,
  activeDay,
  weekStart,
  countByDay,
  today,
}: Props) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5">
      {days.map((d) => {
        const n = countByDay[d] ?? 0;
        const active = d === activeDay;
        return (
          <Link
            key={d}
            href={`/production?week=${weekStart}&day=${d}`}
            className={[
              "flex items-center gap-2 border border-[#E3DFD3] border-b-0 rounded-t-[10px] px-4 py-2.5 text-sm font-semibold transition",
              active
                ? "bg-white text-[#1C2B27] shadow-[inset_0_-2px_0_#0F6E56]"
                : "bg-[#EFEDE4] text-[#6B6356] hover:text-[#1C2B27]",
            ].join(" ")}
          >
            <span>{tabLabel(d, today)}</span>
            <span
              className={[
                "text-xs font-bold rounded-chip px-2 py-px",
                active
                  ? "bg-cg-teal text-white"
                  : "bg-[#DDD8CB] text-[#6B6356]",
              ].join(" ")}
            >
              {n}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
