"use client";

import { useSelection } from "./SelectionProvider";
import { useCan } from "../../_components/UserPermissionsProvider";

// Per-card checkbox. Reads / writes the shared SelectionProvider so
// the BulkScheduleBar can act on all selected POs at once. Hidden
// from users who can't bulk-schedule — selecting would be a no-op
// since the bar wouldn't appear.
export function PoSelectCheckbox({ poId }: { poId: string }) {
  const { isSelected, toggle } = useSelection();
  const canBulkSchedule = useCan("production.bulk_schedule");
  if (!canBulkSchedule) return null;
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
