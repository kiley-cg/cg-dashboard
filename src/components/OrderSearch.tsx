"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "./Button";

export function OrderSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  // useTransition stays pending until the destination page finishes its server
  // render — including the Syncore fetch and the SanMar / S&S inventory calls.
  // So the button accurately reflects "still working" not just "navigating".
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        startTransition(() => {
          router.push(`/jobs/${encodeURIComponent(trimmed)}`);
        });
      }}
      className="flex gap-3 w-full max-w-md"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Syncore Job ID (e.g. 4991)"
        aria-label="Syncore Job ID"
        disabled={pending}
        className="flex-1 bg-white border border-cg-n-200 rounded-input px-4 py-2 text-cg-n-900 placeholder-cg-n-400 focus:outline-none focus:border-cg-red focus:ring-2 focus:ring-cg-red-100 disabled:bg-cg-n-50 disabled:text-cg-n-400"
        autoFocus
      />
      <Button type="submit" size="md" disabled={pending}>
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin"
            />
            Looking up…
          </span>
        ) : (
          "Look up"
        )}
      </Button>
    </form>
  );
}
