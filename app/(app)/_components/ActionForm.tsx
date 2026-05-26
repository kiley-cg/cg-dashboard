"use client";

// Reusable wrapper for the "click a button, server action runs,
// confirmation message appears next to the button" pattern.
//
// Pairs an action that returns a status string with a <SubmitButton>
// (spinner while pending) and a small confirmation chip after success.
//
// Usage:
//   <ActionForm action={reseedRoles} label="Re-seed defaults" loadingLabel="Re-seeding…" />
//
// The action must follow the useActionState contract:
//   async function myAction(prevState: string | null, formData?: FormData): Promise<string>
// Returns the message to display.

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "./SubmitButton";

interface Props {
  // Server action — must return a string message.
  action: (
    prevState: string | null,
    formData: FormData,
  ) => Promise<string>;
  label: string;
  loadingLabel?: string;
  title?: string;
  variant?: "primary" | "ghost";
  /** Optional hidden inputs to include in the form submission. */
  hiddenInputs?: Record<string, string>;
}

export function ActionForm({
  action,
  label,
  loadingLabel,
  title,
  variant = "ghost",
  hiddenInputs,
}: Props) {
  const [state, formAction] = useActionState(action, null);
  // Confirmation chip auto-fades after a few seconds so it doesn't
  // sit there forever — but the action's "result" still in DB, page
  // re-render shows it.
  const [showChip, setShowChip] = useState(false);
  useEffect(() => {
    if (state) {
      setShowChip(true);
      const id = setTimeout(() => setShowChip(false), 6000);
      return () => clearTimeout(id);
    }
  }, [state]);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      {hiddenInputs &&
        Object.entries(hiddenInputs).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <SubmitButton
        label={label}
        loadingLabel={loadingLabel}
        title={title}
        variant={variant}
      />
      {state && showChip && (
        <span className="text-[11px] text-cg-success font-semibold inline-flex items-center gap-1 animate-fade-in">
          ✓ {state}
        </span>
      )}
    </form>
  );
}
