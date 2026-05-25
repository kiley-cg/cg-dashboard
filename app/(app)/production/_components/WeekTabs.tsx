import Link from "next/link";
import { tabLabel } from "../_lib/week";

interface Props {
  days: string[]; // 5 Mon-Fri ISO dates
  activeDay: string;
  weekStart: string;
  countByDay: Record<string, number>;
  qtyByDay: Record<string, number>;
  today: string;
}

// Soft capacity ceiling for the bar fill. POs vary wildly in qty so
// this is a visual rule-of-thumb, not a hard limit. Tune over time as
// we learn the floor's actual sustainable daily volume.
const DAILY_QTY_TARGET = 1500;

// 5-tab Mon-Fri strip. Each tab is a server-rendered link so the active
// day is shareable in the URL and survives reloads. Below the count
// chip, a thin fill bar shows that day's total quantity vs the soft
// target so Kristen can spot capacity imbalance at a glance.
export function WeekTabs({
  days,
  activeDay,
  weekStart,
  countByDay,
  qtyByDay,
  today,
}: Props) {
  return (
    <nav className="flex flex-wrap items-end gap-1.5">
      {days.map((d) => {
        const n = countByDay[d] ?? 0;
        const qty = qtyByDay[d] ?? 0;
        const fill = Math.min(qty / DAILY_QTY_TARGET, 1.25); // allow overshoot
        const overCapacity = fill > 1;
        const active = d === activeDay;
        return (
          <Link
            key={d}
            href={`/production?week=${weekStart}&day=${d}`}
            className={[
              "flex flex-col gap-1 border border-[#E3DFD3] border-b-0 rounded-t-[10px] px-4 py-2 text-sm font-semibold transition min-w-[120px]",
              active
                ? "bg-white text-[#1C2B27] shadow-[inset_0_-2px_0_#0F6E56]"
                : "bg-[#EFEDE4] text-[#6B6356] hover:text-[#1C2B27]",
            ].join(" ")}
          >
            <div className="flex items-center gap-2">
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
            </div>
            {/* Capacity bar — width proportional to qty/target, color
                turns amber when overcommitted. Tiny qty caption keeps
                the number scannable too. */}
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1 rounded-full bg-[#DDD8CB] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(fill, 1) * 100}%`,
                    background: overCapacity
                      ? "#E0A800"
                      : active
                        ? "#0F6E56"
                        : "#9A917F",
                  }}
                />
              </div>
              <span
                className={[
                  "text-[10px] tabular-nums font-medium",
                  overCapacity ? "text-[#A8770A]" : "text-[#9A917F]",
                ].join(" ")}
                title={`${qty} pieces scheduled (soft target ${DAILY_QTY_TARGET})`}
              >
                {qty}
              </span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
