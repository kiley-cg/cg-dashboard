"use client";

// Tiny inline spinner that only renders while the parent Link's navigation
// is pending. Drop inside any <Link> child to give the click visual
// feedback during server-rendering / data-fetching of the destination
// page.
//
// Uses Next.js's per-Link pending status; works because every Link wraps
// its children in a context that this hook reads from.

import { useLinkStatus } from "next/link";

interface Props {
  size?: number;
  className?: string;
}

export function LinkSpinner({ size = 12, className }: Props) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full border-2 border-current border-t-transparent animate-spin ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}
