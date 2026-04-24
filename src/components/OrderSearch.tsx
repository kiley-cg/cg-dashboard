"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./Button";

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
        className="flex-1 bg-white border border-cg-n-200 rounded-input px-4 py-2 text-cg-n-900 placeholder-cg-n-400 focus:outline-none focus:border-cg-red focus:ring-2 focus:ring-cg-red-100"
        autoFocus
      />
      <Button type="submit" size="md">
        Look up
      </Button>
    </form>
  );
}
