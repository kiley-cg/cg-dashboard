import Link from "next/link";

interface Props {
  view: "day" | "week";
  weekStart: string;
  activeDay: string;
}

// Day / Week toggle for the schedule view. ?view=week shows the 5-day
// grid; default (no param or ?view=day) shows the per-day tab view.
// Renders as two segmented buttons — minimal, mirrors the look of
// the top Schedule/Inbound tabs.
export function ViewToggle({ view, weekStart, activeDay }: Props) {
  const dayHref = `/production?week=${weekStart}&day=${activeDay}`;
  const weekHref = `/production?week=${weekStart}&view=week`;
  return (
    <div className="inline-flex rounded border border-[#E3DFD3] overflow-hidden text-[12px] font-semibold">
      <Link
        href={dayHref}
        className={[
          "px-3 py-1.5 transition",
          view === "day"
            ? "bg-cg-teal text-white"
            : "bg-white text-[#6B6356] hover:text-[#1C2B27]",
        ].join(" ")}
      >
        Day
      </Link>
      <Link
        href={weekHref}
        className={[
          "px-3 py-1.5 transition",
          view === "week"
            ? "bg-cg-teal text-white"
            : "bg-white text-[#6B6356] hover:text-[#1C2B27]",
        ].join(" ")}
      >
        Week
      </Link>
    </div>
  );
}
