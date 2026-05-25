"use client";

import { useFilter, type DeptFilter } from "./FilterProvider";

const DEPT_CHIPS: { value: DeptFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "embroidery", label: "Embroidery" },
  { value: "transfers", label: "Transfers" },
  { value: "fulfillment", label: "Fulfillment" },
  { value: "other", label: "Other" },
];

// Thin chip row above the schedule view. Department toggle + "Ready
// only" toggle + a free-text search matched against customer + job#.
// All client-side filtering — instant, no roundtrip.
export function FilterBar() {
  const { dept, readyOnly, query, setDept, setReadyOnly, setQuery, clear } =
    useFilter();

  const hasFilter = dept !== "all" || readyOnly || query.trim().length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="font-semibold text-[#6B6356] mr-1">Filter:</span>
      {DEPT_CHIPS.map((c) => {
        const active = dept === c.value;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => setDept(c.value)}
            className={[
              "rounded-chip px-2.5 py-1 font-semibold transition",
              active
                ? "bg-cg-teal text-white"
                : "bg-[#EFEDE4] text-[#6B6356] hover:bg-[#E3DFD3]",
            ].join(" ")}
          >
            {c.label}
          </button>
        );
      })}

      <label
        className={[
          "ml-1 inline-flex items-center gap-1.5 rounded-chip px-2.5 py-1 font-semibold cursor-pointer transition",
          readyOnly
            ? "bg-[#3A8C5F] text-white"
            : "bg-[#EFEDE4] text-[#6B6356] hover:bg-[#E3DFD3]",
        ].join(" ")}
      >
        <input
          type="checkbox"
          checked={readyOnly}
          onChange={(e) => setReadyOnly(e.target.checked)}
          className="sr-only"
        />
        Ready only
      </label>

      <input
        type="search"
        placeholder="Customer or job #"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="ml-2 border border-[#E3DFD3] rounded px-2 py-1 text-[12.5px] bg-white w-[180px]"
      />

      {hasFilter && (
        <button
          type="button"
          onClick={clear}
          className="text-[12px] text-[#6B6356] underline ml-1 hover:text-[#1C2B27]"
        >
          Clear
        </button>
      )}
    </div>
  );
}
