"use client";

import { useTransition } from "react";
import { deleteTrackingAction } from "../_actions";
import { useCan } from "../../_components/UserPermissionsProvider";

export function DeleteTrackingButton({
  trackingId,
}: {
  trackingId: string;
}) {
  const [pending, start] = useTransition();
  const canDelete = useCan("production.delete_tracking");
  if (!canDelete) return null;

  function onClick() {
    const fd = new FormData();
    fd.set("trackingId", trackingId);
    start(async () => {
      try {
        await deleteTrackingAction(fd);
      } catch (err) {
        alert(
          `Couldn't delete tracking: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={[
        "text-[#9A917F] hover:text-[#D64545] text-[11px] transition px-1",
        pending ? "opacity-60 cursor-wait" : "",
      ].join(" ")}
      title="Remove tracking entry"
    >
      ×
    </button>
  );
}
