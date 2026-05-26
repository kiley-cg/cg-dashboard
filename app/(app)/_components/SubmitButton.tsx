"use client";

// Drop-in submit button that shows a pending state during the
// enclosing <form>'s server-action call. Uses Next.js's useFormStatus
// so it works with any <form action={serverAction}> — no need to
// hoist the action into a client transition wrapper.
//
// Usage:
//   <form action={reseedRoles}>
//     <SubmitButton label="Re-seed defaults" loadingLabel="Re-seeding…" />
//   </form>

import { useFormStatus } from "react-dom";

interface Props {
  label: string;
  loadingLabel?: string;
  className?: string;
  /** "primary" = filled dark button. "ghost" = outline. Default primary. */
  variant?: "primary" | "ghost";
  /** Extra title tooltip. */
  title?: string;
}

export function SubmitButton({
  label,
  loadingLabel,
  className,
  variant = "primary",
  title,
}: Props) {
  const { pending } = useFormStatus();
  const base =
    variant === "primary"
      ? "rounded-btn bg-cg-black text-white px-3 py-1.5 text-xs font-semibold hover:bg-cg-n-800 transition"
      : "text-xs border border-cg-n-300 rounded-input px-3 py-1.5 hover:bg-cg-n-100 transition";
  return (
    <button
      type="submit"
      disabled={pending}
      title={title}
      className={[
        base,
        pending ? "opacity-60 cursor-wait" : "",
        className ?? "",
      ].join(" ")}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner />
          {loadingLabel ?? "Working…"}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="4"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
