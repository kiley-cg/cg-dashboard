"use client";

// Manager-only dropdown — switch the inbox view to another person's
// queue. ?user=<key> query param drives the page render server-side.

import { useRouter } from "next/navigation";
import { ROUTABLE_PEOPLE } from "@/lib/people/registry";

export function UserSwitcher({
  current,
  filter,
}: {
  current: string;
  filter: string;
}) {
  const router = useRouter();
  return (
    <select
      value={current}
      onChange={(e) =>
        router.push(`/inbox?user=${e.target.value}&filter=${filter}`)
      }
      className="border border-cg-n-300 rounded-input px-2 py-1 bg-white text-[12px]"
      title="Switch inbox view (manager only)"
    >
      {ROUTABLE_PEOPLE.filter((p) => p.syncoreUserId).map((p) => (
        <option key={p.key} value={p.key}>
          {p.displayName}
        </option>
      ))}
    </select>
  );
}
