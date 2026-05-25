"use client";

// Client-side filter state for /production. Pure client state — no
// server roundtrip on filter change. The schedule view renders every
// card; PoCard reads this context and returns null when it doesn't
// match, so changing a filter is a single React commit instead of a
// page reload.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Department } from "@/lib/syncore/production";

export type DeptFilter = Department | "all";

interface FilterState {
  dept: DeptFilter;
  readyOnly: boolean;
  query: string; // lowercased substring matched against customer + job#
  setDept: (d: DeptFilter) => void;
  setReadyOnly: (b: boolean) => void;
  setQuery: (q: string) => void;
  clear: () => void;
  // Convenience: should a card with these attributes render?
  matches: (input: {
    dept: Department;
    inboundReady: boolean;
    customer: string | null;
    jobId: string;
  }) => boolean;
}

const Ctx = createContext<FilterState | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [dept, setDept] = useState<DeptFilter>("all");
  const [readyOnly, setReadyOnly] = useState(false);
  const [query, setQuery] = useState("");

  const clear = useCallback(() => {
    setDept("all");
    setReadyOnly(false);
    setQuery("");
  }, []);

  const matches = useCallback<FilterState["matches"]>(
    ({ dept: poDept, inboundReady, customer, jobId }) => {
      if (dept !== "all" && poDept !== dept) return false;
      if (readyOnly && !inboundReady) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const hay = `${customer ?? ""} ${jobId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    },
    [dept, readyOnly, query],
  );

  const value = useMemo<FilterState>(
    () => ({ dept, readyOnly, query, setDept, setReadyOnly, setQuery, clear, matches }),
    [dept, readyOnly, query, clear, matches],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFilter(): FilterState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFilter must be used inside <FilterProvider>");
  return v;
}
