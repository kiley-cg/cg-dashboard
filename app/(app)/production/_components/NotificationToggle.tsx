"use client";

import { useState } from "react";

// Notification control is Kristen's non-negotiable (Day 3 §7). The toggle
// is user-controllable from the masthead. Wire to a real notification
// channel once one exists; for now this is the visible affordance.
export function NotificationToggle() {
  const [on, setOn] = useState(true);

  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      className={[
        "flex items-center gap-2 border border-[#E3DFD3] rounded-chip px-3.5 py-2 text-[13px] font-semibold transition",
        on ? "bg-white text-[#1C2B27]" : "bg-[#F0EEE6] text-[#888]",
      ].join(" ")}
      title="Notifications are user-controllable (Kristen's non-negotiable)"
    >
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: on ? "#3A8C5F" : "#999" }}
      />
      {on ? "Notifications on" : "Notifications muted"}
    </button>
  );
}
