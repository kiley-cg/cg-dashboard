"use client";

// Invite form on /admin/users. Uses useActionState so the Invite
// button shows pending state + a confirmation chip after success.

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "../../../_components/SubmitButton";

export function InviteForm({
  action,
}: {
  action: (
    prevState: string | null,
    formData: FormData,
  ) => Promise<string>;
}) {
  const [state, formAction] = useActionState(action, null);
  const [showChip, setShowChip] = useState(false);
  useEffect(() => {
    if (state) {
      setShowChip(true);
      const id = setTimeout(() => setShowChip(false), 6000);
      return () => clearTimeout(id);
    }
  }, [state]);
  // Heuristic for tone: messages starting with a known "happy" verb
  // get success green; everything else (errors, "already exists") is
  // a neutral notice.
  const isSuccess = state ? /^Invited /.test(state) : false;
  return (
    <>
      <form
        action={formAction}
        className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2"
      >
        <input
          type="text"
          name="name"
          placeholder="Name (optional)"
          className="border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
        />
        <input
          type="email"
          name="email"
          required
          placeholder="email@colorgraphicswa.com"
          className="border border-cg-n-300 rounded-input px-2 py-1 bg-white text-sm"
        />
        <SubmitButton label="Invite" loadingLabel="Inviting…" variant="primary" />
      </form>
      {state && showChip && (
        <p
          className={[
            "text-[11px] font-semibold mt-1.5",
            isSuccess ? "text-cg-success" : "text-cg-n-600",
          ].join(" ")}
        >
          {isSuccess ? "✓ " : ""}
          {state}
        </p>
      )}
    </>
  );
}
