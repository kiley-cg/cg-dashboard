"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "./Button";
import { DECORATORS, DEFAULT_DECORATOR_ID } from "@/lib/decorators";

export function OrderSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [costs, setCosts] = useState(false);
  const [freight, setFreight] = useState(false);
  const [decoratorId, setDecoratorId] = useState(DEFAULT_DECORATOR_ID);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    const params = new URLSearchParams();
    if (costs) params.set("costs", "1");
    if (freight) params.set("freight", "1");
    if (decoratorId !== DEFAULT_DECORATOR_ID) {
      params.set("decorator", decoratorId);
    }
    const qs = params.toString();
    const url = `/jobs/${encodeURIComponent(trimmed)}${qs ? `?${qs}` : ""}`;
    startTransition(() => {
      router.push(url);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 w-full max-w-md">
      <div className="flex gap-3">
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
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-cg-n-500 uppercase tracking-wider font-semibold">
          Include:
        </span>
        <button
          type="button"
          aria-pressed={costs}
          onClick={() => setCosts((v) => !v)}
          disabled={pending}
          className={
            costs
              ? "bg-cg-red text-white px-3 py-1.5 rounded font-semibold"
              : "border border-cg-n-200 text-cg-n-500 px-3 py-1.5 rounded hover:text-cg-n-900"
          }
        >
          Costs {costs ? "on" : "off"}
        </button>
        <button
          type="button"
          aria-pressed={freight}
          onClick={() => setFreight((v) => !v)}
          disabled={pending}
          className={
            freight
              ? "bg-cg-red text-white px-3 py-1.5 rounded font-semibold"
              : "border border-cg-n-200 text-cg-n-500 px-3 py-1.5 rounded hover:text-cg-n-900"
          }
        >
          Freight {freight ? "on" : "off"}
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs flex-wrap">
        <span className="text-cg-n-500 uppercase tracking-wider font-semibold">
          Decorator:
        </span>
        {DECORATORS.map((d) => {
          const active = d.id === decoratorId;
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={active}
              onClick={() => setDecoratorId(d.id)}
              disabled={pending}
              className={
                active
                  ? "bg-cg-red text-white px-3 py-1.5 rounded font-semibold"
                  : "border border-cg-n-200 text-cg-n-500 px-3 py-1.5 rounded hover:text-cg-n-900"
              }
            >
              {d.name}
            </button>
          );
        })}
      </div>
      <p className="text-cg-n-500 text-[11px]">
        Skipping costs/freight speeds up availability-only checks.
      </p>
    </form>
  );
}
