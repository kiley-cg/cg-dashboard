"use client";

// Cross-card selection state for /production. Lets the floor pick
// multiple POs and schedule them all to the same day in one click.
// Lives in client React state — no need to persist across reloads
// since the natural flow is select → schedule → revalidatePath
// wipes the page (and the selection) anyway.

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface SelectionState {
  selected: Set<string>;
  isSelected: (poId: string) => boolean;
  toggle: (poId: string) => void;
  clear: () => void;
}

const Ctx = createContext<SelectionState | null>(null);

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((poId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(poId)) next.delete(poId);
      else next.add(poId);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo<SelectionState>(
    () => ({
      selected,
      isSelected: (poId) => selected.has(poId),
      toggle,
      clear,
    }),
    [selected, toggle, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelection(): SelectionState {
  const v = useContext(Ctx);
  if (!v) {
    // Returning a no-op fallback would silently hide bugs — fail loudly
    // so we catch missing-provider regressions.
    throw new Error("useSelection must be used inside <SelectionProvider>");
  }
  return v;
}
