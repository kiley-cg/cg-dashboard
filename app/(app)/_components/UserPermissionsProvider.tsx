"use client";

// Client-side cache of "what can this user do" so deeply-nested
// components can hide controls without prop-drilling permissions.
// The Set is computed server-side once per page render (via
// getUserPermissions) and hydrated here.

import { createContext, useContext, useMemo } from "react";
import type { PermissionKey } from "@/lib/permissions";

const Ctx = createContext<Set<PermissionKey> | null>(null);

interface ProviderProps {
  permissions: PermissionKey[]; // serializable; reconstituted to a Set on the client
  children: React.ReactNode;
}

export function UserPermissionsProvider({ permissions, children }: ProviderProps) {
  const set = useMemo(() => new Set(permissions), [permissions]);
  return <Ctx.Provider value={set}>{children}</Ctx.Provider>;
}

// Conditional render helper. Returns true when this user has the
// permission; pass into a `{can("…") && <Button />}` expression.
export function useCan(permission: PermissionKey): boolean {
  const set = useContext(Ctx);
  if (!set) {
    // No provider = treat as "not granted" so missing-wiring doesn't
    // silently leak controls. The page must mount the provider.
    return false;
  }
  return set.has(permission);
}
