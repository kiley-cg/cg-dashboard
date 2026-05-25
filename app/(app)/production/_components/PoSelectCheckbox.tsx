"use client";

import { useSelection } from "./SelectionProvider";

// Per-card checkbox. Reads / writes the shared SelectionProvider so
// the BulkScheduleBar can act on all selected POs at once.
export function PoSelectCheckbox({ poId }: { poId: string }) {
  const { isSelected, toggle } = useSelection();
  const checked = isSelected(poId);
  return (
    <label
      className="inline-flex items-center cursor-pointer"
      title="Select this PO for bulk scheduling"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => toggle(poId)}
        className="w-4 h-4 accent-cg-teal cursor-pointer"
      />
    </label>
  );
}
