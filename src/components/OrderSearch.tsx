"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "./Button";

type Mode = "job" | "quote";

export function OrderSearch() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("job");
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  const placeholder =
    mode === "job" ? "Syncore Job ID (e.g. 4991)" : "Syncore Quote ID (e.g. 5351986)";

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
          aria-selected={mode === "job"}
          onClick={() => setMode("job")}
          className={`px-3 py-1.5 rounded-input transition ${
            mode === "job"
              ? "bg-white text-cg-n-900 shadow-sm"
              : "text-cg-n-500 hover:text-cg-n-700"
          }`}
        >
          Job
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "quote"}
          onClick={() => setMode("quote")}
          className={`px-3 py-1.5 rounded-input transition ${
            mode === "quote"
              ? "bg-white text-cg-n-900 shadow-sm"
              : "text-cg-n-500 hover:text-cg-n-700"
          }`}
        >
          Quote
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (!trimmed) return;
          const segment = mode === "job" ? "jobs" : "quotes";
          startTransition(() => {
            router.push(`/${segment}/${encodeURIComponent(trimmed)}`);
          });
        }}
        className="flex gap-3"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={mode === "job" ? "Syncore Job ID" : "Syncore Quote ID"}
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
    </div>
  );
}
