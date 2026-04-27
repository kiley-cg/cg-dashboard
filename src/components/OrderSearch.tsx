"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "./Button";

// Quote lookup is disabled until Syncore exposes a quotes endpoint in their
// V2 API. The /quotes/[id] route still exists so we can flip this back on
// quickly when they ship it. Tested URL patterns that all 404'd:
//   /v2/orders/quotes/{id}
//   /v2/quotes/{id}
//   /v2/orders/clients/{client_id}/quotes/{number}
const QUOTES_ENABLED = false;

export function OrderSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="w-full max-w-md">
      <div
        role="tablist"
        aria-label="Lookup type"
        className="inline-flex bg-cg-n-100 rounded-input p-0.5 text-sm font-semibold mb-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={true}
          className="px-3 py-1.5 rounded-input bg-white text-cg-n-900 shadow-sm"
        >
          Job
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={false}
          disabled={!QUOTES_ENABLED}
          title={
            QUOTES_ENABLED
              ? undefined
              : "Quote lookup is waiting on a Syncore V2 API endpoint that doesn't exist yet."
          }
          className="px-3 py-1.5 rounded-input text-cg-n-400 cursor-not-allowed inline-flex items-center gap-1.5"
        >
          Quote
          <span className="text-[9px] uppercase tracking-wider bg-cg-n-200 text-cg-n-600 px-1.5 py-0.5 rounded">
            Coming soon
          </span>
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (!trimmed) return;
          startTransition(() => {
            router.push(`/jobs/${encodeURIComponent(trimmed)}`);
          });
        }}
        className="flex gap-3"
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

      <p className="text-cg-n-500 text-xs mt-3 max-w-md">
        Need to check inventory on a quote? Convert it to a job in Syncore
        first — Syncore&apos;s V2 API doesn&apos;t expose quotes yet.
      </p>
    </div>
  );
}
