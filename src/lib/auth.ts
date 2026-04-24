import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "./db/client";
import { authConfig } from "./auth.config";

// Full config: adds the Drizzle adapter. Server-only (Node runtime).
// Middleware imports ./auth.config directly to stay edge-safe.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db),
});
