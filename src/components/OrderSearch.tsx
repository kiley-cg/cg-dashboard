"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrderSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        router.push(`/orders/${encodeURIComponent(trimmed)}`);
      }}
      className="flex gap-3 w-full max-w-md"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. SO-12345"
        aria-label="Syncore order number"
        className="flex-1 bg-cg-surface border border-cg-border rounded-card px-4 py-2 focus:outline-none focus:border-cg-red"
        autoFocus
      />
      <button
        type="submit"
        className="bg-cg-red hover:brightness-110 text-white font-semibold px-5 rounded-card transition"
      >
        Look up
      </button>
    </form>
  );
}
